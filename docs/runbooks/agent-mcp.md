# Local Codex editorial reviews

AIR-6 adds a local STDIO MCP adapter over the [agent REST API](agent-api.md). It has four tools: `load_editor_brief`, `list_drafts`, `read_draft`, and `submit_proposal`. It has no database connection, human session, apply, or publish tool. The existing single `AGENT_API_TOKEN` is its only API credential.

## Where it runs

Codex starts the adapter as a local process on your computer. Codex and the adapter communicate through standard input/output (STDIO), without opening an HTTP port. The adapter sends authenticated HTTPS requests to the existing Paulitakes REST API.

```text
Your computer                         Hosted Paulitakes app
Codex → local MCP adapter ──HTTPS──→ agent REST API
```

It is technically an MCP server because it provides tools to Codex, but it is not hosted by the website. The hosted app gains no MCP endpoint. This implements the agreed local adapter approach; it does not introduce a remote MCP service or OAuth setup.

## Setup

1. Use the current Node.js LTS release and run `pnpm install` in this checkout. Keep the checkout at the deployed API version.
2. Install the real **paulitakes-editor** skill locally. On Paul's current machine it is `/Users/paulmacfarlane/.codex/skills/paulitakes-editor/SKILL.md`. A skill stored only in ChatGPT is not automatically available to this process. Copy/install the maintained skill locally if needed; do not use the synthetic e2e fixture for real reviews.
3. Provision `AGENT_API_TOKEN` on the site and in the environment of the Codex process using the same value, as described in the API runbook. Do this out of band; do not paste it into a chat, source file, command argument or committed configuration. The adapter does not load `.env` files or the application's database/OAuth configuration.
4. Add this server to your local Codex configuration, replacing all example paths and the site origin. An absolute Node executable path is useful when a desktop app has a different PATH from your shell.

```toml
[mcp_servers.paulitakes]
command = "/absolute/path/to/node"
args = ["--import", "tsx", "/absolute/path/to/paulitakes/scripts/agent-mcp.mts"]
cwd = "/absolute/path/to/paulitakes"
env_vars = ["AGENT_API_TOKEN"]

[mcp_servers.paulitakes.env]
PAULITAKES_URL = "https://your-paulitakes-site.example"
PAULITAKES_EDITOR_SKILL_PATH = "/absolute/path/to/paulitakes-editor/SKILL.md"
```

Restart the Codex connection after configuration/environment changes. `env_vars` forwards the token from **Codex's environment**, not from a separate terminal opened later. No OAuth registration or additional credential layer is needed. Configuration fields follow the [official Codex MCP documentation](https://developers.openai.com/codex/mcp).

`PAULITAKES_URL` is an origin, with no path/query/credentials; HTTPS is required except for localhost. Local tests use `http://localhost:3000`. Authenticated fetches do not follow redirects, so configure the site's final canonical origin. Requests time out after 30 seconds. Failures expose status or a fixed message, never raw proxy bodies or exceptions. STDOUT is exclusively MCP protocol output.

## Request a review

In this repository, ask: **“Use agent-review to review my saved post [title or UUID] and submit a proposal.”** The [agent-review workflow](../harness/workflows/agent-review.md) explicitly loads the complete installed editorial skill, reads the requested saved snapshot, researches claims, and submits a candidate plus separate notes. It does not sweep other posts. The server also advertises these constraints to connected clients outside the repository.

The adapter retains the loaded brief's SHA-256 attribution for that connection until it is loaded again. Load it again for each review; if the file changes while reviewing, either finish against the already loaded brief or reload it and reassess the review before submitting. A hash records the actual brief provided, not proof of editorial compliance. Models must not supply their own skill hash.

Open the returned review link, select changes, and apply them. Public posts remain unchanged until a human separately publishes pending edits. An existing open proposal is replaced only with explicit supersession. On an uncertain submission, retry identical arguments and idempotencyKey; 409 requires reconsidering current state, 429 requires waiting, and 401 requires checking the provisioned token. Do not evade a lost response by generating another key.

## Verification and limits

Protocol tests cover tool visibility, required brief loading, exact attribution, schema rejection, retries, fixed destinations and sanitized errors. The browser regression spawns the real STDIO entrypoint with a **synthetic brief and token**, submits over the local REST API, and proves human apply remains private, receipt retries survive apply, and only a separate human publish action changes the public post.

These checks do not prove a model's editorial judgment, research quality, or live Codex token provisioning. Complete one requested real review after local configuration, checking the loaded brief, voice, factual notes and review link before applying anything. Never place a production token in test fixtures.
