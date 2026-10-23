# typesafe-mcp

A standard [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server that exposes **TypeSafe AI's Jev decision model** as typed tools —
publishable to npm and runnable anywhere with `npx` or `bunx`.

```bash
npx -y @devbux/typesafe-mcp
```

## What is Jev?

Jev is TypeSafe AI's **System One** decision model. It never generates prose.
Instead, you give it:

- a **`state`** — a situation described as text or structured JSON, and
- a set of **typed questions** about that state,

and Jev returns **typed answers with calibrated probabilities**:

| Question type | You define | Jev returns |
| --- | --- | --- |
| `choice` | 2–255 labelled options (each with an optional description) | the chosen option, a confidence value, and a probability for every option |
| `score` | an ordered scale of level descriptions (at least 2) | a numeric score on your scale, confidence, and per-level probabilities |
| `noul` | a proposition (optionally with true/false descriptions) | a calibrated probability (0..1) that the proposition is true |
| `box` | what to find, and in which image | the target's bounding-box edges (`top`, `bottom`, `left`, `right` as fractions 0..1) and a confidence value |

Questions can also read **images**: pass pictures in an `assets` map and
reference them from the `state`, `instructions`, or `criteria` — see
[Images](#images). `instructions` and `criteria` accept structured JSON
(objects/arrays), not just strings.

Because the output is structured and calibrated rather than free text, Jev is
well suited to routing, triage, moderation, risk scoring, prioritisation, and
any other "decide, don't chat" step inside an agent workflow.

## Requirements

- Node.js **>= 18** (or Bun) to run the server.
- A TypeSafe AI API key (see [Getting an API key](#getting-an-api-key)).

## Install & run

The server speaks MCP over **stdio**, so you normally don't run it by hand —
your MCP client launches it. The commands below are how clients (or you, for a
quick smoke test) start it.

### npx (Node)

```bash
TYPESAFE_API_KEY=your-key npx -y @devbux/typesafe-mcp
```

### bunx (Bun)

```bash
TYPESAFE_API_KEY=your-key bunx @devbux/typesafe-mcp
```

### Global install (npm)

```bash
npm install -g @devbux/typesafe-mcp
TYPESAFE_API_KEY=your-key typesafe-mcp
```

### Global install (Bun)

```bash
bun add -g @devbux/typesafe-mcp
TYPESAFE_API_KEY=your-key typesafe-mcp
```

> The server starts even when `TYPESAFE_API_KEY` is not set, so clients can
> still list its tools; each tool call then returns a clear error naming the
> missing variable instead of crashing.

## Getting an API key

Create an API key in the TypeSafe console at
[typesafe.ai](https://typesafe.ai), then expose it to the server as the
`TYPESAFE_API_KEY` environment variable. Never commit your key to source
control.

## MCP client configuration

### Generic (`mcpServers` JSON)

Most MCP clients (Claude Desktop, and many others) accept a configuration
like this — see also [`examples/mcp-config.json`](examples/mcp-config.json):

```json
{
  "mcpServers": {
    "typesafe": {
      "command": "npx",
      "args": ["-y", "@devbux/typesafe-mcp"],
      "env": {
        "TYPESAFE_API_KEY": "YOUR_TYPESAFE_API_KEY"
      }
    }
  }
}
```

Using Bun instead:

```json
{
  "mcpServers": {
    "typesafe": {
      "command": "bunx",
      "args": ["@devbux/typesafe-mcp"],
      "env": {
        "TYPESAFE_API_KEY": "YOUR_TYPESAFE_API_KEY"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add typesafe \
  -e TYPESAFE_API_KEY=YOUR_TYPESAFE_API_KEY \
  -- npx -y @devbux/typesafe-mcp
```

### Cursor / VS Code

Cursor and VS Code use the same `mcpServers` JSON shape above (Cursor:
`.cursor/mcp.json` or Settings → MCP; VS Code: `.vscode/mcp.json` uses a
top-level `"servers"` key with the same per-server fields). Paste the generic
config and replace the placeholder key.

## Configuration

| Environment variable | Default | Description |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | _(unset)_ | Bearer API key for the TypeSafe AI API. Required for tool calls; the server still starts without it. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Base URL of the TypeSafe AI API. |
| `TYPESAFE_JEV_MODEL` | `jev-latest` | Jev model id to request. Can be overridden per call with the tools' optional `model` argument. Use `jev_list_models` to see what is available. |

## Tools

All tools return the Jev API response as JSON text content. Errors (missing
API key, HTTP 401/403/429/5xx, network failures, timeouts) are returned as MCP
tool errors (`isError`) with a clear message that includes the HTTP status —
never your API key.

| Tool | Inputs | Output |
| --- | --- | --- |
| `jev_decide` | `state` (string \| JSON object \| JSON array), `questions` (map of name → typed question, at least 1), optional `model`, `assets`, `long_context` | All answers in one call: `{ answers, model, usage }` |
| `jev_choice` | `state`, `instructions`, `options` (object: label → description or `null`, 2–255), optional `model`, `assets`, `long_context` | One Choice answer under the name `answer` |
| `jev_score` | `state`, `instructions`, `levels` (array of level descriptions, at least 2, ordered low → high), optional `model`, `assets`, `long_context` | One Score answer under the name `answer` |
| `jev_noul` | `state`, `instructions`, optional `criteria` (`{ "true": ..., "false": ... }` descriptions), optional `model`, `assets`, `long_context` | One Noul answer (probability 0..1) under the name `answer` |
| `jev_box` | `state`, `instructions` (what to find, and in which image), optional `assets`, `model` (default `jev-1.14.0`), `long_context` | One Box answer (`box` edges + confidence) under the name `answer` |
| `jev_list_models` | _(none)_ | `{ models: [{ name, description, release_date }] }` |

`assets` and `long_context` are described under [Images](#images) and
[Long context](#long-context).

### Question shapes for `jev_decide`

```jsonc
{
  "type": "choice",
  "instructions": "Which department should handle this?",
  "criteria": { "billing": "Payments and invoices", "technical": null }
}
```

```jsonc
{
  "type": "score",
  "instructions": "How urgent is this?",
  "criteria": ["not urgent", "low", "medium", "high", "critical"]
}
```

```jsonc
{
  "type": "noul",
  "instructions": "Is a refund likely to be requested?"
  // "criteria" is optional for noul and omitted when not provided
}
```

```jsonc
{
  "type": "box",
  "instructions": "the coffee mug in `kitchen_photo`"
  // box takes no criteria; it needs an image in the request and Jev 1.14
}
```

## Images

An image can go anywhere text can go in a request: in the `state`, in a
question's `instructions`, and in its `criteria`. Every decision tool accepts
an optional `assets` argument — a map from a **reference string** to an
image, base64-encoded:

```json
{
  "state": "Doorbell camera frame: doorbell_img",
  "questions": {
    "person_at_door": {
      "type": "noul",
      "instructions": "Is a person visible in doorbell_img?"
    },
    "person_where": {
      "type": "box",
      "instructions": "the person in `doorbell_img`"
    }
  },
  "assets": {
    "doorbell_img": { "data_base64": "<base64, no data: prefix>", "format": "jpg" }
  },
  "model": "jev-1.14.0"
}
```

Rules from the TypeSafe docs:

- Write each asset's reference wherever the image belongs (whole value or
  inside a longer string). Every asset must be referenced at least once, or
  the API returns `400` — this server checks that before sending. Use
  distinctive references (a UUID is safest): references match as plain text,
  so a short one like `cat` could also match inside `category`.
- Formats: **PNG or JPEG** only, still images. Each image: at most **16 MiB**,
  each side **280–1568 px**; the request body and all images together are
  capped at 32 MiB. Images are never resized by the API — prepare them
  (upright, within the limits) before sending.
- Images are an opt-in "danger zone" feature: the server automatically sends
  the `TypeSafe-Danger-Zone-Images: true` header whenever a request has
  assets or a Box question. TypeSafe marks these features experimental —
  formats and limits may change between releases.
- Jev **1.13 and 1.14** both accept images. **Box questions need Jev 1.14**:
  send `jev-1.14.0` or `jev-preview` as the model (`jev_box` defaults to
  `jev-1.14.0`). A Box answer is always a box, even when the target is
  absent — pair it with a `noul` presence check when that matters.
- The API also accepts multipart uploads; MCP tool calls carry JSON, so this
  server always uses the base64 form.

## Long context

Jev's default context limits are 64k tokens per request and 32k per
question. Any decision tool accepts `long_context: true`, which sends the
`TypeSafe-Danger-Zone-Long-Context: true` header and raises both limits to
262k tokens. TypeSafe marks this experimental too: it is slower and less
accurate, so use it only when a request does not fit the default limits.

## Worked example

A support ticket comes in. In **one** `jev_decide` call you can route it,
rate its urgency, and estimate refund risk:

**Request** (tool `jev_decide`):

```json
{
  "state": "Customer writes: 'I was charged twice for my subscription this month and I want my money back today. This is the second billing problem in three months.'",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which department should handle this ticket?",
      "criteria": {
        "billing": "Charges, invoices, payments and refunds",
        "technical": "Product bugs and technical problems",
        "sales": "Pricing, plans and new purchases"
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is this ticket?",
      "criteria": ["not urgent", "low", "medium", "high", "critical"]
    },
    "refund_likely": {
      "type": "noul",
      "instructions": "Is this customer likely to request a refund?"
    }
  }
}
```

**Response** (shape; exact values come from the live model):

```json
{
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "confidence": 0.91,
      "probabilities": { "billing": 0.91, "technical": 0.06, "sales": 0.03 }
    },
    "urgency": {
      "type": "score",
      "score": 4,
      "confidence": 0.8,
      "probabilities": { "1": 0.02, "2": 0.05, "3": 0.13, "4": 0.55, "5": 0.25 }
    },
    "refund_likely": {
      "type": "noul",
      "noul": 0.72
    }
  },
  "model": "jev-1.13.0",
  "usage": { "input_tokens": 120, "output_tokens": 45 }
}
```

## Development

```bash
git clone https://github.com/devbux/typesafe-mcp.git
cd typesafe-mcp

npm install
npm run dev        # run the server from source with tsx (stdio)
npm run typecheck  # tsc --noEmit
npm test           # vitest (fake fetch — no live network calls)
npm run build      # bundle to dist/index.js with tsup
npm start          # run the built server
```

Project layout:

```text
src/
  index.ts       stdio bootstrap
  server.ts      MCP server + the six jev_* tools (zod-validated)
  config.ts      environment parsing (TYPESAFE_*)
  jev/
    client.ts    typed JevClient for POST /v1/systemone and GET /v1/models
    types.ts     request/response types for the Jev API
test/
  client.test.ts JevClient + config unit tests
```

## Publishing

Releases are published to npm by the **Publish to npm** GitHub Action
(`.github/workflows/publish.yml`):

1. Bump the version in `package.json`, update `CHANGELOG.md`, and push.
2. Create a **GitHub Release** for the new version tag (or run the workflow
   manually with `workflow_dispatch`).
3. The workflow runs typecheck, tests, and build, then publishes with
   `npm publish --provenance --access public`.

Notes:

- The workflow expects an `NPM_TOKEN` repository secret (an npm automation
  token for an account/organisation that owns the `@devbux` scope).
- Provenance is enabled (`id-token: write` permission + `--provenance`), so
  each published version is linked to its GitHub Actions build.
- This is a **scoped** package (`@devbux/typesafe-mcp`); `publishConfig.access`
  is set to `public` in `package.json` so releases are publicly installable.
- `prepublishOnly` also runs typecheck, tests, and build for manual publishes.

## License

[MIT](LICENSE) © 2026 devbux
