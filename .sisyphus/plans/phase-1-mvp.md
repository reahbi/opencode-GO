# Phase 1: MVP Implementation Plan

## TL;DR

> **Quick Summary**: Implement the core OpenCaddy bot MVP using Clean Architecture. Covers scaffolding, domain logic, persistence, OpenCode/Telegram adapters, and basic prompt flow.
> 
> **Deliverables**:
> - Fully functional Telegram bot with /new, /list, /resume, /abort commands
> - OpenCode SDK integration with SSE support (Bun native)
> - JSON-based persistence with atomic writes
> - Core Prompt & Interactive flows
> 
> **Estimated Effort**: Medium (16 Tasks)
> **Parallel Execution**: YES - 5 Waves
> **Critical Path**: Domain → Adapters → Usecases → Main

---

## Context

### Original Request
Implement Phase 1 of OpenCaddy based on existing PLAN.md. Codebase is empty. Stack: Bun, grammy, @opencode-ai/sdk.

### Key Decisions
- **Architecture**: Clean Architecture (Domain -> App -> Adapters).
- **Transport**: Bun native fetch for SSE (no undici).
- **Persistence**: JSON file with atomic write + in-process mutex.
- **Scope**: Plain text MVP (HTML parse mode ready).
- **Testing**: Manual/Integration verification in final wave (no unit tests per file list).

---

## Task Dependency Graph

| Task | Depends On | Reason |
|------|------------|--------|
| **Wave 1** | | |
| Task 1.1 (Shared) | None | Core utilities used by all layers |
| Task 1.2 (Config) | None | Environment and project config used by adapters |
| Task 1.3 (Domain) | None | Core types and Ports interfaces (Foundation) |
| **Wave 2** | | |
| Task 2.1 (Persist) | Task 1.1, 1.3 | Implements StateStore Port, uses Logger |
| Task 2.2 (OC Core) | Task 1.1, 1.2, 1.3 | Implements OpenCodePort, uses Env/Logger |
| Task 2.3 (SSE) | Task 1.1 | Transport helper for OpenCode Adapter |
| Task 2.4 (TG Core) | Task 1.2, 1.3 | Depends on ChatOutputPort interface & Env |
| Task 2.5 (Queue) | Task 1.3 | Depends on StateStore interface (runtime dep) |
| **Wave 3** | | |
| Task 3.1 (Cmds) | Task 1.3 | Implements business logic using Ports |
| Task 3.2 (Prompt) | Task 1.3 | Implements business logic using Ports |
| Task 3.3 (Inter) | Task 1.3 | Implements business logic using Ports |
| **Wave 4** | | |
| Task 4.1 (TG Cmds) | Task 2.4, 3.1-3.3 | Wires Telegram events to Usecases |
| **Wave 5** | | |
| Task 5.1 (Main) | All previous | Composition root |
| Task 5.2 (Verify) | Task 5.1 | Integration testing |

---

## Parallel Execution Graph

```
Wave 1 (Foundation):
├── Task 1.1: Shared Utilities (logger, constants)
├── Task 1.2: Config (env, projects)
└── Task 1.3: Domain Layer (models, events, ports)

Wave 2 (Adapters - Depend on Wave 1):
├── Task 2.1: Persistence Adapter (JSON Store)
├── Task 2.2: OpenCode Adapter Core
├── Task 2.3: SSE Client (Transport)
├── Task 2.4: Telegram Bot Core (Auth, UI)
└── Task 2.5: Chat Queue & Policies

Wave 3 (Usecases - Depend on Ports):
├── Task 3.1: Session Commands
├── Task 3.2: Prompt Flow
└── Task 3.3: Interactive Flow

Wave 4 (Wiring):
└── Task 4.1: Telegram Command Handlers

Wave 5 (Assembly & Verification):
├── Task 5.1: Main Entrypoint
└── Task 5.2: Install & Verification
```

---

## Tasks

### Wave 1: Foundation

#### Task 1.1: Shared Utilities
**Description**: Create logger and constants.
**Files**:
- `src/shared/logger.ts` (pino or console wrapper)
- `src/shared/constants.ts`
**Delegation Recommendation**:
- Category: `quick` - Simple utility files.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Logger exports standard methods (info, error, debug)
- [ ] Constants defined

#### Task 1.2: Configuration
**Description**: Environment variable parsing and project loading.
**Files**:
- `src/config/env.ts` (zod or manual validation)
- `src/config/projects.ts` (load data/projects.json)
**Delegation Recommendation**:
- Category: `unspecified-low` - Validation logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] env.ts validates required vars (BOT_TOKEN, OPENCODE_API_KEY)
- [ ] projects.ts loads projects.json

#### Task 1.3: Domain Layer
**Description**: Define core models, events, errors, and Port interfaces.
**Files**:
- `src/domain/models.ts`
- `src/domain/events.ts`
- `src/domain/errors.ts`
- `src/domain/ports/OpenCodePort.ts`
- `src/domain/ports/ChatOutputPort.ts`
- `src/domain/ports/StateStore.ts`
**Delegation Recommendation**:
- Category: `ultrabrain` - Critical architecture definitions.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] All interfaces from PLAN.md implemented exactly
- [ ] Domain types defined (SessionRef, ChatState, etc.)

