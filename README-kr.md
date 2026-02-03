# OpenCode-Go

**폰 하나로 AI 코딩 에이전트를 원격 조종하세요.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue?labelColor=black&style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-black?logo=bun&logoColor=white&style=flat-square)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?labelColor=black&style=flat-square)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/github/stars/reahbi/opencode-telegram?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/reahbi/opencode-telegram)

<div align="center">
<br>
<img src="docs/images/tdd.jpeg" alt="TDD - 화장실 주도 개발" width="400">

### TDD: Toilet-Driven Development

*Telegram-Driven Development, Toilet-Driven Development — 뭐라 부르든 상관없습니다.*
*당신이 똥 누는 동안에도 AI 에이전트는 일합니다.* 🚽

</div>

---

서버에서 돌아가는 [OpenCode](https://github.com/sst/opencode) 코딩 에이전트를 **텔레그램**으로 원격 제어합니다.
퇴근길 지하철, 카페, 침대 — 어디서든 AI에게 코드를 시키고 결과를 실시간으로 받아보세요.

```
📱 Telegram (어디서든)
 ↕  Telegram Bot API
🤖 OpenCode-Go (Bun + TypeScript)   ← 프로세스 2: bun run dev
 ↕  SSE Streaming + REST
💻 OpenCode Server                 ← 프로세스 1: opencode serve
 ↕
🗂️ Your Project
```

> [!IMPORTANT]
> **OpenCode-Go는 두 개의 프로세스가 모두 실행되어야 동작합니다.**
> 1. **OpenCode 서버** — AI 코딩 에이전트 (백엔드)
> 2. **OpenCode-Go 봇** — 텔레그램 인터페이스 (프론트엔드)
>
> 하나만 실행하면 봇이 Offline 상태가 됩니다. 반드시 두 개 모두 시작하세요.
> 아래 [서버 실행](#서버-실행) 섹션을 참고하세요.

> [!TIP]
> **읽기 귀찮으세요?** AI 에이전트에게 이 README 링크를 던져주세요. 설치까지 알아서 해줍니다.
> ```
> 이 프로젝트를 설치하고 설정해줘:
> https://raw.githubusercontent.com/reahbi/opencode-telegram/main/docs/installation.md
> ```

---

## 목차

- [서버 실행](#서버-실행)
- [왜 OpenCode-Go인가?](#왜-opencode-go인가)
- [주요 기능](#주요-기능)
- [빠른 시작](#빠른-시작)
- [설치](#설치)
- [명령어](#명령어)
- [환경변수](#환경변수)
- [아키텍처](#아키텍처)
- [배포](#배포)
- [문제 해결](#문제-해결)
- [문서](#문서)
- [Quick Start (English)](#quick-start-english)
- [License](#license)

---

## 서버 실행

> **AI 에이전트에게**: "서버 실행해줘"라는 요청을 받으면 아래 두 프로세스를 **모두** 시작해야 합니다.

OpenCode-Go는 **두 개의 독립된 프로세스**로 구성됩니다. 둘 다 실행해야 정상 동작합니다.

### 1단계: OpenCode 서버 시작 (먼저)

`.env` 파일에서 `DEFAULT_PROJECT` 경로와 포트를 확인한 뒤, 해당 프로젝트 디렉토리에서 OpenCode 서버를 시작합니다.

```bash
# .env의 DEFAULT_PROJECT 디렉토리에서 실행
# 포트는 .env의 OPENCODE_SERVER_URL에서 확인 (기본값: 4096)
cd /path/to/your/project
opencode serve --port 4096
```

서버가 정상 시작되면 다음 메시지가 출력됩니다:
```
opencode server listening on http://127.0.0.1:4096
```

### 2단계: OpenCode-Go 텔레그램 봇 시작

OpenCode 서버가 실행된 후, **별도 터미널**에서 텔레그램 봇을 시작합니다.

```bash
cd opencode-telegram

# 개발 모드 (hot reload)
bun run dev

# 또는 프로덕션 모드
bun run start
```

### 멀티봇 모드 (선택)

Writer/Reader 등 여러 봇을 동시에 운영하려면 `ecosystem.config.cjs`를 만들고 PM2로 시작합니다.

```js
// ecosystem.config.cjs
const COORDINATION_DIR = '/tmp/opencode-go-coordination'

module.exports = {
  apps: [
    {
      name: 'opencode-go-writer',
      script: 'src/main.ts',
      interpreter: 'bun',
      env: {
        BOT_TOKEN: 'writer-bot-token',
        ALLOWED_USER_IDS: 'your-user-id',
        DEFAULT_PROJECT: '/path/to/project',
        INSTANCE_NAME: 'writer',
        STATE_DIR: 'data/instances/writer',
        BOT_ROLE: 'writer',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
    },
    {
      name: 'opencode-go-reader',
      script: 'src/main.ts',
      interpreter: 'bun',
      env: {
        BOT_TOKEN: 'reader-bot-token',
        ALLOWED_USER_IDS: 'your-user-id',
        DEFAULT_PROJECT: '/path/to/project',
        INSTANCE_NAME: 'reader',
        STATE_DIR: 'data/instances/reader',
        BOT_ROLE: 'reader',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
    },
  ],
}
```

```bash
pm2 start ecosystem.config.cjs
pm2 logs
```

> [!TIP]
> 텔레그램에서 `/addbot` 명령으로도 봇을 추가할 수 있습니다. 마법사가 토큰 검증부터 PM2 설정까지 안내합니다.

### 실행 확인

두 프로세스가 모두 실행 중이면:
- 봇 로그에 `OpenCode-Go is running!` 출력
- 텔레그램에서 `/start` 전송 시 서버 상태가 🟢 **Online**
- 멀티봇 모드에서는 `/bots`로 등록된 봇의 온라인 상태를 확인

서버 상태가 🔴 **Offline**이면 1단계(OpenCode 서버)가 실행되지 않은 것입니다.

---

## 왜 OpenCode-Go인가?

**문제**: AI 코딩 에이전트(OpenCode)는 강력하지만, 실행 중인 서버 앞에 앉아있어야 합니다.
이동 중에 떠오른 아이디어? 집에 갈 때까지 참아야 합니다.

**해결**: OpenCode-Go가 텔레그램과 OpenCode 사이의 다리가 됩니다.

| 다른 도구들 | OpenCode-Go |
|---|---|
| SSH로 서버 접속해서 CLI 조작 | 텔레그램 메시지 하나로 끝 |
| AI가 권한을 요청하면 터미널로 달려가야 함 | 인라인 버튼 탭 한 번으로 승인 |
| AI가 여러 질문을 하면? 터미널에서 하나씩 입력 | 인라인 버튼으로 순차적으로 답변 — 컴퓨터처럼 편하게 |
| 긴 응답을 터미널에서 스크롤 | 자동 요약 + 파일 전송으로 모바일 최적화 |
| 단일 프로젝트만 | PM2로 여러 프로젝트 동시 관리 |
| "AI가 뭐 하고 있지?" — SSH 접속해서 로그 스크롤 | `/resume` → 진행 중인 작업 즉시 확인 + 실시간 상태 |
| 터미널 출력 복사해서 공유 | `/history` → 구문 강조된 예쁜 HTML 내보내기 |

> 카페에서 "이 파일 리팩토링 해줘" 한 마디 → AI가 알아서 작업 → 권한 요청 버튼 탭 → 완료 통보 — 이게 OpenCode-Go입니다.

### 시키고, 던져두고, 언제든 다시 확인하세요.

```
🚶 당신: "auth 모듈 리팩토링 해줘" → 폰 덮음 → 점심 먹으러 감
🍜 30분 후...
📱 당신: /resume → AI가 아직 작업 중인 거 확인, 권한 승인, 끝
💻 컴퓨터 앞에서: /resume → 하던 작업 이어서 확인
```

**AI는 계속 일합니다. 당신이 지켜볼 필요 없습니다.**

### 세션에 들어가지 않아도 대화 기록을 받을 수 있습니다

```
📋 /list → 전체 세션 목록 → 하나 선택 → HTML로 전체 기록 받기
📄 /history → 현재 세션을 예쁜 HTML로 내보내기
```

**폰, 태블릿, 컴퓨터 어디서든 과거 세션을 확인하세요 — SSH 필요 없습니다.**

---

## 주요 기능

**실시간 스트리밍** — SSE 기반으로 AI의 응답을 즉시 확인. 폴링이 아닙니다.

**대화형 권한/질문** — AI가 파일 수정 권한을 요청하거나 질문을 던지면, 텔레그램 인라인 키보드로 즉시 응답합니다.

**스마트 딜리버리** — 짧은 응답은 인라인, 긴 응답은 자동 분할, 아주 긴 응답은 `.md` 파일로 전송합니다.

**응답 요약** — 긴 AI 응답을 경량 모델이 자동으로 요약해줍니다. 모바일에서 핵심만 빠르게 파악하세요.

**에이전트 전환** — `/agents` 명령으로 상황에 맞는 AI 모델을 선택합니다.

**멀티 인스턴스** — PM2를 사용해 여러 프로젝트를 각각의 봇으로 동시에 관리합니다.

**그룹 채팅** — 여러 봇을 한 텔레그램 그룹에 넣고 @멘션으로 각각 조종합니다. 권한 버튼은 요청자 본인만 누를 수 있습니다.

**멀티봇 협업 (🧪 테스트 중)** — Writer(코드 작성)와 Reader(코드 리뷰) 역할을 분리해 `/debate`로 토론, `/review`로 코드 리뷰를 요청합니다.

**그룹 공유 설정** — `/groupsettings`로 그룹 채팅의 공유 설정(토론 라운드 수)과 봇 현황을 한눈에 확인합니다.

**봇 레지스트리** — `/bots`로 등록된 봇 현황을 확인하고, `/addbot`으로 텔레그램에서 새 봇을 추가합니다.

**Review Mode** — `/settings`에서 탭 한 번으로 읽기 전용 모드를 토글합니다. 서버 재시작 없이 즉시 적용됩니다.

**세션 이어하기** — `/resume`으로 이전 세션에 바로 접속합니다. 진행 중인 작업을 자동으로 감지하고 실시간 진행 상황을 표시합니다 — 시켜놓은 작업 확인할 때 딱입니다.

**대화 기록 내보내기** — `/history`로 대화 기록을 아름다운 HTML 파일로 내보냅니다. 구문 강조와 깔끔한 타이포그래피로 어떤 기기에서든 과거 세션을 확인할 수 있습니다.

**진단 도구** — `bun run doctor`로 설정 문제를 자동 진단합니다.

---

## 빠른 시작

### 방법 1: AI에게 맡기기 (권장)

AI 에이전트(OpenCode, Claude Code, Cursor 등)에 다음을 붙여넣으세요:

```
OpenCode-Go를 설치하고 설정해줘:
https://raw.githubusercontent.com/reahbi/opencode-telegram/main/docs/installation.md
```

AI가 4가지만 물어보고 나머지는 자동으로 처리합니다.

### 방법 2: 직접 설치

```bash
git clone https://github.com/reahbi/opencode-telegram.git
cd opencode-telegram
bun install
bun run setup    # 대화형 설정 마법사
bun run start    # 봇 실행
```

### 첫 사용

1. 텔레그램에서 봇에게 `/start` 전송
2. `/new`로 새 AI 세션 생성
3. 메시지를 보내면 AI에게 전달됩니다

---

## 설치

### 사전 요구사항

- [Bun](https://bun.sh) v1.0 이상 — [설치 가이드](docs/setup/bun.md)
- 텔레그램 봇 토큰 — [봇 생성 가이드](docs/setup/telegram.md)
- OpenCode 서버 실행 — [서버 설정 가이드](docs/setup/opencode.md)

### 수동 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 필수 값을 설정하세요:

```bash
BOT_TOKEN=your-bot-token-here          # @BotFather에서 발급
ALLOWED_USER_IDS=123456789             # 본인의 Telegram User ID
DEFAULT_PROJECT=/path/to/your/project  # OpenCode가 작업할 프로젝트 경로 (절대 경로)
```

> [!TIP]
> `bun run setup`을 사용하면 대화형으로 설정을 완료할 수 있습니다.

> [!WARNING]
> `bun run doctor`로 설정이 올바른지 반드시 확인하세요.

---

## 명령어

| 명령어 | 설명 |
|---|---|
| `/start` | 온보딩 + 상태 확인 |
| `/new [제목]` | 새 AI 세션 생성 |
| `/list` | 세션 목록 보기 |
| `/resume [번호]` | 세션 재개 |
| `/abort` | 현재 작업 중단 |
| `/history` | 세션 대화 이력 내보내기 |
| `/status` | 현재 상태 확인 |
| `/agents` | AI 에이전트/모델 선택 |
| `/settings` | 요약 모드, Review Mode, 출력 형식 등 설정 |
| `/groupsettings` | 그룹 공유 설정 (토론 라운드, 봇 현황) |
| `/debate [주제]` | Writer↔Reader 봇 간 토론 시작 (🧪 테스트 중) |
| `/review [대상]` | 상대 봇에게 코드 리뷰 요청 (🧪 테스트 중) |
| `/bots` | 등록된 봇 현황 (온라인/오프라인) |
| `/addbot` | 새 봇 추가 마법사 (DM 전용) |
| `/cancel` | 진행 중인 마법사 취소 |
| `/help` | 도움말 |

일반 텍스트를 보내면 현재 세션의 AI에게 프롬프트로 전달됩니다.

자세한 사용법: [명령어 가이드](docs/commands.md)

---

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|:---:|---|---|
| `BOT_TOKEN` | ✅ | — | @BotFather 봇 토큰 |
| `ALLOWED_USER_IDS` | ✅ | — | 허용 Telegram User ID (쉼표 구분) |
| `DEFAULT_PROJECT` | ✅ | — | 기본 프로젝트 디렉토리 (절대 경로) |
| `OPENCODE_SERVER_URL` | | `http://127.0.0.1:4096` | OpenCode 서버 주소 |
| `OPENCODE_SERVER_USERNAME` | | `opencode` | 서버 인증 사용자명 |
| `OPENCODE_SERVER_PASSWORD` | | — | 서버 인증 비밀번호 |
| `INSTANCE_NAME` | | 프로젝트 디렉토리명 | 인스턴스 식별자 (로그/상태 표시) |
| `STATE_DIR` | | `data/` | 상태 파일 저장 경로 |
| `BOT_ROLE` | | `standalone` | 봇 역할: `standalone`, `writer`, `reader` |
| `GROUP_CHAT_ENABLED` | | `false` | 그룹 채팅 지원 (`true`/`false`) |
| `COORDINATION_DIR` | | — | 봇 간 조정용 공유 디렉토리 (멀티봇 필수) |
| `DEBUG` | | — | truthy 값 설정 시 디버그 로그 활성화 |

---

## 아키텍처

**Clean Architecture (Hexagonal / Ports & Adapters)** 기반으로 설계되었습니다.

```
src/
├── domain/        # 순수 타입 + 포트 — 외부 의존성 ZERO
├── app/           # 유스케이스 — domain/만 import
├── adapters/      # 외부 세계 — Telegram, OpenCode SDK, JSON 저장소
├── config/        # 환경변수 파싱 + 프로젝트 설정
├── shared/        # 로거, 포매터, 상수
└── main.ts        # Composition Root (의존성 조립)
```

**멀티봇 모드 구조:**

```
📱 Telegram Group
 ↕  @mention routing
🤖 Writer Bot ←──coordination──→ 🤖 Reader Bot
 ↕  SSE + REST                    ↕  SSE + REST
💻 OpenCode Server                💻 OpenCode Server
 ↕                                ↕
🗂️ Project                       🗂️ Project
     └── registry.json (shared) ──┘
```

**핵심 의존성 규칙**: `domain/` → 아무것도 import 안 함 | `app/` → `domain/`만 | `adapters/` → `app/` + `domain/`

**기술 스택**: Bun + TypeScript (strict) + [grammy](https://grammy.dev) + [@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk)

> AI 에이전트가 이 프로젝트를 수정할 때는 [AGENTS.md](AGENTS.md)를 참고하세요.
> 코드맵, 컨벤션, 안티패턴이 정리되어 있습니다.

---

## 배포

PM2를 사용한 프로덕션 배포를 권장합니다.

```bash
# PM2로 전체 인스턴스 시작
bun run start:all

# 로그 확인
bun run logs

# 중지
bun run stop:all
```

멀티 인스턴스 설정, 자동 재시작, 부팅 시 자동 실행 등의 자세한 내용은 [배포 가이드](docs/deploy.md)를 참고하세요.

---

## 문제 해결

```bash
bun run doctor    # 6가지 설정 항목을 자동으로 진단합니다
```

자주 발생하는 문제와 해결법은 [문제 해결 가이드](docs/troubleshooting.md)를 참고하세요.

---

## 문서

| 문서 | 설명 |
|---|---|
| [설치 가이드](docs/installation.md) | AI 에이전트 지원 설치 가이드 |
| [텔레그램 봇 생성](docs/setup/telegram.md) | BotFather 봇 생성 + User ID 확인 |
| [OpenCode 서버 설정](docs/setup/opencode.md) | 서버 설치, 포트, 인증 설정 |
| [Bun 설치](docs/setup/bun.md) | Bun 런타임 설치 + PATH 문제 해결 |
| [명령어 사용법](docs/commands.md) | 전체 명령어 상세 설명 |
| [PM2 배포](docs/deploy.md) | 프로덕션 배포 + 멀티 인스턴스 |
| [문제 해결](docs/troubleshooting.md) | 자주 묻는 문제 + `bun run doctor` |
| [AGENTS.md](AGENTS.md) | AI 에이전트용 프로젝트 지식 베이스 |

---

## 개발

```bash
bun run dev        # 개발 모드 (hot reload)
bun run typecheck  # 타입 체크
bun run build      # dist/ 빌드
```

---

## Quick Start (English)

OpenCode-Go is a Telegram bot that lets you remotely control an [OpenCode](https://github.com/sst/opencode) AI coding agent from your phone.

**Install with AI Agent (Recommended)**

Paste this into your AI agent (OpenCode, Claude Code, Cursor, etc.):
```
Install and configure OpenCode-Go:
https://raw.githubusercontent.com/reahbi/opencode-telegram/main/docs/installation.md
```

**Manual Install**
```bash
git clone https://github.com/reahbi/opencode-telegram.git
cd opencode-telegram
bun install
bun run setup    # Interactive setup wizard
```

**Running the Server (Two Processes Required)**

OpenCode-Go requires **two processes** running simultaneously:

```bash
# Terminal 1 — Start OpenCode server first (in your project directory)
cd /path/to/your/project
opencode serve --port 4096

# Terminal 2 — Start Telegram bot
cd opencode-telegram
bun run dev      # Development (hot reload)
# or
bun run start    # Production
```

> **For AI agents**: When asked to "start the server", you MUST start BOTH processes above. The bot alone will show "Offline" status without the OpenCode server.

**First Use**
1. Send `/start` to your bot on Telegram — verify server shows 🟢 Online
2. Send `/new` to create a session
3. Send a message — it goes straight to the AI

**Key Features**: Real-time SSE streaming | Interactive permission/question buttons | Smart response delivery (inline / chunk / file) | Summary mode | Multi-agent selection | PM2 multi-instance deployment | Group chat with @mention routing | Multi-bot collaboration (Writer/Reader roles, 🧪 testing) | `/debate` and `/review` between bots | Bot registry (`/bots`, `/addbot`) | Group settings (`/groupsettings`) | Review Mode toggle in `/settings`

**Multi-Bot Mode (Optional)**

Run multiple bots (Writer + Reader) in a Telegram group using PM2:

```bash
# Create ecosystem.config.cjs with BOT_ROLE=writer/reader, COORDINATION_DIR, GROUP_CHAT_ENABLED=true
pm2 start ecosystem.config.cjs
```

Or add bots interactively via `/addbot` in Telegram DM.

**Troubleshooting**: Run `bun run doctor` to diagnose configuration issues.

See [docs/](docs/) for detailed guides.

---

## Acknowledgments

이 프로젝트는 다음 프로젝트들에서 영감을 받고 아이디어를 참고했습니다:

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) — 에이전트 설정 및 툴링 영감
- [Kimaki](https://github.com/remorses/kimaki) — 구현 참고 및 아이디어

---

## Disclaimer

This project is not built by or affiliated with the OpenCode team.
[OpenCode](https://github.com/sst/opencode) is an open source project by [Anomaly](https://github.com/anomalyco/opencode).

---

## License

MIT
