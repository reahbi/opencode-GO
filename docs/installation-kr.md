# Installation

## For Humans

AI 에이전트(OpenCode, Claude Code 등)에 다음을 붙여넣으세요:

```
OpenCode-Go를 설치하고 설정해줘:
https://raw.githubusercontent.com/reahbi/opencode-telegram/main/docs/installation.md
```

또는 직접 설치:
```bash
git clone https://github.com/reahbi/opencode-telegram.git
cd opencode-telegram
bun install
bun run setup
```

## For LLM Agents

You are helping the user install **OpenCode-Go** — a Telegram bot that remotely controls OpenCode coding agent sessions from a phone.

The user needs to provide **4 values**. Ask them **one at a time**, explain each briefly, and verify before moving on.

### Step 0: Clone & Install

```bash
git clone https://github.com/reahbi/opencode-telegram.git
cd opencode-telegram
```

Check if Bun is installed:
```bash
bun --version
```

If Bun is not installed, tell the user:
> Bun이 필요합니다. 설치하려면: `curl -fsSL https://bun.sh/install | bash` 실행 후 터미널을 재시작하세요.

Then install dependencies:
```bash
bun install
```

### Step 1: Ask for BOT_TOKEN

Ask the user:
> Telegram 봇 토큰이 있나요?
>
> 봇 토큰은 `123456:ABC-DEF...` 형태의 문자열입니다.
> @BotFather에서 봇을 만들면 발급받을 수 있어요.
>
> - 있으면 토큰을 알려주세요
> - 없으면 "없어"라고 하세요

**If user doesn't have one**, guide them:
> 텔레그램에서 @BotFather 를 검색해서 대화를 시작하세요.
> 1. `/newbot` 전송
> 2. 봇 이름 입력 (예: My OpenCode-Go)
> 3. 봇 유저네임 입력 (예: my_opencode_go_bot) — 반드시 `_bot`으로 끝나야 합니다
> 4. 생성 완료 후 토큰을 복사해서 알려주세요

**When user provides the token**, verify it:
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```
- If response contains `"ok":true`, tell the user: `✓ 봇 확인됨: @<username>`
- If verification fails, tell the user the token seems invalid and ask them to check again.

Store the token value as `BOT_TOKEN`.

### Step 2: Ask for ALLOWED_USER_IDS

Ask the user:
> 본인의 Telegram User ID를 알고 계신가요?
>
> 숫자로 된 고유 ID입니다 (예: `7702469661`).
> 봇을 사용할 수 있는 사람을 제한하는 데 사용됩니다.
>
> - 알면 알려주세요
> - 모르면 "몰라"라고 하세요

**If user doesn't know**, guide them:
> 텔레그램에서 @userinfobot 에게 아무 메시지나 보내면 숫자 ID를 알려줍니다.
> 확인 후 알려주세요.

**When user provides the ID**, validate it is a number. If user provides multiple IDs separated by commas, that's fine too.

Store the value as `ALLOWED_USER_IDS`.

### Step 3: Ask about server password

Ask the user:
> OpenCode 서버에 비밀번호를 설정하시겠어요?
>
> 비밀번호를 설정하면 외부에서 서버에 접근하는 걸 막을 수 있습니다.
> 로컬에서만 쓴다면 없어도 괜찮습니다.
>
> - 설정하려면: 원하는 비밀번호를 입력하세요
> - 필요 없으면: "없어" 또는 "스킵"

**If user sets a password**, store it as `OPENCODE_SERVER_PASSWORD` and tell the user:
> ✓ 비밀번호가 설정됩니다.
> `opencode serve` 시작 시에도 같은 비밀번호를 사용해야 합니다:
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

> OpenCode에서 사용한 프로젝트 목록입니다:
>
> 1. /home/user/my-app
> 2. /home/user/another-project
>
> 번호로 선택하거나 다른 경로를 직접 입력하세요.

**If server was unreachable** — ask directly:
> OpenCode가 작업할 프로젝트의 경로를 알려주세요.
>
> 절대 경로로 입력해주세요 (예: `/home/user/my-project`).

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

> ✓ OpenCode-Go가 실행 중입니다!
>
> 텔레그램에서 봇에게 `/start` 를 보내보세요.
> 봇이 상태 정보와 함께 응답하면 설치가 완료된 것입니다.
>
> 사용법:
> - `/new` — 새 AI 세션 시작
> - 메시지를 보내면 AI에게 전달됩니다
> - `/help` — 전체 명령어 보기

### Troubleshooting

If something goes wrong at any step:
```bash
bun run doctor
```
This checks all 6 configuration items and shows what needs to be fixed.

For detailed troubleshooting, read: `docs/troubleshooting.md`
