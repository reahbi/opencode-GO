[🇺🇸 English](installation.md)

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

The user needs to provide **3 values** (BOT_TOKEN, ALLOWED_USER_IDS, DEFAULT_PROJECT).

### CRITICAL REQUIRED INPUT GATE (절대 건너뛰지 마세요)

`.env`를 만들거나 봇을 시작하기 전에, 아래 3개 값을 반드시 수집하고 검증해야 합니다:
1. `BOT_TOKEN` (필수값 중 가장 먼저 수집)
2. `ALLOWED_USER_IDS`
3. `DEFAULT_PROJECT`

**Hard-stop rules:**
- 필수값이 하나라도 비어 있으면 절대 다음 단계로 진행하지 마세요.
- 누락된 값만 다시 질문하고, 3개 모두 수집될 때까지 반복하세요.
- `BOT_TOKEN`은 Telegram `getMe`로 검증하고, 응답에 `"ok":true`가 있을 때만 통과입니다.
- 토큰 검증 실패 시 `BOT_TOKEN`을 다시 받아 재검증하세요.
- 이 게이트를 통과하기 전에는 `.env` 생성과 `bun run start` 실행을 금지합니다.

**완료 체크리스트 (모두 `yes`여야 함):**
- `BOT_TOKEN verified`: yes
- `ALLOWED_USER_IDS collected`: yes
- `DEFAULT_PROJECT collected`: yes

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

**선택적 의존성** (특정 기능에 필요):
- **음성 TTS** — `edge-tts` Python 패키지가 필요합니다. 설치: `python3 -m venv /tmp/edge-tts-env && /tmp/edge-tts-env/bin/pip install edge-tts`
- **터널** — `cloudflared` 바이너리가 PATH에 있어야 합니다. 설치: [cloudflare/cloudflared releases](https://github.com/cloudflare/cloudflared/releases) 참고

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
- If response contains `"ok":true`, tell the user: `✓ 봇 확인됨: @<username>` and store token as `BOT_TOKEN`.
- If verification fails, do NOT continue. 토큰이 유효하지 않다고 안내하고 새 토큰을 받아 성공할 때까지 검증을 반복하세요.

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

### Step 4: OpenCode 서버 확인

> **중요: OpenCode 서버를 종료하거나 재시작하지 마세요.**
> 이 단계에서는 서버 연결만 **확인**합니다. `kill`이나 `opencode serve`를 직접 실행하지 마세요.

**서버가 실행 중인지 확인:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/project
```

**응답 `200`** → 서버가 실행 중. `OPENCODE_SERVER_PASSWORD=` (빈 값)으로 설정. Step 5로 진행.

**응답 `401`** → 서버가 비밀번호 설정된 상태로 실행 중. 사용자에게 현재 비밀번호를 물어보고 `OPENCODE_SERVER_PASSWORD`에 저장한 뒤 검증:
```bash
curl -s -u opencode:<PASSWORD> http://127.0.0.1:4096/project
```
JSON 응답이 오면 → Step 5로 진행. 401이면 → 비밀번호가 틀렸다고 안내.

**연결 거부 / 응답 없음** → 서버가 실행 중이 아님. 사용자에게 **별도 터미널**에서 시작을 안내:

> OpenCode 서버가 실행 중이 아닙니다. 별도 터미널에서 시작해주세요:
>
> **WSL/Linux/macOS:** `opencode serve --port 4096 &`
>
> **Windows:** `powershell.exe -Command "Start-Process opencode -ArgumentList 'serve','--port','4096' -WindowStyle Hidden"`
>
> 시작 후 알려주시면 연결을 확인하겠습니다.

사용자가 확인하면 curl 명령을 다시 실행. 응답이 오면 Step 5로 진행.

### Step 5: Ask for DEFAULT_PROJECT

**서버에서 프로젝트 목록을 가져옵니다:**
```bash
# OPENCODE_SERVER_PASSWORD가 설정된 경우:
curl -s -u opencode:<PASSWORD> http://127.0.0.1:4096/project

# 비밀번호 없는 경우:
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

### Step 6: Create .env and verify

`.env` 생성 전에 게이트 상태를 먼저 확인하세요:

- `BOT_TOKEN verified`: yes
- `ALLOWED_USER_IDS collected`: yes
- `DEFAULT_PROJECT collected`: yes

하나라도 `no`면 중단하고 해당 단계로 돌아가 값을 채우세요. 이 상태에서는 `.env`를 생성하면 안 됩니다.

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
- All checks passed → proceed to Step 7.
- Some checks failed → read the failure messages and help the user resolve them. Common issues:
  - OpenCode server not running → tell user to run `opencode serve` (or `OPENCODE_SERVER_PASSWORD=<pw> opencode serve` if password was set)
  - Project directory not found → verify the path exists

### Step 7: Start the bot

> **OpenCode 내부에서 실행 중인 AI 에이전트인 경우:**
> `bun run start`는 포그라운드 장기 실행 프로세스입니다. 직접 실행하면 세션이 블로킹됩니다.
> 대신, **사용자에게** 별도 터미널에서 봇을 수동 시작하라고 안내하세요:
> ```
> cd opencode-go && bun run start
> ```
> 그리고 아래 "Troubleshooting" 섹션으로 건너뛰세요. `bun run start`를 직접 실행하지 마세요.

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
