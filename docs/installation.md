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

**IMPORTANT RULES:**
1. Before doing anything else, you MUST complete Step 0 and get user confirmation.
2. **ALWAYS use clickable selection prompts** (not text input) when asking questions with predefined options.
3. Ask questions **one at a time**, explain each briefly, and verify before moving on.

The user needs to provide **4 values**.

### Step 0: Confirm Environment (MANDATORY FIRST STEP)

**STOP. Present clickable options to the user:**

> **Which environment will you use?**

Options (clickable):
- **Windows** — Project path like `C:\Users\...`
- **WSL/Linux** — Project path like `/home/...`
- **macOS** — Project path like `/Users/...`

After user chooses, confirm and continue:

> ✓ Environment: **[Windows/WSL/macOS]**

**Store this choice — you will need it in Step 5.**

### Step 1: Clone & Install

After user confirms the environment, proceed with installation:

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

### Step 4: Ask about server password

**Present clickable options:**

> Would you like to set a password for the OpenCode server?
> (A password prevents unauthorized access. Skip if only using locally.)

Options (clickable):
- **Yes, set a password** — User will provide password
- **No, skip** — No password needed

**If user selects "Yes"**, ask for the password and store it as `OPENCODE_SERVER_PASSWORD`.

**If user selects "No"**, set `OPENCODE_SERVER_PASSWORD=` (empty).

### Step 5: Start OpenCode Server

**Start the server in the background yourself based on the environment from Step 0:**

**If user selected Windows:**
```bash
# If password is set:
powershell.exe -Command "\$env:OPENCODE_SERVER_PASSWORD='<password>'; Start-Process opencode -ArgumentList 'serve','--port','4096' -WindowStyle Hidden"

# If no password:
powershell.exe -Command "Start-Process opencode -ArgumentList 'serve','--port','4096' -WindowStyle Hidden"
```

**If user selected WSL/Linux or macOS:**
```bash
# If password is set:
OPENCODE_SERVER_PASSWORD=<password> opencode serve --port 4096 &

# If no password:
opencode serve --port 4096 &
```

Wait a few seconds for the server to start, then verify the connection:
```bash
# If password is set:
curl -s -u opencode:<PASSWORD> http://127.0.0.1:4096/project

# If no password:
curl -s http://127.0.0.1:4096/project
```

- If the server responds with JSON → connection works, proceed to Step 6 with project selection.
- If the server returns an error or is unreachable → ask the user to check if the server is running. Proceed to Step 6 with manual path input.

### Step 6: Ask for DEFAULT_PROJECT

**If server responded in Step 5** — fetch the project list:
```bash
# If password is set:
curl -s -u opencode:<PASSWORD> http://127.0.0.1:4096/project

# If no password:
curl -s http://127.0.0.1:4096/project
```

The response is a JSON array of projects. Filter out any entry where `worktree` is `"/"`. Sort by `time.updated` descending (most recent first).

**Verify the paths match the environment from Step 0:**
- Windows → paths should look like `C:\...` or `/c/...`
- WSL/Linux → paths should look like `/home/...`
- macOS → paths should look like `/Users/...`

**If paths don't match**, warn the user:
> ⚠️ The project paths look like [WSL/Windows/macOS], but you selected [environment] in Step 0.
> This means the wrong OpenCode server is running.
> Please start the server in [correct environment] and try again.

**If paths match**, present clickable options from the project list:

> Here are your [environment] projects:

Options (clickable):
- **C:\Users\me\my-app** (most recent)
- **C:\Users\me\another-project**
- **Enter a different path** — User will type manually

**If server was unreachable** — ask directly:
> What's the path to the project OpenCode should work on?
>
> Please enter an absolute path (Windows: `C:\Users\...`, WSL: `/home/...`, macOS: `/Users/...`).

Store the chosen path as `DEFAULT_PROJECT`.

### Step 7: Create .env and verify

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
- All checks passed → proceed to Step 8.
- Some checks failed → read the failure messages and help the user resolve them. Common issues:
  - OpenCode server not running → tell user to run `opencode serve` (or `OPENCODE_SERVER_PASSWORD=<pw> opencode serve` if password was set)
  - Project directory not found → verify the path exists

### Step 8: Start the bot

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
