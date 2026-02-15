[🇺🇸 English](README.md)

# Claude-Go

**폰 하나로 Claude Code를 원격 조종하세요.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue?labelColor=black&style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-black?logo=bun&logoColor=white&style=flat-square)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?labelColor=black&style=flat-square)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/github/stars/reahbi/claude-go?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/reahbi/claude-go)

<div align="center">
<br>
<img src="docs/images/tdd.jpeg" alt="TDD - 화장실 주도 개발" width="400">

### TDD: Toilet-Driven Development

*Telegram-Driven Development, Toilet-Driven Development — 뭐라 부르든 상관없습니다.*
*당신이 똥 누는 동안에도 AI 에이전트는 일합니다.* 🚽

</div>

<div align="center">
<br>
<img src="docs/images/ddd.jpeg" alt="DDD - 운전 주도 개발" width="500">

### DDD: Drive-Driven Development

*"테스트 돌려보고 깨지는 거 고쳐." — 타이핑한 거 아닙니다. 말한 겁니다.*
*양손은 핸들, 눈은 전방. AI는 이미 테스트를 고치고 있습니다.* 🚗

</div>

---

### 포켓몬 고처럼, 어디서든 코딩하세요

**어디서든 코딩하세요.** 버스에서, 공원에서, 줄 서서 기다리면서 — 당신이 어디에 있든, AI 에이전트는 준비되어 있습니다.

초보 개발자에게 스마트폰으로 코딩하는 건 고통입니다: 작은 터미널 글씨, SSH 클라이언트, 오타 지옥. **Claude-Go는 그 모든 불편함을 없앱니다.** 버튼 누르고, 메시지 보내고, 어려운 건 AI에게 맡기세요.

---

서버에서 돌아가는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)를 **텔레그램**으로 원격 제어합니다.
퇴근길 지하철, 카페, 침대 — 어디서든 AI에게 코드를 시키고 결과를 실시간으로 받아보세요.

```
📱 Telegram (어디서든)
 ↕  Telegram Bot API
🤖 Claude-Go (Bun + TypeScript)
 ↕  Claude Agent SDK (같은 프로세스)
🗂️ Your Project
```

> [!IMPORTANT]
> **Claude-Go는 단일 프로세스로 실행됩니다.**
> 별도 서버 없이 봇만 실행하면 Claude Agent SDK를 통해 모든 것이 처리됩니다.

> [!TIP]
> **읽기 귀찮으세요?** AI 에이전트에게 이 README 링크를 던져주세요. 설치까지 알아서 해줍니다.
> ```
> 이 프로젝트를 설치하고 설정해줘:
> https://raw.githubusercontent.com/reahbi/claude-go/master/docs/installation.md
> ```

---

## 목차

