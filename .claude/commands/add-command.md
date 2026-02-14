# Add Telegram Command

Procedure for adding a new Telegram bot command to claude-go.

## When to Use

- Adding a new `/slash` command (e.g., `/stats`, `/export`)
- Adding a command with inline keyboard callbacks

## When NOT to Use

- **Modifying an existing command** — read the command file directly and edit it
- **Fixing a bug in a command** — use `/hotfix` or fix directly; this skill is for NEW commands only
- **Adding an internal utility function** — no skill needed, just write the code
- **Changing callback behavior only** — edit `adapters/telegram/ui/callbacks.ts` directly

## Procedure

Update ALL of these files. Missing any step will cause the command to silently not work.

### Step 1: Create command handler

File: `src/adapters/telegram/commands/{name}.ts`

```typescript
import type { BotDeps } from '../commands/index.js';
import type { Context } from 'grammy';

export function {name}Command(deps: BotDeps) {
  return async (ctx: Context) => {
    await deps.chatQueue.runTask(ctx.chat!.id, async () => {
      // Implementation here
      await ctx.reply('Done');
    });
  };
}
```

**Rules**:
- Export a `{name}Command(deps)` factory function (not a class)
- Always use `chatQueue.runTask()` for per-chat operations
- If using inline buttons, also export `handle{Name}Callback(ctx, action, state)`

### Step 2: Register in index.ts

File: `src/adapters/telegram/commands/index.ts`

- Add import at top
- Add `reg('{name}', {name}Command(state))` in `registerCommands()`
- If callback buttons: add `case '{name}':` in callback_query handler

### Step 3: Add callback parser (if using buttons)

File: `src/adapters/telegram/ui/callbacks.ts`

- Add type to `ParsedCallback` union
- Add parsing logic in `parseCallback()` function

### Step 4: Update help text

File: `src/adapters/telegram/commands/help.ts`

- Add command to appropriate section

### Step 5: Register with BotFather menu

File: `src/main.ts`

- Add to `bot.api.setMyCommands([...])` array

## Reference Example

See `src/adapters/telegram/commands/git.ts` for a command with inline keyboard callbacks.

## Validation

After completing all steps:

```bash
bun run typecheck
bun test
```

Test manually in Telegram: send `/{name}` and verify it appears in the `/help` output and BotFather menu.
