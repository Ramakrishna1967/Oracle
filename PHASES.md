# Oracle — Build Phases

## Phase 1 — Project Scaffold and Configuration
Files: package.json, tsconfig.json, jest.config.js, docker-compose.yml, manifest.json, .env.example, .gitignore
Status: COMPLETE

---

## Phase 2 — Shared Infrastructure
Files:
- src/shared/constants.ts
- src/shared/types/signal.ts
- src/shared/types/pattern.ts
- src/shared/types/jobs.ts
- src/shared/types/index.ts
- src/shared/utils/logger.ts
- src/shared/utils/errors.ts
- src/config/index.ts
- src/config/redis.ts
Status: COMPLETE

---

## Phase 3 — Queue Layer
Files:
- src/queue/queues.ts
- src/queue/producers.ts
Status: COMPLETE

---

## Phase 4 — Signal Watcher (Component 1)
Files:
- src/signal-watcher/normalizer.ts
- src/signal-watcher/handlers/message.handler.ts
- src/signal-watcher/handlers/reaction.handler.ts
- src/signal-watcher/handlers/member.handler.ts
- src/signal-watcher/index.ts
- src/signal-watcher/__tests__/normalizer.test.ts
- src/signal-watcher/__tests__/message.handler.test.ts
Status: COMPLETE

---

## Phase 5 — Pattern Engine (Component 2)
Files:
- src/pattern-engine/store.ts
- src/pattern-engine/correlator.ts
- src/pattern-engine/detector.ts
- src/pattern-engine/search.ts
- src/pattern-engine/index.ts
- src/pattern-engine/__tests__/correlator.test.ts
- src/pattern-engine/__tests__/detector.test.ts
Status: COMPLETE

---

## Phase 6 — Context Enricher (Component 3)
Files:
- src/context-enricher/mcp-client.ts
- src/context-enricher/adapters/github.adapter.ts
- src/context-enricher/adapters/jira.adapter.ts
- src/context-enricher/index.ts
- src/context-enricher/__tests__/mcp-client.test.ts
Status: COMPLETE

---

## Phase 7 — Confidence Scorer (Component 4)
Files:
- src/confidence-scorer/scorer.ts
- src/confidence-scorer/hold-queue.ts
- src/confidence-scorer/index.ts
- src/confidence-scorer/__tests__/scorer.test.ts
Status: COMPLETE

---

## Phase 8 — Action Layer (Component 5)
Files:
- src/action-layer/audit.ts
- src/action-layer/rate-limiter.ts
- src/action-layer/formatter.ts
- src/action-layer/dm-sender.ts
- src/action-layer/actions.handler.ts
- src/action-layer/index.ts
- src/action-layer/__tests__/formatter.test.ts
- src/action-layer/__tests__/rate-limiter.test.ts
Status: COMPLETE

---

## Phase 9 — Entry Point, Health and Integration Tests
Files:
- src/health/index.ts
- src/server.ts
- src/index.ts
Status: COMPLETE

---

## Phase 10 — GitHub and Jira MCP Integration (Planned)
Files:
- src/context-enricher/adapters/github.adapter.ts (extend)
- src/context-enricher/adapters/jira.adapter.ts (extend)
Status: PENDING — requires GITHUB_PERSONAL_ACCESS_TOKEN and Jira credentials in .env
