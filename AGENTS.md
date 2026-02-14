# CLAUDE-GO KNOWLEDGE BASE

**Generated:** 2026-02-14
**Directory:** `claude-go`

## WHO THIS FILE IS FOR

This document is for agents editing the `claude-go` repository with Claude Code (or compatible coding agents).
It is a project engineering guide, not a runtime prompt for the Telegram bot itself.

## INSTRUCTION PRECEDENCE (CLAUDE CODE)

When instructions overlap, use this order:

1. Active system/developer instructions in the current Claude Code session
2. `AGENTS.md` (this file, repository-specific source of truth)
3. `CLAUDE.md` in this repository (quick-start companion)
4. `README.md` and other docs

If `CLAUDE.md` and `AGENTS.md` differ, follow `AGENTS.md`.

## OVERVIEW

Telegram bot that remotely controls Claude Code AI sessions from a phone. Bun + TypeScript + grammy + @anthropic-ai/claude-agent-sdk. Clean Architecture (Hexagonal / Ports & Adapters). **Single-process** — no separate server required.

## STRUCTURE

```
src/
├── main.ts                    # Main bot composition root — DI wiring, bot start
├── hookBot.ts                 # Hook bot composition root — session notification process
├── domain/                    # Pure types + ports. ZERO external deps.
│   ├── models.ts              #   SessionRef, ChatState, UserSettings, ImageAttachment
│   ├── events.ts              #   ClaudeEvent discriminated union (8 event types)
│   ├── errors.ts              #   AppError hierarchy (QueryError, etc.)
│   ├── hookBotTypes.ts        #   HookBotConfig, TrackedSession, HookNotification
│   └── ports/
│       ├── ClaudeAgentPort.ts #   runQuery() → QueryHandle (AsyncGenerator), getSupportedModels()
│       ├── SessionStorePort.ts #  Session CRUD (create, list, get, update, delete)
│       ├── ChatOutputPort.ts  #   sendText, editText, sendFile, sendAudio, sendInteraction, editInteraction
│       ├── StateStore.ts      #   getChatState, saveChatState, withChatLock
│       ├── SummaryPort.ts     #   summarize + summarizeForVoice
│       ├── TtsPort.ts         #   Text-to-speech synthesis interface
│       ├── TranscriptionPort.ts # Voice-to-text transcription (Whisper)
│       ├── CoordinationPort.ts #  Bot-to-bot event pub/sub for debate/review
│       ├── BotRegistryPort.ts #   Bot registration, listing, role lookup
│       ├── GroupSettingsPort.ts # Group-shared settings (debate rounds)
│       ├── CustomAgentPort.ts #   Custom agent definitions (system prompts)
│       ├── MemoryPort.ts      #   Semantic memory interface (Phase 5)
│       └── HookNotificationPort.ts # Notification output for hook bot
├── app/                       # Usecases — imports domain/ ONLY
│   ├── usecases/
│   │   ├── promptFlow.ts      #   Text msg → query() AsyncGenerator → throttled edits → delivery
│   │   ├── sessionCommands.ts #   /new /list /resume /abort + exportSessionHistory
│   │   ├── interactiveFlow.ts #   AskUserQuestion tool detection → user response round-trip
│   │   ├── debateFlow.ts      #   /debate /review + bot-to-bot coordination
│   │   ├── sessionWatcher.ts  #   Query state tracking + live message updates + inactivity detection
│   │   ├── completionWatcher.ts # Hook bot session monitoring
│   │   ├── tunnelManager.ts   #   cloudflared subprocess management per chat
│   │   └── voiceFlow.ts       #   Voice TTS response generation
│   ├── queue/
│   │   ├── chatQueue.ts       #   Per-chat promise-chain serialization
│   │   └── messageQueue.ts    #   Message delivery queue with retry
│   └── policies/
│       ├── deliveryRouter.ts  #   inline(<3.8k) / chunk / file(>oversize) routing
│       └── limits.ts          #   All numeric constants (thresholds, TTLs, retries)
├── adapters/                  # External world — implements ports
│   ├── telegram/
│   │   ├── bot.ts             #   grammy init, default HTML parse mode, ChatOutputPort impl
│   │   ├── authMiddleware.ts  #   ALLOWED_USER_IDS check (silent drop on unauthorized)
│   │   ├── groupMiddleware.ts #   Group chat @mention routing
│   │   ├── rateLimitMiddleware.ts # Token bucket rate limiter
│   │   ├── awaitingInputMiddleware.ts # Auto-cancel awaiting input on destructive commands
│   │   ├── hookBotAdapter.ts  #   HookNotificationPort impl for Telegram
│   │   ├── commands/
│   │   │   ├── index.ts       #   Command router + callback query dispatcher + text handler
│   │   │   ├── new.ts         #   /new [title]
│   │   │   ├── resume.ts      #   /resume [number]
│   │   │   ├── list.ts        #   /list (paginated with inline keyboard)
│   │   │   ├── abort.ts       #   /abort
│   │   │   ├── history.ts     #   /history — export session history as file
│   │   │   ├── help.ts        #   /help
│   │   │   ├── start.ts       #   /start — onboarding + status overview
│   │   │   ├── status.ts      #   /status
│   │   │   ├── agents.ts      #   /agents — list + inline keyboard to switch
│   │   │   ├── makeagent.ts   #   /makeagent — create custom agent with system prompt
│   │   │   ├── settings.ts    #   /settings — summary mode, review mode, voice, output format
│   │   │   ├── groupsettings.ts # /groupsettings — group-shared settings
│   │   │   ├── debate.ts      #   /debate — start bot-to-bot debate
│   │   │   ├── review.ts      #   /review — request code review from peer bot
│   │   │   ├── bots.ts        #   /bots — list registered bots
│   │   │   ├── addbot.ts      #   /addbot — interactive bot setup wizard
│   │   │   ├── addhookbot.ts  #   /addhookbot — hook bot setup wizard
│   │   │   ├── queue.ts       #   /queue /clearqueue /showqueue
│   │   │   ├── undo.ts        #   /undo /redo
│   │   │   ├── restart.ts     #   /restart — restart bot process
│   │   │   ├── git.ts         #   /git — git status, diff, log
│   │   │   └── tunnel.ts      #   /tunnel — cloudflared tunnel to localhost
│   │   └── ui/
│   │       ├── callbacks.ts   #   Callback query parser (q:, agent:, settings:, gs:, sm:, listpage:, etc.)
│   │       └── keyboards.ts   #   InlineKeyboard builders for questions/settings
│   ├── claude/
│   │   ├── claudeAgentAdapter.ts #  ClaudeAgentPort impl via Agent SDK query()
│   │   ├── claudeEventMapper.ts  #  SDKMessage → ClaudeEvent mapping
│   │   ├── claudeSummaryService.ts # SummaryPort impl via Claude CLI subprocess
│   │   └── jsonSessionStore.ts    # SessionStorePort impl (atomic JSON file)
│   ├── whisper/
│   │   └── openaiWhisperAdapter.ts # TranscriptionPort impl via OpenAI Whisper API
│   ├── tts/
│   │   └── edgeTtsAdapter.ts  #   TtsPort impl via edge-tts CLI (Korean voices)
│   ├── persistence/
│   │   ├── jsonStateStore.ts  #   Atomic write (tmp+rename), in-process lock per chatId
│   │   └── hookBotStateStore.ts # Hook bot state persistence
│   └── coordination/
│       ├── fileCoordinationAdapter.ts # CoordinationPort impl via filesystem
│       ├── fileRegistryAdapter.ts     # BotRegistryPort impl via registry.json
│       ├── fileGroupSettingsAdapter.ts # GroupSettingsPort impl via group-settings.json
│       └── fileCustomAgentAdapter.ts  # CustomAgentPort impl via filesystem
├── cli/                       # CLI tools (not part of bot runtime)
│   ├── setup.ts               #   Interactive setup wizard (bun run setup)
│   └── doctor.ts              #   Configuration diagnostics (bun run doctor)
├── config/
│   ├── env.ts                 #   Validates & returns EnvConfig (throws on missing required vars)
│   └── projects.ts            #   Reads data/projects.json, 1-based indexing
└── shared/
    ├── logger.ts              #   Prefixed logger: [TELEGRAM], [CLAUDE], [SESSION], etc.
    ├── formatResponse.ts      #   telegramify-markdown wrapper + HTML sanitizer + stripHtml
    ├── structuralExtract.ts   #   Extracts headings, file paths, bullets from markdown
    ├── waitForServer.ts       #   PM2 boot-time race condition guard
    └── constants.ts           #   TELEGRAM_MAX_MESSAGE_LENGTH, etc.
```

