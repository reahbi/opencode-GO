# Claude-Go 프로젝트 상세 분석

## 1. 프로젝트 개요

**Claude-Go**는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) AI 코딩 에이전트를 Telegram을 통해 원격 제어하는 봇이다. 버스, 카페, 침대 등 어디서든 스마트폰으로 AI에게 코드 작성을 지시하고 실시간 결과를 받을 수 있다.

**기술 스택**: Bun + TypeScript (strict) + grammy + @anthropic-ai/claude-agent-sdk
**아키텍처**: Clean Architecture (Hexagonal / Ports & Adapters)
**버전**: v0.2.0 / **라이선스**: MIT

### 시스템 구조

```
[Telegram] <-> [Claude-Go Bot (Bun) + Claude Agent SDK (임베드)]  <-> [프로젝트 코드]
```

단일 프로세스로 실행된다. Agent SDK의 `query()` AsyncGenerator가 봇 프로세스 안에서 직접 Claude Code를 호출한다.

---

## 2. 핵심 기능

### 2.1 실시간 스트리밍
Agent SDK의 `query()` AsyncGenerator 기반으로 AI 응답을 실시간 수신한다. 폴링 없이 즉각적인 응답을 제공하며, 1초 간격 쓰로틀링으로 Telegram 메시지를 라이브 업데이트한다.

### 2.2 인터랙티브 질문 시스템
AI가 질문을 할 때(AskUserQuestion 도구 감지), Telegram 인라인 키보드로 즉시 응답 가능하다.
- **질문 응답**: 선택지 버튼, 직접 입력, 멀티셀렉트(체크박스 UI) 지원
- **TTL**: 10분 경과 시 만료
- **권한 모드**: `plan` / `ask` / `bypass` 전환 지원 (`/plan`, `/ask`, `/bypass`, `/settings`)
- **ask 정책**: 승인 프롬프트와 release-gate는 Claude Code SDK 런타임 기본 정책을 따르며, 별도 텔레그램 커스텀 승인 플로우는 없음

### 2.3 스마트 전달 (Smart Delivery)
응답 길이에 따라 자동으로 전달 방식을 결정한다:
- **3,500자 이하**: 인라인 메시지로 직접 표시
- **3,500~15,000자**: 여러 메시지로 분할 (최대 5개)
- **15,000자 초과**: `.md` 파일로 전송

### 2.4 AI 요약
긴 응답을 Claude CLI 서브프로세스(`claude -p`)로 자동 요약한다. 별도 API 키 불필요.
- **트리거 기준**: 3,000자 이상 (사용자 조정 가능, 최소 2,000자)
- **요약 출력 목표**: 2,000자
- **HTML 하드캡**: 3,200자 (Telegram 4,096자 제한 대비)

### 2.5 음성 응답 (Voice TTS)
AI 응답을 음성으로 변환하여 오디오 파일로 제공한다. Edge TTS 엔진 사용.
- **지원 언어**: 한국어/영어
- **음성 선택**: 여성(SunHiNeural) / 남성(InJoonNeural)
- **속도 조절**: 1.0x, 1.25x, 1.5x, 2.0x
- **요약 길이**: 500/800/1,200/2,000자 중 선택
- **자동 모드**: 200자 이상 응답 시 자동 음성 생성

### 2.6 음성 입력 (Whisper STT)
Telegram 음성 메시지를 텍스트로 변환하여 AI 프롬프트로 전달. OpenAI Whisper API 사용.

### 2.7 세션 관리
- `/new [title]` — 새 AI 세션 생성
- `/list` — 페이지네이션이 적용된 세션 목록
- `/resume [n]` — 이전 세션 재개, 진행 중인 작업 자동 감지 및 실시간 진행 표시
- `/abort` — 현재 작업 중단
- `/history` — HTML/Markdown 형식으로 대화 히스토리 내보내기

### 2.8 메시지 큐와 Undo/Redo
- `/queue [msg]` — AI가 바쁠 때 메시지를 대기열에 추가 (최대 5개, 10,000자)
- `/undo` / `/redo` — AI 마지막 응답 되돌리기/재실행

### 2.9 Git 상태
`/git` 명령어로 브랜치, 상태, 최근 커밋을 한눈에 확인. 인라인 버튼으로 diff, log 조회.

### 2.10 에이전트/모델 전환
`/agents` 명령어로 사용 가능한 AI 에이전트 목록을 확인하고 실시간 전환. `/makeagent`로 커스텀 에이전트 생성.

### 2.11 이미지 지원
Telegram에서 직접 사진 전송 가능. 에러 스크린샷, UI 목업, 다이어그램 등을 AI가 분석.

### 2.12 비활동 감지
30분간 세션 비활동 시 경고 알림. 5분 간격으로 체크.

### 2.13 Cloudflared 터널
`/tunnel` 명령어로 로컬 서버를 외부에 공개하는 터널 생성. 채팅별 서브프로세스 관리, 종료 시 자동 정리.

