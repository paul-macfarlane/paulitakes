import {
  AGENT_BODY_LIMIT,
  AGENT_BODY_TIMEOUT_MS,
  AgentError,
} from "./contract";
import { AgentFailure } from "./errors";

export async function readAgentJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    ) ||
    ![null, "identity"].includes(request.headers.get("content-encoding"))
  )
    throw new AgentFailure(AgentError.MediaType);
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new AgentFailure(AgentError.Invalid);
    if (Number(length) > AGENT_BODY_LIMIT)
      throw new AgentFailure(AgentError.TooLarge);
  }
  if (!request.body) throw new AgentFailure(AgentError.Invalid);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  const expires = Date.now() + AGENT_BODY_TIMEOUT_MS;
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AgentFailure(AgentError.Timeout)),
      AGENT_BODY_TIMEOUT_MS,
    );
  });
  try {
    while (true) {
      if (Date.now() >= expires) throw new AgentFailure(AgentError.Timeout);
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > AGENT_BODY_LIMIT) throw new AgentFailure(AgentError.TooLarge);
      chunks.push(value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch (error) {
    if (error instanceof AgentFailure) throw error;
    throw new AgentFailure(AgentError.Invalid);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
