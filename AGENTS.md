# OPENCODE-GO KNOWLEDGE BASE

**Generated:** 2026-02-04
**Directory:** `opencode-telegram` (NOT `Claude-telegram`)

## OVERVIEW

Telegram bot that remotely controls OpenCode coding agent sessions from a phone. Bun + TypeScript + grammy + @opencode-ai/sdk. Clean Architecture (Hexagonal / Ports & Adapters).

## STRUCTURE

```
src/
├── main.ts                    # Composition root — DI wiring, bot start
├── domain/                    # Pure types + ports. ZERO external deps.
│   ├── models.ts              #   SessionRef, ChatState, UserSettings, PendingInteraction
│   ├── events.ts              #   OpenCodeEvent discriminated union (7 event types)
│   ├── errors.ts              #   AppError hierarchy (8 error classes with codes)
│   └── ports/
│       ├── OpenCodePort.ts    #   Session CRUD, prompts, SSE, permission/question reply
│       ├── ChatOutputPort.ts  #   sendText, editText, sendFile, sendAudio, sendInteraction, editInteraction
│       ├── StateStore.ts      #   getChatState, saveChatState, withChatLock
│       ├── TtsPort.ts         #   Text-to-speech synthesis interface
│       ├── SummaryPort.ts     #   summarize + summarizeForVoice
│       ├── CoordinationPort.ts #  Bot-to-bot event pub/sub for debate/review
│       ├── BotRegistryPort.ts #   Bot registration, listing, role lookup
│       └── GroupSettingsPort.ts # Group-shared settings (debate rounds)
├── app/                       # Usecases — imports domain/ ONLY
│   ├── usecases/
│   │   ├── promptFlow.ts      #   Text msg → SSE stream → throttled edits → delivery
│   │   ├── sessionCommands.ts #   /new /list /resume /abort + exportSessionHistory
│   │   ├── interactiveFlow.ts #   permission.asked / question.asked round-trip
│   │   ├── debateFlow.ts      #   /debate /review + bot-to-bot coordination (🧪 testing)
│   │   ├── sessionWatcher.ts  #   SSE watcher + live message updates + inactivity detection
│   │   ├── tunnelManager.ts   #   cloudflared subprocess management per chat
│   │   └── voiceFlow.ts       #   Voice TTS response generation
│   ├── queue/
│   │   └── chatQueue.ts       #   Per-chat promise-chain serialization
│   └── policies/
│       ├── deliveryRouter.ts  #   inline(<3.8k) / chunk / file(>oversize) routing
│       └── limits.ts          #   All numeric constants (thresholds, TTLs, retries)
├── adapters/                  # External world — implements ports
│   ├── telegram/
│   │   ├── bot.ts             #   grammy init, default HTML parse mode, ChatOutputPort impl
│   │   ├── authMiddleware.ts  #   ALLOWED_USER_IDS check (silent drop on unauthorized)
│   │   ├── awaitingInputMiddleware.ts # Auto-cancel awaiting input on destructive commands
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
│   │   │   ├── settings.ts    #   /settings — summary mode, threshold, output format, history
│   │   │   ├── groupsettings.ts # /groupsettings — group-shared settings (debate rounds, bot status)
│   │   │   ├── debate.ts      #   /debate — start bot-to-bot debate (🧪 testing)
│   │   │   ├── review.ts      #   /review — request code review from peer bot (🧪 testing)
│   │   │   ├── bots.ts        #   /bots — list registered bots
│   │   │   ├── addbot.ts      #   /addbot — interactive bot setup wizard
│   │   │   └── tunnel.ts      #   /tunnel — cloudflared tunnel to localhost
│   │   └── ui/
│   │       ├── callbacks.ts   #   Callback query parser (perm:, q:, agent:, settings:, gs:, sm:, listpage:, listsel:, hist:, dba:, dbr:, tunnel:, git:, voice:)
│   │       └── keyboards.ts   #   InlineKeyboard builders for permissions/questions
│   ├── opencode/
│   │   ├── opencodeAdapter.ts #   OpenCodePort impl via SDK v2 client
│   │   ├── eventMapper.ts     #   SDK SSE events → domain OpenCodeEvent mapping (text + tool parts)
│   │   └── summaryService.ts  #   Creates temp session, prompts lightweight model, deletes (+ voice summary)
│   ├── tts/
│   │   └── edgeTtsAdapter.ts  #   TtsPort impl via edge-tts CLI (Korean voices)
│   ├── persistence/
│   │   └── jsonStateStore.ts  #   Atomic write (tmp+rename), in-process lock per chatId
│   └── coordination/
│       ├── fileCoordinationAdapter.ts # CoordinationPort impl via filesystem
│       ├── fileRegistryAdapter.ts     # BotRegistryPort impl via registry.json
│       └── fileGroupSettingsAdapter.ts # GroupSettingsPort impl via group-settings.json
├── cli/                       # CLI tools (not part of bot runtime)
│   ├── setup.ts               #   Interactive setup wizard (bun run setup)
│   └── doctor.ts              #   Configuration diagnostics (bun run doctor)
├── config/
│   ├── env.ts                 #   Validates & returns EnvConfig (throws on missing required vars)
│   └── projects.ts            #   Reads data/projects.json, 1-based indexing
└── shared/
    ├── logger.ts              #   Prefixed logger: [TELEGRAM], [OPENCODE], [SESSION], etc.
    ├── formatResponse.ts      #   telegramify-markdown wrapper + HTML sanitizer + stripHtml
    ├── structuralExtract.ts   #   Extracts headings, file paths, bullets from markdown
    └── constants.ts           #   TELEGRAM_MAX_MESSAGE_LENGTH, DEFAULT_SERVER_URL, etc.
```

