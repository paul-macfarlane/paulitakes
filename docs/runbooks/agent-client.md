# Local Codex editorial reviews

AIR-6 provides a small command-line helper over the [agent REST API](agent-api.md). Codex runs it when you request a review. It reads the existing `AGENT_API_TOKEN` from its environment, performs one command and exits. There is no MCP connection to register, background process, or additional service to deploy.

## Setup

1. Use the current Node.js LTS release and run `pnpm install` in this checkout. Keep the checkout at the deployed API version.
2. Install the real **paulitakes-editor** skill locally. On Paul's machine it is `/Users/paulmacfarlane/.codex/skills/paulitakes-editor/SKILL.md`. A ChatGPT-only skill is not automatically available as a local file. Do not use the synthetic test fixture for real reviews.
3. Make the same `AGENT_API_TOKEN` configured on the site available in the environment used to run the helper. Provision it out of band as described in the API runbook; never put it in command arguments, proposal files, chat, or committed configuration. The helper does not load `.env` files or application database/OAuth configuration.
4. Set the two non-secret environment values below, replacing the examples. Run commands from this repository's root. No Codex MCP configuration is needed. If you previously configured the old `mcp_servers.paulitakes` entry from this PR, remove that obsolete entry from your local configuration.

```sh
export PAULITAKES_URL="https://your-paulitakes-site.example"
export PAULITAKES_EDITOR_SKILL_PATH="/absolute/path/to/paulitakes-editor/SKILL.md"
```

`PAULITAKES_URL` must be an HTTPS origin without a path, query or credentials; HTTP is allowed for localhost tests. Requests refuse redirects, so use the site's canonical origin. Credentials stay in the Authorization header. Each request has a 30-second timeout; errors expose a fixed message or HTTP status, not raw response bodies or exceptions.

## Request a review

Ask Codex: **“Use agent-review to review my saved post [title or UUID] and submit a proposal.”** The [review workflow](../harness/workflows/agent-review.md) tells Codex to load the complete editorial skill, read the requested post, research claims and prepare a complete candidate with separate notes. You do not need to construct JSON yourself.

The helper supports four commands. Each successful command prints JSON to stdout. Failure prints a sanitized message to stderr and exits nonzero. All commands except `brief` read a JSON object from stdin; no draft text or credentials belong in command arguments.

| Command  | Input                                      | Output                                                                                               |
| -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `brief`  | None                                       | Full installed brief, `skill.name/hash`, `siteUrl` and a fresh UUID `idempotencyKey` for this review |
| `list`   | `{}` or `{ "limit": 20, "after": "UUID" }` | Paginated saved-post metadata and next cursor                                                        |
| `read`   | `{ "postId": "UUID" }`                     | Saved snapshot, source version, category choices and open proposal ID                                |
| `submit` | Full proposal below                        | Proposal ID, reviewPath and replayed flag                                                            |

For example, Codex can keep request/response files in a private temporary directory:

```sh
review_dir="$(mktemp -d)"
node --import tsx scripts/agent-review.ts brief > "$review_dir/brief.json"
node --import tsx scripts/agent-review.ts list <<<'{}'
# Codex writes read.json and proposal.json using the returned context.
node --import tsx scripts/agent-review.ts read < "$review_dir/read.json"
node --import tsx scripts/agent-review.ts submit < "$review_dir/proposal.json"
```

The submit input contains `postId`, the read `sourceVersion`, a complete `candidate`, `notes`, `skillHash` copied from the loaded brief and the same review's `idempotencyKey`. Set `supersedesProposalId` only when the user explicitly requests replacing an existing open proposal. Candidate fields are title, slug, bodyMd, categoryId, tags, thumbnailUrl, bannerUrl and videoUrl; note fields follow the shared [proposal schema](../../src/lib/proposals/input.ts). The helper validates these fields, rereads the installed brief, verifies `skillHash`, and supplies the API's skill attribution. It never accepts a model-supplied `skill` object.

The workflow requires loading and reading the brief before each review. The helper is stateless: it does not track call order or prove that a model read or followed the instructions. The hash check prevents silently attributing an edit to a different installed brief. If the brief changed, reassess the review against the new brief before a new submission. For an uncertain prior submission, preserve the original input and brief; restore the original brief or inspect human review history before deciding what to do. Do not evade uncertainty with a new key.

On an uncertain submission, retry the **same saved proposal file**, including its key. Do not rerun `brief` just to obtain a new key. HTTP 409 requires rereading/reconsidering current state; 429 requires waiting; 401 requires checking the configured token. Keep temporary draft/proposal files private and out of Git, then remove them when the result is confirmed and they are no longer needed.

Open the returned reviewPath on siteUrl. Only the human owner/admin can select/apply changes; public posts stay unchanged until a separate human publication action. Editorial/fact/media notes remain outside the article. The helper has no database access, human session, direct edit, apply or publish command.

## Verification and limits

Tests cover fixed authenticated destinations, strict inputs, exact brief attribution, changed-brief rejection, stable retries, sanitized failures and actual CLI process exit/output behavior. The browser regression runs the CLI with a synthetic brief/token, submits through the REST API, verifies separate notes, applies privately and publishes through the human UI.

Live environment provisioning and a model's editorial/research quality need a real requested review after setup. The installed editorial brief can be checked locally without touching production content; hash attribution does not certify compliance or factual accuracy.
