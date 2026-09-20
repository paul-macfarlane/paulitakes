import "server-only";
import { env } from "@/lib/shared/env";
import type { Tx } from "@/lib/posts/data";
import { agentTransaction, lockAgentState, writeQuota } from "./data";
import {
  AGENT_READ_LIMIT,
  AGENT_SUBMIT_LIMIT,
  AGENT_WINDOW_MS,
  AgentError,
  AgentQuota,
  configuredTokenMatches,
  parseAgentBearer,
} from "./contract";
import { AgentFailure } from "./errors";

type Bearer = string;
function assertToken(bearer: Bearer) {
  if (
    !configuredTokenMatches(bearer, env.AGENT_API_TOKEN, [
      env.BETTER_AUTH_SECRET,
      env.CRON_SECRET,
    ])
  )
    throw new AgentFailure(AgentError.Unauthorized);
}
export async function admitAgent(
  header: string | null,
  quota: AgentQuota,
): Promise<Bearer> {
  const bearer = parseAgentBearer(header);
  if (!bearer) throw new AgentFailure(AgentError.Unauthorized);
  assertToken(bearer);
  // Admission commits quota before parsing a body. Neither slow clients nor
  // invalid requests hold a DB lock or receive free write attempts.
  await agentTransaction(async (tx) => {
    const row = await lockAgentState(tx);
    const now = new Date();
    assertToken(bearer);
    const read = quota === AgentQuota.Read;
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
    await writeQuota(tx, row.id, quota, window, count + 1);
  });
  return bearer;
}
export function withAuthorizedAgent<T>(
  bearer: Bearer,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return agentTransaction(async (tx) => {
    await lockAgentState(tx);
    assertToken(bearer);
    const result = await work(tx);
    assertToken(bearer);
    return result;
  });
}
