import { readFileSync } from "node:fs";
import {
  EditorCommand,
  EditorCommandError,
  editorCommandSchema,
  readConfig,
  runEditorCommand,
} from "../src/lib/agent-client/service";

async function main() {
  const parsed = editorCommandSchema.safeParse(process.argv[2]);
  if (!parsed.success || process.argv.length !== 3)
    throw new EditorCommandError(
      "Usage: node --import tsx scripts/agent-review.ts <brief|list|read|submit>. Supply JSON on stdin except for brief.",
    );
  const config = readConfig(process.env);
  const input =
    parsed.data === EditorCommand.Brief
      ? {}
      : JSON.parse(readFileSync(0, "utf8"));
  const result = await runEditorCommand(parsed.data, input, config);
  console.log(JSON.stringify(result));
}
main().catch((error: unknown) => {
  console.error(
    error instanceof EditorCommandError
      ? error.message
      : "Review command failed. Check input JSON and local configuration; retry uncertain submissions with the same saved input.",
  );
  process.exitCode = 1;
});
