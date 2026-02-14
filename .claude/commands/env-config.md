# Environment & Runtime Configuration

Procedure for adding environment variables and changing runtime configuration.

## When to Use

- Adding a new environment variable
- Changing PM2 or runtime configuration
- Modifying startup behavior

## When NOT to Use

- **Changing policy thresholds** (timeouts, limits) — edit `app/policies/limits.ts` directly
- **Changing Telegram constants** — edit `shared/constants.ts` directly
- **Adding a command** — use `/add-command` skill instead

## Environment Variables

```bash
# Required
BOT_TOKEN=               # Telegram bot token from BotFather
ALLOWED_USER_IDS=        # Comma-separated Telegram user IDs (at least one)
DEFAULT_PROJECT=         # Absolute path to default project directory

# Claude Configuration (optional)
CLAUDE_MODEL=            # Default: claude-sonnet-4-5
CLAUDE_CODE_PATH=        # Path to Claude Code executable (auto-detected)
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

## Adding a New Environment Variable

### Step 1: Add to config/env.ts

File: `src/config/env.ts`

Add validation in `loadEnvConfig()`. Use the existing pattern:
- Required vars: throw on missing
- Optional vars: provide default value

### Step 2: Update EnvConfig type

If `EnvConfig` is a typed interface, add the new field.

### Step 3: Wire to consumer

Pass the value through the composition root (`main.ts` or `hookBot.ts`) to wherever it's needed.

### Step 4: Update doctor.ts

File: `src/cli/doctor.ts`

Add the new variable to diagnostic checks if it's important for setup.

## Running the System

### Single bot
```bash
bun run start        # Production
bun run dev          # Development (hot reload)
```

### Hook bot
```bash
bun run hook         # Direct
```

### Multi-bot with PM2
```bash
pm2 start ecosystem.config.cjs   # Start all bots
pm2 status                        # Check status
pm2 logs                          # View logs
pm2 stop all                      # Stop all
```

### Diagnostics
```bash
bun run setup        # Interactive setup wizard
bun run doctor       # Configuration diagnostics
```

## Validation

```bash
bun run typecheck
bun test
```

Test: run `bun run doctor` to verify the new variable is detected correctly.
