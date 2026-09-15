import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createEditorServer, readConfig } from "../src/lib/agent-mcp/server";

try {
  const config = readConfig(process.env);
  await serveStdio(() => createEditorServer(config));
} catch {
  // stdout belongs exclusively to MCP; never print configuration or raw errors.
  console.error(
    "Paulitakes MCP failed to start. Check the agent MCP runbook and local configuration.",
  );
  process.exitCode = 1;
}
