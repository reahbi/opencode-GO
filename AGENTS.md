# OPENCADDY KNOWLEDGE BASE

**Generated:** 2026-02-02

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
│       ├── ChatOutputPort.ts  #   sendText, editText, sendFile, sendInteraction, editInteraction
│       └── StateStore.ts      #   getChatState, saveChatState, withChatLock
├── app/                       # Usecases — imports domain/ ONLY
│   ├── usecases/
│   │   ├── promptFlow.ts      #   Text msg → SSE stream → throttled edits → delivery
│   │   ├── sessionCommands.ts #   /new /list /resume /abort + exportSessionHistory
│   │   └── interactiveFlow.ts #   permission.asked / question.asked round-trip
│   ├── queue/
│   │   └── chatQueue.ts       #   Per-chat promise-chain serialization
│   └── policies/
│       ├── deliveryRouter.ts  #   inline(<3.8k) / chunk / file(>oversize) routing
│       └── limits.ts          #   All numeric constants (thresholds, TTLs, retries)
├── adapters/                  # External world — implements ports
│   ├── telegram/
│   │   ├── bot.ts             #   grammy init, default HTML parse mode, ChatOutputPort impl
│   │   ├── authMiddleware.ts  #   ALLOWED_USER_IDS check (silent drop on unauthorized)
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
│   │   │   └── settings.ts    #   /settings — summary mode, threshold, output format, history
│   │   └── ui/
│   │       ├── callbacks.ts   #   Callback query parser (perm:, q:, agent:, settings:, sm:, listpage:, listsel:, hist:)
│   │       └── keyboards.ts   #   InlineKeyboard builders for permissions/questions
│   ├── opencode/
│   │   ├── opencodeAdapter.ts #   OpenCodePort impl via SDK v2 client
│   │   ├── eventMapper.ts     #   SDK SSE events → domain OpenCodeEvent mapping
│   │   └── summaryService.ts  #   Creates temp session, prompts lightweight model, deletes
│   └── persistence/
│       └── jsonStateStore.ts  #   Atomic write (tmp+rename), in-process lock per chatId
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
| Add new Telegram command | `adapters/telegram/commands/` + register in `commands/index.ts` | Follow existing factory pattern |
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
- Question: `q:{interactionId}:{answerIndex|skip}`
- Agent switch: `agent:{agentName}`
- Settings: `settings:{action}[:value]`
- Model select: `sm:{providerID}/{modelID}`

### Logging
- Context-based prefixes: `logger.info('opencode', 'msg')` → `[OPENCODE] msg`
- Valid contexts: `telegram`, `opencode`, `session`, `state`, `bot`, `queue`, `interactive`, `summary`
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
```

## NOTES

- **Tests**: `bun:test` with 210+ tests across 13 files. See `## TESTING` section above.
- **No CI/CD** — manual deployment. No GitHub Actions, Makefile, or Dockerfile.
- **No linter/formatter** — relies solely on `tsc --strict` for quality.
- **SDK version**: Uses `@opencode-ai/sdk/v2/client` exclusively (v1 API was dropped).
- **Bun SSE caveat**: v1.1.26/27 had 8-second SSE disconnect regression. Use latest stable.
- **State migration**: `jsonStateStore.migrateState()` backfills missing fields — update it when changing `ChatState` schema.
- **Summary service** creates ephemeral sessions: creates → prompts → deletes. Failure to delete leaves orphan sessions.
- **SSE timeout**: 24 hours (`SSE_TIMEOUT_MS`). Streaming edits throttled at 1 edit/sec.
- **Interaction TTL**: 5 minutes. Expired interactions are checked lazily on callback, no active GC.
- **Constants are split**: `shared/constants.ts` (general) and `app/policies/limits.ts` (policy-specific). Check both.
