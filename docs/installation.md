[Korean](installation-kr.md)

# Installation

## For Humans

Paste this into your AI agent (Claude Code, Cursor, etc.):

```
Install and configure Claude-Go:
https://raw.githubusercontent.com/reahbi/claude-go/master/docs/installation.md
```

Or install manually:
```bash
git clone https://github.com/reahbi/claude-go.git
cd claude-go
bun install
bun run setup
```

## For LLM Agents

You are helping the user install **Claude-Go** — a Telegram bot that remotely controls Claude Code AI sessions from a phone. Claude-Go is a **single-process** application — no separate server required.

**IMPORTANT RULES:**
1. **ALWAYS use clickable selection prompts** (not text input) when asking questions with predefined options.
2. Ask questions **one at a time**, explain each briefly, and verify before moving on.

The user needs to provide **3 values**: `BOT_TOKEN`, `ALLOWED_USER_IDS`, `DEFAULT_PROJECT`.

### Step 1: Clone & Install

```bash
git clone https://github.com/reahbi/claude-go.git
cd claude-go
```

Check if Bun is installed:
```bash
bun --version
```

If Bun is not installed, tell the user:
> Bun is required. To install: Run `curl -fsSL https://bun.sh/install | bash` and restart your terminal.

Then install dependencies:
```bash
bun install
```

Check if Claude Code CLI is installed:
```bash
claude --version
```

If Claude Code is not installed, tell the user:
> Claude Code CLI is required. To install: Run `npm install -g @anthropic-ai/claude-code` and authenticate with `claude` once.

**Optional dependencies** (for specific features):
- **Voice Input (STT)** — requires OpenAI API key. Set `OPENAI_API_KEY` in `.env`.
- **Voice TTS** — requires `edge-tts` Python package. Install: `python3 -m venv /tmp/edge-tts-env && /tmp/edge-tts-env/bin/pip install edge-tts`
- **Tunnel** — requires `cloudflared` binary in PATH. Install: see [cloudflare/cloudflared releases](https://github.com/cloudflare/cloudflared/releases)

### Step 2: Ask for BOT_TOKEN

**Present clickable options:**

> Do you have a Telegram bot token?
> (A bot token looks like `123456:ABC-DEF...`)

Options (clickable):
- **Yes, I have one** — User will provide token
- **No, I need to create one** — Guide them through BotFather

**If user selects "No"**, guide them:
> Search for @BotFather in Telegram and start a conversation.
> 1. Send `/newbot`
> 2. Enter a bot name (e.g., My Claude-Go)
> 3. Enter a bot username (e.g., my_claude_go_bot) — must end with `_bot`
> 4. Copy the token you receive and share it here

**When user provides the token**, verify it:
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```
- If response contains `"ok":true`, tell the user: `Verified: @<username>`
- If verification fails, tell the user the token seems invalid and ask them to check again.

Store the token value as `BOT_TOKEN`.

### Step 3: Ask for ALLOWED_USER_IDS

**Present clickable options:**

> Do you know your Telegram User ID?
> (It's a numeric ID like `7702469661`)

Options (clickable):
- **Yes, I know it** — User will provide ID
- **No, I don't know it** — Guide them to @userinfobot

**If user selects "No"**, guide them:
> Send any message to @userinfobot in Telegram — it will reply with your numeric ID.
> Let me know once you have it.

**When user provides the ID**, validate it is a number. If user provides multiple IDs separated by commas, that's fine too.

Store the value as `ALLOWED_USER_IDS`.

### Step 4: Ask for DEFAULT_PROJECT

> What's the absolute path to the project Claude should work on?
>
> Please enter an absolute path (e.g., `/home/user/my-project` or `C:\Users\user\my-project`).

Verify the path exists:
```bash
ls -d <path>
```

Store the chosen path as `DEFAULT_PROJECT`.

### Step 5: Create .env and verify

Generate the `.env` file:
```bash
cat > .env << 'ENVEOF'
BOT_TOKEN=<BOT_TOKEN value>
ALLOWED_USER_IDS=<ALLOWED_USER_IDS value>
DEFAULT_PROJECT=<DEFAULT_PROJECT value>
ENVEOF
```

Run the diagnostic tool:
```bash
bun run doctor
```

Check the output:
- All checks passed — proceed to Step 6.
- Some checks failed — read the failure messages and help the user resolve them. Common issues:
  - Claude Code not found — tell user to install with `npm install -g @anthropic-ai/claude-code`
  - Project directory not found — verify the path exists

### Step 6: Start the bot

```bash
bun run start
```

If the bot starts successfully (you'll see `Claude-Go is running!` in the output), tell the user:

> Claude-Go is running!
>
> Send `/start` to your bot on Telegram.
> If the bot responds with status information, installation is complete.
>
> Usage:
> - `/new` — Start a new AI session
> - Send a message — it goes straight to the AI
> - `/help` — View all commands

### Troubleshooting

If something goes wrong at any step:
```bash
bun run doctor
```
This auto-diagnoses configuration issues and shows what needs to be fixed.

For detailed troubleshooting, read: `docs/troubleshooting.md`