## DEPENDENCY RULES (NEVER VIOLATE)

```
domain/     → imports NOTHING (pure TypeScript only)
app/        → imports domain/ only
adapters/   → imports app/ + domain/ (implements ports)
main.ts     → imports everything (composition root)
hookBot.ts  → imports everything (second composition root)
shared/     → imports nothing from other layers
config/     → imports domain/ (for ProjectRef type) + shared/
```

**FORBIDDEN imports**:
- `domain/` or `app/` must NEVER import `grammy`, `@anthropic-ai/claude-agent-sdk`, `undici`
- Runtime integration libraries (Telegram SDK, Claude SDK, HTTP clients, persistence clients) belong in `adapters/`
- `domain/` and `app/` must remain framework-free
- `config/` and `shared/` may use lightweight utilities only when they do not pull framework concerns into `domain/` or `app/`

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new Telegram command | See checklist below | Multiple files need updates |
| Change prompt/response flow | `app/usecases/promptFlow.ts` | query() AsyncGenerator + throttled edits |
| Handle new Claude event | `adapters/claude/claudeEventMapper.ts` + `domain/events.ts` | Add to ClaudeEvent union |
| Change delivery thresholds | `app/policies/limits.ts` + `shared/constants.ts` | Two places for constants |
| Add new error type | `domain/errors.ts` | Extend `AppError` with unique code |
| Question UX | `app/usecases/interactiveFlow.ts` + `adapters/telegram/ui/` | AskUserQuestion tool detection |
| State schema changes | `domain/models.ts` + `adapters/persistence/jsonStateStore.ts` | Update `migrateState()` for backward compat |
| Response formatting | `shared/formatResponse.ts` + `app/policies/deliveryRouter.ts` | Block tokenizer preserves code fences |
| Summary feature | `adapters/claude/claudeSummaryService.ts` | CLI subprocess: `claude -p` |
| Agent/model selection | `adapters/telegram/commands/agents.ts` | `agent:` and `sm:` callback prefixes |
| Session management | `adapters/claude/jsonSessionStore.ts` + `app/usecases/sessionCommands.ts` | Local JSON session store |
| Session history export | `app/usecases/sessionCommands.ts` + `adapters/telegram/commands/history.ts` | Exports as .md or .html file |
| Group settings | `adapters/telegram/commands/groupsettings.ts` | `gs:` callback prefix |
| Debate/Review | `app/usecases/debateFlow.ts` + `adapters/coordination/` | Bot-to-bot coordination via filesystem |
| Bot registry | `adapters/coordination/fileRegistryAdapter.ts` | Shared registry.json in coordination dir |
| Tunnel management | `app/usecases/tunnelManager.ts` + `adapters/telegram/commands/tunnel.ts` | cloudflared subprocess per chat |
| Voice/TTS feature | `app/usecases/voiceFlow.ts` + `adapters/tts/edgeTtsAdapter.ts` | Edge TTS with Korean voices |
| Voice input (STT) | `adapters/whisper/openaiWhisperAdapter.ts` | OpenAI Whisper API |
| Hook bot monitoring | `app/usecases/completionWatcher.ts` + `hookBot.ts` | Session completion/stall notifications |
| Rate limiting | `adapters/telegram/rateLimitMiddleware.ts` | Token bucket per user |
| Custom agents | `adapters/coordination/fileCustomAgentAdapter.ts` + `commands/makeagent.ts` | System prompt injection |

