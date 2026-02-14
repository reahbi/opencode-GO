# CLAUDE-GO PROJECT CONSTITUTION

This is the authoritative guide for agents editing the `claude-go` repository.
All agents must follow this file. For Codex agents: `AGENTS.md` points here.

## IDENTITY

Telegram bot that remotely controls Claude Code AI sessions from a phone.
- **Stack**: Bun + TypeScript + grammy + `@anthropic-ai/claude-agent-sdk`
- **Architecture**: Clean Architecture (Hexagonal / Ports & Adapters)
- **Runtime**: Single-process main bot; optional hook bot as separate process

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
- Runtime integration libraries belong in `adapters/` only
- `domain/` and `app/` must remain framework-free

## ANTI-PATTERNS (ALWAYS LOADED)

- **Do NOT import external packages in `domain/` or `app/`** — only `adapters/` touches grammy/SDK
- **Do NOT use markdown syntax in summary prompts** — Telegram HTML tags only (`<b>`, `<code>`, `<pre>`)
- **Do NOT bypass `chatQueue`** — all per-chat operations must be serialized through it
- **Do NOT mutate state without `saveChatState()`** — JSON file is source of truth
- **Do NOT add a new `LogContext` without updating `PREFIXES` in `logger.ts`**
- **Do NOT hardcode thresholds** — use `LIMITS` in `app/policies/limits.ts` or `shared/constants.ts`

## CONVENTIONS

### Import Style
- Relative paths only, `.js` extensions always (ESM + Bun bundler resolution)
- No path aliases. Use `import type` for type-only imports.

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
- Agent: `agent:{agentName}` | Settings: `settings:{action}[:value]`
- Group: `gs:{action}[:value]` | Model: `sm:{providerID}/{modelID}`
- Debate: `dba:{debateId}` / `dbr:{debateId}` | Tunnel: `tunnel:{port|stop|custom}`
- Git: `git:{diff|diff-full|log|refresh}` | Voice: `voice:listen`

### Logging
- Context-based prefixes: `logger.info('claude', 'msg')` → `[CLAUDE] msg`
- Valid contexts: `telegram`, `claude`, `session`, `state`, `bot`, `queue`, `interactive`, `summary`, `debate`, `review`, `registry`, `tunnel`, `voice`, `hookbot`, `whisper`

## WHERE TO LOOK (QUICK REFERENCE)

| Task | Location |
|------|----------|
| Prompt/response flow | `app/usecases/promptFlow.ts` |
| Session CRUD | `app/usecases/sessionCommands.ts` |
| Question UX | `app/usecases/interactiveFlow.ts` |
| Command wiring | `adapters/telegram/commands/index.ts` |
| Claude event mapping | `adapters/claude/claudeEventMapper.ts` |
| Delivery thresholds | `app/policies/limits.ts` + `shared/constants.ts` |
| State schema changes | `domain/models.ts` + `adapters/persistence/jsonStateStore.ts` |
| Response formatting | `shared/formatResponse.ts` + `app/policies/deliveryRouter.ts` |

## AVAILABLE SKILLS (invoke with /command)

Use these skills for specific tasks. Each skill contains full procedures, templates, and checklists.

| Skill | When to Use |
|-------|-------------|
| `/add-command` | Adding a new Telegram bot command |
| `/write-tests` | Adding or modifying tests |
| `/hook-bot` | Modifying the hook bot subsystem |
| `/architecture-ref` | Major structural changes; need code map or directory tree |
| `/env-config` | Adding environment variables or changing runtime config |

**Rule**: If a skill exists for your task, use it. Do not guess procedures from memory.

## COMMANDS

```bash
bun run dev          # Development (hot reload)
bun run start        # Production
bun run hook         # Run hook bot
bun run typecheck    # Type check only
bun run build        # Build to dist/
bun test             # Run all tests
bun test --watch     # Watch mode
bun test --coverage  # With coverage
bun run setup        # Interactive setup
bun run doctor       # Configuration diagnostics
```

## VALIDATE BEFORE FINISH

Every change must pass:
1. `bun run typecheck`
2. `bun test`

## ESSENTIAL NOTES

- No CI/CD — manual deployment. No GitHub Actions, Makefile, or Dockerfile.
- No linter/formatter — relies solely on `tsc --strict` for quality.
- SDK: `@anthropic-ai/claude-agent-sdk` — in-process `query()` AsyncGenerator.
- Single-process: No separate server. Bot embeds Claude Agent SDK directly.
- State migration: `jsonStateStore.migrateState()` backfills missing fields.
- Constants split: `shared/constants.ts` (general) and `app/policies/limits.ts` (policy-specific).
- Permission mode: `bypassPermissions` — AI executes tools freely.
- Prefer minimal, focused changes over broad refactors unless requested.
