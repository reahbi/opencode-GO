# OpenCaddy — OpenCode Telegram Bot

## 개요

WSL에서 실행 중인 OpenCode 코딩 에이전트를 Telegram으로 원격 제어하는 봇.
핸드폰에서 Telegram으로 지시를 내리면, WSL의 OpenCode가 코드를 작성/수정하고,
결과를 Telegram 메시지 또는 .md 파일로 전송한다.

**프로젝트명**: opencaddy
**레포지토리**: github.com/nosky/opencaddy (예정)

---

## 아키텍처

### 시스템 다이어그램

```
📱 Telegram (어디서든)
   ↕ Telegram Bot API (grammy)
🤖 OpenCaddy Bot Process (WSL)
   ↕ @opencode-ai/sdk v1 + v2 (localhost)
🖥️ opencode serve (단일 인스턴스)
   ├─ ?directory=/mnt/c/Dysphagia
   ├─ ?directory=/home/nosky/project-b
   └─ ?directory=...  (directory 파라미터로 라우팅)
```

### 클린 아키텍처 레이어

```
┌─────────────────────────────────────────────────┐
│  main.ts (Composition Root)                     │
│  - 의존성 주입, 포트 ↔ 어댑터 바인딩            │
├─────────────────────────────────────────────────┤
│  adapters/ (외부 세계와의 접점)                  │
│  ├─ telegram/  grammy, HTML 렌더링, 키보드      │
│  ├─ opencode/  SDK v1+v2, SSE, 프로세스 관리    │
│  └─ persistence/  JSON 파일 상태 저장            │
├─────────────────────────────────────────────────┤
│  app/ (유스케이스 — 비즈니스 오케스트레이션)      │
│  ├─ usecases/  세션, 프롬프트, 인터랙션, 프로젝트│
│  └─ queue/     per-chat 직렬화                   │
├─────────────────────────────────────────────────┤
│  domain/ (순수 타입 + 포트 — 외부 의존성 ZERO)   │
│  ├─ models.ts  SessionRef, ProjectRef, ChatState │
│  ├─ events.ts  AgentOutput, PermissionAsked 등   │
│  ├─ errors.ts  타입드 에러                       │
│  └─ ports/     OpenCodePort, ChatOutputPort 등   │
└─────────────────────────────────────────────────┘
```

### 의존성 규칙 (절대 위반 불가)

```
domain/ → 아무것도 import하지 않음 (순수 TypeScript만)
app/    → domain/만 import
adapters/ → app/ + domain/ import (포트 구현)
main.ts → 모든 레이어 import (유일하게 자유로운 파일)
```

- `domain/`에서 `grammy`, `undici`, `@opencode-ai/sdk` import 금지
- `app/`에서 `grammy`, `undici`, `@opencode-ai/sdk` import 금지
- 외부 라이브러리는 오직 `adapters/`에서만 사용

---

## 설계 결정

### 1. 단일 서버 + directory 라우팅

프로젝트별 별도 `opencode serve` 인스턴스 대신, **단일 서버가 `directory` 파라미터로 여러 프로젝트를 처리**.

**이유**:
- 포트 관리, 프로세스 감시, 리소스 낭비 제거
- OpenCode SDK가 이미 `directory` query param / `x-opencode-directory` 헤더 지원
- 나중에 격리가 필요하면 `OpenCodePort` 인터페이스 뒤에서 멀티서버로 전환 가능

### 2. SDK v1 + v2 동시 사용 (v2는 필수)

**검증 결과**: v1에는 `permission.asked`, `question.asked` 이벤트가 **존재하지 않음**.
v2 subpath export (`@opencode-ai/sdk/v2`)는 공식 확인됨.

- **v1** (`@opencode-ai/sdk`): 세션 관리, 프롬프트 전송
- **v2** (`@opencode-ai/sdk/v2`): 이벤트 스트리밍 + permission/question 응답 API (필수)
  - `permission.asked` / `question.asked` 이벤트 수신
  - `client.permission.reply({ requestID, response })` — 권한 응답
  - `client.question.reply({ requestID, answers })` — 질문 응답
  - `client.question.reject({ requestID })` — 질문 거부

