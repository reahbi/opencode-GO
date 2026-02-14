[English](hookbot.md)

# 훅 봇 가이드

Claude Code 세션을 모니터링하고 텔레그램으로 알림을 보내는 경량 독립 프로세스입니다 — 완료, 정체, 에러를 모두 알려줍니다.

---

## 목차
1. [훅 봇이란?](#훅-봇이란)
2. [빠른 시작 (3분 세팅)](#빠른-시작-3분-세팅)
3. [동작 원리](#동작-원리)
4. [알림 종류](#알림-종류)
5. [설정](#설정)
6. [훅 봇 실행](#훅-봇-실행)
7. [명령어](#명령어)
8. [환경변수](#환경변수)
9. [아키텍처](#아키텍처)
10. [문제 해결](#문제-해결)

---

## 훅 봇이란?

훅 봇은 세션 모니터링 전용 **별도 텔레그램 봇 프로세스**입니다. 메인 Claude-Go 봇은 직접 메시지를 보내고 세션을 관리하는 능동적 조작이 필요하지만, 훅 봇은 백그라운드에서 조용히 돌아가며 무슨 일이 생기면 알려줍니다.

### 메인 봇 vs 훅 봇

| | 메인 봇 | 훅 봇 |
|---|---|---|
| **목적** | 대화형 AI 제어 | 수동 세션 모니터링 |
| **명령어** | 전체 (`/new`, `/resume` 등) | 최소 (`/hookstatus`, `/start`) |
| **상호작용** | 프롬프트 전송, 세션 관리 | 알림 수신 |
| **프로세스** | `bun run start` / `bun run dev` | `bun run hook` |
| **진입점** | `src/main.ts` | `src/hookBot.ts` |

### 왜 훅 봇을 쓸까?

- **"시키고 잊기" 워크플로우** — 메인 봇에서 작업을 시작하고, 텔레그램을 닫고, 완료되면 알림을 받으세요.
- **멀티 프로젝트 모니터링** — 하나의 채팅방에서 모든 프로젝트를 감시합니다. 봇 하나로 여러 프로젝트.
- **경량** — 스트리밍 편집도, 상태 관리도 없습니다. 이벤트 → 알림, 그게 전부입니다.

---

## 빠른 시작 (3분 세팅)

### 1단계: BotFather에서 봇 만들기

1. 텔레그램에서 [@BotFather](https://t.me/botfather)를 찾습니다.
2. `/newbot`으로 새 봇(예: `MyHookBot`)을 만듭니다.
3. **API Token**을 복사합니다.

### 2단계: `/addhookbot` 마법사 실행

기존 메인 봇과의 **1:1 채팅(DM)**에서:

1. `/addhookbot`을 보냅니다.
   > **Hook Bot Setup Wizard**
   >
   > BotFather에서 발급받은 봇 토큰을 보내주세요.

2. API 토큰을 붙여넣습니다.
   > **@MyHookBot** 확인됨
   >
   > 모니터링할 프로젝트를 선택하세요:
   > `[All projects]` `[project-a]` `[project-b]` `[Done]`

3. 프로젝트를 선택합니다 — 개별 선택하거나 **All projects**를 눌러 전체를 모니터링합니다.

4. 알림을 받을 채팅 ID를 입력합니다 (`default`를 보내면 현재 채팅을 사용).
   > **Hook bot configured!**
   >
   > `[Start Now (PM2)]` `[Save Config Only]`

5. **Start Now**를 누르면 PM2로 즉시 실행됩니다.

### 3단계: 확인

훅 봇에게 `/start`를 보냅니다:
> Hook Bot active. Use /hookstatus for details.

`/hookstatus`로 모니터링 중인 프로젝트를 확인합니다:
> **Hook Bot Status**
>
> Monitoring 3 project(s):
> 1. my-app
> 2. my-api
> 3. my-lib
>
> Mode: all

---

## 동작 원리

```
Telegram (알림)
 |  Telegram Bot API
Hook Bot (Bun + TypeScript)    <- bun run hook
 |  세션 상태 모니터링
프로젝트들 (1..N개)
```

1. 훅 봇은 설정된 프로젝트별로 Claude 세션 상태를 모니터링합니다.
2. 세션 상태 전환을 추적합니다: `idle → busy → idle`.
3. 세션이 완료되면(busy → idle), 세션 요약과 함께 알림을 보냅니다.
4. 세션이 30분 이상 활동 없이 busy 상태이면 정체 경고를 보냅니다.

---

## 알림 종류

### 세션 완료
AI 세션이 작업을 마쳤을 때(busy → idle) 전송됩니다.

```
Session completed
my-project
auth 모듈 리팩토링
12m 34s
```

### 정체 경고
세션이 30분 이상 활동 없이 busy 상태일 때 전송됩니다.

```
Session stalled in my-project
Session: ses_abc123
Inactive for 35m 12s
```

정체 경고는 세션이 idle이 되거나 수동으로 중단될 때까지 30분마다 반복됩니다.

### 세션 에러
세션에서 에러가 발생할 때 전송됩니다.

```
Session error in my-project
Session: ses_abc123
Error: Model rate limit exceeded
```

---

## 설정

### hook-config.json

마법사가 `data/hook-config.json`을 생성합니다:

```json
{
  "botToken": "123456:ABC-DEF...",
  "chatId": 123456789,
  "projects": [
    { "directory": "/home/user/my-app", "name": "my-app" },
    { "directory": "/home/user/my-api", "name": "my-api" }
  ],
  "mode": "selected"
}
```

### 설정 필드

| 필드 | 필수 | 설명 |
|---|:---:|---|
| `botToken` | Yes | BotFather에서 발급받은 텔레그램 봇 토큰 |
| `chatId` | Yes | 알림을 받을 텔레그램 채팅 ID |
| `projects` | Yes* | 모니터링할 `{directory, name}` 배열 |
| `mode` | Yes | `all` (자동 탐색) 또는 `selected` (수동 목록) |

> \* `mode`가 `all`이면 시작 시 프로젝트를 자동 탐색합니다.

---

## 훅 봇 실행

### 개발 모드

```bash
bun run hook
```

### 프로덕션 (PM2)

`/addhookbot` 마법사가 `ecosystem.config.cjs`에 자동으로 항목을 추가합니다:

```javascript
{
  name: 'claude-go-hookbot',
  script: 'src/hookBot.ts',
  interpreter: 'bun',
  cwd: '/path/to/claude-go',
  env: {
    HOOK_CONFIG_PATH: 'data/hook-config.json',
  },
  autorestart: true,
  max_memory_restart: '512M',
},
```

```bash
pm2 start ecosystem.config.cjs
pm2 logs claude-go-hookbot
```

### 수동 실행

```bash
HOOK_CONFIG_PATH=data/hook-config.json bun run src/hookBot.ts
```

---

## 명령어

훅 봇의 명령어는 최소한입니다:

| 명령어 | 설명 |
|---|---|
| `/start` | 봇이 활성 상태인지 확인 |
| `/hookstatus` | 모니터링 중인 프로젝트와 모드 표시 |

---

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|:---:|---|---|
| `HOOK_CONFIG_PATH` | | `data/hook-config.json` | 훅 봇 설정 파일 경로 |

> 훅 봇은 프로젝트, 채팅 ID 등 나머지 설정을 환경변수가 아닌 설정 JSON 파일에서 읽습니다.

---

## 아키텍처

훅 봇은 메인 봇과 같은 **Clean Architecture**를 따르지만 훨씬 단순한 구성입니다:

```
src/hookBot.ts                              # Composition root
 +-- domain/hookBotTypes.ts                 # HookBotConfig, TrackedSession, HookNotification
 +-- domain/ports/HookNotificationPort.ts   # notify(notification) 인터페이스
 +-- app/usecases/completionWatcher.ts      # 세션 모니터링 + 정체 감지
 +-- adapters/telegram/hookBotAdapter.ts    # 텔레그램 알림 + 콜백 핸들러
```

### 주요 컴포넌트

| 컴포넌트 | 역할 |
|---|---|
| `createCompletionWatcher` | 프로젝트별 세션 상태 모니터링, busy/idle 전환 추적, 정체 감지 |
| `createHookBotNotificationAdapter` | `HookNotificationPort` 구현 — 텔레그램 메시지 포맷팅 및 전송 |
| `createHookBot` | 기본 HTML 파싱 모드의 grammy Bot 인스턴스 생성 |
| `createHookBotAuthGuard` | 설정된 `chatId`의 메시지만 허용하는 미들웨어 |
| `registerHookBotHandlers` | `/start`, `/hookstatus`, 콜백 핸들러 등록 |

---

## 문제 해결

**Q: 훅 봇이 알림을 보내지 않아요.**
- **A1**: hook-config.json의 프로젝트 디렉토리가 올바른지 확인하세요.
- **A2**: `pm2 logs claude-go-hookbot`으로 에러를 확인하세요.
- **A3**: 훅 봇 프로세스에서 Claude Code CLI가 접근 가능한지 확인하세요.

**Q: 훅 봇을 제거하려면?**
- **A**: `/addhookbot`을 다시 실행하면 현재 설정과 함께 **Remove hook bot** 버튼이 표시됩니다. 이 버튼으로 설정 삭제, PM2 프로세스 중지, ecosystem 파일 정리가 모두 처리됩니다.

**Q: 메인 봇과 훅 봇에 같은 봇 토큰을 쓸 수 있나요?**
- **A**: 안 됩니다. 각 봇 프로세스는 고유한 텔레그램 봇 토큰이 필요합니다. BotFather에서 훅 봇용 봇을 별도로 만드세요.
