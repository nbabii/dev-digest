# DevDigest MCP server

A local MCP server (stdio) that exposes DevDigest to Claude Code and other MCP
clients. It is a thin wrapper over the DevDigest HTTP API — it holds no data and
no keys of its own.

## Tools

| Tool | What it does | Writes? |
|---|---|---|
| `list_agents` | Configured review agents, with the `id` to pass as `agent` | no |
| `run_agent_on_pr` | Runs one agent on a PR and returns the finished verdict + findings (waits up to ~90 s, else returns a `run_id`) | **yes** (spends LLM credits) |
| `get_findings` | Verdict and findings of an already finished run (filters, pagination) | no |
| `get_conventions` | Stored repo conventions (never starts a scan) | no |
| `get_blast_radius` | Stub — returns `not_implemented` | no |

Arguments are flat: `repo` is `"owner/name"`, `pr` is the PR number, `agent` is
an agent id or name. Responses are concise by default (`response_format`:
`concise` | `detailed`), paginated, and capped at ~25k tokens.

## Prerequisites

- The DevDigest API running (`./scripts/dev.sh` from the repo root) with the repo
  imported and at least one agent configured. PRs must already be known to the API.
- Node 20+.

## Install and test

```bash
cd mcp-server
npm install
npm test
```

## Register with Claude Code

```bash
claude mcp add devdigest -- npm --silent --prefix /abs/path/to/dev-digest/mcp-server start
claude mcp list            # should show devdigest as connected
```

`--silent` is required: npm's run banner would otherwise corrupt the stdio
stream. Alternative that avoids npm entirely:

```bash
claude mcp add devdigest -- /abs/path/to/dev-digest/mcp-server/node_modules/.bin/tsx /abs/path/to/dev-digest/mcp-server/src/main.ts
```

Environment (pass with `claude mcp add -e KEY=value …`):

- `DEVDIGEST_API_URL` — API base URL, default `http://localhost:3001`
- `DEVDIGEST_MCP_WAIT_MS` — how long `run_agent_on_pr` waits, default `90000`

If the API is not running, tools answer with "DevDigest API not reachable …
Next: start it with ./scripts/dev.sh".

## Try it

Ask Claude Code: "List my DevDigest agents, then run the security agent on PR 12
of acme/api and show the critical findings."
