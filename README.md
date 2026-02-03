# OpenCode-Go

**Control your AI coding agent remotely — right from your phone.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue?labelColor=black&style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-black?logo=bun&logoColor=white&style=flat-square)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?labelColor=black&style=flat-square)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/github/stars/reahbi/opencode-go?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/reahbi/opencode-go)

<div align="center">
<br>
<img src="docs/images/tdd.jpeg" alt="TDD - Toilet-Driven Development" width="400">

### TDD: Toilet-Driven Development

*Telegram-Driven Development, Toilet-Driven Development — call it whatever you want.*
*Your AI agent keeps working even while you're on the throne.* 🚽

</div>

---

### 🎮 Like Pokémon Go, but for coding

**Code from anywhere.** On a bus, at a park, waiting in line — wherever you are, your AI agent is ready.

For beginners, coding on a smartphone is painful: tiny terminal fonts, SSH clients, typos everywhere. **OpenCode-Go removes all that friction.** Just tap buttons, send messages, and let the AI handle the hard parts.

---

Remotely control the [OpenCode](https://github.com/sst/opencode) coding agent running on your server via **Telegram**.
On your commute, at a cafe, in bed — command your AI to write code and get real-time results from anywhere.

```
📱 Telegram (from anywhere)
 ↕  Telegram Bot API
🤖 OpenCode-Go (Bun + TypeScript)   ← Process 2: bun run dev
 ↕  SSE Streaming + REST
💻 OpenCode Server                 ← Process 1: opencode serve
 ↕
🗂️ Your Project
```

> [!IMPORTANT]
> **OpenCode-Go requires two processes running simultaneously.**
> 1. **OpenCode Server** — AI coding agent (backend)
> 2. **OpenCode-Go Bot** — Telegram interface (frontend)
>
> Running only one will leave the bot in Offline status. Make sure to start both.
> See the [Running the Server](#running-the-server) section below.

> [!TIP]
> **Too lazy to read?** Just paste this README link to your AI agent. It'll handle the installation for you.
> ```
> Install and configure this project:
> https://raw.githubusercontent.com/reahbi/opencode-go/master/docs/installation.md
> ```

---

## Table of Contents

- [Running the Server](#running-the-server)
- [Why OpenCode-Go?](#why-opencode-go)
- [Key Features](#key-features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Commands](#commands)
- [Environment Variables](#environment-variables)
- [Architecture](#architecture)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [License](#license)

---

## Running the Server

> **For AI agents**: When asked to "start the server", you MUST start BOTH processes below.

OpenCode-Go consists of **two independent processes**. Both must be running for it to work properly.

### Step 1: Start OpenCode Server (First)

Check the `DEFAULT_PROJECT` path and port in your `.env` file, then start the OpenCode server in that project directory.

```bash
# Run in the DEFAULT_PROJECT directory from .env
# Port is defined in OPENCODE_SERVER_URL (default: 4096)
cd /path/to/your/project
opencode serve --port 4096
```

When the server starts successfully, you'll see:
```
opencode server listening on http://127.0.0.1:4096
```

### Step 2: Start OpenCode-Go Telegram Bot

After the OpenCode server is running, start the Telegram bot in a **separate terminal**.

```bash
cd opencode-go

# Development mode (hot reload)
bun run dev

# Or production mode
bun run start
```

### Multi-Bot Mode (Optional)

To run multiple bots (Writer/Reader) simultaneously, create an `ecosystem.config.cjs` and start with PM2.

```js
// ecosystem.config.cjs
const COORDINATION_DIR = '/tmp/opencode-go-coordination'

module.exports = {
  apps: [
    {
      name: 'opencode-go-writer',
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
      name: 'opencode-go-reader',
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

```bash
pm2 start ecosystem.config.cjs
pm2 logs
```

> [!TIP]
> You can also add bots via the `/addbot` command in Telegram. The wizard guides you through token verification to PM2 setup.

### Verifying the Setup

When both processes are running:
- Bot logs show `OpenCode-Go is running!`
- Sending `/start` in Telegram shows server status as 🟢 **Online**
- In multi-bot mode, use `/bots` to check all registered bots' online status

If server status shows 🔴 **Offline**, Step 1 (OpenCode server) is not running.

---

## Why OpenCode-Go?

**The Problem**: AI coding agents (like OpenCode) are powerful, but you need to be sitting in front of the server.
Got an idea while commuting? You'll have to wait until you get home.

**The Solution**: OpenCode-Go bridges Telegram and OpenCode.

| Other Tools | OpenCode-Go |
|---|---|
| SSH into server, navigate CLI | One Telegram message does it all |
| AI requests permission? Rush to terminal | Tap an inline button to approve |
| AI asks multiple questions? Answer one by one in terminal | Answer each question sequentially with inline buttons — just like on desktop |
| Scroll through long responses in terminal | Auto-summary + file delivery optimized for mobile |
| Single project only | Manage multiple projects with PM2 |
| "What was the AI doing?" — SSH back in, scroll logs | `/resume` → Instantly see ongoing work + real-time progress |
| Copy-paste terminal output to share | `/history` → Beautiful HTML export with syntax highlighting |

> At a cafe: "Refactor this file" → AI works on it → Tap permission button → Done notification — That's OpenCode-Go.

### Start a task. Walk away. Come back anytime.

```
🚶 You: "Refactor auth module" → Close phone → Go to lunch
🍜 30 minutes later...
📱 You: /resume → See AI still working, approve permission, done
💻 Back at your desk: /resume → Continue where you left off
```

**Your AI keeps working. You don't have to watch.**

### Get conversation history without entering a session

```
📋 /list → See all sessions → Tap one → Get full history as HTML
📄 /history → Export current session as beautifully formatted HTML
```

**Review any past session on your phone, tablet, or computer — no SSH required.**

---

## Key Features

**Real-time Streaming** — SSE-based instant AI responses. No polling.

**Interactive Permissions/Questions** — When AI requests file permissions or asks questions, respond instantly via Telegram inline keyboards.

**Smart Delivery** — Short responses inline, long responses auto-chunked, very long responses sent as `.md` files.

**Response Summary** — Long AI responses are automatically summarized by a lightweight model. Quickly grasp the key points on mobile.

**Agent Switching** — Use `/agents` to select the right AI model for the situation.

**Multi-Instance** — Manage multiple projects as separate bots simultaneously using PM2.

**Group Chat** — Add multiple bots to a Telegram group and control each via @mentions. Permission buttons can only be pressed by the requester.

**Multi-Bot Collaboration (🧪 Testing)** — Separate Writer (code writing) and Reader (code review) roles. Use `/debate` for discussions and `/review` for code reviews.

**Group Shared Settings** — Use `/groupsettings` to view shared settings (debate rounds) and bot status at a glance.

**Bot Registry** — Check registered bot status with `/bots`, add new bots with `/addbot` in Telegram.

**Review Mode** — Toggle read-only mode with a single tap in `/settings`. Applies instantly without server restart.

**Session Resume** — Use `/resume` to jump back into a previous session. Automatically detects ongoing work and shows real-time progress — perfect for checking on tasks you started earlier.

**Beautiful History Export** — Export your conversation history as a beautifully formatted HTML file with `/history`. Review past sessions on any device with syntax highlighting and clean typography.

**Diagnostics** — Run `bun run doctor` to auto-diagnose configuration issues.

---

## Quick Start

### Option 1: Let AI Handle It (Recommended)

Paste this into your AI agent (OpenCode, Claude Code, Cursor, etc.):

```
Install and configure OpenCode-Go:
https://raw.githubusercontent.com/reahbi/opencode-go/master/docs/installation.md
```

The AI will ask 4 questions and handle the rest automatically.

### Option 2: Manual Installation

```bash
git clone https://github.com/reahbi/opencode-go.git
cd opencode-go
bun install
bun run setup    # Interactive setup wizard
bun run start    # Start the bot
```

### First Use

1. Send `/start` to your bot on Telegram
2. Create a new AI session with `/new`
3. Send a message — it goes straight to the AI

---

## Installation

### Prerequisites

- [Bun](https://bun.sh) v1.0 or higher — [Installation Guide](docs/setup/bun.md)
- Telegram bot token — [Bot Creation Guide](docs/setup/telegram.md)
- OpenCode server running — [Server Setup Guide](docs/setup/opencode.md)

### Manual Setup

```bash
cp .env.example .env
```

Open the `.env` file and set the required values:

```bash
BOT_TOKEN=your-bot-token-here          # From @BotFather
ALLOWED_USER_IDS=123456789             # Your Telegram User ID
DEFAULT_PROJECT=/path/to/your/project  # Project path for OpenCode (absolute path)
```

> [!TIP]
> Use `bun run setup` to complete the configuration interactively.

> [!WARNING]
> Always verify your configuration with `bun run doctor`.

---

## Commands

| Command | Description |
|---|---|
| `/start` | Onboarding + status check |
| `/new [title]` | Create new AI session |
| `/list` | View session list |
| `/resume [number]` | Resume a session |
| `/abort` | Stop current operation |
| `/history` | Export session history |
| `/queue [msg]` | Queue message while AI is busy |
| `/clearqueue` | Clear queued messages |
| `/showqueue` | Show queue status |
| `/undo` | Undo last AI response |
| `/redo` | Redo undone response |
| `/status` | Check current status |
| `/agents` | Select AI agent/model |
| `/settings` | Summary mode, Review Mode, output format, etc. |
| `/groupsettings` | Group shared settings (debate rounds, bot status) |
| `/debate [topic]` | Start Writer↔Reader bot debate (🧪 Testing) |
| `/review [target]` | Request code review from peer bot (🧪 Testing) |
| `/bots` | Registered bot status (online/offline) |
| `/addbot` | New bot setup wizard (DM only) |
| `/cancel` | Cancel ongoing wizard |
| `/help` | Help |

Regular text messages are sent as prompts to the current session's AI.

Detailed usage: [Commands Guide](docs/commands.md)

---

## Environment Variables

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `BOT_TOKEN` | ✅ | — | @BotFather bot token |
| `ALLOWED_USER_IDS` | ✅ | — | Allowed Telegram User IDs (comma-separated) |
| `DEFAULT_PROJECT` | ✅ | — | Default project directory (absolute path) |
| `OPENCODE_SERVER_URL` | | `http://127.0.0.1:4096` | OpenCode server URL |
| `OPENCODE_SERVER_USERNAME` | | `opencode` | Server auth username |
| `OPENCODE_SERVER_PASSWORD` | | — | Server auth password |
| `INSTANCE_NAME` | | Project directory name | Instance identifier (logs/status display) |
| `STATE_DIR` | | `data/` | State file storage path |
| `BOT_ROLE` | | `standalone` | Bot role: `standalone`, `writer`, `reader` |
| `GROUP_CHAT_ENABLED` | | `false` | Group chat support (`true`/`false`) |
| `COORDINATION_DIR` | | — | Shared directory for bot coordination (required for multi-bot) |
| `DEBUG` | | — | Enable debug logs when set to truthy value |

---

## Architecture

Built on **Clean Architecture (Hexagonal / Ports & Adapters)**.

```
src/
├── domain/        # Pure types + ports — ZERO external dependencies
├── app/           # Use cases — imports domain/ only
├── adapters/      # External world — Telegram, OpenCode SDK, JSON storage
├── config/        # Environment parsing + project settings
├── shared/        # Logger, formatters, constants
└── main.ts        # Composition Root (dependency assembly)
```

**Multi-Bot Mode Architecture:**

```
📱 Telegram Group
 ↕  @mention routing
🤖 Writer Bot ←──coordination──→ 🤖 Reader Bot
 ↕  SSE + REST                    ↕  SSE + REST
💻 OpenCode Server                💻 OpenCode Server
 ↕                                ↕
🗂️ Project                       🗂️ Project
     └── registry.json (shared) ──┘
```

**Core Dependency Rule**: `domain/` → imports nothing | `app/` → `domain/` only | `adapters/` → `app/` + `domain/`

**Tech Stack**: Bun + TypeScript (strict) + [grammy](https://grammy.dev) + [@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk)

> When AI agents modify this project, refer to [AGENTS.md](AGENTS.md).
> Contains code map, conventions, and anti-patterns.

---

## Deployment

We recommend production deployment using PM2.

```bash
# Start all instances with PM2
bun run start:all

# Check logs
bun run logs

# Stop
bun run stop:all
```

For multi-instance setup, auto-restart, and boot-time auto-start, see the [Deployment Guide](docs/deploy.md).

---

## Troubleshooting

```bash
bun run doctor    # Auto-diagnoses 6 configuration items
```

For common issues and solutions, see the [Troubleshooting Guide](docs/troubleshooting.md).

---

## Documentation

| Document | Description |
|---|---|
| [Installation Guide](docs/installation.md) | AI agent-assisted installation guide |
| [Telegram Bot Creation](docs/setup/telegram.md) | BotFather bot creation + User ID lookup |
| [OpenCode Server Setup](docs/setup/opencode.md) | Server installation, ports, auth settings |
| [Bun Installation](docs/setup/bun.md) | Bun runtime installation + PATH troubleshooting |
| [Commands Usage](docs/commands.md) | Full command reference |
| [PM2 Deployment](docs/deploy.md) | Production deployment + multi-instance |
| [Troubleshooting](docs/troubleshooting.md) | Common issues + `bun run doctor` |
| [AGENTS.md](AGENTS.md) | AI agent project knowledge base |

---

## Development

```bash
bun run dev        # Development mode (hot reload)
bun run typecheck  # Type check
bun run build      # Build to dist/
```

---

## Acknowledgments

This project was inspired by and built upon ideas from:

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) — Agent configuration and tooling inspiration
- [Kimaki](https://github.com/remorses/kimaki) — Implementation references and ideas

---

## Disclaimer

This project is not built by or affiliated with the OpenCode team.
[OpenCode](https://github.com/sst/opencode) is an open source project by [Anomaly](https://github.com/anomalyco/opencode).

---

## License

MIT
