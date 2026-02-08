# OpenCode-Go 프로젝트 상세 분석

## 1. 프로젝트 개요

**OpenCode-Go**는 서버에서 실행 중인 [OpenCode](https://github.com/sst/opencode) AI 코딩 에이전트를 Telegram을 통해 원격 제어하는 봇이다. 버스, 카페, 침대 등 어디서든 스마트폰으로 AI에게 코드 작성을 지시하고 실시간 결과를 받을 수 있다.

**기술 스택**: Bun + TypeScript (strict) + grammy + @opencode-ai/sdk  
**아키텍처**: Clean Architecture (Hexagonal / Ports & Adapters)  
**버전**: v0.1.0 / **라이선스**: MIT

### 시스템 구조

```
[Telegram] <-> [OpenCode-Go Bot (Bun)] <-SSE/REST-> [OpenCode Server] <-> [프로젝트 코드]
```

두 개의 독립 프로세스가 동시에 실행되어야 한다:
1. **OpenCode Server** — AI 코딩 에이전트 백엔드 (`opencode serve --port 4096`)
2. **OpenCode-Go Bot** — Telegram 인터페이스 프론트엔드 (`bun run start`)

---

## 2. 핵심 기능

### 2.1 실시간 스트리밍
SSE(Server-Sent Events) 기반으로 AI 응답을 실시간 수신한다. 폴링 없이 즉각적인 응답을 제공하며, 1초 간격 쓰로틀링으로 Telegram 메시지를 라이브 업데이트한다.

### 2.2 인터랙티브 권한/질문 시스템
AI가 파일 수정 권한을 요청하거나 질문을 할 때, Telegram 인라인 키보드로 즉시 응답 가능하다.
- **권한 응답**: `once` (1회), `always` (항상 허용), `reject` (거부)
- **질문 응답**: 선택지 버튼, 직접 입력, 멀티셀렉트(체크박스 UI) 지원
- **TTL**: 10분 경과 시 만료

### 2.3 스마트 전달 (Smart Delivery)
응답 길이에 따라 자동으로 전달 방식을 결정한다:
- **3,500자 이하**: 인라인 메시지로 직접 표시
- **3,500~15,000자**: 여러 메시지로 분할 (최대 5개)
- **15,000자 초과**: `.md` 파일로 전송

### 2.4 AI 요약
긴 응답을 경량 모델(기본: Google Gemini 3 Flash)로 자동 요약한다.
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

### 2.6 세션 관리
- `/new [title]` — 새 AI 세션 생성
- `/list` — 페이지네이션이 적용된 세션 목록
- `/resume [n]` — 이전 세션 재개, 진행 중인 작업 자동 감지 및 실시간 진행 표시
- `/abort` — 현재 작업 중단
- `/history` — HTML/Markdown 형식으로 대화 히스토리 내보내기

### 2.7 메시지 큐와 Undo/Redo
- `/queue [msg]` — AI가 바쁠 때 메시지를 대기열에 추가 (최대 5개, 10,000자)
- `/undo` / `/redo` — AI 마지막 응답 되돌리기/재실행

### 2.8 Git 상태
`/git` 명령어로 브랜치, 상태, 최근 커밋을 한눈에 확인. 인라인 버튼으로 diff, log 조회.

### 2.9 에이전트/모델 전환
`/agents` 명령어로 사용 가능한 AI 에이전트 목록을 확인하고 실시간 전환.

### 2.10 이미지 지원
Telegram에서 직접 사진 전송 가능. 에러 스크린샷, UI 목업, 다이어그램 등을 AI가 분석.

### 2.11 비활동 감지
30분간 세션 비활동 시 경고 알림. 5분 간격으로 체크.

### 2.12 Cloudflared 터널
`/tunnel` 명령어로 로컬 서버를 외부에 공개하는 터널 생성. 채팅별 서브프로세스 관리, 종료 시 자동 정리.

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
- 권한 버튼은 요청자만 누를 수 있음

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
| `OPENCODE_SERVER_URL` | `http://127.0.0.1:4096` | 서버 주소 |
| `OPENCODE_SERVER_USERNAME` | `opencode` | 서버 인증 사용자명 |
| `OPENCODE_SERVER_PASSWORD` | _(없음)_ | 서버 인증 비밀번호 |
| `INSTANCE_NAME` | 프로젝트 디렉토리명 | 봇 인스턴스 식별자 |
| `STATE_DIR` | `data/` | 상태 파일 저장 경로 |
| `BOT_ROLE` | `standalone` | 봇 역할 |
| `GROUP_CHAT_ENABLED` | `false` | 그룹 채팅 지원 |
| `COORDINATION_DIR` | _(없음)_ | 봇 간 조정 공유 디렉토리 |
| `DEFAULT_AGENT` | _(없음)_ | 기본 AI 에이전트 |
| `DEBUG` | _(없음)_ | truthy 시 디버그 로그 활성화 |

### 4.3 사용자 설정 (`/settings`)
Telegram 인라인 키보드로 실시간 변경 가능한 항목:

**에이전트 & 모드**
- AI 에이전트 선택 및 전환
- Review Mode 토글 (읽기 전용 모드)

**요약 설정**
- 요약 ON/OFF 토글 (기본: ON)
- 요약 모델 선택 (기본: Gemini 3 Flash)
- 트리거 임계값 설정 (기본: 3,000자)

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
adapters/ → 외부 세계 구현체 (Telegram, OpenCode SDK, JSON 저장소)
config/   → 환경 설정 파싱
shared/   → 로거, 포매터, 상수
main.ts   → Composition Root (DI 조립)
```

**절대 금지**: `domain/`이나 `app/`에서 grammy, SDK 등 외부 패키지 import

### 5.2 주요 유즈케이스
| 유즈케이스 | 역할 |
|-----------|------|
| `promptFlow` | 텍스트 → SSE 스트림 → 쓰로틀링 편집 → 전달 |
| `sessionCommands` | 세션 CRUD + 히스토리 내보내기 |
| `interactiveFlow` | 권한/질문 라운드트립 |
| `sessionWatcher` | SSE 감시 + 라이브 메시지 업데이트 + 비활동 감지 |
| `debateFlow` | 봇 간 토론/리뷰 조정 |
| `tunnelManager` | cloudflared 서브프로세스 관리 |
| `voiceFlow` | 음성 TTS 응답 생성 |

### 5.3 상태 관리
- JSON 파일 기반 영속화 (`jsonStateStore`)
- 원자적 쓰기 (tmp 파일 + rename)
- 채팅별 인프로세스 잠금 + 전역 파일 잠금
- 상태 마이그레이션으로 하위 호환성 유지

---

## 6. CLI 도구

| 명령어 | 설명 |
|--------|------|
| `bun run setup` | 대화형 설정 마법사 (4가지 질문으로 `.env` 생성) |
| `bun run doctor` | 6개 항목 자동 진단 (환경 변수, 서버 연결, 봇 토큰 등) |
| `bun run dev` | 개발 모드 (핫 리로드) |
| `bun run start` | 프로덕션 실행 |
| `bun run typecheck` | TypeScript 타입 체크만 |
| `bun run build` | `dist/`로 빌드 |
| `bun test` | 전체 테스트 실행 (bun:test, 16개 파일 280+ 테스트) |

---

## 7. 내부 정책 상수

| 상수 | 값 | 설명 |
|------|---|------|
| `MAX_MESSAGE_LENGTH` | 3,500자 | 단일 Telegram 메시지 한계 |
| `FILE_FALLBACK_THRESHOLD` | 15,000자 | 파일 전환 기준 |
| `INTERACTION_TTL_MS` | 10분 | 권한/질문 만료 시간 |
| `MAX_QUEUED_MESSAGES` | 5개 | 채팅당 최대 대기 메시지 |
| `INACTIVITY_WARNING_MS` | 30분 | 비활동 경고 기준 |
| `VOICE_HISTORY_MAX` | 50개 | 채팅당 음성 응답 보관 한도 |
| `VOICE_HISTORY_TTL_MS` | 24시간 | 음성 응답 TTL |
| `REGISTRY_HEARTBEAT_INTERVAL_MS` | 60초 | 봇 하트비트 간격 |
| `REGISTRY_STALE_THRESHOLD_MS` | 3분 | 봇 stale 판정 기준 |
| `MAX_DEBATE_ROUNDS` | 6라운드 | 단일 토론 최대 라운드 |
| `SSE_TIMEOUT` | 24시간 | SSE 스트리밍 타임아웃 |

---

## 8. 전체 명령어 목록

| 명령어 | 설명 |
|--------|------|
| `/start` | 온보딩 + 서버 상태 확인 |
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
| `/settings` | 봇 설정 |
| `/groupsettings` | 그룹 공유 설정 |
| `/debate [topic]` | 봇 간 토론 시작 |
| `/review [target]` | 코드 리뷰 요청 |
| `/bots` | 등록된 봇 상태 |
| `/addbot` | 봇 추가 마법사 (DM 전용) |
| `/tunnel` | cloudflared 터널 생성 |
| `/cancel` | 진행 중인 마법사 취소 |
| `/help` | 도움말 |

일반 텍스트 메시지는 현재 세션의 AI에게 프롬프트로 전달된다.
