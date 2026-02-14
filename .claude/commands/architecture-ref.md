# Architecture Reference

Full directory structure and code map for claude-go. Use when making structural changes.

## When to Use

- Major refactoring or adding new modules/layers
- Need to understand the full directory tree
- Need the symbol table (factory functions, adapters, ports)
- Adding a new port or adapter

## When NOT to Use

- **Simple bug fix** — read the specific file, don't load the full map
- **Adding a command** — use `/add-command` skill instead
- **Writing tests only** — use `/write-tests` skill instead
- **Quick lookup** — use Grep/Glob to find the specific symbol

## Directory Structure

```
src/
├── main.ts                    # Main bot composition root
├── hookBot.ts                 # Hook bot composition root
├── domain/                    # Pure types + ports. ZERO external deps.
│   ├── models.ts              #   SessionRef, ChatState, UserSettings, ImageAttachment
│   ├── events.ts              #   ClaudeEvent discriminated union (8 event types)
│   ├── errors.ts              #   AppError hierarchy
│   ├── hookBotTypes.ts        #   HookBotConfig, TrackedSession, HookNotification
│   └── ports/
│       ├── ClaudeAgentPort.ts #   runQuery() → QueryHandle, getSupportedModels()
│       ├── SessionStorePort.ts #  Session CRUD
│       ├── ChatOutputPort.ts  #   sendText, editText, sendFile, sendAudio, sendInteraction
│       ├── StateStore.ts      #   getChatState, saveChatState, withChatLock
│       ├── SummaryPort.ts     #   summarize + summarizeForVoice
│       ├── TtsPort.ts         #   Text-to-speech synthesis
│       ├── TranscriptionPort.ts # Voice-to-text (Whisper)
│       ├── CoordinationPort.ts #  Bot-to-bot event pub/sub
│       ├── BotRegistryPort.ts #   Bot registration, listing, role lookup
│       ├── GroupSettingsPort.ts # Group-shared settings
│       ├── CustomAgentPort.ts #   Custom agent definitions
│       ├── MemoryPort.ts      #   Semantic memory interface
│       └── HookNotificationPort.ts # Hook bot notification output
├── app/                       # Usecases — imports domain/ ONLY
│   ├── usecases/
│   │   ├── promptFlow.ts      #   Text → query() AsyncGenerator → throttled edits → delivery
│   │   ├── sessionCommands.ts #   /new /list /resume /abort + exportSessionHistory
│   │   ├── interactiveFlow.ts #   AskUserQuestion tool → user response round-trip
│   │   ├── debateFlow.ts      #   /debate /review + bot-to-bot coordination
│   │   ├── sessionWatcher.ts  #   Query state tracking + live updates + inactivity
│   │   ├── completionWatcher.ts # Hook bot session monitoring
│   │   ├── tunnelManager.ts   #   cloudflared subprocess management
│   │   └── voiceFlow.ts       #   Voice TTS response generation
│   ├── queue/
│   │   ├── chatQueue.ts       #   Per-chat promise-chain serialization
│   │   └── messageQueue.ts    #   Message delivery queue with retry
│   └── policies/
│       ├── deliveryRouter.ts  #   inline/chunk/file routing
│       └── limits.ts          #   All numeric constants
├── adapters/                  # External world — implements ports
│   ├── telegram/              #   grammy bot, commands, UI, middleware
│   ├── claude/                #   Agent SDK adapter, event mapper, session store
│   ├── whisper/               #   OpenAI Whisper transcription
│   ├── tts/                   #   Edge TTS adapter
│   ├── persistence/           #   JSON state store with atomic writes
│   └── coordination/          #   File-based bot coordination
├── cli/                       #   setup.ts, doctor.ts
├── config/                    #   env.ts, projects.ts
└── shared/                    #   logger, formatResponse, constants
```

## Code Map (Key Symbols)

| Symbol | Type | Location |
|--------|------|----------|
| `createClaudeAgentAdapter` | factory | `adapters/claude/claudeAgentAdapter.ts` |
| `mapSdkMessage` | function | `adapters/claude/claudeEventMapper.ts` |
| `createPromptFlow` | factory | `app/usecases/promptFlow.ts` |
| `createInteractiveFlow` | factory | `app/usecases/interactiveFlow.ts` |
| `createSessionCommands` | factory | `app/usecases/sessionCommands.ts` |
| `createDebateFlow` | factory | `app/usecases/debateFlow.ts` |
| `createChatQueue` | factory | `app/queue/chatQueue.ts` |
| `createJsonStateStore` | factory | `adapters/persistence/jsonStateStore.ts` |
| `createBot` | factory | `adapters/telegram/bot.ts` |
| `createChatOutputAdapter` | factory | `adapters/telegram/bot.ts` |
| `createAuthMiddleware` | factory | `adapters/telegram/authMiddleware.ts` |
| `registerCommands` | function | `adapters/telegram/commands/index.ts` |
| `routeDelivery` | function | `app/policies/deliveryRouter.ts` |
| `loadEnvConfig` | function | `config/env.ts` |

## Adding a New Port

1. Define interface in `src/domain/ports/{PortName}.ts`
2. Create adapter in `src/adapters/{category}/{adapterName}.ts`
3. Wire in composition root (`main.ts` or `hookBot.ts`)
4. Create mock factory in `src/__tests__/helpers/mock{PortName}.ts`
5. Export from `src/__tests__/helpers/index.ts`