## DEPENDENCY RULES (NEVER VIOLATE)

```
domain/     → imports NOTHING (pure TypeScript only)
app/        → imports domain/ only
adapters/   → imports app/ + domain/ (implements ports)
main.ts     → imports everything (sole composition root)
shared/     → imports nothing from other layers
config/     → imports domain/ (for ProjectRef type) + shared/
```

**FORBIDDEN imports**:
- `domain/` or `app/` must NEVER import `grammy`, `@opencode-ai/sdk`, `undici`
- External libraries ONLY in `adapters/`

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new Telegram command | See checklist below | Multiple files need updates |
| Change prompt/response flow | `app/usecases/promptFlow.ts` | SSE streaming + throttled edits |
| Handle new OpenCode event | `adapters/opencode/eventMapper.ts` + `domain/events.ts` | Add to discriminated union |
| Change delivery thresholds | `app/policies/limits.ts` + `shared/constants.ts` | Two places for constants |
| Add new error type | `domain/errors.ts` | Extend `AppError` with unique code |
| Permission/question UX | `app/usecases/interactiveFlow.ts` + `adapters/telegram/ui/` | Callback format: `perm:{id}:{response}` |
| State schema changes | `domain/models.ts` + `adapters/persistence/jsonStateStore.ts` | Update `migrateState()` for backward compat |
| Response formatting | `shared/formatResponse.ts` + `app/policies/deliveryRouter.ts` | Block tokenizer preserves code fences |
| Summary feature | `adapters/opencode/summaryService.ts` | Creates ephemeral session, prompts, deletes |
| Agent/model selection | `adapters/telegram/commands/index.ts` (callback handler) | `agent:` and `sm:` callback prefixes |
| Session history export | `app/usecases/sessionCommands.ts` + `adapters/telegram/commands/history.ts` | Exports as .md or .html file |
| Group settings | `adapters/telegram/commands/groupsettings.ts` | `gs:` callback prefix, filters bots by chat membership |
| Debate/Review (🧪) | `app/usecases/debateFlow.ts` + `adapters/coordination/` | Bot-to-bot coordination via filesystem |
| Bot registry | `adapters/coordination/fileRegistryAdapter.ts` | Shared registry.json in coordination dir |
| Tunnel management | `app/usecases/tunnelManager.ts` + `adapters/telegram/commands/tunnel.ts` | cloudflared subprocess per chat |
| Voice/TTS feature | `app/usecases/voiceFlow.ts` + `adapters/tts/edgeTtsAdapter.ts` | Edge TTS with Korean voices |
| Multi-select questions | `app/usecases/interactiveFlow.ts` | `question.multiple` field, toggle/next callbacks |
| Tool part display | `adapters/opencode/eventMapper.ts` + `domain/events.ts` | `tool.part.updated` event type |
| Inactivity detection | `app/usecases/sessionWatcher.ts` + `app/policies/limits.ts` | 30min warning via `INACTIVITY_WARNING_MS` |

