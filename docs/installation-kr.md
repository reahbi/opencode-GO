# Installation

## For Humans

AI 에이전트(OpenCode, Claude Code 등)에 다음을 붙여넣으세요:

```
OpenCode-Go를 설치하고 설정해줘:
https://raw.githubusercontent.com/reahbi/opencode-go/master/docs/installation.md
```

또는 직접 설치:
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

### Step 0: Confirm Environment (환경 확인 - 필수 첫 단계)

**멈추세요. 클릭 가능한 선택지를 제공하세요:**

> **어떤 환경을 사용하시나요?**

Options (clickable):
- **Windows** — 프로젝트 경로: `C:\Users\...`
- **WSL/Linux** — 프로젝트 경로: `/home/...`
- **macOS** — 프로젝트 경로: `/Users/...`

사용자가 선택하면 확인:

> ✓ 환경: **[Windows/WSL/macOS]**

**이 선택을 저장하세요 — Step 5에서 필요합니다.**

### Step 1: Clone & Install (클론 & 설치)

사용자가 환경을 확인한 후 설치 진행:

```bash
git clone https://github.com/reahbi/opencode-go.git
cd opencode-go
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

### Step 2: Ask for BOT_TOKEN

**클릭 가능한 선택지를 제공하세요:**

> Telegram 봇 토큰이 있나요?
> (봇 토큰은 `123456:ABC-DEF...` 형태입니다)

Options (clickable):
- **있어요** — 토큰을 입력받음
- **없어요, 만들어야 해요** — BotFather 안내

**"없어요"를 선택하면** 안내:
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

### Step 3: Ask for ALLOWED_USER_IDS

**클릭 가능한 선택지를 제공하세요:**

> Telegram User ID를 알고 계신가요?
> (숫자로 된 고유 ID입니다, 예: `7702469661`)

Options (clickable):
- **알아요** — ID를 입력받음
- **몰라요** — @userinfobot 안내

**"몰라요"를 선택하면** 안내:
> 텔레그램에서 @userinfobot 에게 아무 메시지나 보내면 숫자 ID를 알려줍니다.
> 확인 후 알려주세요.

**When user provides the ID**, validate it is a number. If user provides multiple IDs separated by commas, that's fine too.

Store the value as `ALLOWED_USER_IDS`.

### Step 4: Ask about server password

**클릭 가능한 선택지를 제공하세요:**

> OpenCode 서버에 비밀번호를 설정하시겠어요?
> (로컬에서만 쓴다면 없어도 괜찮습니다)

Options (clickable):
- **설정할래요** — 비밀번호를 입력받음
- **스킵** — 비밀번호 없이 진행

**If user sets a password**, store it as `OPENCODE_SERVER_PASSWORD`.

**If user skips**, set `OPENCODE_SERVER_PASSWORD=` (empty).

### Step 5: Start OpenCode Server (서버 시작)

**먼저 기존 4096 포트 서버를 종료하고, Step 0에서 선택한 환경에 따라 서버를 시작하세요:**

**Windows를 선택한 경우:**
```bash
# 기존 4096 포트 서버 종료 (Windows + WSL 모두)
powershell.exe -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 4096 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
kill $(lsof -t -i:4096) 2>/dev/null || true

# Windows 서버 시작 (비밀번호 있음):
powershell.exe -Command "\$env:OPENCODE_SERVER_PASSWORD='<password>'; Start-Process opencode -ArgumentList 'serve','--port','4096' -WindowStyle Hidden"

# Windows 서버 시작 (비밀번호 없음):
powershell.exe -Command "Start-Process opencode -ArgumentList 'serve','--port','4096' -WindowStyle Hidden"
```

**WSL/Linux 또는 macOS를 선택한 경우:**
```bash
# 기존 4096 포트 서버 종료
kill $(lsof -t -i:4096) 2>/dev/null || true

# 서버 시작 (비밀번호 있음):
OPENCODE_SERVER_PASSWORD=<password> opencode serve --port 4096 &

# 서버 시작 (비밀번호 없음):
opencode serve --port 4096 &
```

몇 초 기다린 후 서버 연결 확인:
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

**경로가 Step 0에서 선택한 환경과 일치하는지 확인:**
- Windows → 경로가 `C:\...` 또는 `/c/...` 형태
- WSL/Linux → 경로가 `/home/...` 형태
- macOS → 경로가 `/Users/...` 형태

**경로가 일치하지 않으면** 경고:
> ⚠️ 프로젝트 경로가 [WSL/Windows/macOS]처럼 보이는데, Step 0에서 [환경]을 선택하셨습니다.
> 잘못된 OpenCode 서버가 실행 중입니다.
> [올바른 환경]에서 서버를 시작하고 다시 시도하세요.

**경로가 일치하면** 클릭 가능한 선택지로 프로젝트 목록 표시:

> [환경] 프로젝트 목록입니다:

Options (clickable):
- **C:\Users\me\my-app** (가장 최근)
- **C:\Users\me\another-project**
- **다른 경로 입력** — 직접 입력

**If server was unreachable** — ask directly:
> OpenCode가 작업할 프로젝트의 경로를 알려주세요.
>
> 절대 경로로 입력해주세요 (Windows: `C:\Users\...`, WSL: `/home/...`, macOS: `/Users/...`).

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
