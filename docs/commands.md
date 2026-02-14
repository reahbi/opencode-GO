[🇰🇷 한국어](commands-kr.md)

# Bot Commands Usage

This document provides detailed information on all available commands and how to use them with the Telegram bot.

## Basic Commands

### /start
- **Description**: Use when first starting the bot or checking status. Displays onboarding message and current active session status.
- **Usage**: `/start`

### /new [title]
- **Description**: Creates a new AI session. Title is optional.
- **Usage**: `/new [title]`
- **Example**: `/new Fix login bug`

### /list
- **Description**: Displays all saved sessions. Navigate through the list using pagination buttons.
- **Usage**: `/list`

### /resume [number]
- **Description**: Resumes a previous session. Use the session number shown in `/list`.
- **Usage**: `/resume [number]`
- **Example**: `/resume 3`

### /abort
- **Description**: Immediately stops the current AI operation.
- **Usage**: `/abort`

### /status
- **Description**: Shows the bot's current status. Check active session info, current project path, and cost tracking.
- **Usage**: `/status`

### /agents
- **Description**: Displays available AI agents and allows switching between them. Click inline keyboard buttons to select your preferred agent.
- **Usage**: `/agents`

### /settings
- **Description**: Modify bot behavior settings. Adjust summary mode, summary threshold, output format, and more.
- **Usage**: `/settings`

### /history
- **Description**: Exports the current active session's conversation history as `.md` or `.html` file. Configure export format and message limit in `/settings`.
- **Usage**: `/history`

## Queue & Undo Commands

### /queue [message]
- **Description**: Queues a message to be sent after the AI finishes its current task. Useful when the AI is busy processing.
- **Usage**: `/queue [message]`
- **Example**: `/queue Also fix the unit tests`

### /clearqueue
- **Description**: Clears all queued messages for the current chat.
- **Usage**: `/clearqueue`

### /showqueue
- **Description**: Shows the current queue status and pending messages.
- **Usage**: `/showqueue`

### /undo
- **Description**: Reverts the last AI response. The AI's changes to files will be undone.
- **Usage**: `/undo`
- **Note**: Only the most recent response can be undone. Use `/redo` to restore.

### /redo
- **Description**: Restores the previously undone AI response.
- **Usage**: `/redo`
- **Note**: Only available after using `/undo`.

### /help
- **Description**: Shows the complete list of available commands with brief descriptions.
- **Usage**: `/help`

## Group Chat Commands

### /groupsettings
- **Description**: Manages shared settings for group chats. Configure debate rounds and check the status of bots in the current group.
- **Usage**: `/groupsettings`
- **Note**: Only available in group chats. Use `/settings` for personal settings.
- **Submenus**:
  - **🎭 Debate Settings**: Set debate rounds (3, 6, 10, unlimited, or custom input)
  - **🤖 Bot Details**: Check roles, agents, and online status of bots in this chat

## Multi-Bot Commands (🧪 Testing)

### /debate [rounds] [topic]
- **Description**: Starts a debate between Writer and Reader bots on the given topic.
- **Usage**: `/debate [topic]` or `/debate [rounds] [topic]`
- **Example**: `/debate React vs Vue`, `/debate 10 Should we apply TypeScript strict mode`
- **Note**: Requires Writer/Reader role bots in the same group.

### /review [target]
- **Description**: Requests a code review from the Reader bot.
- **Usage**: `/review [review target]`
- **Example**: `/review Security status of auth.ts`

### /bots
- **Description**: Shows the status of registered bots (online/offline).
- **Usage**: `/bots`

### /addbot
- **Description**: Starts the wizard to add a new bot. Only available in DM (direct message).
- **Usage**: `/addbot`

### /cancel
- **Description**: Cancels the ongoing wizard (e.g., /addbot).
- **Usage**: `/cancel`

## Utility Commands

