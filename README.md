# Oracle

Autonomous workspace intelligence layer for Slack. Detects emerging cross-channel signal patterns, enriches them with external system context, scores confidence, and delivers structured incident briefs directly to the right person — with one-click action buttons.

---

## What It Does

Oracle runs continuously in the background of your Slack workspace. When it detects that the same topic is surfacing across multiple channels simultaneously — timeouts, outages, deployment failures, etc. — it:

1. Aggregates and correlates the signals using a pattern engine
2. Enriches the pattern with context from GitHub (deploy status) and Jira (open tickets) via MCP
3. Scores the confidence of the pattern (0-100) using a weighted model
4. Sends a structured DM brief to the most relevant person with one-click action buttons

---

## Architecture

```
Slack Events
    |
    v
Signal Watcher        -- Listens to messages, reactions, member joins
    |
    v
Pattern Engine        -- BullMQ worker, buckets signals by topic, detects cross-channel patterns
    |
    v
Context Enricher      -- Fetches GitHub deploy status and Jira tickets via MCP
    |
    v
Confidence Scorer     -- Weighted scoring: channel spread, velocity, external confirmation
    |
    v
Action Layer          -- Formats brief, sends DM, handles button interactions
```

**Stack:** TypeScript, Node.js 22, Slack Bolt, BullMQ, Redis, Express, MCP SDK

---

## Project Structure

```
src/
  action-layer/         Formats briefs, sends DMs, handles button interactions, rate limiting
  confidence-scorer/    Weighted confidence scoring, hold queue
  config/               Config loader (Zod-validated), Redis connection factory
  context-enricher/     MCP client, GitHub and Jira adapters
  health/               /oracle-health slash command, Express health endpoint
  pattern-engine/       Signal store, Jaccard correlator, pattern detector
  queue/                BullMQ queue definitions and job producers
  shared/               Constants, types, logger, error classes
  signal-watcher/       Slack Bolt app, message/reaction/member event handlers, normalizer
  index.ts              Bootstrap and graceful shutdown
  server.ts             Express API server
```

---

## Getting Started

### Prerequisites

- Node.js >= 22
- Docker (for Redis)
- A Slack app with Socket Mode enabled

### 1. Clone and install

```bash
git clone https://github.com/your-username/oracle.git
cd oracle
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
REDIS_URL=redis://127.0.0.1:6379
```

See `.env.example` for all available options including GitHub and Jira MCP configuration.

### 3. Start Redis

```bash
docker compose up -d
```

### 4. Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm run start
```

---

## Slack App Setup

Import `manifest.json` directly into your Slack app configuration at api.slack.com/apps.

Required bot scopes:
- `channels:history`
- `channels:read`
- `chat:write`
- `commands`
- `im:write`
- `reactions:read`
- `users:read`

Socket Mode must be enabled with an App-Level Token that has `connections:write`.

---

## GitHub and Jira Integration (Optional)

To enable real deploy status and ticket enrichment, add to your `.env`:

```env
# GitHub
MCP_GITHUB_COMMAND=npx
MCP_GITHUB_ARGS=-y,@modelcontextprotocol/server-github
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...

# Jira
MCP_JIRA_COMMAND=npx
MCP_JIRA_ARGS=-y,@modelcontextprotocol/server-jira
```

Without these, Oracle still works — it derives context heuristically from the signal data.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | required | Bot OAuth token |
| `SLACK_APP_TOKEN` | required | App-level token for Socket Mode |
| `SLACK_SIGNING_SECRET` | required | Request signing secret |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL |
| `CONFIDENCE_THRESHOLD` | `85` | Score threshold to fire a brief (0-100) |
| `MAX_DMS_PER_USER_PER_HOUR` | `3` | Rate limit per user |
| `MAX_DMS_PER_WORKSPACE_PER_HOUR` | `20` | Rate limit per workspace |
| `FALLBACK_CHANNEL_ID` | — | Channel to post to if DM fails |
| `PORT` | `3000` | Express API port |
| `LOG_LEVEL` | `info` | Pino log level |

---

## Health Check

```bash
# Slash command in Slack
/oracle-health

# HTTP endpoint
curl http://localhost:3000/health
```

---

## Testing

```bash
npm test
npm run test:coverage
```

---

## License

Private