`adapters/opencode/` 뒤에서 추상화하여 나머지 코드는 SDK 버전을 모름.

### 3. HTML Parse Mode (MarkdownV2 대신)

MarkdownV2는 17개 특수문자 이스케이핑 필요. AI 출력에서 매우 불안정.
HTML은 `<`, `>`, `&` 3개만 이스케이프 + `<pre><code>` 코드 하이라이팅 지원.

### 4. JSON 상태 저장 (단일 프로세스 전제)

- 단일 봇 프로세스만 실행한다는 전제
- atomic write (temp + rename) + in-process mutex
- 크래시 시 마지막 정상 상태로 복구
- 스케일 필요 시 `StateStore` 포트만 SQLite로 교체

---

## 파일 구조

```
~/opencaddy/
├── README.md
├── LICENSE                         # MIT
├── PLAN.md                         # 이 문서
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── data/
│   ├── projects.json               # 등록된 프로젝트 목록
│   └── projects.json.example
│
└── src/
    ├── main.ts                     # Composition Root — 의존성 조립 + 봇 시작
    │
    ├── domain/                     # 순수 타입 + 포트 (외부 의존성 ZERO)
    │   ├── models.ts               #   SessionRef, ProjectRef, ChatState, PendingInteraction
    │   ├── events.ts               #   AgentOutput, PermissionAsked, QuestionAsked, SessionIdle
    │   ├── errors.ts               #   NotAuthorized, NoActiveSession, ProjectNotFound 등
    │   └── ports/
    │       ├── OpenCodePort.ts     #   createSession, sendPrompt, abortSession, streamEvents
    │       ├── ChatOutputPort.ts   #   sendText, sendFile, editText, sendInteraction
    │       └── StateStore.ts       #   getChatState, saveChatState, withChatLock
    │
    ├── app/                        # 유스케이스 (domain/만 import)
    │   ├── usecases/
    │   │   ├── sessionCommands.ts  #   /new /resume /list /abort /delete /retry /fork /share
    │   │   ├── promptFlow.ts       #   프롬프트 전달 → 스트림 연결 → 응답 완료 처리
    │   │   ├── interactiveFlow.ts  #   permission.asked / question.asked 상태머신
    │   │   └── projectCommands.ts  #   /projects /connect /add /remove + allowlist 검증
    │   ├── queue/
    │   │   └── chatQueue.ts        #   per-chat 직렬화 (명령/이벤트 인터리브 방지)
    │   └── policies/
    │       └── limits.ts           #   MAX_MESSAGE_LENGTH, MAX_CHUNKS, MAX_RETRIES 등
    │
    ├── adapters/                   # 외부 세계 (app/ + domain/ import, 포트 구현)
    │   ├── telegram/
    │   │   ├── bot.ts              #   grammy 초기화 + 미들웨어 + 라우팅 테이블
    │   │   ├── authMiddleware.ts   #   ALLOWED_USER_IDS 체크 미들웨어
    │   │   ├── commands/           #   각 명령어 핸들러 (args 파싱 → usecase 호출)
    │   │   │   ├── index.ts        #     라우팅 테이블 (명령어 → 핸들러 매핑)
    │   │   │   ├── new.ts
    │   │   │   ├── resume.ts
    │   │   │   ├── list.ts
    │   │   │   ├── abort.ts
    │   │   │   ├── retry.ts
    │   │   │   ├── fork.ts
    │   │   │   ├── share.ts
    │   │   │   ├── delete.ts
    │   │   │   ├── projects.ts
    │   │   │   ├── connect.ts
    │   │   │   ├── add.ts
    │   │   │   ├── remove.ts
    │   │   │   ├── status.ts
    │   │   │   ├── model.ts
    │   │   │   └── help.ts
    │   │   ├── rendering/
    │   │   │   ├── htmlRenderer.ts #     도메인 RenderPlan → Telegram HTML 변환
    │   │   │   ├── splitPlan.ts    #     스마트 분할 (코드블록 경계 보존)
    │   │   │   └── fileFallback.ts #     긴 응답 → .md 파일 첨부
    │   │   └── ui/
    │   │       ├── keyboards.ts    #     인라인 키보드 빌더 (permission/question)
    │   │       └── callbacks.ts    #     콜백 쿼리 파싱 → app 입력으로 변환
    │   │
    │   ├── opencode/
    │   │   ├── opencodeAdapter.ts  #   OpenCodePort 구현 (SDK v1+v2 → 도메인 타입 변환)
    │   │   ├── eventMapper.ts      #   SDK/SSE 이벤트 → 도메인 이벤트 매핑
    │   │   └── transport/
    │   │       └── sseClient.ts    #   undici Agent + 커스텀 fetch + SSE 파싱/재시도/abort/버퍼링
    │   │
    │   └── persistence/
    │       └── jsonStateStore.ts   #   StateStore 포트 구현 (atomic write + in-process lock)
    │
    ├── config/
    │   ├── env.ts                  #   환경변수 파싱/검증 (BOT_TOKEN, ALLOWED_USER_IDS 등)
    │   └── projects.ts             #   projects.json 파싱/검증 + allowlist
    │
    └── shared/
        ├── logger.ts               #   구조화된 로거 ([TELEGRAM], [OPENCODE], [SESSION] 등)
        └── constants.ts            #   앱 전역 상수
```

