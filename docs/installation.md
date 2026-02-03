# Installation

## For Humans

Paste this into your AI agent (OpenCode, Claude Code, etc.):

```
Install and configure OpenCode-Go:
https://raw.githubusercontent.com/reahbi/opencode-go/master/docs/installation.md
```

Or install manually:
```bash
git clone https://github.com/reahbi/opencode-go.git
cd opencode-go
bun install
bun run setup
```

## For LLM Agents

You are helping the user install **OpenCode-Go** — a Telegram bot that remotely controls OpenCode coding agent sessions from a phone.

The user needs to provide **4 values**. Ask them **one at a time**, explain each briefly, and verify before moving on.

### Step 0: Clone & Install

```bash
git clone https://github.com/reahbi/opencode-go.git
cd opencode-go
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

### Step 1: Ask for BOT_TOKEN

Ask the user:
> Do you have a Telegram bot token?
>
> A bot token looks like `123456:ABC-DEF...`.
> You can get one by creating a bot with @BotFather.
>
> - If you have one, please share it
> - If not, just say "no"

**If user doesn't have one**, guide them:
> Search for @BotFather in Telegram and start a conversation.
> 1. Send `/newbot`
> 2. Enter a bot name (e.g., My OpenCode-Go)
> 3. Enter a bot username (e.g., my_opencode_go_bot) — must end with `_bot`
> 4. Copy the token you receive and share it here

**When user provides the token**, verify it:
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```
- If response contains `"ok":true`, tell the user: `✓ Bot verified: @<username>`
- If verification fails, tell the user the token seems invalid and ask them to check again.

Store the token value as `BOT_TOKEN`.

### Step 2: Ask for ALLOWED_USER_IDS

Ask the user:
> Do you know your Telegram User ID?
>
> It's a numeric ID (e.g., `7702469661`).
> This is used to restrict who can use the bot.
>
> - If you know it, please share it
> - If not, just say "no"

**If user doesn't know**, guide them:
> Send any message to @userinfobot in Telegram — it will reply with your numeric ID.
> Let me know once you have it.

**When user provides the ID**, validate it is a number. If user provides multiple IDs separated by commas, that's fine too.

Store the value as `ALLOWED_USER_IDS`.

### Step 3: Ask about server password

Ask the user:
> Would you like to set a password for the OpenCode server?
>
> A password prevents unauthorized access to your server.
> If you're only using it locally, you can skip this.
>
> - To set one: Enter your desired password
> - To skip: Say "no" or "skip"

**If user sets a password**, store it as `OPENCODE_SERVER_PASSWORD` and tell the user:
> ✓ Password will be set.
> You'll need to use the same password when starting `opencode serve`:
> ```
> OPENCODE_SERVER_PASSWORD=<password> opencode serve
> ```

**If user skips**, set `OPENCODE_SERVER_PASSWORD=` (empty).

Now verify the server connection:
```bash
# If password is set:
curl -s -u opencode:<PASSWORD> http://127.0.0.1:4096/project

# If no password:
curl -s http://127.0.0.1:4096/project
```

- If the server responds with JSON → connection works, proceed to Step 4 with project selection.
- If the server returns an error or is unreachable → tell the user it's fine, they can start the server later. Proceed to Step 4 with manual path input.

### Step 4: Ask for DEFAULT_PROJECT

**If server responded in Step 3** — fetch the project list:
```bash
# If password is set:
curl -s -u opencode:<PASSWORD> http://127.0.0.1:4096/project

# If no password:
curl -s http://127.0.0.1:4096/project
```

The response is a JSON array of projects. Filter out any entry where `worktree` is `"/"`. Sort by `time.updated` descending (most recent first). Present the list to the user:

> Here are the projects used with OpenCode:
>
> 1. /home/user/my-app
> 2. /home/user/another-project
>
> Select a number or enter a different path directly.

**If server was unreachable** — ask directly:
> What's the path to the project OpenCode should work on?
>
> Please enter an absolute path (e.g., `/home/user/my-project`).

Store the chosen path as `DEFAULT_PROJECT`.

### Step 5: Create .env and verify

Generate the `.env` file:
```bash
cat > .env << 'ENVEOF'
BOT_TOKEN=<BOT_TOKEN value>
ALLOWED_USER_IDS=<ALLOWED_USER_IDS value>
DEFAULT_PROJECT=<DEFAULT_PROJECT value>
OPENCODE_SERVER_URL=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=<OPENCODE_SERVER_PASSWORD value or empty>
ENVEOF
```

Run the diagnostic tool:
```bash
bun run doctor
```

Check the output:
- All checks passed → proceed to Step 6.
- Some checks failed → read the failure messages and help the user resolve them. Common issues:
  - OpenCode server not running → tell user to run `opencode serve` (or `OPENCODE_SERVER_PASSWORD=<pw> opencode serve` if password was set)
  - Project directory not found → verify the path exists

### Step 6: Start the bot

```bash
bun run start
```

If the bot starts successfully (you'll see `OpenCode-Go is running!` in the output), tell the user:

> ✓ OpenCode-Go is running!
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
This checks all 6 configuration items and shows what needs to be fixed.

For detailed troubleshooting, read: `docs/troubleshooting.md`