### /git
- **Description**: Shows the current project's Git status at a glance. Displays branch name, staged/unstaged/untracked file counts, and recent commits. Use inline keyboard buttons to view diff stats, full diff, or extended log.
- **Usage**: `/git`
- **Inline Buttons**:
  - **📋 Diff**: Shows staged and unstaged change statistics
  - **📄 Full Diff**: Shows the complete diff (sent as `.patch` file if too long)
  - **📜 Log**: Shows the last 10 commits
  - **🔄 Refresh**: Refreshes the git status display

### /tunnel [port|stop]
- **Description**: Creates a publicly accessible tunnel to a local server using cloudflared. Useful for sharing development servers or testing webhooks. Select from common ports or enter a custom port.
- **Usage**: `/tunnel`, `/tunnel 3000`, `/tunnel stop`
- **Inline Buttons** (when no tunnel is active):
  - **3000 (React/Next)**, **5173 (Vite)**, **8080 (General)**, **4000 (GraphQL)**: Quick port selection
  - **Enter custom port...**: Enter any port number
- **Inline Buttons** (when tunnel is active):
  - **Open**: Opens the tunnel URL
  - **Stop**: Stops the active tunnel
- **Note**: Requires `cloudflared` to be installed on the system.

### /makeagent
- **Description**: AI-powered wizard to create a custom agent with a tailored system prompt. Describe the agent you want (e.g., "코드 리뷰어" or "devops helper"), and the AI generates a complete agent profile with name, description, and system prompt.
- **Usage**: `/makeagent`
- **Flow**:
  1. Send `/makeagent` to start the wizard
  2. Describe the agent you want to create
  3. AI generates a draft with name, description, and system prompt
  4. Review and choose: ✅ Save, 🔄 Regenerate, ✏️ Edit, or ❌ Cancel
  5. Optionally rename the agent before saving
- **Note**: Requires an active project session. Created agents appear in `/settings` → Custom Agent.

## Regular Conversation (Prompting)

Sending regular text (not a command) forwards it as a prompt to the current session's AI agent. The AI will analyze code or suggest modifications based on your request.

## Settings Options Details

The following options can be managed through the `/settings` menu:

### Agent & Mode (`🤖 Agent & Mode`)
- **Agent Selection**: Switch between available AI agents. Click an agent name to activate it.
- **Review Mode**: Toggle read-only mode. When ON, file modification requests are auto-rejected. Reader bots have this ON by default; Writer bots have it OFF.

### Custom Agent (`🎭 Custom Agent`)
- **Custom Agent Selection**: Switch between custom agents created via `/makeagent`. Click an agent name to activate or remove it.

### Summary (`📊 Summary`)
- **Summary Mode**: When enabled, automatically summarizes long AI responses using a lightweight model.
- **Summary Model**: Select the AI model used for summarization (generated via Claude CLI).
- **Summary Threshold**: Responses exceeding this length trigger summary mode. (Default: 3,000 characters)
- **Expertise Level**: Adjusts both text summary and voice prompt style:
  - 🎮 **Vibe Coder** — No jargon. Explains changes from the user's perspective.
  - 👨‍💻 **Developer** — Full technical detail with file names, function signatures, test results.
  - 🌱 **Beginner** — Technical terms with brief explanations to help learning.

### Output (`📝 Output`)
- **Output Format**:
  - `formatted`: Applies Markdown formatting for better readability.
  - `raw`: Displays the AI's raw response as-is.

### History Export (`📜 History Export`)
- **History Format**: Choose export format between `.md` (Markdown) or `.html` (HTML).
- **History Limit**: Limit the number of recent messages to export. `0` or `all` exports everything.

### Voice (`🔊 Voice`)
- **Voice Mode**: Enable/disable voice responses. When ON, a 🔊 Listen button appears after AI responses.
- **Auto Mode**: When ON, voice MP3 is automatically generated and sent when AI finishes — no button tap needed.
- **Language**: Korean (🇰🇷) or English (🇺🇸) for TTS output.
- **Summary Length**: Target length for voice summary: 500, 800, 1,200, or 2,000 characters.
- **Speed**: Playback speed: 1.0x, 1.25x, 1.5x, or 2.0x.
- **Voice Gender**: Female (👩) or Male (👨) voice.
- **Expertise Level**: Same as Summary — affects voice prompt style.
