import "server-only";
import type { Tx } from "@/lib/posts/data";
import {
  agentTransaction,
  lockCredential,
  writeQuota,
  type Credential,
} from "./data";
import {
  AGENT_READ_LIMIT,
  AGENT_SUBMIT_LIMIT,
  AGENT_WINDOW_MS,
  AgentError,
  AgentScope,
  digestMatches,
  parseAgentBearer,
} from "./contract";
import { AgentFailure } from "./errors";

type Bearer = NonNullable<ReturnType<typeof parseAgentBearer>>;
function assertCredential(
  row: Credential | undefined,
  bearer: Bearer,
  scope: AgentScope,
  now: Date,
): asserts row is Credential {
  if (
    !row ||
    !digestMatches(bearer.tokenHash, row.tokenHash) ||
    row.revokedAt ||
    row.expiresAt <= now
  )
    throw new AgentFailure(AgentError.Unauthorized);
  if (!row.scopes.includes(scope)) throw new AgentFailure(AgentError.Forbidden);
}
export async function admitAgent(
  header: string | null,
  scope: AgentScope,
): Promise<Bearer> {
  const bearer = parseAgentBearer(header);
  if (!bearer) throw new AgentFailure(AgentError.Unauthorized);
  // Admission commits quota before parsing a body. Neither slow clients nor
  // invalid requests hold a DB lock or receive free write attempts.
  await agentTransaction(async (tx) => {
    const row = await lockCredential(tx, bearer.id);
    const now = new Date();
    assertCredential(row, bearer, scope, now);
    const read = scope === AgentScope.Read;
    const previous = read ? row.readWindow : row.submitWindow;
    const fresh =
      !previous || now.getTime() - previous.getTime() >= AGENT_WINDOW_MS;
    const window = fresh ? now : previous;
    const count = fresh ? 0 : read ? row.readCount : row.submitCount;
    if (count >= (read ? AGENT_READ_LIMIT : AGENT_SUBMIT_LIMIT))
      throw new AgentFailure(
        AgentError.RateLimited,
        Math.max(
          1,
          Math.ceil(
            (window.getTime() + AGENT_WINDOW_MS - now.getTime()) / 1000,
          ),
        ),
      );
    await writeQuota(tx, row.id, scope, window, count + 1);
  });
  return bearer;
}
export function withAuthorizedAgent<T>(
  bearer: Bearer,
  scope: AgentScope,
  work: (tx: Tx, credential: Credential) => Promise<T>,
): Promise<T> {
  return agentTransaction(async (tx) => {
    const row = await lockCredential(tx, bearer.id);
    assertCredential(row, bearer, scope, new Date());
    const result = await work(tx, row);
    // Expiry during expensive diff work rolls the whole operation back.
    assertCredential(row, bearer, scope, new Date());
    return result;
  });
}
