# CLAUDE-GO QUICK GUIDE FOR CLAUDE CODE

Use this file as a quick entry point.
`AGENTS.md` is the authoritative project guide.

## Read Order

1. Session system/developer instructions
2. `AGENTS.md` (source of truth for this repository)
3. `CLAUDE.md` (this quick guide)
4. `README.md` and feature docs

## Project Snapshot

- Stack: Bun + TypeScript + grammy + `@anthropic-ai/claude-agent-sdk`
- Architecture: Clean Architecture (Hexagonal / Ports & Adapters)
- Runtime: Main bot is single-process; hook bot is optional second process

## Non-Negotiable Rules

- Keep layering strict:
  - `domain/`: pure TS types/ports, no framework deps
  - `app/`: imports `domain/` only
  - `adapters/`: external integrations (Telegram, Claude SDK, persistence)
- Do not bypass `chatQueue` for per-chat operations
- Do not mutate chat state without `saveChatState()`
- Keep constants in `shared/constants.ts` or `app/policies/limits.ts` (no hardcoded thresholds)

## Where To Look First

- Prompt flow: `src/app/usecases/promptFlow.ts`
- Session commands: `src/app/usecases/sessionCommands.ts`
- Interactive question handling: `src/app/usecases/interactiveFlow.ts`
- Telegram command wiring: `src/adapters/telegram/commands/index.ts`
- Claude event mapping: `src/adapters/claude/claudeEventMapper.ts`

## Command Work Checklist

When adding a new Telegram command, update all required locations in `AGENTS.md` checklist:

- `src/adapters/telegram/commands/{name}.ts`
- `src/adapters/telegram/commands/index.ts`
- `src/adapters/telegram/ui/callbacks.ts` (if callbacks are used)
- `src/adapters/telegram/commands/help.ts`
- `src/main.ts` (`setMyCommands`)

## Validate Before Finish

- Typecheck: `bun run typecheck`
- Tests: `bun test`
- Build (if needed): `bun run build`

## Notes

- This repository currently has no formatter/linter gate; rely on strict TypeScript + tests.
- Prefer minimal, focused changes over broad refactors unless requested.