### 의존성 그래프 (모듈 간 import 관계)

```
main.ts ──────┬─→ config/*
              ├─→ domain/*
              ├─→ app/*
              └─→ adapters/*  (포트 ↔ 구현 바인딩)

adapters/telegram/* ──→ app/usecases/*  (usecase 호출)
                    ──→ domain/*        (타입 사용)

adapters/opencode/* ──→ domain/ports/*  (포트 구현)
                    ──→ domain/*        (타입 사용)
                    ✗→ grammy (금지)

adapters/persistence/* ──→ domain/ports/* (포트 구현)

app/usecases/* ──→ domain/ports/*  (포트 호출)
               ──→ domain/*        (타입 사용)
               ✗→ grammy, sdk, undici (금지)

domain/* ──→ (없음, 순수 TypeScript)
```

---

## 핵심 포트 (인터페이스)

### OpenCodePort

```typescript
interface OpenCodePort {
  // 세션 관리 (v1)
  createSession(directory: string, title: string): Promise<SessionRef>
  getSession(sessionId: string, directory: string): Promise<SessionRef | null>
  listSessions(directory: string): Promise<SessionRef[]>
  deleteSession(sessionId: string, directory: string): Promise<void>
  forkSession(sessionId: string, directory: string): Promise<SessionRef>
  shareSession(sessionId: string, directory: string): Promise<string>  // URL
  sendPrompt(sessionId: string, directory: string, text: string): Promise<AgentOutput>
  abortSession(sessionId: string, directory: string): Promise<void>

  // 이벤트 스트리밍 (v2)
  streamEvents(directory: string, handler: EventHandler, signal: AbortSignal): Promise<void>

  // 인터랙티브 응답 (v2)
  replyPermission(requestId: string, directory: string, response: 'once' | 'always' | 'reject'): Promise<void>
  replyQuestion(requestId: string, directory: string, answers: string[][]): Promise<void>
  rejectQuestion(requestId: string, directory: string): Promise<void>

  // 헬스체크
  healthCheck(): Promise<boolean>
}
```

### ChatOutputPort