### Adding a New Telegram Command (Checklist)

When adding a new command (e.g., `/example`), update ALL of these files:

1. **Create command handler**: `adapters/telegram/commands/{name}.ts`
   - Export `{name}Command(deps)` factory function
   - If using inline buttons, export `handle{Name}Callback(ctx, action, state)` too

2. **Register in index.ts**: `adapters/telegram/commands/index.ts`
   - Add import at top
   - Add `reg('{name}', {name}Command(state))` in registerCommands()
   - If callback buttons: add `case '{name}':` in callback_query handler

3. **Add callback parser** (if using buttons): `adapters/telegram/ui/callbacks.ts`
   - Add type to `ParsedCallback` union
   - Add parsing logic in `parseCallback()` function

4. **Update help text**: `adapters/telegram/commands/help.ts`
   - Add command to appropriate section

5. **Register with BotFather**: `src/main.ts`
   - Add to `bot.api.setMyCommands([...])` array

**Example**: See `git.ts` for a command with inline keyboard callbacks.

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createClaudeAgentAdapter` | factory | `adapters/claude/claudeAgentAdapter.ts` | Implements ClaudeAgentPort via Agent SDK |
| `mapSdkMessage` | function | `adapters/claude/claudeEventMapper.ts` | SDKMessage → ClaudeEvent mapper |
| `createClaudeSummaryService` | factory | `adapters/claude/claudeSummaryService.ts` | Summary via Claude CLI subprocess |
| `createJsonSessionStore` | factory | `adapters/claude/jsonSessionStore.ts` | SessionStorePort impl (atomic JSON) |
| `createPromptFlow` | factory | `app/usecases/promptFlow.ts` | Orchestrates prompt → query → deliver |
| `createCompletionWatcher` | factory | `app/usecases/completionWatcher.ts` | Session monitoring + stall detection |
| `createInteractiveFlow` | factory | `app/usecases/interactiveFlow.ts` | AskUserQuestion tool → user response |
| `createSessionCommands` | factory | `app/usecases/sessionCommands.ts` | CRUD session operations |
| `createDebateFlow` | factory | `app/usecases/debateFlow.ts` | Bot-to-bot debate/review coordination |
| `createChatQueue` | factory | `app/queue/chatQueue.ts` | Per-chat promise-chain serialization |
| `createJsonStateStore` | factory | `adapters/persistence/jsonStateStore.ts` | Atomic JSON state with locks |
| `createBot` | factory | `adapters/telegram/bot.ts` | grammy Bot with default HTML parse mode |
| `createChatOutputAdapter` | factory | `adapters/telegram/bot.ts` | ChatOutputPort over grammy API |
| `createAuthMiddleware` | factory | `adapters/telegram/authMiddleware.ts` | userId allowlist middleware |
| `createHookBotNotificationAdapter` | factory | `adapters/telegram/hookBotAdapter.ts` | HookNotificationPort impl for Telegram |
| `createOpenaiWhisperAdapter` | factory | `adapters/whisper/openaiWhisperAdapter.ts` | TranscriptionPort via Whisper API |
| `createEdgeTtsAdapter` | factory | `adapters/tts/edgeTtsAdapter.ts` | TtsPort impl via edge-tts CLI |
| `createFileCoordinationAdapter` | factory | `adapters/coordination/fileCoordinationAdapter.ts` | CoordinationPort impl |
| `createFileRegistryAdapter` | factory | `adapters/coordination/fileRegistryAdapter.ts` | BotRegistryPort impl |
| `createFileGroupSettingsAdapter` | factory | `adapters/coordination/fileGroupSettingsAdapter.ts` | GroupSettingsPort impl |
| `registerCommands` | function | `adapters/telegram/commands/index.ts` | Wires all commands + callbacks + text handler |
| `routeDelivery` | function | `app/policies/deliveryRouter.ts` | Decides inline/chunk/file strategy |
| `loadEnvConfig` | function | `config/env.ts` | Parses + validates env vars at startup |

## CONVENTIONS

### Import Style
- Relative paths only, `.js` extensions always (ESM + Bun bundler resolution)
- No path aliases configured
- `import type` for type-only imports

### Factory Pattern (NOT classes)
- All adapters and usecases use `createX(deps)` factory functions returning object literals
- Dependencies injected as typed interface objects, not concrete classes

### Error Handling
- Domain errors extend `AppError(code, message)` — typed error codes
- Adapters: try/catch → `isDomainError()` check → rethrow or wrap in `QueryError`
- Usecases: `instanceof AppError` → show to user; else → log + generic message

### HTML as Default Parse Mode
- Bot configured with transformer: default `parse_mode: 'HTML'` on all messages
- MarkdownV2 used only in `deliveryRouter` for formatted responses
- Fallback chain: MarkdownV2 → stripped markdown → HTML → plain text → file

### Callback Data Format
- Question: `q:{interactionId}:{questionIdx}:{answerIndex|skip|type|back|toggle|next}`
- Agent switch: `agent:{agentName}`
- Settings: `settings:{action}[:value]}` (per-bot)
- Group settings: `gs:{action}[:value]` (shared across bots in group)
- Model select: `sm:{providerID}/{modelID}`
- Debate accept/reject: `dba:{debateId}` / `dbr:{debateId}`
- Tunnel control: `tunnel:{port|stop|custom}`
- Git actions: `git:{diff|diff-full|log|refresh}`
- Voice: `voice:listen`

### Logging
- Context-based prefixes: `logger.info('claude', 'msg')` → `[CLAUDE] msg`
- Valid contexts: `telegram`, `claude`, `session`, `state`, `bot`, `queue`, `interactive`, `summary`, `debate`, `review`, `registry`, `tunnel`, `voice`, `hookbot`, `whisper`
- Debug: only output when `process.env.DEBUG` is truthy

## ANTI-PATTERNS (THIS PROJECT)

- **Do NOT import external packages in `domain/` or `app/`** — only `adapters/` touches grammy/SDK
- **Do NOT use markdown syntax in summary prompts** — Telegram HTML tags only (`<b>`, `<code>`, `<pre>`, etc.)
- **Do NOT bypass `chatQueue`** — all per-chat operations must be serialized through it
- **Do NOT mutate state without `saveChatState()`** — JSON file is source of truth
- **Do NOT add a new `LogContext` without updating the `PREFIXES` const in `logger.ts`**
- **Do NOT hardcode thresholds** — use `LIMITS` object in `app/policies/limits.ts` or `shared/constants.ts`

## COMMANDS

```bash
# Development (hot reload)
bun run dev

