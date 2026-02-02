# OpenCaddy

텔레그램에서 AI 코딩 어시스턴트(OpenCode)를 원격으로 조작하는 봇입니다.
휴대폰에서 코딩 에이전트에게 지시하고, 결과를 실시간으로 받아보세요.

## 주요 기능
- 텔레그램에서 OpenCode 세션을 생성/관리
- AI와 실시간 대화 (SSE 스트리밍)
- 권한 요청/질문 응답 (인라인 키보드)
- 다중 에이전트 선택
- 응답 요약 모드
- 다중 인스턴스 지원 (PM2)

## 사전 요구사항
- [Bun](https://bun.sh) v1.0 이상 — [설치 가이드](docs/setup/bun.md)
- 텔레그램 봇 토큰 — [봇 생성 가이드](docs/setup/telegram.md)
- OpenCode 서버 — [서버 설정 가이드](docs/setup/opencode.md)

## 설치

### AI 에이전트로 설치 (권장)

AI 에이전트(OpenCode, Claude Code 등)에 다음을 붙여넣으세요:

```
OpenCaddy를 설치하고 설정해줘:
https://raw.githubusercontent.com/your-repo/opencode-telegram/main/docs/installation.md
```

AI가 4가지만 질문하고 나머지는 자동으로 처리합니다.

### 직접 설치

```bash
git clone https://github.com/your-repo/opencode-telegram.git
cd opencode-telegram
bun install
bun run setup    # 대화형 설정 마법사
```

또는 수동으로 `.env` 파일을 생성:

```bash
cp .env.example .env
```

`.env` 파일을 열어 다음 값을 설정하세요:

```bash
BOT_TOKEN=your-bot-token-here          # @BotFather에서 발급
ALLOWED_USER_IDS=123456789             # 본인의 Telegram User ID
DEFAULT_PROJECT=/path/to/your/project  # OpenCode가 작업할 프로젝트 경로 (절대 경로)
```

### 3. 봇 실행
```bash
bun run start
```

### 4. 텔레그램에서 사용
1. 텔레그램에서 봇에게 `/start` 전송
2. `/new` 로 새 세션 생성
3. 메시지를 보내 AI와 대화 시작!

> ⚠️ 문제가 발생하면 `bun run doctor`로 설정을 진단할 수 있습니다.

## 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 온보딩 + 상태 확인 |
| `/new [제목]` | 새 세션 생성 |
| `/list` | 세션 목록 보기 |
| `/resume [번호]` | 세션 재개 |
| `/abort` | 현재 작업 중단 |
| `/status` | 상태 확인 |
| `/agents` | AI 에이전트 선택 |
| `/settings` | 설정 변경 |

일반 텍스트를 보내면 AI에게 프롬프트로 전달됩니다.

자세한 사용법: [명령어 가이드](docs/commands.md)

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `BOT_TOKEN` | ✓ | — | @BotFather에서 발급받은 봇 토큰 |
| `ALLOWED_USER_IDS` | ✓ | — | 허용할 Telegram User ID (쉼표 구분) |
| `DEFAULT_PROJECT` | ✓ | — | 기본 프로젝트 디렉토리 (절대 경로) |
| `OPENCODE_SERVER_URL` | | `http://127.0.0.1:4096` | OpenCode 서버 URL |
| `OPENCODE_SERVER_USERNAME` | | `opencode` | 서버 인증 사용자명 |
| `OPENCODE_SERVER_PASSWORD` | | — | 서버 인증 비밀번호 |
| `INSTANCE_NAME` | | 프로젝트 디렉토리명 | 인스턴스 이름 (로그/상태 표시용) |
| `STATE_DIR` | | `data/` | 상태 파일 저장 경로 |

## 개발

```bash
# 개발 모드 (hot reload)
bun run dev

# 타입 체크
bun run typecheck

# 빌드
bun run build
```

## 배포

PM2를 사용한 프로덕션 배포는 [배포 가이드](docs/deploy.md)를 참고하세요.

## 문제 해결

설정 진단:
```bash
bun run doctor
```

자주 묻는 문제와 해결법: [문제 해결 가이드](docs/troubleshooting.md)

## 문서

- [설치 가이드 (AI 에이전트 지원)](docs/installation.md)
- [텔레그램 봇 생성](docs/setup/telegram.md)
- [OpenCode 서버 설정](docs/setup/opencode.md)
- [Bun 설치](docs/setup/bun.md)
- [명령어 사용법](docs/commands.md)
- [문제 해결](docs/troubleshooting.md)
- [PM2 배포](docs/deploy.md)

---

## Quick Start (English)

OpenCaddy is a Telegram bot that lets you remotely control an OpenCode (Claude Code) coding agent from your phone.

### Install with AI Agent (Recommended)

Paste this into your AI agent (OpenCode, Claude Code, etc.):
```
Install and configure OpenCaddy:
https://raw.githubusercontent.com/your-repo/opencode-telegram/main/docs/installation.md
```

### Manual Install
```bash
git clone https://github.com/your-repo/opencode-telegram.git
cd opencode-telegram
bun install
bun run setup    # Interactive setup wizard
bun run start
```

### First Use
1. Send `/start` to your bot on Telegram
2. Send `/new` to create a session
3. Send a message to start chatting with AI

### Troubleshooting
```bash
bun run doctor    # Diagnose configuration issues
```

See [Troubleshooting Guide](docs/troubleshooting.md) for common issues.

---

## License

MIT