```typescript
interface ChatOutputPort {
  sendText(chatId: number, text: string, parseMode?: string): Promise<OutputHandle>
  editText(chatId: number, handle: OutputHandle, text: string, parseMode?: string): Promise<void>
  sendFile(chatId: number, buffer: Buffer, filename: string, caption?: string): Promise<void>
  sendInteraction(chatId: number, text: string, buttons: Button[]): Promise<OutputHandle>
  sendTypingAction(chatId: number): Promise<void>
}

// OutputHandle은 opaque 타입 — app 레이어에서 Telegram messageId를 직접 다루지 않음
type OutputHandle = string

```

### StateStore

```typescript
interface StateStore {
  getChatState(chatId: number): Promise<ChatState>
  saveChatState(chatId: number, state: ChatState): Promise<void>
  withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T>
}
```

---

## Telegram 명령어 목록

### 세션 관리
| 명령어 | 설명 | 핸들러 파일 |
|--------|------|------------|
| `/new [제목]` | 새 세션 시작 | commands/new.ts |
| `/resume [번호]` | 세션 이어서 | commands/resume.ts |
| `/list` | 세션 목록 | commands/list.ts |
| `/abort` | 현재 작업 중단 | commands/abort.ts |
| `/retry` | 마지막 프롬프트 재실행 | commands/retry.ts |
| `/fork` | 세션 분기 | commands/fork.ts |
| `/share` | 공유 링크 | commands/share.ts |
| `/delete` | 세션 삭제 | commands/delete.ts |

### 프로젝트 관리
| 명령어 | 설명 | 핸들러 파일 |
|--------|------|------------|
| `/projects` | 프로젝트 목록 | commands/projects.ts |
| `/connect [번호]` | 프로젝트 전환 | commands/connect.ts |
| `/add [경로]` | 프로젝트 등록 | commands/add.ts |
| `/remove [번호]` | 프로젝트 제거 | commands/remove.ts |

### 유틸리티
| 명령어 | 설명 | 핸들러 파일 |
|--------|------|------------|
| `/status` | 현재 상태 | commands/status.ts |
| `/model [이름]` | 모델 변경 | commands/model.ts |
| `/help` | 도움말 | commands/help.ts |

### 일반 메시지
텍스트 입력 → `app/usecases/promptFlow.ts` → OpenCode에 프롬프트로 전달

---

## 응답 포맷 전략

### 포맷: HTML Parse Mode

```typescript
// HTML이 MarkdownV2보다 안전한 이유
// MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . ! 전부 이스케이프
// HTML: <, >, & 만 이스케이프 + 코드블록은 <pre><code> 태그
```

### 전송 전략 (하이브리드)

```
AI 응답 완료
  ├─ ≤3500자 → 단일 HTML 메시지
  │   └─ 코드 블록: <pre><code class="language-X">
  ├─ 3500~15000자 → 코드블록 보존하며 분할 전송 (최대 5개 메시지)
  │   └─ 코드블록 중간 분할 시: 닫고 다음 메시지에서 다시 열기
  └─ >15000자 → .md 파일 첨부 + 요약 메시지 (500자 이내)
```

### 왜 3500자? (4096이 아닌 이유)
- Telegram 한도: 4096자
- HTML 태그 오버헤드 + 이스케이핑으로 실제 컨텐츠 공간 감소
- 안전 마진 확보

### 실시간 피드백
```
사용자 메시지 수신
  → "⏳ 처리 중..." 메시지 전송 (ChatOutputPort.sendText)
  → typing 인디케이터 5초마다 갱신 (ChatOutputPort.sendTypingAction)
  → 응답 완료 시 "처리 중" 메시지를 결과로 교체 (ChatOutputPort.editText)
  → 결과가 길면 새 메시지/파일로 전송
```

### app에서 렌더링까지의 흐름