# Production
bun run start

# Run hook bot
bun run hook

# Type check only
bun run typecheck

# Build to dist/
bun run build

# Run all tests
bun test

# Watch mode
bun test --watch

# With coverage report
bun test --coverage

# Interactive setup
bun run setup

# Configuration diagnostics
bun run doctor
```

## RUNNING THE SYSTEM

**Core bot is single process** — just start the bot. No separate server process is required for normal operation.
The hook bot is optional and runs as a separate process only when you enable session notifications.

### Start Bot

```bash
# Production
bun run start

# Development (hot reload)
bun run dev
```

### Multi-Bot with PM2

```bash
# Start all bots defined in ecosystem.config.cjs
pm2 start ecosystem.config.cjs

# Check status
pm2 status

# View logs
pm2 logs

# Stop all
pm2 stop all
```

### Quick Reference

| Command | Description |
|---------|-------------|
| `bun run start` | Start bot (production) |
| `bun run dev` | Start bot (dev, hot reload) |
| `bun run hook` | Start hook bot |
| `pm2 start ecosystem.config.cjs` | Start multi-bot |
| `pm2 status` | Check bot status |
| `pm2 logs --lines 20` | View recent logs |
| `bun run doctor` | Diagnose configuration |

## TESTING

### Framework
- **Runner**: `bun:test` (built-in, zero dependencies)
- **Config**: `bunfig.toml` at project root
- **Types**: Included via `@types/bun`

### Directory Structure
```
src/__tests__/
├── smoke.test.ts              # Framework verification
├── helpers/
│   ├── index.ts               # Re-exports all helpers
│   ├── mockClaudeAgentPort.ts # ClaudeAgentPort mock factory
│   ├── mockSessionStore.ts    # SessionStorePort mock factory
│   ├── mockChatOutputPort.ts  # ChatOutputPort mock factory
│   ├── mockStateStore.ts      # StateStore mock factory
│   ├── mockCoordinationPort.ts # CoordinationPort mock factory
│   ├── mockBotRegistryPort.ts # BotRegistryPort mock factory
│   ├── mockGroupSettingsPort.ts # GroupSettingsPort mock factory
│   ├── builders.ts            # Test data builders
│   └── async.ts               # Async test utilities
├── pure/                      # Pure function tests (no mocks)
│   ├── formatResponse.test.ts
│   ├── structuralExtract.test.ts
│   ├── deliveryRouter.test.ts
│   ├── domain.test.ts
│   ├── claudeAgentAdapter.test.ts
│   ├── claudeEventMapper.test.ts
│   ├── claudeSummaryService.test.ts
│   ├── rateLimitMiddleware.test.ts
│   ├── whisperAdapter.test.ts
│   ├── callbacks.test.ts
│   ├── messageQueue.test.ts
│   ├── sessionCommandsHelpers.test.ts
│   └── interactiveFlowHelpers.test.ts
├── integration/               # Integration tests (real file I/O)
│   ├── fileCoordinationAdapter.test.ts
│   ├── fileRegistryAdapter.test.ts
│   ├── jsonSessionStore.test.ts
│   └── jsonStateStore.test.ts
└── usecases/                  # Usecase tests (with mocked ports)
    ├── promptFlow.test.ts
    ├── sessionCommands.test.ts
    ├── interactiveFlow.test.ts
    ├── sessionWatcher.test.ts
    ├── completionWatcher.test.ts
    ├── debateFlow.test.ts
    └── chatQueue.test.ts