### Adding a New Telegram Command (Checklist)

When adding a new command (e.g., `/git`), update ALL of these files:

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
| `createOpenCodeAdapter` | factory | `adapters/opencode/opencodeAdapter.ts` | Implements OpenCodePort via SDK v2 |
| `createPromptFlow` | factory | `app/usecases/promptFlow.ts` | Orchestrates prompt → stream → deliver |
| `createInteractiveFlow` | factory | `app/usecases/interactiveFlow.ts` | Permission/question round-trip |
| `createSessionCommands` | factory | `app/usecases/sessionCommands.ts` | CRUD session operations |
| `createChatQueue` | factory | `app/queue/chatQueue.ts` | Per-chat promise-chain serialization |
| `createJsonStateStore` | factory | `adapters/persistence/jsonStateStore.ts` | Atomic JSON state with locks |
| `createBot` | factory | `adapters/telegram/bot.ts` | grammy Bot with default HTML parse mode |
| `createChatOutputAdapter` | factory | `adapters/telegram/bot.ts` | ChatOutputPort over grammy API |
| `createAuthMiddleware` | factory | `adapters/telegram/authMiddleware.ts` | userId allowlist middleware |
| `createSummaryService` | factory | `adapters/opencode/summaryService.ts` | Summarize via temp session + lightweight model |
| `registerCommands` | function | `adapters/telegram/commands/index.ts` | Wires all commands + callbacks + text handler |
| `mapSdkEvent` | function | `adapters/opencode/eventMapper.ts` | SDK SSE → domain event mapper |
| `routeDelivery` | function | `app/policies/deliveryRouter.ts` | Decides inline/chunk/file strategy |
| `StatusDisplayManager` | class | `app/usecases/statusDisplay.ts` | Real-time SSE aggregation with throttle |
| `loadEnvConfig` | function | `config/env.ts` | Parses + validates env vars at startup |
| `historyCommand` | factory | `adapters/telegram/commands/history.ts` | Export session history as file |
| `startCommand` | factory | `adapters/telegram/commands/start.ts` | Onboarding + status overview |
| `createDebateFlow` | factory | `app/usecases/debateFlow.ts` | Bot-to-bot debate/review coordination |
| `createFileCoordinationAdapter` | factory | `adapters/coordination/fileCoordinationAdapter.ts` | CoordinationPort impl |
| `createFileRegistryAdapter` | factory | `adapters/coordination/fileRegistryAdapter.ts` | BotRegistryPort impl |
| `createFileGroupSettingsAdapter` | factory | `adapters/coordination/fileGroupSettingsAdapter.ts` | GroupSettingsPort impl |
| `groupSettingsCommand` | factory | `adapters/telegram/commands/groupsettings.ts` | Group-shared settings command |
| `filterBotsInChat` | function | `adapters/telegram/commands/groupsettings.ts` | Filter bots by Telegram API getChatMember |
| `createTunnelManager` | factory | `app/usecases/tunnelManager.ts` | Manages cloudflared tunnel subprocesses |
| `tunnelCommand` | factory | `adapters/telegram/commands/tunnel.ts` | /tunnel command with port selection UI |
| `gitCommand` | factory | `adapters/telegram/commands/git.ts` | /git command with diff, log, status |
| `createVoiceFlow` | factory | `app/usecases/voiceFlow.ts` | Voice TTS response generation |
| `createEdgeTtsAdapter` | factory | `adapters/tts/edgeTtsAdapter.ts` | TtsPort impl via edge-tts CLI |
| `createAwaitingInputMiddleware` | factory | `adapters/telegram/awaitingInputMiddleware.ts` | Auto-cancel awaiting input on commands |

## CONVENTIONS

### Import Style
- Relative paths only, `.js` extensions always (ESM + Bun bundler resolution)
- No path aliases configured
- `import type` for type-only imports

### Factory Pattern (NOT classes)
- All adapters and usecases use `createX(deps)` factory functions returning object literals
- Dependencies injected as typed interface objects, not concrete classes
- Exception: `StatusDisplayManager` is the only class in the project

