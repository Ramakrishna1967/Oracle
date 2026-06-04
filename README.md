<div align="center">

# Oracle

**Autonomous Workspace Intelligence for Slack**

Oracle monitors your Slack workspace in real time, detects emerging cross-channel signal patterns, enriches them with live system context from GitHub and Jira, scores confidence, and delivers structured incident briefs directly to the right engineer — before anyone even files a ticket.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?style=flat-square&logo=redis)](https://redis.io/)
[![Slack](https://img.shields.io/badge/Slack-Bolt_SDK-4A154B?style=flat-square&logo=slack)](https://slack.dev/bolt-js/)

## License

This project is licensed under the [MIT License](LICENSE).

</div>

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [System Architecture](#system-architecture)
- [Component Deep Dive](#component-deep-dive)
- [Pipeline Flow](#pipeline-flow)
- [Confidence Scoring Model](#confidence-scoring-model)
- [Alert Format](#alert-format)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration Reference](#configuration-reference)
- [Slack App Setup](#slack-app-setup)
- [GitHub and Jira Integration](#github-and-jira-integration)
- [Health Monitoring](#health-monitoring)
- [Testing](#testing)

---

## Overview

Modern engineering teams work across dozens of Slack channels. When an incident begins, the early signals — timeout errors in `#backend`, deploy questions in `#devops`, user complaints in `#support` — appear scattered and unconnected.

**Oracle connects those dots automatically.**

It detects the pattern, pulls in live context (recent deploys, open tickets), scores its own confidence, and fires a structured brief to the most relevant engineer via DM — complete with one-click action buttons.

### Key Capabilities

| Capability | Description |
|---|---|
| Real-time signal ingestion | Processes messages, reactions, and member joins via Slack Socket Mode |
| Cross-channel correlation | Detects patterns spanning multiple channels using Jaccard similarity |
| External context enrichment | Pulls live GitHub deploy status and Jira tickets via MCP |
| Confidence scoring | Weighted multi-factor model scores each pattern 0-100 |
| Targeted DM delivery | Sends structured briefs to the most involved engineer |
| Rate limiting | Prevents alert fatigue with per-user and per-workspace limits |
| Audit trail | Full Redis Streams audit log of every action taken |
| One-click actions | Notify backup, post status update, escalate, or dismiss — all from the DM |

---

## How It Works

```
You type in Slack → Oracle detects the pattern → Oracle enriches context → Oracle scores confidence → Oracle DMs the right person
```

A concrete example:

> **09:14** — `@alice` posts in `#backend`: *"Getting critical DB timeouts"*
> **09:15** — `@bob` posts in `#devops`: *"Did someone just deploy? seeing errors"*
> **09:15** — `@carol` reacts with `:fire:` in `#support`

Oracle detects these three signals, correlates them to the topic `"timeout"`, checks GitHub for a recent failed deploy, finds one, scores confidence at **87/100**, and DMs `@alice` with a fully structured brief in under 3 seconds — before anyone opens a war room.

---

## System Architecture

```mermaid
graph TB
    subgraph Slack["Slack Workspace"]
        CH1["#backend"]
        CH2["#devops"]
        CH3["#support"]
        DM["Direct Message"]
    end

    subgraph Oracle["Oracle System"]
        direction TB

        subgraph SW["Signal Watcher"]
            MSG["Message Handler"]
            RXN["Reaction Handler"]
            MBR["Member Join Handler"]
            NRM["Normalizer"]
        end

        subgraph Q1["Queue: oracle-signals"]
            SQ["BullMQ Signal Queue"]
        end

        subgraph PE["Pattern Engine"]
            STR["Signal Store"]
            COR["Correlator"]
            DET["Detector"]
        end

        subgraph Q2["Queue: oracle-patterns"]
            PQ["BullMQ Pattern Queue"]
        end

        subgraph CE["Context Enricher"]
            MCP["MCP Client"]
            GHA["GitHub Adapter"]
            JRA["Jira Adapter"]
        end

        subgraph Q3["Queue: oracle-scoring"]
            SRQ["BullMQ Scoring Queue"]
        end

        subgraph CS["Confidence Scorer"]
            SCR["Scorer"]
            HLD["Hold Queue"]
        end

        subgraph Q4["Queue: oracle-actions"]
            AQ["BullMQ Action Queue"]
        end

        subgraph AL["Action Layer"]
            FMT["Formatter"]
            DMS["DM Sender"]
            AUD["Audit Logger"]
            RL["Rate Limiter"]
            AH["Action Handler"]
        end

        subgraph API["Express API"]
            HLT["Health Endpoint"]
        end
    end

    subgraph External["External Systems"]
        GH["GitHub API"]
        JR["Jira API"]
        RD["Redis"]
    end

    CH1 -->|events| MSG
    CH2 -->|events| MSG
    CH3 -->|events| RXN
    MSG --> NRM
    RXN --> NRM
    MBR --> NRM
    NRM --> SQ
    SQ --> STR
    STR --> COR
    COR --> DET
    DET --> PQ
    PQ --> MCP
    MCP --> GHA
    MCP --> JRA
    GHA -->|workflow runs| GH
    JRA -->|search issues| JR
    MCP --> SRQ
    SRQ --> SCR
    SCR -->|score >= threshold| AQ
    SCR -->|score in hold range| HLD
    HLD -->|rescore after 10min| SCR
    AQ --> RL
    RL --> FMT
    FMT --> DMS
    DMS -->|brief| DM
    DMS --> AUD
    AUD --> RD
    SQ --- RD
    PQ --- RD
    SRQ --- RD
    AQ --- RD

    style Oracle fill:#0d1117,stroke:#30363d,color:#e6edf3
    style Slack fill:#1a1a2e,stroke:#4A154B,color:#e6edf3
    style External fill:#0d1117,stroke:#30363d,color:#e6edf3
    style SW fill:#161b22,stroke:#30363d,color:#e6edf3
    style PE fill:#161b22,stroke:#30363d,color:#e6edf3
    style CE fill:#161b22,stroke:#30363d,color:#e6edf3
    style CS fill:#161b22,stroke:#30363d,color:#e6edf3
    style AL fill:#161b22,stroke:#30363d,color:#e6edf3
    style API fill:#161b22,stroke:#30363d,color:#e6edf3
```

---

## Component Deep Dive

### Component 1 — Signal Watcher

Connects to Slack via Socket Mode (WebSocket). Listens to three event types across all channels the bot is a member of.

```mermaid
flowchart LR
    subgraph Handlers
        MH["message.handler\nFilters bots/subtypes\nResolves channel name"]
        RH["reaction.handler\nMaps reaction to urgency score"]
        MBH["member.handler\nCaptures join events"]
    end

    subgraph Normalizer
        EE["extractEntities()\nUser mentions, channels,\nURLs, keywords"]
        UH["computeUrgencyHint()\nKeywords + exclamations\n+ CAPS words → 0-10"]
        ID["makeSignalId()\nSHA-256 deterministic ID\nfor deduplication"]
    end

    MH --> EE
    RH --> EE
    MBH --> EE
    EE --> UH
    UH --> ID
    ID -->|Signal object| Queue["oracle-signals queue"]
```

**Signal schema:**

```typescript
{
  signalId: string        // SHA-256 hash of channel+user+ts+content
  timestamp: number       // Unix ms
  channelId: string
  channelName: string
  userId: string
  eventType: 'message' | 'reaction' | 'member_joined' | 'thread_reply'
  rawContent: string
  extractedEntities: string[]   // user:U123, channel:general, keyword:outage
  urgencyHint: number           // 0-10
  workspaceId: string
}
```

---

### Component 2 — Pattern Engine

Consumes signals from the queue, maintains an in-memory bucketed signal store, and uses Jaccard similarity to detect cross-channel patterns.

```mermaid
flowchart TB
    SIG["Incoming Signal"] --> BUCK["Signal Bucket\n(keyed by workspace+entity)"]

    BUCK --> COR

    subgraph COR["Correlator"]
        JS["Jaccard Similarity\nCompares entity sets\nbetween signals"]
        VEL["Signal Velocity\nSignals per minute\nover 5-min window"]
        URG["Avg Urgency\nMean urgencyHint\nacross all signals"]
    end

    COR --> GATE{"Meets\nThreshold?"}

    GATE -->|"signals >= 2\nAND velocity >= 0.1\nOR urgency >= 3"| EMIT["Emit Pattern"]
    GATE -->|No| WAIT["Wait for\nmore signals"]

    EMIT --> FP["Bucket Fingerprint\nSignal IDs + channels\nPrevents re-emission"]
    FP --> PQ["oracle-patterns queue"]
```

**Deduplication:** Once a pattern is emitted for a given bucket state (identified by a fingerprint of all signal IDs + channels), it will not be re-emitted unless new signals arrive, changing the fingerprint.

---

### Component 3 — Context Enricher

Pulls external system context for each detected pattern using the Model Context Protocol (MCP). Both GitHub and Jira adapters are optional — Oracle degrades gracefully if they are unavailable.

```mermaid
flowchart LR
    PAT["Pattern"] --> CE

    subgraph CE["Context Enricher"]
        GHA["GitHub Adapter\nfetch workflow_runs\nFilter by last 30 min\nRepo from entities"]
        JRA["Jira Adapter\nsearch issues by topic\nFilter: status != Done\nPriority + assignee"]
        FB["Fallback\nDerive context from\nsignal velocity + urgency"]
    end

    GHA -->|MCP| GH["GitHub API"]
    JRA -->|MCP| JR["Jira API"]

    GHA -->|unavailable| FB
    JRA -->|unavailable| FB

    CE --> EP["EnrichedPattern\n+ deployStatus\n+ relatedTickets\n+ ownerAvailability\n+ onCallBackup\n+ unavailableSources"]
    EP --> SQ["oracle-scoring queue"]
```

---

### Component 4 — Confidence Scorer

Scores each enriched pattern against six weighted factors. Patterns above the fire threshold trigger immediate action. Patterns in the hold range are rescored after 10 minutes.

```mermaid
flowchart TB
    EP["EnrichedPattern"] --> SCORE

    subgraph SCORE["Scoring Engine"]
        CS["Channel Spread\n1ch=30, 2ch=60, 3ch=80, 4+ch=100\nWeight: 30%"]
        SV["Signal Velocity\n<1/min=25, 1/min=50, 2/min=75, 5+/min=100\nWeight: 25%"]
        EC["External Confirmation\nFailed deploy=100, In-progress=80\nOpen ticket=60, None=20\nWeight: 20%"]
        OA["Owner Availability\nAvailable=100, In meeting=40\nUnavailable=50 neutral\nWeight: 10%"]
        HM["Historical Match\nPhase 2 — currently 50\nWeight: 10%"]
        SU["Sentiment Urgency\nAvg urgencyHint / 10 * 100\nWeight: 5%"]
    end

    CS --> WS["Weighted Sum"]
    SV --> WS
    EC --> WS
    OA --> WS
    HM --> WS
    SU --> WS

    WS --> DEC{"Decision"}
    DEC -->|"score >= FIRE_THRESHOLD"| FIRE["FIRE\nEnqueue action"]
    DEC -->|"score >= HOLD_THRESHOLD"| HOLD["HOLD\nRescore in 10 min"]
    DEC -->|"score < HOLD_THRESHOLD"| DISC["DISCARD\nLog and drop"]
```

**Default thresholds:**

| Threshold | Default | Environment Variable |
|---|---|---|
| Fire | 30 | `CONFIDENCE_THRESHOLD` |
| Hold | 20 | `HOLD_THRESHOLD` |

---

### Component 5 — Action Layer

Formats the scored pattern into a Slack Block Kit brief, enforces rate limits, sends the DM with retry logic, and handles the interactive button responses.

```mermaid
sequenceDiagram
    participant Q as oracle-actions Queue
    participant RL as Rate Limiter
    participant FMT as Formatter
    participant DMS as DM Sender
    participant SL as Slack API
    participant AUD as Audit Logger
    participant RD as Redis

    Q->>RL: Check rate limit (user + workspace)
    alt Rate limit exceeded
        RL-->>Q: Suppress brief
        RL->>AUD: Log suppression
    else Allowed
        RL->>FMT: Format brief
        FMT-->>DMS: Block Kit message
        DMS->>SL: conversations.open
        SL-->>DMS: DM channel ID
        DMS->>SL: chat.postMessage (with blocks)
        SL-->>DMS: message timestamp
        DMS->>AUD: Log delivery
        AUD->>RD: XADD to audit stream
        alt DM fails after retries
            DMS->>SL: Post to fallback channel
        end
    end
```

**Rate limits:**

| Limit | Default |
|---|---|
| Max DMs per user per hour | 3 |
| Max DMs per workspace per hour | 20 |
| DM retry attempts | 2 |
| DM retry interval | 30 seconds |

---

## Pipeline Flow

End-to-end data flow from a single Slack message to a delivered brief:

```mermaid
sequenceDiagram
    participant U as Engineer (Slack)
    participant SW as Signal Watcher
    participant Q1 as oracle-signals
    participant PE as Pattern Engine
    participant Q2 as oracle-patterns
    participant CE as Context Enricher
    participant GH as GitHub MCP
    participant JR as Jira MCP
    participant Q3 as oracle-scoring
    participant CS as Confidence Scorer
    participant Q4 as oracle-actions
    participant AL as Action Layer
    participant DM as DM (Slack)

    U->>SW: Message event
    SW->>SW: Normalize + extract entities
    SW->>Q1: Enqueue signal

    Q1->>PE: Dequeue signal
    PE->>PE: Bucket by topic entity
    PE->>PE: Correlate (Jaccard + velocity)
    alt Pattern detected
        PE->>Q2: Enqueue pattern
    end

    Q2->>CE: Dequeue pattern
    CE->>GH: fetch workflow runs (last 30min)
    GH-->>CE: deploy status
    CE->>JR: search issues by topic
    JR-->>CE: related tickets
    CE->>Q3: Enqueue enriched pattern

    Q3->>CS: Dequeue enriched pattern
    CS->>CS: Score all 6 factors
    CS->>CS: Apply weighted sum
    alt score >= FIRE threshold
        CS->>Q4: Enqueue action
    else score in HOLD range
        CS->>CS: Hold 10 min then rescore
    else score < HOLD threshold
        CS->>CS: Discard
    end

    Q4->>AL: Dequeue action
    AL->>AL: Check rate limit
    AL->>AL: Format Block Kit brief
    AL->>DM: Send DM with action buttons
    DM-->>U: Brief delivered
```

---

## Confidence Scoring Model

The score is computed as a weighted sum of six independent factors, each normalized to 0-100:

```
score = (
  channelSpread      * 0.30 +
  signalVelocity     * 0.25 +
  externalConfirm    * 0.20 +
  ownerAvailability  * 0.10 +
  historicalMatch    * 0.10 +
  sentimentUrgency   * 0.05
) / 100
```

| Factor | Weight | What It Measures |
|---|---|---|
| Channel Spread | 30% | How many distinct channels the pattern spans |
| Signal Velocity | 25% | Rate of signals per minute over the last 5 minutes |
| External Confirmation | 20% | GitHub deploy failures or open Jira tickets |
| Owner Availability | 10% | Whether the primary engineer is reachable |
| Historical Match | 10% | Whether similar patterns have fired before |
| Sentiment Urgency | 5% | Average urgency score across all signals (keywords, CAPS, exclamations) |

---

## Alert Format

Every brief Oracle sends is a structured Slack Block Kit message with four one-click action buttons:

```
Oracle Alert (87/100)

SITUATION
Topic "timeout" is surfacing across #backend, #devops (5 signals, 2 channels in 20 min).

CONTEXT
• [FAILED] Deploy: api-gateway — failure (8 min ago)
• Ticket: ENG-4821 — DB connection pool exhaustion (P1, assigned: alice)
• Channels: #backend, #devops
• Velocity: 1.2 signals/min

Confidence: 87/100 | Top factors: channel spread (80), external confirmation (100)
Suggested: Investigate the failed deployment in api-gateway and assess rollback.

[ Notify Backup ]  [ Post Status Update ]  [ Escalate ]  [ Dismiss ]
```

**Action buttons:**

| Button | What It Does |
|---|---|
| Notify Backup | DMs the on-call backup engineer |
| Post Status Update | Posts a status message to the fallback channel |
| Escalate | Triggers escalation and logs to audit trail |
| Dismiss | Suppresses the pattern and continues monitoring |

---

## Project Structure

```
Oracle/
├── src/
│   ├── action-layer/
│   │   ├── __tests__/
│   │   │   ├── formatter.test.ts       Unit tests for brief formatter
│   │   │   └── rate-limiter.test.ts    Unit tests for rate limiter
│   │   ├── actions.handler.ts          Slack button interaction handlers
│   │   ├── audit.ts                    Redis Streams audit logger
│   │   ├── dm-sender.ts               DM delivery with retry logic
│   │   ├── formatter.ts               Slack Block Kit brief formatter
│   │   ├── index.ts                   BullMQ worker, orchestrates delivery
│   │   └── rate-limiter.ts            Per-user and per-workspace rate limits
│   │
│   ├── confidence-scorer/
│   │   ├── __tests__/
│   │   │   └── scorer.test.ts          Unit tests for scoring model
│   │   ├── hold-queue.ts              Delayed rescore logic for held patterns
│   │   ├── index.ts                   BullMQ worker
│   │   └── scorer.ts                  Six-factor weighted scoring engine
│   │
│   ├── config/
│   │   ├── index.ts                   Zod-validated config loader
│   │   └── redis.ts                   Redis connection factory (BullMQ + IORedis)
│   │
│   ├── context-enricher/
│   │   ├── __tests__/
│   │   │   └── mcp-client.test.ts      Unit tests for MCP client
│   │   ├── adapters/
│   │   │   ├── github.adapter.ts      GitHub MCP adapter (deploy status)
│   │   │   └── jira.adapter.ts        Jira MCP adapter (related tickets)
│   │   ├── index.ts                   BullMQ worker, orchestrates enrichment
│   │   └── mcp-client.ts             MCP stdio client with retry logic
│   │
│   ├── health/
│   │   ├── __tests__/
│   │   │   └── health.test.ts          Unit tests for health report
│   │   └── index.ts                   Health report builder + /oracle-health command
│   │
│   ├── pattern-engine/
│   │   ├── __tests__/
│   │   │   ├── correlator.test.ts      Unit tests for Jaccard + velocity
│   │   │   └── detector.test.ts        Unit tests for pattern detection
│   │   ├── correlator.ts              Jaccard similarity + signal velocity
│   │   ├── detector.ts               Pattern detection + fingerprinting
│   │   ├── index.ts                   BullMQ worker
│   │   ├── search.ts                  Pattern search utilities
│   │   └── store.ts                   In-memory signal bucket store
│   │
│   ├── queue/
│   │   ├── producers.ts               Job producers for all four queues + DLQ
│   │   └── queues.ts                  BullMQ queue definitions
│   │
│   ├── shared/
│   │   ├── constants.ts               All tunable constants and thresholds
│   │   ├── types/
│   │   │   ├── index.ts               Re-exports all types
│   │   │   ├── jobs.ts                BullMQ job data types
│   │   │   ├── pattern.ts             Pattern, EnrichedPattern, ScoredPattern types
│   │   │   └── signal.ts              Signal type
│   │   └── utils/
│   │       ├── errors.ts              Typed error classes
│   │       └── logger.ts              Pino structured logger factory
│   │
│   ├── signal-watcher/
│   │   ├── __tests__/
│   │   │   ├── message.handler.test.ts
│   │   │   └── normalizer.test.ts
│   │   ├── handlers/
│   │   │   ├── member.handler.ts      member_joined_channel events
│   │   │   ├── message.handler.ts     message.channels events
│   │   │   └── reaction.handler.ts    reaction_added events
│   │   ├── index.ts                   Slack Bolt app bootstrap
│   │   └── normalizer.ts             Entity extraction, urgency scoring, signal ID
│   │
│   ├── index.ts                       Main entry point, graceful shutdown
│   └── server.ts                      Express health API server
│
├── .env.example                        Environment variable template
├── .gitignore
├── docker-compose.yml                  Redis container
├── jest.config.js
├── manifest.json                       Slack app manifest (importable)
├── package.json
├── PHASES.md                           Build phase tracker
├── README.md
└── tsconfig.json
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 22
- **Docker** (for Redis)
- **A Slack workspace** where you can install apps
- **A Slack App** configured with Socket Mode (see [Slack App Setup](#slack-app-setup))

### 1. Clone the repository

```bash
git clone https://github.com/Ramakrishna1967/Oracle.git
cd Oracle
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your Slack credentials at minimum:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
REDIS_URL=redis://127.0.0.1:6379
```

### 4. Start Redis

```bash
docker compose up -d
```

Verify Redis is running:

```bash
docker exec oracle-redis redis-cli PING
# Expected: PONG
```

### 5. Start Oracle

```bash
# Development mode (hot reload via tsx)
npm run dev

# Production mode
npm run build
npm run start
```

You should see:

```
{"level":"info","component":"bootstrap","msg":"Starting Oracle..."}
{"level":"info","component":"pattern-engine","msg":"Pattern Engine started"}
{"level":"info","component":"context-enricher","msg":"Context Enricher started"}
{"level":"info","component":"confidence-scorer","msg":"Confidence Scorer started"}
{"level":"info","component":"action-layer","msg":"Action Layer started"}
{"level":"info","component":"signal-watcher","msg":"Signal Watcher connected to Slack"}
{"level":"info","component":"server","port":3000,"msg":"Express API server listening"}
```

### 6. Test it

In any Slack channel Oracle is a member of, send two or more messages containing urgency keywords:

```
production database is down
getting critical timeout errors now
```

Oracle will detect the pattern and DM you a structured brief within seconds.

---

## Configuration Reference

All configuration is loaded from environment variables and validated with Zod at startup. Oracle will refuse to start if required variables are missing or invalid.

### Required

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token from OAuth and Permissions page (starts with `xoxb-`) |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode (starts with `xapp-`) |
| `SLACK_SIGNING_SECRET` | Request signing secret from Basic Information |

### Redis

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL for BullMQ and rate limiter |

### Oracle Tuning

| Variable | Default | Description |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | `30` | Score (0-100) required to fire a brief |
| `HOLD_THRESHOLD` | `20` | Score (0-100) to hold a pattern for rescore |
| `MAX_DMS_PER_USER_PER_HOUR` | `3` | Rate limit — briefs per user per hour |
| `MAX_DMS_PER_WORKSPACE_PER_HOUR` | `20` | Rate limit — briefs per workspace per hour |
| `FALLBACK_CHANNEL_ID` | — | Channel ID to post to if DM delivery fails |

### MCP Integration (Optional)

| Variable | Default | Description |
|---|---|---|
| `MCP_GITHUB_COMMAND` | — | Command to launch GitHub MCP server (e.g. `npx`) |
| `MCP_GITHUB_ARGS` | — | Comma-separated args (e.g. `-y,@modelcontextprotocol/server-github`) |
| `MCP_JIRA_COMMAND` | — | Command to launch Jira MCP server |
| `MCP_JIRA_ARGS` | — | Comma-separated args |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | — | GitHub PAT with `repo` scope |

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express API server port |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `NODE_ENV` | `development` | Node environment |

---

## Slack App Setup

### Option A — Import manifest (recommended)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Select **From an app manifest**
3. Choose your workspace
4. Paste the contents of `manifest.json` from this repository
5. Click **Create**

### Option B — Manual setup

Create a new Slack app and configure the following:

**OAuth Scopes (Bot Token):**

```
channels:history
channels:read
chat:write
commands
im:write
reactions:read
users:read
```

**Event Subscriptions (Bot Events):**

```
message.channels
reaction_added
member_joined_channel
```

**Interactivity:** Enable and configure a valid Request URL

**Socket Mode:** Enable and generate an App-Level Token with `connections:write` scope

**Slash Commands:** Create `/oracle-health` pointing to your server

### Install and get tokens

1. Go to **OAuth and Permissions** and click **Install to Workspace**
2. Copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
3. Go to **Basic Information** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`
4. Go to **Basic Information** → **App-Level Tokens** → generate token with `connections:write` → `SLACK_APP_TOKEN`

---

## GitHub and Jira Integration

Oracle uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to communicate with external systems. Both integrations are optional — Oracle works without them using heuristic fallback context.

### GitHub Integration

Enables Oracle to pull live GitHub Actions workflow run status and correlate recent deploys with incidents.

**1. Generate a Personal Access Token**

Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)

Select the `repo` scope. Copy the token (starts with `ghp_`).

**2. Add to `.env`**

```env
MCP_GITHUB_COMMAND=npx
MCP_GITHUB_ARGS=-y,@modelcontextprotocol/server-github
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here
```

**3. What Oracle fetches**

Oracle calls `list_workflow_runs` filtered to the last 30 minutes. It looks for runs with status `failure` or `in_progress` and includes the result in every brief.

### Jira Integration

Enables Oracle to find open Jira tickets related to the detected topic cluster.

**Add to `.env`**

```env
MCP_JIRA_COMMAND=npx
MCP_JIRA_ARGS=-y,@modelcontextprotocol/server-jira
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-jira-api-token
```

---

## Health Monitoring

### Slash Command

In any Slack channel:

```
/oracle-health
```

Returns a report of all components, queue depths, recent fire rate, and Redis connectivity.

### HTTP Endpoint

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "components": {
    "redis": "ok",
    "signalWatcher": "ok",
    "patternEngine": "ok",
    "contextEnricher": "ok",
    "confidenceScorer": "ok",
    "actionLayer": "ok"
  },
  "queues": {
    "signals": { "waiting": 0, "active": 0, "failed": 0 },
    "patterns": { "waiting": 0, "active": 0, "failed": 0 },
    "scoring": { "waiting": 0, "active": 0, "failed": 0 },
    "actions": { "waiting": 0, "active": 0, "failed": 0 }
  }
}
```

### Dead Letter Queue

Jobs that fail all retry attempts are moved to a Dead Letter Queue (`oracle-dlq`) with full context including original queue, job data, error message, and stack trace. Monitor with:

```bash
docker exec oracle-redis redis-cli LLEN bull:oracle-dlq:failed
```

---

## Testing

Oracle has unit tests for all core algorithmic components.

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

**Test coverage targets:**

| Component | Tests |
|---|---|
| Signal normalizer | Entity extraction, urgency scoring, signal ID determinism |
| Correlator | Jaccard similarity, signal velocity |
| Detector | Pattern threshold logic, fingerprint deduplication |
| Scorer | All six factor scorers, weighted sum |
| Formatter | Block Kit structure, context bullet generation |
| Rate Limiter | Per-user and per-workspace limit enforcement |

---

## Queue Architecture

```mermaid
graph LR
    SIG["oracle-signals\nSignal ingestion queue"] -->|Pattern Engine worker| PAT["oracle-patterns\nPattern dispatch queue"]
    PAT -->|Context Enricher worker| SCR["oracle-scoring\nScoring queue"]
    SCR -->|Confidence Scorer worker| ACT["oracle-actions\nAction delivery queue"]
    ACT -->|Action Layer worker| DLQ["oracle-dlq\nDead Letter Queue\n(failed jobs only)"]

    style SIG fill:#1f2937,stroke:#374151,color:#f9fafb
    style PAT fill:#1f2937,stroke:#374151,color:#f9fafb
    style SCR fill:#1f2937,stroke:#374151,color:#f9fafb
    style ACT fill:#1f2937,stroke:#374151,color:#f9fafb
    style DLQ fill:#7f1d1d,stroke:#991b1b,color:#f9fafb
```

All queues are backed by Redis via BullMQ. Each queue has:
- **Concurrency:** Configurable per worker
- **Retry:** Up to 3 attempts with exponential backoff
- **DLQ:** Failed jobs after max attempts are moved to `oracle-dlq` with full context

---

## Graceful Shutdown

Oracle handles `SIGINT` and `SIGTERM` for clean shutdown:

1. Express API server closes (stops accepting new HTTP requests)
2. Signal Watcher disconnects from Slack Socket Mode
3. All BullMQ workers drain active jobs and close
4. Redis connections close cleanly

```bash
# Send shutdown signal
Ctrl+C

# Output
{"msg":"Shutting down Oracle..."}
{"msg":"Oracle shutdown complete. Exiting."}
```

---

<div align="center">

Built with TypeScript, Slack Bolt, BullMQ, Redis, and the Model Context Protocol.

</div>