```

### Conventions
- **Test location**: All tests in `src/__tests__/`, mirroring source structure
- **Naming**: `{module}.test.ts` for test files
- **Mocking**: Only mock at port boundaries. Use `createMock*Port()` factories.
- **No `any`**: Full type safety in tests. Mock factories return typed port objects.
- **Pure vs Usecase vs Integration**: Pure function tests in `pure/`, usecase tests in `usecases/`, adapter tests with real I/O in `integration/`
- **Builders**: Use `build*()` helpers from `helpers/builders.ts` for test data
- **Async**: Use `createDeferredPromise()` for controlling async flow
- **New tests**: When adding a feature, add tests in the same commit

### Adding New Tests
1. If testing a pure function: add to `src/__tests__/pure/`
2. If testing a usecase: add to `src/__tests__/usecases/`, use mock factories
3. If testing an adapter with real I/O: add to `src/__tests__/integration/`
4. If a new port method is added: update the corresponding mock factory in `helpers/`
5. Run `bun test` before committing — all tests must pass

## ENVIRONMENT VARIABLES

```bash
# Required
BOT_TOKEN=               # Telegram bot token from BotFather
ALLOWED_USER_IDS=        # Comma-separated Telegram user IDs (at least one)
DEFAULT_PROJECT=         # Absolute path to default project directory