```
app/promptFlow.ts (SSE-first 전략)
  1. event.subscribe() 먼저 시작 (v2 클라이언트)
  2. SSE 이벤트를 chatQueue에 enqueue
  3. session.prompt() 호출 (작업 트리거, v1 클라이언트)
  4. 완료 판단: SSE 터미널 이벤트 또는 prompt() resolve 중 먼저 오는 것
  5. SSE 실패 시 → prompt() 결과로 fallback (non-streamed)
  → 도메인 AgentOutput 생성 (플랫폼 무관)
  → ChatOutputPort.sendText/sendFile 호출 (추상, OutputHandle 반환)

adapters/telegram/rendering/htmlRenderer.ts
  → AgentOutput → HTML 변환
  → splitPlan.ts로 분할 계획 생성
  → fileFallback.ts로 파일 첨부 판단
  → grammy API 호출 (구체적 Telegram 코드는 여기서만)
```

### 인터랙티브 플로우 (permission/question) 라운드트립

```
SSE "permission.asked" 이벤트 (v2)
  → eventMapper.ts → 도메인 PermissionAsked 이벤트
  → chatQueue에 enqueue
  → interactiveFlow.ts:
      1. ChatState에 { interactionId, sessionId, requestId, expiresAt } 저장
      2. ChatOutputPort.sendInteraction() 호출 (인라인 키보드)
  → 사용자 버튼 탭 → Telegram 콜백 쿼리
  → adapters/telegram/ui/callbacks.ts → interactionId 파싱
  → interactiveFlow.ts:
      1. ChatState에서 interaction 로드
      2. OpenCodePort.replyPermission(requestId, response) 호출
      3. 인터랙션 메시지 편집 ("승인됨" / "거부됨")

TTL/Watchdog:
  - 각 pending interaction에 expiresAt 설정 (기본 5분)
  - 세션 완료/연결 끊김 시 pending 상태 자동 정리
  - /abort는 항상 작동 (pending interaction 상태와 무관)
```

---

## SSE 안정화 (kimaki에서 배운 교훈)

### 필수 적용 사항 (adapters/opencode/transport/sseClient.ts)

| 이슈 | 해결책 | 출처 |
|------|--------|------|
| 커넥션 풀 확장 | `BUN_CONFIG_MAX_HTTP_REQUESTS=500` 환경변수 (Bun 기본 256개) | Bun 소스코드 검증 |
| SSE 스트림 끊김 | Bun 네이티브 fetch (별도 timeout 설정 불필요) | Bun docs |
| 불완전한 파트 전송 | 파트 버퍼링 (완료 시만 flush) | kimaki session-handler.ts |
| 스트림만 abort | 이중 abort (AbortController + API abort) | kimaki session-handler.ts |
| 서버 크래시 | 자동 재시작 (최대 5회, 백오프) | kimaki opencode.ts |
| 이벤트 핸들러 경합 | per-session 직렬화 (chatQueue.ts) | kimaki session-handler.ts |
| 권한 중복 요청 | directory+permission+pattern 키로 중복 제거 | kimaki session-handler.ts |
| 설정 파일 I/O | OPENCODE_CONFIG_CONTENT 환경변수로 주입 | kimaki opencode.ts |

### 레이스 컨디션 방어

| 시나리오 | 방어 |
|----------|------|
| /abort 중 SSE가 계속 토큰 방출 | 세션 상태머신 + idempotent abort |
| 새 메시지 도착 중 이전 응답 진행 중 | chatQueue.ts가 직렬화 보장 |
| 재시작 시 부분 출력 중복 | (sessionId, eventId) 키로 중복 제거 |
| 프로젝트 전환 중 스트림 진행 중 | 전환 전 기존 스트림 abort 후 전환 |

### 크래시 복구

```
봇 재시작 시:
  → 모든 ChatState 로드
  → pendingQuestion/pendingPermission이 있으면 "stale" 마킹
  → 사용자에게 /resume 또는 /retry 안내
  → 자동 스트림 재개 하지 않음 (중복 방지)
```

---

## 기술 스택