### Error Handling
- Domain errors extend `AppError(code, message)` — typed error codes
- Adapters: try/catch → `isDomainError()` check → rethrow or wrap in `OpenCodeConnectionError`
- Usecases: `instanceof AppError` → show to user; else → log + generic message
- `unwrap<T>()` helper for SDK result extraction with automatic error classification

### HTML as Default Parse Mode
- Bot configured with transformer: default `parse_mode: 'HTML'` on all messages
- MarkdownV2 used only in `deliveryRouter` for formatted responses
- Fallback chain: MarkdownV2 → stripped markdown → HTML → plain text → file

### Callback Data Format
- Permission: `perm:{interactionId}:{once|always|reject}`
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
- Context-based prefixes: `logger.info('opencode', 'msg')` → `[OPENCODE] msg`
- Valid contexts: `telegram`, `opencode`, `session`, `state`, `bot`, `queue`, `interactive`, `summary`, `debate`, `review`, `registry`, `tunnel`, `voice`
- Debug: only output when `process.env.DEBUG` is truthy

## ANTI-PATTERNS (THIS PROJECT)

- **Do NOT import external packages in `domain/` or `app/`** — only `adapters/` touches grammy/SDK
- **Do NOT use markdown syntax in summary prompts** — Telegram HTML tags only (`<b>`, `<code>`, `<pre>`, etc.)
- **Do NOT bypass `chatQueue`** — all per-chat operations must be serialized through it
- **Do NOT mutate state without `saveChatState()`** — JSON file is source of truth
- **Do NOT add a new `LogContext` without updating the `PREFIXES` const in `logger.ts`**
- **Do NOT hardcode thresholds** — use `LIMITS` object in `app/policies/limits.ts` or `shared/constants.ts`
- **Permission responses are strictly `'once' | 'always' | 'reject'`** — no other values accepted

## COMMANDS

```bash
# Development (hot reload)
bun run dev

# Production
bun run start

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
```

## RUNNING THE SYSTEM

**Two processes required**: OpenCode Server + Bot(s). Start server FIRST.

### Step 1: Start OpenCode Server

**WSL/Linux/macOS** (simple):
```bash
# With password
OPENCODE_SERVER_PASSWORD=<password> opencode serve --port 4096 &

# Without password
opencode serve --port 4096 &
```

**Windows** (requires .bat wrapper for password):
```bash
# Create server.bat (password gets set inside the batch file)
cat > server.bat << 'BATEOF'
@echo off
set OPENCODE_SERVER_PASSWORD=<password>
opencode serve --port 4096
BATEOF

# Start minimized
powershell.exe -Command "Start-Process '$(wslpath -w $(pwd)/server.bat)' -WindowStyle Minimized"
```

> **Why .bat for Windows?** PowerShell's `Start-Process` doesn't pass environment variables to child processes. The .bat file sets the variable in the same process that runs `opencode serve`.

### Step 2: Start Bot(s)

**Single bot** (development):
```bash
bun run start
# or with hot reload
bun run dev
```

**Multi-bot** (production with PM2):
```bash
# Start all bots defined in ecosystem.config.cjs
pm2 start ecosystem.config.cjs

# Check status
pm2 status

# View logs
pm2 logs

# Stop all
pm2 stop all

# Restart all
pm2 restart all
```

### Quick Reference

| Command | Description |
|---------|-------------|
| `OPENCODE_SERVER_PASSWORD=xxx opencode serve --port 4096 &` | Start server (WSL) |
| `pm2 start ecosystem.config.cjs` | Start all bots |
| `pm2 status` | Check bot status |
| `pm2 logs --lines 20` | View recent logs |
| `pm2 restart all` | Restart all bots |
| `curl -s -u opencode:<pw> http://127.0.0.1:4096/project` | Verify server |

### Troubleshooting Startup