### Wave 2: Adapters

#### Task 2.1: Persistence Adapter
**Description**: Implement JSON state store with atomic write and mutex.
**Files**:
- `src/adapters/persistence/jsonStateStore.ts`
**Delegation Recommendation**:
- Category: `unspecified-high` - Concurrency/Locking logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Implements StateStore interface
- [ ] Uses temporary file + rename for atomic write
- [ ] Implements in-memory mutex (withChatLock)

#### Task 2.2: OpenCode Adapter Core
**Description**: Implement OpenCodePort using SDK v1/v2.
**Files**:
- `src/adapters/opencode/opencodeAdapter.ts`
- `src/adapters/opencode/eventMapper.ts`
**Delegation Recommendation**:
- Category: `ultrabrain` - Complex SDK integration.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Implements OpenCodePort interface
- [ ] Handles Session CRUD (v1)
- [ ] Handles Events/Permissions (v2)

#### Task 2.3: SSE Transport
**Description**: Implement Bun-native SSE client.
**Files**:
- `src/adapters/opencode/transport/sseClient.ts`
**Delegation Recommendation**:
- Category: `unspecified-low` - Network logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Connects to SSE endpoint using global fetch
- [ ] Handles stream parsing and event dispatch
- [ ] Supports AbortSignal

#### Task 2.4: Telegram Bot Core
**Description**: Initialize Grammy bot, auth middleware, and base UI.
**Files**:
- `src/adapters/telegram/bot.ts`
- `src/adapters/telegram/authMiddleware.ts`
- `src/adapters/telegram/ui/keyboards.ts`
- `src/adapters/telegram/ui/callbacks.ts`
**Delegation Recommendation**:
- Category: `unspecified-high` - Telegram API logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Bot instance created with HTML parse mode
- [ ] Auth middleware checks allowed users
- [ ] Keyboards helper functions defined

#### Task 2.5: Chat Queue & Policies
**Description**: Implement per-chat message serialization and limits.
**Files**:
- `src/app/queue/chatQueue.ts`
- `src/app/policies/limits.ts`
**Delegation Recommendation**:
- Category: `unspecified-high` - Queue logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] ChatQueue serializes operations per chatId
- [ ] Limits defined (BUN_CONFIG_MAX_HTTP_REQUESTS compliance)

### Wave 3: Usecases

#### Task 3.1: Session Commands
**Description**: Implement logic for /new, /list, /resume, /abort.
**Files**:
- `src/app/usecases/sessionCommands.ts`
**Delegation Recommendation**:
- Category: `unspecified-high` - Core business logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] createSessionFlow logic
- [ ] listSessionsFlow logic
- [ ] resumeSessionFlow logic

#### Task 3.2: Prompt Flow
**Description**: Implement message -> prompt -> response flow.
**Files**:
- `src/app/usecases/promptFlow.ts`
**Delegation Recommendation**:
- Category: `unspecified-high` - Core business logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] handleUserMessage logic
- [ ] Subscribes to SSE
- [ ] Sends prompt and handles events

#### Task 3.3: Interactive Flow
**Description**: Handle permission and question events.
**Files**:
- `src/app/usecases/interactiveFlow.ts`
**Delegation Recommendation**:
- Category: `unspecified-high` - Complex flow.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] handlePermissionRequest logic
- [ ] handleQuestionRequest logic

### Wave 4: Wiring

#### Task 4.1: Telegram Command Handlers
**Description**: Wire Telegram commands to Usecases.
**Files**:
- `src/adapters/telegram/commands/index.ts`
- `src/adapters/telegram/commands/new.ts`
- `src/adapters/telegram/commands/resume.ts`
- `src/adapters/telegram/commands/list.ts`
- `src/adapters/telegram/commands/abort.ts`
- `src/adapters/telegram/commands/help.ts`
- `src/adapters/telegram/commands/status.ts`
**Delegation Recommendation**:
- Category: `unspecified-low` - Wiring logic.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Commands registered in bot
- [ ] Commands invoke corresponding Usecases

### Wave 5: Assembly

#### Task 5.1: Main Entrypoint
**Description**: Composition root.
**Files**:
- `src/main.ts`
**Delegation Recommendation**:
- Category: `ultrabrain` - System assembly.
- Skills: [`typescript-programmer`]
**Acceptance Criteria**:
- [ ] Instantiates Adapters
- [ ] Injects dependencies into Usecases
- [ ] Starts Bot

#### Task 5.2: Verification
**Description**: Install dependencies and verify build.
**Delegation Recommendation**:
- Category: `unspecified-low`
- Skills: [`typescript-programmer`, `git-master`]
**Acceptance Criteria**:
- [ ] `bun install` succeeds
- [ ] `tsc --noEmit` passes (no type errors)
- [ ] Bot starts locally (smoke test)

---

## Success Criteria
1. Directory structure matches `File Tree`.
2. All ports in `domain/` are implemented in `adapters/`.
3. `bun install && tsc` passes without errors.