### 2.14 Extended Thinking
키워드 감지('think', '분석', 'deep')로 자동 활성화. AI의 사고 과정을 "💭 Thinking..." 메시지로 표시.

### 2.15 비용 추적
세션별 토큰 사용량과 비용을 추적. `/status`에서 확인 가능. `maxBudgetUsd`로 세션당 최대 비용 설정 가능.

### 2.16 Rate Limiting
grammy 미들웨어 기반 토큰 버킷으로 사용자당 요청 빈도 제한.

---

## 3. 멀티봇 시스템

### 3.1 봇 역할
| 역할 | 설명 |
|------|------|
| `standalone` | 독립 실행 (기본값) |
| `writer` | 코드 작성 담당 |
| `reader` | 코드 리뷰/읽기 전용 담당 |

### 3.2 그룹 채팅
- `GROUP_CHAT_ENABLED=true`로 활성화
- 그룹 내 `@mention`으로 특정 봇에 명령
- 질문 버튼은 요청자만 누를 수 있음

### 3.3 봇 간 협업 (실험 기능)
- `/debate [topic]` — Writer/Reader 봇 간 토론 세션
- `/review [target]` — 피어 봇에게 코드 리뷰 요청
- 파일 시스템 기반 Coordination으로 봇 간 이벤트 교환
- 토론 라운드 수 설정 가능 (기본 6라운드, `/groupsettings`에서 변경)

### 3.4 봇 레지스트리
- 60초 간격 하트비트로 온라인 상태 추적
- 3분 미응답 시 stale 처리
- `/bots`로 등록된 봇 상태 확인
- `/addbot` — 텔레그램 내 대화형 봇 추가 마법사

### 3.5 PM2 배포
`ecosystem.config.cjs`로 여러 봇 인스턴스를 동시에 관리:
```bash
pm2 start ecosystem.config.cjs   # 전체 시작
pm2 logs                          # 로그 확인
pm2 stop all                      # 전체 중지
```

---

## 4. 환경 변수 및 설정

### 4.1 필수 환경 변수
| 변수 | 설명 |
|------|------|
| `BOT_TOKEN` | @BotFather에서 발급받은 봇 토큰 |
| `ALLOWED_USER_IDS` | 허용된 Telegram 유저 ID (쉼표 구분) |
| `DEFAULT_PROJECT` | AI가 작업할 프로젝트 디렉토리 (절대 경로) |