| 구분 | 선택 | 이유 |
|------|------|------|
| Runtime | Bun | 빠름, TypeScript 네이티브 |
| Telegram | grammy | 최신, TypeScript 지원, Bun 호환 확인됨 |
| OpenCode | @opencode-ai/sdk (v1 + /v2) | 공식 SDK. v1=세션관리, v2=이벤트+권한/질문 API (필수) |
| 상태 저장 | JSON 파일 (→ SQLite 전환 가능) | 심플, StateStore 포트로 추상화 |
| 에러 처리 | 커스텀 tagged errors (domain/errors.ts) | 외부 의존성 없이 구현 |

### undici 불필요 (검증 완료)

`undici.setGlobalDispatcher()`는 Bun에서 **NO-OP 스텁**임이 소스코드에서 확인됨.
Bun은 자체 HTTP 클라이언트를 사용하며 undici의 fetch를 무시함.
대신 `BUN_CONFIG_MAX_HTTP_REQUESTS=500` 환경변수로 커넥션 풀 확장.

### Bun SSE 주의사항

- Bun v1.1.26/v1.1.27에서 SSE 8초 후 연결 끊김 리그레션 보고 (GitHub #13811)
- 최신 안정 버전 사용 권장, SSE 연결 끊김 시 재연결 로직 필수

---

## 구현 순서 (Phase)

### Phase 1: 기반 + MVP
- [ ] 프로젝트 스캐폴딩 (디렉토리 구조 생성)
- [ ] domain/ 타입 + 포트 정의
- [ ] config/ 환경변수 + 프로젝트 파싱
- [ ] adapters/persistence/ JSON 상태 저장소 (atomic write + lock)
- [ ] adapters/opencode/ SDK 연결 + SSE 안정화 (커넥션 풀, 타임아웃, 버퍼링)
- [ ] adapters/telegram/ grammy 초기화 + auth 미들웨어
- [ ] app/usecases/promptFlow.ts — 메시지 → 프롬프트 → 응답 (plain text)
- [ ] app/usecases/sessionCommands.ts — /new, /list, /resume, /abort
- [ ] app/usecases/interactiveFlow.ts — permission.asked / question.asked
- [ ] app/queue/chatQueue.ts — per-chat 직렬화
- [ ] typing 인디케이터 + "처리 중" 메시지
- [ ] main.ts 조립 + 기본 에러 핸들링

### Phase 2: 출력 파이프라인
- [ ] adapters/telegram/rendering/htmlRenderer.ts — HTML 포맷팅
- [ ] adapters/telegram/rendering/splitPlan.ts — 스마트 분할
- [ ] adapters/telegram/rendering/fileFallback.ts — .md 파일 첨부
- [ ] "처리 중" → 결과 교체 (editMessageText)

### Phase 3: 멀티 프로젝트
- [ ] app/usecases/projectCommands.ts — /projects, /connect, /add, /remove
- [ ] directory allowlist + 경로 정규화 (보안)
- [ ] 프로젝트 전환 시 기존 스트림 정리

### Phase 4: 고급 기능
- [ ] /fork, /share, /delete, /retry, /model, /status
- [ ] 파일 첨부 (이미지 → OpenCode 전달)
- [ ] 서버 자동 재시작 (크래시 복구)
- [ ] 크래시 후 stale 상태 복구 안내

---

## 보안

- `ALLOWED_USER_IDS`: auth 미들웨어에서 체크 (adapters/telegram/authMiddleware.ts)
- `OPENCODE_SERVER_PASSWORD`: HTTP Basic Auth (adapters/opencode/opencodeAdapter.ts)
- `.env` 파일은 절대 git에 포함하지 않음
- directory allowlist: `..`, symlink escape 방지, 등록된 경로만 허용 (app/usecases/projectCommands.ts)
- OPENCODE_CONFIG_CONTENT로 permission 사전 설정 (adapters/opencode/)
- 상태 파일 (data/state.json) git 제외

---

## 빠른 시작

### 사전 요구사항
- [Bun](https://bun.sh) 설치
- [OpenCode](https://opencode.ai) 설치 + `opencode serve` 실행 가능
- Telegram Bot Token ([BotFather](https://t.me/BotFather)에서 발급)

### 설치

```bash
git clone https://github.com/nosky/opencaddy.git
cd opencaddy
bun install
cp .env.example .env
```

### 설정

`.env` 파일 편집:
```bash
BOT_TOKEN=your-telegram-bot-token
ALLOWED_USER_IDS=123456789          # 본인 Telegram ID
DEFAULT_PROJECT=/path/to/your/project
OPENCODE_SERVER_URL=http://127.0.0.1:4096
OPENCODE_SERVER_PASSWORD=            # 선택사항
```

### 실행

```bash
# 1. OpenCode 서버 시작 (별도 터미널)
cd /path/to/your/project
opencode serve --port 4096

# 2. OpenCaddy 봇 시작
bun run start
# 또는 개발 모드 (핫 리로드)
bun run dev
```

### Telegram에서 사용
1. BotFather에서 만든 봇에게 메시지 전송
2. `/help`로 명령어 확인
3. 텍스트 입력하면 OpenCode에 전달됨

---

## 오픈소스 기여 가이드

### 새 명령어 추가하기
1. `src/adapters/telegram/commands/mycommand.ts` 생성
2. `commands/index.ts` 라우팅 테이블에 등록
3. 필요하면 `src/app/usecases/`에 비즈니스 로직 추가
4. `domain/`에 필요한 타입/포트 추가

### 렌더링 버그 수정하기
→ `src/adapters/telegram/rendering/` 디렉토리

### OpenCode 연동 이슈
→ `src/adapters/opencode/` 디렉토리

### 상태 관리 이슈
→ `src/adapters/persistence/` + `src/domain/ports/StateStore.ts`

---

## 참고 프로젝트

- [kimaki](https://github.com/remorses/kimaki) — Discord 버전. SSE 안정화, 파트 버퍼링 등 핵심 패턴 참고
- [OpenCode SDK](https://opencode.ai/docs/sdk/) — 공식 SDK 문서
- [OpenCode Server](https://opencode.ai/docs/server/) — 서버 API 문서
- [grammy](https://grammy.dev) — Telegram Bot 프레임워크
- [n3d1117/chatgpt-telegram-bot](https://github.com/n3d1117/chatgpt-telegram-bot) — 스트리밍 응답 패턴 참고

---

## kimaki에서 배운 핵심 교훈

1. **SSE 커넥션 풀 데드락**: kimaki는 undici Agent 500개로 해결. Bun에서는 `BUN_CONFIG_MAX_HTTP_REQUESTS=500` 환경변수로 대응 (undici는 Bun에서 NO-OP)
2. **SDK v1 + v2 필수 병용**: v1에는 `permission.asked`/`question.asked` 이벤트가 없음 → v2 필수 → opencode adapter에서 추상화
3. **fetch 타임아웃 비활성화**: SSE 장시간 스트림이 기본 타임아웃에 끊김
4. **이중 abort**: AbortController만으로는 서버측 처리가 계속됨 → API abort도 호출
5. **파트 버퍼링**: 불완전한 파트를 바로 전송하면 깨진 메시지 → 완료 시만 flush
6. **OPENCODE_CONFIG_CONTENT**: 설정 파일 없이 환경변수로 주입 가능
7. **자동 재시작 + 상한**: 5회 초과 크래시 시 포기 (무한 재시작 방지)
8. **권한 중복 제거**: 같은 권한을 여러 번 요청하면 UX 스팸 → 키 기반 중복 제거

---

## 확장 트리거 (현재 설계를 넘어서야 할 때)

| 상황 | 조치 |
|------|------|
| 멀티 프로세스 필요 | StateStore를 SQLite로 교체 (포트 동일) |
| 프로젝트 격리 필요 | OpenCodePort 뒤에서 멀티서버 모드 추가 |
| 크래시 후 정확한 스트림 재개 | 이벤트 시퀀스 ID + 체크포인트 프로토콜 필요 |
| Telegram 외 플랫폼 | ChatOutputPort 새 어댑터 추가 (Discord, Slack 등) |
