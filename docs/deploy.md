[🇰🇷 한국어](deploy-kr.md)

# PM2 Deployment Guide

This document explains how to reliably deploy and manage Claude-Go using the PM2 process manager.

## PM2 Overview

PM2 is a production process manager for Node.js applications. It automatically restarts your application when it crashes unexpectedly, and provides log management and auto-start on system boot.

## Installing PM2

You can install the Bun-compatible PM2 package or use the standard PM2:
```bash
bun add -g pm2
# or
npm install -g pm2
```

## Configuration and Startup

1. Run the initial project setup:
   ```bash
   bun run setup
   ```
   During setup, you can choose to configure PM2 multi-instance settings.
2. Start the application using the generated configuration file:
   ```bash
   pm2 start ecosystem.config.cjs
   ```

## Key Commands

Use these commands to manage your deployed application:

- **View logs**: `pm2 logs`
- **Restart**: `pm2 restart ecosystem.config.cjs`
- **Stop**: `pm2 stop ecosystem.config.cjs`
- **Delete processes**: `pm2 delete ecosystem.config.cjs`

## Auto-Start on System Boot

Configure the bot to start automatically when the server reboots:

1. Generate the system service registration command:
   ```bash
   pm2 startup
   ```
   (Copy and run the command output in your terminal.)
2. Save the current running process list:
   ```bash
   pm2 save
   ```

## Multi-Instance Management

Using `bun run setup`, you can manage multiple projects as separate Telegram bots. Each instance can have its own unique project path and bot token, running as independent processes through PM2.

**Important Notes**:
- Each instance must use a different `BOT_TOKEN`.
- To prevent data conflicts, set a separate `STATE_DIR` for each instance.
- Use the `INSTANCE_NAME` variable in `.env` to distinguish between instances.

## Multi-Bot Mode (Writer/Reader)

Additional configuration is required to enable bot collaboration in a group chat.

### Required Environment Variables

| Variable | Description |
|---|---|
| `BOT_ROLE` | `writer` or `reader` (collaboration role) |
| `GROUP_CHAT_ENABLED` | `true` (allow group chat responses) |
| `COORDINATION_DIR` | Shared directory for bot coordination (same for all bots) |
| `STATE_DIR` | State directory per bot (different for each bot) |

### ecosystem.config.cjs Example

```javascript
const COORDINATION_DIR = '/tmp/claude-go-coordination'

module.exports = {
  apps: [
    {
      name: 'claude-go-writer',
      script: 'src/main.ts',
      interpreter: 'bun',
      env: {
        BOT_TOKEN: 'writer-bot-token',
        ALLOWED_USER_IDS: 'your-user-id',
        DEFAULT_PROJECT: '/path/to/project',
        INSTANCE_NAME: 'writer',
        STATE_DIR: 'data/instances/writer',
        BOT_ROLE: 'writer',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
    },
    {
      name: 'claude-go-reader',
      script: 'src/main.ts',
      interpreter: 'bun',
      env: {
        BOT_TOKEN: 'reader-bot-token',
        ALLOWED_USER_IDS: 'your-user-id',
        DEFAULT_PROJECT: '/path/to/project',
        INSTANCE_NAME: 'reader',
        STATE_DIR: 'data/instances/reader',
        BOT_ROLE: 'reader',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
    },
  ],
}
```

### Alternative: /addbot Wizard

You can also add bots via the `/addbot` command in Telegram. The wizard guides you through token verification to PM2 setup.

For more details: [Multi-Bot Guide](multibot.md)