# Claude Configuration (optional)
CLAUDE_MODEL=            # Default: claude-sonnet-4-5
CLAUDE_CODE_PATH=        # Path to Claude Code executable (auto-detected if on PATH)
MAX_THINKING_TOKENS=     # Extended Thinking token limit (0 = disabled)
MAX_BUDGET_USD=          # Max budget per session in USD

# Optional
OPENAI_API_KEY=          # OpenAI API key for Whisper voice-to-text
HOOK_CONFIG_PATH=        # Path to hook-config.json (default: data/hook-config.json)
DEBUG=                   # Any truthy value enables debug logging

# Multi-bot (optional)
BOT_ROLE=                # standalone | writer | reader
INSTANCE_NAME=           # Bot identifier for logs/registry
STATE_DIR=               # Per-bot state directory (must be unique)
GROUP_CHAT_ENABLED=      # true | false
COORDINATION_DIR=        # Shared directory for bot coordination
DEFAULT_AGENT=           # Default agent name
DEFAULT_CUSTOM_AGENT=    # Custom agent ID from /makeagent
```

## HOOK BOT

Optional separate PM2 process that monitors Claude sessions and sends Telegram notifications.

**Entrypoint**: `src/hookBot.ts` (second composition root)
**Config**: `data/hook-config.json` (created by `/addhookbot` wizard)
**Setup**: Run `/addhookbot` from any existing bot to configure

**Features**:
- Session completion notifications (busy→idle) with full last message
- Stall detection (30min inactivity warning)
- Error forwarding

**Architecture** (Clean Architecture):
- `src/domain/hookBotTypes.ts` — Domain types (HookBotConfig, TrackedSession, HookNotification)
- `src/domain/ports/HookNotificationPort.ts` — Notification output port for hook bot
- `src/app/usecases/completionWatcher.ts` — Session monitoring usecase
- `src/adapters/telegram/hookBotAdapter.ts` — Telegram adapter (implements HookNotificationPort)
- `src/adapters/telegram/commands/addhookbot.ts` — Setup wizard in existing bots

## NOTES

- **Tests**: `bun:test` with 340+ tests across 30+ files. See `## TESTING` section above.
- **No CI/CD** — manual deployment. No GitHub Actions, Makefile, or Dockerfile.
- **No linter/formatter** — relies solely on `tsc --strict` for quality.
- **SDK**: Uses `@anthropic-ai/claude-agent-sdk` — in-process `query()` AsyncGenerator.
- **Single-process**: No separate server. Bot embeds Claude Agent SDK directly.
- **Session management**: Self-managed via `SessionStorePort` (JSON file). SDK does not provide session listing.
- **State migration**: `jsonStateStore.migrateState()` backfills missing fields — update it when changing `ChatState` schema.
- **Summary service**: Uses Claude CLI subprocess (`claude -p`). No additional API key needed.
- **Streaming edits**: Throttled at 1 edit/sec via `LIMITS.STREAMING_THROTTLE_MS`.
- **Interaction TTL**: 10 minutes. Expired interactions are checked lazily on callback, no active GC.
- **Inactivity warning**: 30 minutes idle triggers notification. Check `LIMITS.INACTIVITY_WARNING_MS`.
- **Constants are split**: `shared/constants.ts` (general) and `app/policies/limits.ts` (policy-specific). Check both.
- **Voice/TTS**: Uses `edge-tts` CLI with Korean voices (`ko-KR-SunHiNeural`, `ko-KR-InJoonNeural`). Requires edge-tts installed.
- **Voice input**: Uses OpenAI Whisper API for voice-to-text transcription. Requires `OPENAI_API_KEY`.
- **Extended Thinking**: Triggered by keywords ("think", "analyze", "deep"). Uses `maxThinkingTokens` option.
- **Cost tracking**: Extracted from `SDKResultMessage.usage` → stored in `SessionMeta.totalCostUsd`.
- **Budget control**: Set `MAX_BUDGET_USD` env var or configure via `/settings`. Passed to SDK as `maxBudgetUsd`.
- **Image support**: Native base64 via `SDKUserMessage` content blocks. No temp files needed.
- **Permission mode**: `bypassPermissions` — no permission prompts. AI executes tools freely.
- **Tunnel feature**: Uses `cloudflared tunnel --url` for quick tunnels. Subprocesses managed per-chat, auto-cleaned on shutdown.
- **Document handling**: Bot supports file uploads (documents) in addition to images. Files are downloaded, base64 encoded, and sent to AI with caption as prompt.
- **State file locking**: `jsonStateStore` uses both per-chat locks AND global file lock to prevent cross-chat race conditions.
- **Rate limiting**: Token bucket middleware prevents Telegram API abuse. Configurable per-user limits.
