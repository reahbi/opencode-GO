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
- **Description**: Shows the bot's current status. Check OpenCode server connection status, active session info, and current project path.
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

## Regular Conversation (Prompting)

Sending regular text (not a command) forwards it as a prompt to the current session's AI agent. The AI will analyze code or suggest modifications based on your request.

## Settings Options Details

The following options can be managed through the `/settings` menu:

- **Summary Mode**: When enabled, automatically summarizes long AI responses.
- **Output Format**:
  - `formatted`: Applies Markdown formatting for better readability.
  - `raw`: Displays the AI's raw response as-is.
- **Summary Threshold**: Responses exceeding this length will trigger summary mode. (Default: 3000 characters)
- **Summary Model**: Select the lightweight AI model used for summarization.
- **History Format**: Choose export format between `.md` (Markdown) or `.html` (HTML).
- **History Limit**: Limit the number of recent messages to export. `0` or `all` exports everything.
