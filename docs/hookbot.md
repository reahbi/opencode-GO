[한국어](hookbot-kr.md)

# Hook Bot Guide

A lightweight, standalone process that monitors your OpenCode sessions and sends Telegram notifications — completions, stalls, errors, permissions, and questions.

---

## Table of Contents
1. [What is Hook Bot?](#what-is-hook-bot)
2. [Quick Start (3-Minute Setup)](#quick-start-3-minute-setup)
3. [How It Works](#how-it-works)
4. [Notification Types](#notification-types)
5. [Configuration](#configuration)
6. [Running the Hook Bot](#running-the-hook-bot)
7. [Commands](#commands)
8. [Environment Variables](#environment-variables)
9. [Architecture](#architecture)
10. [Troubleshooting](#troubleshooting)

---

## What is Hook Bot?

Hook Bot is a **separate Telegram bot process** designed for passive session monitoring. While the main OpenCode-Go bot requires active interaction (sending messages, creating sessions), Hook Bot runs quietly in the background and notifies you when something happens.

### Main Bot vs Hook Bot

| | Main Bot | Hook Bot |
|---|---|---|
| **Purpose** | Interactive AI control | Passive session monitoring |
| **Commands** | Full set (`/new`, `/resume`, etc.) | Minimal (`/hookstatus`, `/start`) |
| **Interaction** | Send prompts, manage sessions | Receive notifications, approve permissions |
| **Process** | `bun run start` / `bun run dev` | `bun run hook` |
| **Entry point** | `src/main.ts` | `src/hookBot.ts` |

### Why Use Hook Bot?

- **"Fire and forget" workflows** — Start a task on the main bot, close Telegram, get notified when it's done.
- **Multi-project monitoring** — Watch all your projects from a single chat. One bot, many projects.
- **Permission forwarding** — Approve file permissions directly from the notification chat without switching to the main bot.
- **Lightweight** — No SSE streaming edits, no state management. Just event → notify.

---

## Quick Start (3-Minute Setup)

### Step 1: Create a Bot in BotFather

1. Find [@BotFather](https://t.me/botfather) in Telegram.
2. Create a new bot (e.g., `MyHookBot`) with `/newbot`.
3. Copy the **API Token**.

### Step 2: Run the `/addhookbot` Wizard

In a **1:1 chat (DM)** with your existing main bot:

1. Send `/addhookbot`.
   > 📡 **Hook Bot Setup Wizard**
   >
   > Send the bot token from BotFather.

2. Paste the API token.
   > ✅ **@MyHookBot** verified
   >
   > Select projects to monitor:
   > `[📡 All projects]` `[⬜ project-a]` `[⬜ project-b]` `[✅ Done]`

3. Choose projects — select individual ones or tap **📡 All projects** to monitor everything.

4. Enter the chat ID for notifications (or send `default` to use the current chat).
   > ✅ **Hook bot configured!**
   >
   > `[🚀 Start Now (PM2)]` `[📋 Save Config Only]`

5. Tap **🚀 Start Now** to launch immediately via PM2.

### Step 3: Verify

Send `/start` to your hook bot. You should see:
> 🔔 Hook Bot active. Use /hookstatus for details.

Send `/hookstatus` to confirm monitored projects:
> 🔔 **Hook Bot Status**
>
> Monitoring 3 project(s):
> 1. my-app
> 2. my-api
> 3. my-lib
>
> Mode: all

---

## How It Works

```
📱 Telegram (notifications)
 ↕  Telegram Bot API
🔔 Hook Bot (Bun + TypeScript)    ← bun run hook
 ↕  SSE Streaming (read-only)
💻 OpenCode Server                ← opencode serve
 ↕
🗂️ Your Projects (1..N)
```

1. Hook Bot connects to the OpenCode server via **SSE** (Server-Sent Events) for each monitored project.
2. It tracks session state transitions: `idle → busy → idle`.
3. When a session completes (busy → idle), it fetches the last assistant message and sends a notification.
4. Permissions and questions are forwarded with interactive inline buttons.
5. If a session is busy for 30+ minutes without activity, a stall warning is sent.
6. On SSE disconnect, it automatically reconnects with exponential backoff and reconciles missed events.

---

## Notification Types

### ✅ Session Completion
Sent when an AI session finishes working (busy → idle).

```
✅ Session completed
📁 my-project
📝 Refactor auth module
⏱ 12m 34s

[Last assistant message delivered below]
```

Includes the **full last assistant message** using smart delivery (inline / chunked / file attachment).

### ⚠️ Stall Warning
Sent when a session has been busy for 30+ minutes with no activity.

```
⚠️ Session stalled in my-project
Session: ses_abc123
Inactive for 35m 12s
```

Stall warnings repeat every 30 minutes until the session becomes idle or is manually aborted.

### ❌ Session Error
Sent when the OpenCode server reports a session error.

```
❌ Session error in my-project
Session: ses_abc123
Error: Model rate limit exceeded
```

### 🔐 Permission Request
Forwarded when the AI requests file permissions. Includes interactive buttons to respond directly.

```
🔐 Permission requested
📁 my-project
🔧 Write to files
Patterns: src/**/*.ts, tests/**/*.ts

[✅ Once] [✅ Always] [❌ Reject]
```

- **Once** — Allow this specific request.
- **Always** — Allow all future requests with this pattern.
- **Reject** — Deny the request.

### ❓ Question
Forwarded when the AI asks a question with options.

```
❓ Question from AI
📁 my-project
Which testing framework should I use?

[Jest]
[Vitest]
[bun:test]
```

> **Note**: Multi-question requests (multiple questions at once) display a message to respond from the main bot, as Hook Bot supports single-question responses only.

---

## Configuration

### hook-config.json

The wizard creates `data/hook-config.json`:

```json
{
  "botToken": "123456:ABC-DEF...",
  "chatId": 123456789,
  "projects": [
    { "directory": "/home/user/my-app", "name": "my-app" },
    { "directory": "/home/user/my-api", "name": "my-api" }
  ],
  "serverUrl": "http://127.0.0.1:4096",
  "serverUsername": "opencode",
  "serverPassword": "your-password",
  "mode": "selected"
}
```

### Configuration Fields

| Field | Required | Description |
|---|:---:|---|
| `botToken` | ✅ | Telegram bot token from BotFather |
| `chatId` | ✅ | Telegram chat ID for notifications |
| `projects` | ✅* | Array of `{directory, name}` to monitor |
| `serverUrl` | ✅ | OpenCode server URL |
| `serverUsername` | | Server auth username (default: `opencode`) |
| `serverPassword` | | Server auth password |
| `mode` | ✅ | `all` (auto-discover) or `selected` (manual list) |

> \* When `mode` is `all`, projects are auto-discovered from the server at startup. The `projects` array is populated automatically.

---

## Running the Hook Bot

### Development

```bash
bun run hook
```

### Production (PM2)

The `/addhookbot` wizard auto-appends an entry to `ecosystem.config.cjs`:

```javascript
{
  name: 'opencode-go-hookbot',
  script: 'src/hookBot.ts',
  interpreter: 'bun',
  cwd: '/path/to/opencode-go',
  env: {
    HOOK_CONFIG_PATH: 'data/hook-config.json',
    OPENCODE_SERVER_URL: 'http://127.0.0.1:4096',
    OPENCODE_SERVER_USERNAME: 'opencode',
    OPENCODE_SERVER_PASSWORD: 'your-password',
  },
  autorestart: true,
  max_memory_restart: '512M',
},
```

```bash
pm2 start ecosystem.config.cjs
pm2 logs opencode-go-hookbot
```

### Manual Start

```bash
HOOK_CONFIG_PATH=data/hook-config.json bun run src/hookBot.ts
```

---

## Commands

Hook Bot has a minimal command set:

| Command | Description |
|---|---|
| `/start` | Confirm the bot is active |
| `/hookstatus` | Show monitored projects and mode |

All other interaction happens through **notification callbacks** (permission/question buttons).

---

## Environment Variables

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `HOOK_CONFIG_PATH` | | `data/hook-config.json` | Path to hook bot configuration file |

> The hook bot reads all other settings (server URL, auth, projects) from the config JSON file, not from environment variables.

---

## Architecture

Hook Bot follows the same **Clean Architecture** as the main bot but with a much simpler composition:

```
src/hookBot.ts                              # Composition root
 ├── domain/hookBotTypes.ts                 # HookBotConfig, TrackedSession, HookNotification
 ├── domain/ports/HookNotificationPort.ts   # notify(notification) interface
 ├── app/usecases/completionWatcher.ts      # SSE monitoring + stall detection
 └── adapters/telegram/hookBotAdapter.ts    # Telegram notification + callback handlers
```

### Key Components

| Component | Role |
|---|---|
| `createCompletionWatcher` | Connects to SSE per project, tracks busy/idle transitions, detects stalls |
| `createHookBotNotificationAdapter` | Implements `HookNotificationPort` — formats and sends Telegram messages |
| `createHookBot` | Creates a grammy Bot instance with default HTML parse mode |
| `createHookBotAuthGuard` | Middleware that only allows messages from the configured `chatId` |
| `registerHookBotHandlers` | Registers `/start`, `/hookstatus`, and callback handlers for permissions/questions |

### SSE Reconnection

- Automatic reconnect with exponential backoff (1s → 30s max).
- On reconnect, reconciles tracked sessions against server state to catch completions missed during disconnect.
- Seeds busy sessions from the server at startup.

### Request Tracking

Permission and question callbacks use a `requestMap` with TTL (10 minutes). After expiration, buttons show "⏳ Expired".

---

## Troubleshooting

**Q: Hook bot isn't sending notifications.**
- **A1**: Verify the OpenCode server is running and accessible from the hook bot.
- **A2**: Check `hook-config.json` has correct `serverUrl` and credentials.
- **A3**: Run `pm2 logs opencode-go-hookbot` to see connection errors.

**Q: Permission buttons show "⏳ Expired".**
- **A**: Interaction TTL is 10 minutes. Respond to permissions within that window, or handle them from the main bot.

**Q: "Mode is all" but no projects are being monitored.**
- **A**: The server must have active projects. Check `curl -u opencode:password http://127.0.0.1:4096/project` returns project data.

**Q: How do I remove the hook bot?**
- **A**: Run `/addhookbot` again — it will show the current configuration with a **❌ Remove hook bot** button. This deletes the config, stops the PM2 process, and cleans up the ecosystem file.

**Q: Can I use the same bot token for main bot and hook bot?**
- **A**: No. Each bot process needs its own unique Telegram bot token. Create a separate bot in BotFather for the hook bot.

---

Happy monitoring! 📡🔔