| Issue | Solution |
|-------|----------|
| "OpenCode server is not reachable" | Server not running. Start with `opencode serve --port 4096` |
| 401 Unauthorized | Password mismatch. Check `OPENCODE_SERVER_PASSWORD` in both server and .env |
| Port 4096 already in use | Kill existing: `kill $(lsof -t -i:4096)` or PowerShell equivalent |
| Windows password not working | Use .bat wrapper (see above). PowerShell env vars don't inherit. |

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
│   ├── mockOpenCodePort.ts    # OpenCodePort mock factory
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
│   ├── sessionCommandsHelpers.test.ts
│   └── interactiveFlowHelpers.test.ts
└── usecases/                  # Usecase tests (with mocked ports)
    ├── promptFlow.test.ts
    ├── sessionCommands.test.ts
    ├── interactiveFlow.test.ts
    ├── sessionWatcher.test.ts
    ├── debateFlow.test.ts
    └── chatQueue.test.ts
```

### Conventions
- **Test location**: All tests in `src/__tests__/`, mirroring source structure
- **Naming**: `{module}.test.ts` for test files
- **Mocking**: Only mock at port boundaries. Use `createMock*Port()` factories.
- **No `any`**: Full type safety in tests. Mock factories return typed port objects.
- **Pure vs Usecase**: Pure function tests go in `pure/`, usecase tests in `usecases/`
- **Builders**: Use `build*()` helpers from `helpers/builders.ts` for test data
- **Async**: Use `createDeferredPromise()` for controlling async flow
- **New tests**: When adding a feature, add tests in the same commit

### Adding New Tests
1. If testing a pure function: add to `src/__tests__/pure/`
2. If testing a usecase: add to `src/__tests__/usecases/`, use mock factories
3. If a new port method is added: update the corresponding mock factory in `helpers/`
4. Run `bun test` before committing — all tests must pass

## ENVIRONMENT VARIABLES

```bash
# Required
BOT_TOKEN=               # Telegram bot token from BotFather
ALLOWED_USER_IDS=        # Comma-separated Telegram user IDs (at least one)
DEFAULT_PROJECT=         # Absolute path to default project directory

# Optional
OPENCODE_SERVER_URL=     # Default: http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME= # Default: opencode
OPENCODE_SERVER_PASSWORD= # Omit for no auth
DEBUG=                   # Any truthy value enables debug logging

# Multi-bot (optional)
BOT_ROLE=                # standalone | writer | reader
INSTANCE_NAME=           # Bot identifier for logs/registry
STATE_DIR=               # Per-bot state directory (must be unique)
GROUP_CHAT_ENABLED=      # true | false
COORDINATION_DIR=        # Shared directory for bot coordination
```

## NOTES

- **Tests**: `bun:test` with 280+ tests across 16 files. See `## TESTING` section above.
- **No CI/CD** — manual deployment. No GitHub Actions, Makefile, or Dockerfile.
- **No linter/formatter** — relies solely on `tsc --strict` for quality.
- **SDK version**: Uses `@opencode-ai/sdk/v2/client` exclusively (v1 API was dropped).
- **Bun SSE caveat**: v1.1.26/27 had 8-second SSE disconnect regression. Use latest stable.
- **State migration**: `jsonStateStore.migrateState()` backfills missing fields — update it when changing `ChatState` schema.
- **Summary service** creates ephemeral sessions: creates → prompts → deletes. Failure to delete leaves orphan sessions.
- **SSE timeout**: 24 hours (`SSE_TIMEOUT_MS`). Streaming edits throttled at 1 edit/sec.
- **Interaction TTL**: 10 minutes. Expired interactions are checked lazily on callback, no active GC.
- **Inactivity warning**: 30 minutes idle triggers notification. Check `LIMITS.INACTIVITY_WARNING_MS`.
- **Constants are split**: `shared/constants.ts` (general) and `app/policies/limits.ts` (policy-specific). Check both.
- **Voice/TTS**: Uses `edge-tts` CLI with Korean voices (`ko-KR-SunHiNeural`, `ko-KR-InJoonNeural`). Requires edge-tts installed in `/tmp/edge-tts-env/`.
- **Multi-select questions**: AI can set `question.multiple=true`. UI shows checkboxes with toggle/next pattern.
- **Tunnel feature**: Uses `cloudflared tunnel --url` for quick tunnels. Subprocesses managed per-chat, auto-cleaned on shutdown.
- **Document handling**: Bot supports file uploads (documents) in addition to images. Files are downloaded, base64 encoded, and sent to AI with caption as prompt.
- **State file locking**: `jsonStateStore` uses both per-chat locks AND global file lock to prevent cross-chat race conditions during read-modify-write.