- [왜 Claude-Go인가?](#왜-claude-go인가)
- [주요 기능](#주요-기능)
- [빠른 시작](#빠른-시작)
- [설치](#설치)
- [명령어](#명령어)
- [환경변수](#환경변수)
- [아키텍처](#아키텍처)
- [배포](#배포)
- [문제 해결](#문제-해결)
- [License](#license)

---

## 왜 Claude-Go인가?

**문제**: AI 코딩 에이전트(Claude Code)는 강력하지만, 실행 중인 서버 앞에 앉아있어야 합니다.
이동 중에 떠오른 아이디어? 집에 갈 때까지 참아야 합니다.

**해결**: Claude-Go가 텔레그램과 Claude Code 사이의 다리가 됩니다.

| 다른 도구들 | Claude-Go |
|---|---|
| SSH로 서버 접속해서 CLI 조작 | 텔레그램 메시지 하나로 끝 |
| AI가 질문하면? 터미널에서 답변 | 인라인 버튼 탭 한 번으로 응답 |
| 긴 응답을 터미널에서 스크롤 | 자동 요약 + 파일 전송으로 모바일 최적화 |
| 단일 프로젝트만 | PM2로 여러 프로젝트 동시 관리 |
| "AI가 뭐 하고 있지?" — SSH 접속해서 로그 스크롤 | `/resume` → 진행 중인 작업 즉시 확인 + 실시간 상태 |
| 터미널 출력 복사해서 공유 | `/history` → 구문 강조된 예쁜 HTML 내보내기 |

> 카페에서 "이 파일 리팩토링 해줘" 한 마디 → AI가 알아서 작업 → 완료 통보 — 이게 Claude-Go입니다.

### 시키고, 던져두고, 언제든 다시 확인하세요.

```
🚶 당신: "auth 모듈 리팩토링 해줘" → 폰 덮음 → 점심 먹으러 감
🍜 30분 후...
📱 당신: /resume → AI가 아직 작업 중인 거 확인, 완료
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

**실시간 스트리밍** — Claude가 생각하고 쓰는 내용을 실시간으로 확인. 글자 단위로 나타나는 응답을 바로 볼 수 있습니다.

**확장 사고 (Extended Thinking)** — "think", "분석", "deep" 같은 키워드로 깊은 분석을 유도합니다. Claude의 사고 과정을 확인할 수 있습니다.

**스마트 딜리버리** — 짧은 응답은 인라인, 긴 응답은 자동 분할, 아주 긴 응답은 `.md` 파일로 전송합니다.

**응답 요약** — 긴 AI 응답을 경량 모델이 자동으로 요약해줍니다. 모바일에서 핵심만 빠르게 파악하세요. 요약 스타일은 전문성 수준에 따라 자동 조절됩니다.

**비용 추적** — 응답마다 토큰 사용량과 비용을 확인합니다. 세션별 지출을 추적할 수 있습니다.

**에이전트 전환** — `/agents` 명령으로 상황에 맞는 AI 모델을 선택합니다.

**멀티 인스턴스** — PM2를 사용해 여러 프로젝트를 각각의 봇으로 동시에 관리합니다.

**그룹 채팅** — 여러 봇을 한 텔레그램 그룹에 넣고 @멘션으로 각각 조종합니다.

**멀티봇 협업** — Writer(코드 작성)와 Reader(코드 리뷰) 역할을 분리해 `/debate`로 토론, `/review`로 코드 리뷰를 요청합니다.

**그룹 공유 설정** — `/groupsettings`로 그룹 채팅의 공유 설정(토론 라운드 수)과 봇 현황을 한눈에 확인합니다.

**봇 레지스트리** — `/bots`로 등록된 봇 현황을 확인하고, `/addbot`으로 텔레그램에서 새 봇을 추가합니다.

**Review Mode** — `/settings`에서 탭 한 번으로 읽기 전용 모드를 토글합니다. 재시작 없이 즉시 적용됩니다.

**세션 이어하기** — `/resume`으로 이전 세션에 바로 접속합니다. 진행 중인 작업을 자동으로 감지하고 실시간 진행 상황을 표시합니다.

**대화 기록 내보내기** — `/history`로 대화 기록을 아름다운 HTML 파일로 내보냅니다.

**이미지 전송** — 핸드폰에서 찍은 사진을 바로 전송하세요. 에러 메시지 스크린샷, UI 목업, 다이어그램 — Claude의 비전 API로 네이티브 분석됩니다.

**음성 입력** — 음성 메시지를 보내면 Whisper로 자동 변환되어 Claude에게 전달됩니다. (OpenAI API 키 필요)

**음성 응답** — AI 요약을 읽는 대신 들으세요. 자동 음성 모드를 켜면 AI 작업 완료 시 MP3가 자동 전송됩니다. Edge TTS 기반 한국어/영어 음성을 지원합니다.

**전문성 수준** — 텍스트 요약과 음성 응답을 본인의 수준에 맞게 조절하세요. `/settings`에서 세 가지 모드 중 선택:
- **바이브 코더** — 전문 용어 없이 사용자 관점에서 설명합니다.
- **개발자** — 파일명, 함수 시그니처, 아키텍처 논리, 테스트 결과 등 전체 기술 디테일을 포함합니다.
- **입문자** — 기술 용어에 간단한 설명을 덧붙입니다. 개발하면서 배울 수 있습니다.

**Git 상태 (`/git`)** — 브랜치, 상태, 최근 커밋을 한눈에 확인합니다.

**비활성 경고** — AI 세션이 30분 이상 유휴 상태이면 알림을 받습니다.

**훅 봇** — Claude 세션을 모니터링하는 별도의 경량 프로세스입니다. 세션 완료, 정체, 에러 발생 시 텔레그램으로 알림을 받을 수 있습니다. `/addhookbot`으로 설정하세요.

**예산 관리** — `MAX_BUDGET_USD` 환경변수로 세션당 최대 지출을 설정합니다.

**진단 도구** — `bun run doctor`로 설정 문제를 자동 진단합니다.

---

## 빠른 시작

### 방법 1: AI에게 맡기기 (권장)

AI 에이전트(Claude Code, Cursor 등)에 다음을 붙여넣으세요:

```
Claude-Go를 설치하고 설정해줘:
https://raw.githubusercontent.com/reahbi/claude-go/master/docs/installation.md
```

AI가 몇 가지만 물어보고 나머지는 자동으로 처리합니다.

### 방법 2: 직접 설치

```bash
git clone https://github.com/reahbi/claude-go.git
cd claude-go
bun install
bun run setup    # 대화형 설정 마법사
bun run start    # 봇 실행
```

### 사전 요구사항

- [Bun](https://bun.sh) v1.0 이상
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 설치 및 인증
- [@BotFather](https://t.me/BotFather)에서 텔레그램 봇 토큰

### 첫 사용

1. 텔레그램에서 봇에게 `/start` 전송
2. `/new`로 새 AI 세션 생성
3. 메시지를 보내면 Claude에게 전달됩니다

---

## 설치

### 수동 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 필수 값을 설정하세요:

```bash
BOT_TOKEN=your-bot-token-here          # @BotFather에서 발급
ALLOWED_USER_IDS=123456789             # 본인의 Telegram User ID
DEFAULT_PROJECT=/path/to/your/project  # 프로젝트 경로 (절대 경로)
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
| `/queue [메시지]` | AI 작업 중일 때 메시지 큐에 추가 |
| `/clearqueue` | 큐 비우기 |
| `/showqueue` | 큐 상태 보기 |
| `/undo` | 마지막 AI 응답 되돌리기 |
| `/redo` | 되돌린 응답 다시 적용 |
| `/status` | 현재 상태 확인 |
| `/git` | Git 상태, diff, log |
| `/agents` | AI 에이전트/모델 선택 |
| `/plan` | 권한 모드를 `plan`으로 전환 (계획 우선 승인 흐름) |
| `/ask` | 권한 모드를 `ask`로 전환 (SDK 기본 프롬프트 동작) |
| `/bypass` | 권한 모드를 `bypass`로 전환 (도구 전체 접근) |
| `/settings` | 요약 모드, Review Mode, 음성, 출력 형식 등 설정 |
| `/groupsettings` | 그룹 공유 설정 (토론 라운드, 봇 현황) |
| `/debate [주제]` | Writer↔Reader 봇 간 토론 시작 |
| `/review [대상]` | 상대 봇에게 코드 리뷰 요청 |
| `/bots` | 등록된 봇 현황 (온라인/오프라인) |
| `/addbot` | 새 봇 추가 마법사 (DM 전용) |
| `/addhookbot` | 훅 봇 설정 마법사 (DM 전용) |
| `/cancel` | 진행 중인 마법사 취소 |
| `/help` | 도움말 |

일반 텍스트를 보내면 현재 세션의 AI에게 프롬프트로 전달됩니다.

권한 모드는 텔레그램에서 `/plan`, `/ask`, `/bypass` 또는 `/settings`로 전환할 수 있습니다.
`ask` 모드의 승인 프롬프트는 Claude Code SDK 기본 동작을 따릅니다. 릴리즈 게이트는 Claude Code/SDK 런타임 정책으로 봐야 하며, 텔레그램 커스텀 승인 플로우를 의미하지 않습니다.

---

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|:---:|---|---|
| `BOT_TOKEN` | Yes | — | @BotFather 봇 토큰 |
| `ALLOWED_USER_IDS` | Yes | — | 허용 Telegram User ID (쉼표 구분) |
| `DEFAULT_PROJECT` | Yes | — | 기본 프로젝트 디렉토리 (절대 경로) |
| `CLAUDE_MODEL` | | `claude-sonnet-4-5` | Claude 모델 ID |
| `CLAUDE_CODE_PATH` | | (자동 탐지) | Claude Code 실행 경로 |
| `MAX_THINKING_TOKENS` | | `0` | Extended Thinking 토큰 제한 (0 = 비활성) |
| `MAX_BUDGET_USD` | | — | 세션당 최대 예산 (USD) |
| `OPENAI_API_KEY` | | — | Whisper 음성 인식용 OpenAI API 키 |
| `INSTANCE_NAME` | | 프로젝트 디렉토리명 | 인스턴스 식별자 |
| `STATE_DIR` | | `data/` | 상태 파일 저장 경로 |
| `BOT_ROLE` | | `standalone` | 봇 역할: `standalone`, `writer`, `reader` |
| `GROUP_CHAT_ENABLED` | | `false` | 그룹 채팅 지원 |
| `COORDINATION_DIR` | | — | 봇 간 조정용 공유 디렉토리 (멀티봇 필수) |
| `DEFAULT_AGENT` | | — | 기본 AI 에이전트 이름 |
| `DEFAULT_CUSTOM_AGENT` | | — | 기본 커스텀 에이전트 ID (`/makeagent`로 생성) |
| `HOOK_CONFIG_PATH` | | `data/hook-config.json` | 훅 봇 설정 파일 경로 |
| `DEBUG` | | — | 디버그 로그 활성화 |

---

## 아키텍처

**Clean Architecture (Hexagonal / Ports & Adapters)** 기반으로 설계되었습니다.

```
src/
├── domain/        # 순수 타입 + 포트 — 외부 의존성 ZERO
├── app/           # 유스케이스 — domain/만 import
├── adapters/      # 외부 세계 — Telegram, Claude Agent SDK, JSON 저장소
├── config/        # 환경변수 파싱 + 프로젝트 설정
├── shared/        # 로거, 포매터, 상수
├── main.ts        # Composition Root (의존성 조립)
└── hookBot.ts     # Hook Bot Composition Root (세션 알림 프로세스)
```

**단일 프로세스 구조:**

```
📱 Telegram
 ↕  Telegram Bot API
🤖 Claude-Go Bot (Bun + TypeScript)
 ├── grammy (텔레그램 프레임워크)
 ├── Claude Agent SDK (같은 프로세스, query() AsyncGenerator)
 ├── Session Store (JSON 기반, 로컬)
 └── Summary Service (Claude CLI 서브프로세스)
 ↕
🗂️ Your Project
```

**멀티봇 모드:**

```
📱 Telegram Group
 ↕  @mention routing
🤖 Writer Bot ←──coordination──→ 🤖 Reader Bot
 ↕  Agent SDK                     ↕  Agent SDK
🗂️ Project                       🗂️ Project
     └── registry.json (shared) ──┘
```

**핵심 의존성 규칙**: `domain/` → 아무것도 import 안 함 | `app/` → `domain/`만 | `adapters/` → `app/` + `domain/`

**기술 스택**: Bun + TypeScript (strict) + [grammy](https://grammy.dev) + [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

> AI 에이전트가 이 프로젝트를 수정할 때는 [AGENTS.md](AGENTS.md)를 참고하세요.
> 코드맵, 컨벤션, 안티패턴이 정리되어 있습니다.

---

## 배포

### 단일 봇

```bash
bun run start    # 프로덕션 모드
```

### PM2 멀티봇

```js
// ecosystem.config.cjs
const COORDINATION_DIR = '/tmp/claude-go-coordination'

module.exports = {
  apps: [
    {
      name: 'claude-go-writer',
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
      name: 'claude-go-reader',
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
> 텔레그램에서 `/addbot` 명령으로도 봇을 추가할 수 있습니다.

---

## 문제 해결

```bash
bun run doctor    # 설정 항목을 자동으로 진단합니다
```

자주 발생하는 문제:
- **Claude Code를 찾을 수 없음**: `claude` CLI가 설치되어 있고 PATH에 있는지 확인하거나, `CLAUDE_CODE_PATH`를 설정하세요
- **봇이 응답하지 않음**: `.env`의 `BOT_TOKEN`과 `ALLOWED_USER_IDS`를 확인하세요
- **세션 에러**: `/new`로 새 세션을 생성해보세요

---

## 개발

```bash
bun run dev        # 개발 모드 (hot reload)
bun run hook       # 훅 봇 실행 (세션 알림)
bun run typecheck  # 타입 체크
bun run build      # dist/ 빌드
bun test           # 테스트 실행
```

---

## Acknowledgments

이 프로젝트는 다음 프로젝트들에서 영감을 받고 아이디어를 참고했습니다:

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) — 에이전트 설정 및 툴링 영감
- [Kimaki](https://github.com/remorses/kimaki) — 구현 참고 및 아이디어
- [linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot) — Claude Agent SDK + grammy 패턴

---

## Disclaimer

이 프로젝트는 Anthropic에서 만들었거나 공식 제휴된 프로젝트가 아닙니다.
[Claude Code](https://docs.anthropic.com/en/docs/claude-code)는 [Anthropic](https://www.anthropic.com)의 제품입니다.

---

## License

MIT
