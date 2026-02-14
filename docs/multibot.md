[🇰🇷 한국어](multibot-kr.md)

# Multi-Bot Mode Guide

Welcome to **Multi-Bot Mode** — run multiple AI bots that collaborate together! 🤖🤖

This guide walks you through controlling multiple bots in a single group chat, having them debate topics, and reviewing each other's code.

---

## Table of Contents
1. [What is Multi-Bot?](#what-is-multi-bot)
2. [Quick Start (5-Minute Setup)](#quick-start-5-minute-setup)
3. [Understanding Bot Roles](#understanding-bot-roles)
4. [Using Group Chat](#using-group-chat)
5. [Debate Feature (/debate) 🧪](#debate-feature-debate-)
6. [Code Review Feature (/review) 🧪](#code-review-feature-review-)
7. [Bot Management](#bot-management)
8. [Group Settings (/groupsettings)](#group-settings-groupsettings)
9. [Personal Settings (/settings)](#personal-settings-settings)
10. [Manual Setup (ecosystem.config.cjs)](#manual-setup-ecosystemconfigcjs)
11. [Environment Variable Reference](#environment-variable-reference)
12. [Troubleshooting (FAQ)](#troubleshooting-faq)

---

## What is Multi-Bot?
Multi-Bot Mode is a way to operate bots with different specialties (roles) as a team.

*   **Separation of Expertise:** Rather than having one bot do everything, assigning one to write code (Writer) and another to review code (Reader) produces much more thorough results. 🎭
*   **Collaboration Features:** Bots can debate on specific topics or have one bot review code written by another.
*   **@Mention Control:** In group chat, you can give commands to `@WriterBot` and ask questions to `@ReaderBot`, creating an efficient workflow. 🔍

---

## Quick Start (5-Minute Setup)

### Step 1: Create Bots in BotFather 🤖
You'll need at least 2 bots.
1. Find [@BotFather](https://t.me/botfather) in Telegram.
2. Create your first bot (e.g., `MyWriterBot`) using `/newbot` and copy the **API Token**.
3. Run `/newbot` again to create a second bot (e.g., `MyReaderBot`) and save its token too.
4. **Important:** Make sure `Bot Settings` -> `Allow Groups?` is `Enabled` for each bot!

### Step 2: Run the `/addbot` Wizard 🪄
Do this in a **1:1 chat (DM)** with your existing bot.

1. Send `/addbot` to the bot.
   > 🤖 **Bot Setup Wizard**
   >
   > Send the token of the new bot you received from BotFather.

2. Paste the API token of your new bot.
   > ✅ **@MyWriterBot** verified
   >
   > Select a role:
   > `[✏️ Writer]` `[🔒 Reader]`

3. Click a role button. You'll see a project list.
   > Role: **✏️ Writer**
   >
   > Select a project:
   > `[📁 my-project]` `[✏️ Enter manually]`

4. Select a project and you're done! You can start right away.
   > ✅ **Bot registered!**
   >
   > `[🚀 Start Now (PM2)]` `[📋 Save Config Only]`

5. Click `🚀 Start Now` and the bot will immediately start running on the server.

> 💡 Add the second bot the same way. This time, select the `🔒 Reader` role.

### Step 3: Invite to Group Chat 👥
1. Create a new group in Telegram.
2. Invite all the bots you created to the group.

### Step 4: Have Your First Conversation 💬
```
👤 You: @MyWriterBot /new Refactoring project
🤖 WriterBot: ✅ Session created

👤 You: @MyWriterBot Refactor auth.ts for me
🤖 WriterBot: (Working in real-time streaming...)

👤 You: @MyReaderBot Check if there are any issues with the code Writer just changed
🤖 ReaderBot: Overall it looks good, but there's a missing null check...
```

---

## Understanding Bot Roles

### ✏️ Writer (Author)
The 'action hero' that directly modifies code and creates files.
*   **Permissions:** Can read and write files.
*   **Use for:** Requests like "Refactor this function" or "Create a new API endpoint".
*   **Review Mode:** **OFF** by default.

### 🔒 Reader (Reviewer)
The 'meticulous inspector' that analyzes code and provides advice.
*   **Permissions:** **Read-only** by default. (Modification requests are automatically rejected.)
*   **Use for:** Code analysis, bug finding, architecture questions, etc.
*   **Review Mode:** **ON** by default.

### ⚙️ Standalone (Independent)
The default state with no role distinction. Use when handling everything with a single bot. Debate and review features between bots are not available.

---

## Using Group Chat

### Communicating via @Mention
In group chat, bots don't listen to every message. You must **@mention** the bot to get a response.

*   **Example:**
    *   👤 User: `@MyWriterBot Add logging to this file`
    *   🤖 WriterBot: `Sure, adding logs... (starting work)`
    *   👤 User: `@MyReaderBot Any issues with the code Writer just fixed?`
    *   🤖 ReaderBot: `Analysis shows exception handling could be improved...`

Without a mention, bots will just quietly observe. 🤫

### Permission Buttons
When a bot wants to modify files, **[Approve] / [Reject]** buttons appear.
*   **Private chat:** Anyone can press them.
*   **Group chat:** For security, **only the person who issued the command** can press the buttons. Others will see "You don't have permission". 🔒

---

## Debate Feature (/debate) 🧪

> **🧪 Testing**: This feature is currently in testing. Some behaviors may be unstable.

A feature where two bots exchange opinions and reach a conclusion.

### Usage
Type `/debate [topic]` in the chat.

### Example Conversation
```
👤 You: /debate Should we use Vue instead of React for this project?

🎭 Debate started: React vs Vue

🤖 WriterBot (Round 1):
  Vue has a lower learning curve and Single File Components
  boost productivity...

🤖 ReaderBot (Round 2):
  However, considering React's ecosystem and community size,
  it's better for long-term maintenance...

🤖 WriterBot (Round 3):
  Vue 3's Composition API provides similar flexibility
  to React Hooks...

... (up to 6 rounds)

🏁 Debate ended: Maximum rounds reached
```

### Tips
- More specific topics lead to higher quality debates (❌ "What's better?" → ✅ "Should we apply TypeScript strict mode to this project?")
- Each round has a maximum 5-minute response time
- Times out if the other bot is offline
- Default debate rounds can be changed in `/groupsettings`
- You can also specify rounds inline: `/debate [rounds] topic`

---

## Code Review Feature (/review) 🧪

> **🧪 Testing**: This feature is currently in testing. Some behaviors may be unstable.

The crown jewel of collaboration — have another bot review one bot's work.

### Usage
Describe what you want reviewed and type `/review`.

### Example Conversation
```
👤 You: /review Security status of auth.ts

🔍 Review started: auth.ts security status

🤖 ReaderBot:
  🔎 Code Review Results:

  ✅ Good points:
  - JWT token expiration time is appropriately set
  - bcrypt hashing is correctly implemented

  ⚠️ Needs improvement:
  - line 42: password is being logged in plain text
  - line 67: Possible SQL injection
  - No rate limiting, vulnerable to brute force attacks

✅ Review complete
```

### Tips
- The more specific your review target description, the more accurate the review
- Unlike debates, reviews are **one-way** — Reader delivers analysis results once and that's it

---

## Bot Management

### /bots — Check Bot Status
See what bots are on your team and whether they're awake (Online).

> **Example output:**
> 🟢 **MyWriterBot** (Writer) - Online
> 🟢 **MyReaderBot** (Reader) - Online
> 🔴 **TestBot** (Standalone) - Offline

### /addbot — Add New Bot (Wizard)
Use when adding a new bot to the team. **Must be done in 1:1 chat (DM)** with the bot.

See [Quick Start Step 2](#step-2-run-the-addbot-wizard-) for detailed step-by-step instructions.

### /cancel — Cancel Wizard
If you change your mind during bot setup, type `/cancel` anytime to abort. ❌

---

## Group Settings (/groupsettings)

Manage shared settings for group chat. **These settings apply to all bots in the group.**

### Usage
Type `/groupsettings` in group chat.

> **Note**: Even with multiple bots in the group, **only one bot responds** (alphabetically first).

### Menu Structure

| Menu | Description |
|---|---|
| 🎭 Debate Settings | Set debate rounds (3/6/10/unlimited/custom) |
| 🤖 Bot Details | Roles, agents, and online status of bots in this chat |

### Display Information
- **🟢/🔴**: Bot online/offline status (3-minute threshold)
- **Role**: ✏️ Writer / 🔒 Reader / ⚙️ Standalone
- **Agent**: AI agent each bot is currently using

### Example Screen
```
⚙️ Group Settings
Applies to all bots in this chat

🎭 Debate: 6 rounds

🟢 @MyWriterBot
   ✏️ writer · 🤖 claude-sonnet
🟢 @MyReaderBot
   🔒 reader · 🤖 default
```

---

## Personal Settings (/settings)

Fine-tune each bot's **individual** behavior.

### Toggle Review Mode
1. Type `/settings`
2. Click `🤖 Agent & Mode` button
3. Click `🔒 Toggle Review Mode` button

| | Review Mode ON | Review Mode OFF |
|---|---|---|
| File modification | ❌ Auto-reject | ✅ Allowed (requires approval) |
| Code analysis | ✅ | ✅ |
| Reader bot default | ⬅️ This | |
| Writer bot default | | ⬅️ This |

> 💡 Settings are **applied immediately**. No bot restart needed!
> 💡 Values changed in `/settings` override role defaults.

---

## Manual Setup (ecosystem.config.cjs)

Developers can manually edit files to add bots instead of using the `/addbot` wizard.

```javascript
// ecosystem.config.cjs
const COORDINATION_DIR = '/tmp/claude-go-coordination'

module.exports = {
  apps: [
    {
      name: 'claude-go-writer',
      script: 'src/main.ts',
      interpreter: 'bun',
      cwd: '/path/to/claude-go',
      env: {
        BOT_TOKEN: 'your-writer-bot-token-here',
        ALLOWED_USER_IDS: 'your-telegram-user-id',
        DEFAULT_PROJECT: '/path/to/my-project',
        INSTANCE_NAME: 'writer',
        STATE_DIR: 'data/instances/writer',

        BOT_ROLE: 'writer',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'claude-go-reader',
      script: 'src/main.ts',
      interpreter: 'bun',
      cwd: '/path/to/claude-go',
      env: {
        BOT_TOKEN: 'your-reader-bot-token-here',
        ALLOWED_USER_IDS: 'your-telegram-user-id',
        DEFAULT_PROJECT: '/path/to/my-project',
        INSTANCE_NAME: 'reader',
        STATE_DIR: 'data/instances/reader',

        BOT_ROLE: 'reader',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
}
```

> ⚠️ **Important:** `STATE_DIR` must be **different for each bot**. Same paths will cause state conflicts.
> ⚠️ **Important:** `COORDINATION_DIR` must be the **same for all bots**. Different paths prevent communication.

PM2 Commands:
```bash
pm2 start ecosystem.config.cjs   # Start all
pm2 restart all                   # Restart all
pm2 logs                          # View logs
pm2 list                          # Check status
pm2 stop all                      # Stop all
```

---

## Environment Variable Reference

Essential configuration values for multi-bot operation.

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `BOT_ROLE` | ✅ | `standalone` | Bot role (`writer`, `reader`, `standalone`) |
| `GROUP_CHAT_ENABLED` | - | `false` | Allow group chat responses (`true` recommended) |
| `COORDINATION_DIR` | ✅ | - | Absolute path for bots to share conversation history |
| `INSTANCE_NAME` | - | Project folder name | Name shown in `/bots` list and logs |
| `STATE_DIR` | - | `data/` | Bot state file storage folder (different for each bot!) |

---

## Troubleshooting (FAQ)

**Q: Bot isn't responding in group chat!** 🔴
*   **A1:** Make sure you're calling it with `@mention`.
*   **A2:** Check if `GROUP_CHAT_ENABLED` is set to `true`.
*   **A3:** Go to BotFather and verify `Allow Groups?` is enabled.

**Q: /debate isn't working.**
*   **A1:** Bots need `BOT_ROLE` set to `writer` and `reader` respectively. If both are `standalone`, there's no debate partner.
*   **A2:** Verify both bots have `COORDINATION_DIR` pointing to **exactly the same folder**.

**Q: Bot froze during debate.**
*   **A:** Debates have a maximum 5-minute response time per bot. If the other bot is offline or taking too long, timeout occurs. Check bot status with `pm2 status`.

**Q: Can someone else press the approval button in the group?**
*   **A:** No! For security, only the person who issued the command can press the button. 🔒

**Q: I ran /addbot but the bot won't start.**
*   **A:** Make sure `pm2` is installed on the server. The wizard uses `pm2` to launch new processes.

---

Happy collaborative coding! 🟢🚀
