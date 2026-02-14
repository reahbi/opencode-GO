# Hook Bot

Procedure for modifying the hook bot subsystem in claude-go.

## When to Use

- Modifying hook bot notification logic
- Adding new notification types (completion, stall, error)
- Changing hook bot configuration or setup wizard
- Modifying hook bot state persistence

## When NOT to Use

- **Working on the main bot** — the hook bot is a SEPARATE process with its own composition root at `src/hookBot.ts`. Do not confuse with `src/main.ts`.
- **Adding a regular Telegram command** — use `/add-command` skill instead
- **Changing shared domain types used by both bots** — edit domain types directly, but test both bots

## Architecture

The hook bot follows the same Clean Architecture as the main bot but has its own composition root:

| Layer | File | Role |
|-------|------|------|
| Domain types | `src/domain/hookBotTypes.ts` | HookBotConfig, TrackedSession, HookNotification |
| Domain port | `src/domain/ports/HookNotificationPort.ts` | Notification output interface |
| Usecase | `src/app/usecases/completionWatcher.ts` | Session monitoring + stall detection |
| Adapter | `src/adapters/telegram/hookBotAdapter.ts` | HookNotificationPort impl for Telegram |
| Persistence | `src/adapters/persistence/hookBotStateStore.ts` | Hook bot state persistence |
| Setup wizard | `src/adapters/telegram/commands/addhookbot.ts` | `/addhookbot` in existing bots |
| Composition root | `src/hookBot.ts` | DI wiring, bot start |

## Key Behaviors

- **Session completion**: Detects busy → idle transition, sends full last message
- **Stall detection**: 30min inactivity warning (`LIMITS.INACTIVITY_WARNING_MS`)
- **Error forwarding**: Captures and forwards session errors
- **Config**: `data/hook-config.json` (created by `/addhookbot` wizard)

## Running

```bash
bun run hook              # Direct
pm2 start ecosystem.config.cjs  # With PM2 (multi-bot)
```

## Validation

```bash
bun run typecheck
bun test
```

Test manually: trigger a session completion and verify notification arrives in the hook bot's Telegram chat.