### 4.2 선택 환경 변수
| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CLAUDE_MODEL` | `claude-sonnet-4-5` | AI 모델 |
| `CLAUDE_CODE_PATH` | _(자동 감지)_ | Claude Code CLI 경로 |
| `MAX_THINKING_TOKENS` | `0` | Extended Thinking 토큰 수 |
| `MAX_BUDGET_USD` | _(없음)_ | 세션당 최대 비용 |
| `OPENAI_API_KEY` | _(없음)_ | Whisper STT용 |
| `INSTANCE_NAME` | 프로젝트 디렉토리명 | 봇 인스턴스 식별자 |
| `STATE_DIR` | `data/` | 상태 파일 저장 경로 |
| `BOT_ROLE` | `standalone` | 봇 역할 |
| `GROUP_CHAT_ENABLED` | `false` | 그룹 채팅 지원 |
| `COORDINATION_DIR` | _(없음)_ | 봇 간 조정 공유 디렉토리 |
| `DEFAULT_AGENT` | _(없음)_ | 기본 AI 에이전트 |
| `DEFAULT_CUSTOM_AGENT` | _(없음)_ | 기본 커스텀 에이전트 |
| `DEBUG` | _(없음)_ | truthy 시 디버그 로그 활성화 |

### 4.3 사용자 설정 (`/settings`)
Telegram 인라인 키보드로 실시간 변경 가능한 항목:

**에이전트 & 모드**
- AI 에이전트 선택 및 전환
- Review Mode 토글 (읽기 전용 모드)

**커스텀 에이전트**
- `/makeagent`로 생성한 커스텀 에이전트 선택

**요약 설정**
- 요약 ON/OFF 토글 (기본: ON)
- 요약 모델 선택 (Claude CLI로 생성)
- 트리거 임계값 설정 (기본: 3,000자)
- 전문성 수준: 바이브 코더 / 개발자 / 입문자

**출력 설정**
- 포맷 모드: Formatted / Raw

**히스토리 내보내기**
- 파일 형식: HTML / Markdown (기본: HTML)
- 포함 범위: 전체 / 최근 N개 메시지

**음성 설정**
- 음성 ON/OFF, 자동 모드 ON/OFF
- 언어: 한국어/영어
- 요약 길이: 500/800/1,200/2,000자
- 재생 속도: 1.0x ~ 2.0x
- 음성 성별: 여성/남성

---

## 5. 아키텍처

### 5.1 계층 구조
```
domain/   → 순수 타입 + 포트 인터페이스 (외부 의존성 ZERO)
app/      → 유즈케이스 (domain/만 import)
adapters/ → 외부 세계 구현체 (Telegram, Claude Agent SDK, JSON 저장소, Whisper)
config/   → 환경 설정 파싱
shared/   → 로거, 포매터, 상수
main.ts   → Composition Root (DI 조립)
```

**절대 금지**: `domain/`이나 `app/`에서 grammy, SDK 등 외부 패키지 import

### 5.2 주요 유즈케이스
| 유즈케이스 | 역할 |
|-----------|------|
| `promptFlow` | 텍스트 → query() AsyncGenerator → 쓰로틀링 편집 → 전달 |
| `sessionCommands` | 세션 CRUD + 히스토리 내보내기 |
| `interactiveFlow` | 질문 라운드트립 (AskUserQuestion 도구 감지) |
| `sessionWatcher` | query 상태 추적 + 라이브 메시지 업데이트 + 비활동 감지 |
| `completionWatcher` | 훅 봇 세션 모니터링 + 정체 감지 |
| `debateFlow` | 봇 간 토론/리뷰 조정 |
| `tunnelManager` | cloudflared 서브프로세스 관리 |
| `voiceFlow` | 음성 TTS 응답 생성 |

### 5.3 상태 관리
- JSON 파일 기반 영속화 (`jsonStateStore`, `jsonSessionStore`)
- 원자적 쓰기 (tmp 파일 + rename)
- 채팅별 인프로세스 잠금 + 전역 파일 잠금
- 상태 마이그레이션으로 하위 호환성 유지

---

## 6. CLI 도구

| 명령어 | 설명 |
|--------|------|
| `bun run setup` | 대화형 설정 마법사 (3가지 질문으로 `.env` 생성) |
| `bun run doctor` | 자동 진단 (환경 변수, Claude Code CLI, 봇 토큰 등) |
| `bun run dev` | 개발 모드 (핫 리로드) |
| `bun run start` | 프로덕션 실행 |
| `bun run hook` | 훅 봇 실행 |
| `bun run typecheck` | TypeScript 타입 체크만 |
| `bun run build` | `dist/`로 빌드 |
| `bun test` | 전체 테스트 실행 (bun:test, 340+ 테스트) |

---

## 7. 내부 정책 상수

| 상수 | 값 | 설명 |
|------|---|------|
| `MAX_MESSAGE_LENGTH` | 3,500자 | 단일 Telegram 메시지 한계 |
| `FILE_FALLBACK_THRESHOLD` | 15,000자 | 파일 전환 기준 |
| `INTERACTION_TTL_MS` | 10분 | 질문 만료 시간 |
| `MAX_QUEUED_MESSAGES` | 5개 | 채팅당 최대 대기 메시지 |
| `INACTIVITY_WARNING_MS` | 30분 | 비활동 경고 기준 |
| `VOICE_HISTORY_MAX` | 50개 | 채팅당 음성 응답 보관 한도 |
| `VOICE_HISTORY_TTL_MS` | 24시간 | 음성 응답 TTL |
| `REGISTRY_HEARTBEAT_INTERVAL_MS` | 60초 | 봇 하트비트 간격 |
| `REGISTRY_STALE_THRESHOLD_MS` | 3분 | 봇 stale 판정 기준 |
| `MAX_DEBATE_ROUNDS` | 6라운드 | 단일 토론 최대 라운드 |

---

## 8. 전체 명령어 목록

| 명령어 | 설명 |
|--------|------|
| `/start` | 온보딩 + 상태 확인 |
| `/new [title]` | 새 AI 세션 생성 |
| `/list` | 세션 목록 (페이지네이션) |
| `/resume [n]` | 세션 재개 |
| `/abort` | 현재 작업 중단 |
| `/history` | 세션 히스토리 내보내기 |
| `/queue [msg]` | 메시지 대기열 추가 |
| `/clearqueue` | 대기열 초기화 |
| `/showqueue` | 대기열 상태 확인 |
| `/undo` / `/redo` | AI 응답 되돌리기/재실행 |
| `/status` | 현재 상태 확인 |
| `/git` | Git 상태, diff, log |
| `/agents` | AI 에이전트 선택 |
| `/plan` | 권한 모드를 `plan`으로 전환 |
| `/ask` | 권한 모드를 `ask`로 전환 |
| `/bypass` | 권한 모드를 `bypass`로 전환 |
| `/makeagent` | 커스텀 에이전트 생성 마법사 |
| `/settings` | 봇 설정 |
| `/groupsettings` | 그룹 공유 설정 |
| `/debate [topic]` | 봇 간 토론 시작 |
| `/review [target]` | 코드 리뷰 요청 |
| `/bots` | 등록된 봇 상태 |
| `/addbot` | 봇 추가 마법사 (DM 전용) |
| `/addhookbot` | 훅 봇 설정 마법사 (DM 전용) |
| `/tunnel` | cloudflared 터널 생성 |
| `/cancel` | 진행 중인 마법사 취소 |
| `/help` | 도움말 |

일반 텍스트 메시지는 현재 세션의 AI에게 프롬프트로 전달된다.
