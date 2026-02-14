[English](installation.md)

# Installation

## For Humans

AI 에이전트(Claude Code, Cursor 등)에 다음을 붙여넣으세요:

```
Claude-Go를 설치하고 설정해줘:
https://raw.githubusercontent.com/reahbi/claude-go/master/docs/installation.md
```

또는 직접 설치:
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

### Step 1: Clone & Install (클론 & 설치)

```bash
git clone https://github.com/reahbi/claude-go.git
cd claude-go
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

Check if Claude Code CLI is installed:
```bash
claude --version
```

If Claude Code is not installed, tell the user:
> Claude Code CLI가 필요합니다. 설치: `npm install -g @anthropic-ai/claude-code` 실행 후 `claude` 명령으로 인증하세요.

**선택적 의존성** (특정 기능에 필요):
- **음성 입력 (STT)** — OpenAI API 키가 필요합니다. `.env`에 `OPENAI_API_KEY`를 설정하세요.
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
> 2. 봇 이름 입력 (예: My Claude-Go)
> 3. 봇 유저네임 입력 (예: my_claude_go_bot) — 반드시 `_bot`으로 끝나야 합니다
> 4. 생성 완료 후 토큰을 복사해서 알려주세요

**When user provides the token**, verify it:
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```
- If response contains `"ok":true`, tell the user: `봇 확인됨: @<username>`
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

### Step 4: Ask for DEFAULT_PROJECT

> AI가 작업할 프로젝트의 절대 경로를 알려주세요.
>
> 절대 경로로 입력해주세요 (예: `/home/user/my-project` 또는 `C:\Users\user\my-project`).

Verify the path exists:
```bash
ls -d <path>
```

Store the chosen path as `DEFAULT_PROJECT`.

### Step 5: Create .env and verify (.env 생성 및 검증)

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
  - Claude Code를 찾을 수 없음 — `npm install -g @anthropic-ai/claude-code`로 설치 안내
  - 프로젝트 디렉토리를 찾을 수 없음 — 경로 확인

### Step 6: Start the bot (봇 시작)

```bash
bun run start
```

If the bot starts successfully (you'll see `Claude-Go is running!` in the output), tell the user:

> Claude-Go가 실행 중입니다!
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
설정 항목을 자동 진단하고 수정이 필요한 부분을 알려줍니다.

자세한 문제 해결: `docs/troubleshooting.md` 참고
