# HookBot Improvement Plan

**Created:** 2026-02-08
**Status:** Oracle validated (2026-02-08)

## Overview

HookBot의 알림 과다, 제한적 question 처리, 컴퓨터 세션 추적 실패를 해결하는 종합 개선 계획.

**핵심 철학**: HookBot은 "주의가 필요한 이벤트"만 알림. 과거 세션은 추적 불필요, 새로 생기는 세션을 확실히 잡는 것이 중요.

---

## Phase 1: 제거 (불필요한 것 걷어내기)

### 1A. Backfill 전체 제거

**이유**: 꺼져있을 때 놓친 세션은 추적 불필요. 새 세션만 잘 잡으면 충분.

| 제거 대상 | 파일 | 라인 |
|-----------|------|------|
| `BackfillStateV1` 타입 | `hookBot.ts` | 89-92 |
| `createEmptyBackfillState()` | `hookBot.ts` | 94-96 |
| `atomicWriteJson()` | `hookBot.ts` | 98-102 |
| `loadBackfillState()` | `hookBot.ts` | 104-117 |
| `formatBackfillMarkdown()` | `hookBot.ts` | 119-142 |
| `sendBackfillOnce()` | `hookBot.ts` | 144-213 |
| backfillStatePath + 호출 | `hookBot.ts` | 261-262 |
| `InputFile` import (backfill 전용) | `hookBot.ts` | 3 |
| `SessionStatus` import (backfill 전용) | `hookBot.ts` | 13 |

**삭제량**: ~130줄
**파일 삭제**: `data/hookbot-backfill.json` (더 이상 생성/관리하지 않음)

### 1B. Discovery 폴링 제거 → 시작 시 1회 + 수동 `/scan`

**이유**: 5초마다 2-3 HTTP 호출 (하루 ~17,000회)은 과도. 시작 시 발견 + 필요 시 수동 스캔이면 충분.

| 항목 | 상세 |
|------|------|
| **제거** | `hookBot.ts:266-288` — `refreshTimer` + `setInterval(5000)` 폴링 루프 |
| **제거** | `hookBot.ts:298-303` — shutdown에서 `refreshTimer` 정리 코드 |
| **유지** | `hookBot.ts:237-246` — 시작 시 1회 `discoverProjectsFromServer()` |
| **추가** | `hookBotAdapter.ts`에 `/scan` 명령어 등록 |
| **추가** | `/settings` 키보드에 "🔍 Scan Projects" 버튼 (`hbs:scan` 콜백) |

#### `/scan` 구현 세부

```
/scan 또는 hbs:scan 버튼 →
  1. discoverProjectsFromServer(config, currentProjects) 호출
  2. 기존 목록과 diff
  3. 새 프로젝트 있으면 → watcher.startWatching(newlyFound)
  4. 텔레그램에 결과 보고:
     - 새 거 있음: "🔍 Found N new project(s): {names}. Now monitoring {total}."
     - 새 거 없음: "✅ All projects already monitored ({total} total)."
```

**의존성 변경**: `registerHookBotHandlers()`에 watcher 인스턴스와 discover 함수를 추가 파라미터로 전달해야 함.

현재:
```typescript
registerHookBotHandlers(bot, openCode, config)
```

변경 후:
```typescript
registerHookBotHandlers(bot, openCode, config, {
  watcher,
  discoverProjects: () => discoverProjectsFromServer(config, projects),
  projects,  // mutable array reference
})
```

### 1C. `assistant.reply` 알림 제거

**이유**: completion(마지막 메시지 preview 포함) + 매 턴 assistant.reply = 중복. 세션당 10-30개의 풀 메시지가 쏟아지는 것은 noise.

| 제거 대상 | 파일 | 라인 | 설명 |
|-----------|------|------|------|
| assistant.reply 발송 (실시간) | `completionWatcher.ts` | 200-217 | `message.part.updated` 시 finished assistant 응답 전송 |
| assistant.reply 발송 (idle) | `completionWatcher.ts` | 74-87 | `fetchAndNotifyCompletion()` 안에서 추가 전송 |
| `messageRoles` Map | `completionWatcher.ts` | 29 | assistant.reply 추적용 |
| `deliveredAssistantReplies` Set | `completionWatcher.ts` | 30 | 중복 방지용 |
| `lastAssistantReplyBySession` Map | `completionWatcher.ts` | 31 | 중복 방지용 |
| `message.updated` 핸들러의 `messageRoles.set()` | `completionWatcher.ts` | 97-99 | 위 Map 제거 시 불필요 |
| `assistant.reply` 타입 정의 | `hookBotTypes.ts` | 62-69 | HookNotification union에서 제거 |
| `notifyAssistantReply()` 함수 | `hookBotAdapter.ts` | 338-343 | 알림 구현 |
| `notify()` switch case | `hookBotAdapter.ts` | 366-367 | dispatch |

**유지**: completion의 `lastMessage`는 유지하되, 현재 500자 slice를 제거하고 **전체 마지막 메시지**를 `deliverSafe()`로 전달하도록 개선.

**변경**: `fetchAndNotifyCompletion()` 수정:
```typescript
// 현재 (line 60):
const lastMessagePreview = lastAssistantText ? lastAssistantText.slice(0, 500) : undefined

// 변경 후:
const lastMessage = lastAssistantText  // 전체 전달, deliverSafe가 길이 처리
```

---

## Phase 2: 핵심 버그 수정

### 2A. `session.idle`이 prior `session.busy` 없이도 completion 알림

**문제**: 컴퓨터에서 만든 세션이 busy→idle 전환 시, `session.busy` 이벤트를 hookbot이 놓치면 `busySessions`에 기록이 없어 idle 이벤트가 조용히 무시됨.

**발생 시나리오**:
1. hookbot 시작 전에 세션이 시작 + 끝남 → seedBusySessions는 이미 idle이라 잡지 못함 → idle 이벤트 도착 시 tracked 없음
2. SSE 연결 끊어진 사이에 busy+idle 둘 다 발생 → reconcile에서 이미 idle이라 busy로 등록 안 함 → 놓침
3. 새 디렉토리 discovery 전에 세션 시작+완료 → SSE 구독 자체가 없었음

**현재 코드** (`completionWatcher.ts:118-127`):
```typescript
case 'session.idle': {
  const key = compositeKey(directory, event.data.sessionId)
  const tracked = busySessions.get(key)
  if (tracked) {  // ← tracked 없으면 아무 일도 안 함!
    void fetchAndNotifyCompletion(...)
    busySessions.delete(key)
  }
  break
}
```

**수정**:
```typescript
case 'session.idle': {
  const key = compositeKey(directory, event.data.sessionId)
  const tracked = busySessions.get(key)
  if (tracked) {
    void fetchAndNotifyCompletion(event.data.sessionId, directory, projectName, tracked)
    busySessions.delete(key)
    lastStallWarningTimes.delete(key)
    logger.info('hookbot', `Session ${event.data.sessionId} completed in ${projectName}`)
  } else {
    // 컴퓨터 세션 등: busy 기록 없이 idle만 도착한 경우에도 알림
    const untracked: TrackedSession = {
      sessionId: event.data.sessionId,
      directory,
      projectName,
      busySince: 0,  // unknown duration
      lastActivityTime: Date.now(),
      observed: false,
    }
    void fetchAndNotifyCompletion(event.data.sessionId, directory, projectName, untracked)
    logger.info('hookbot', `Session ${event.data.sessionId} completed in ${projectName} (untracked)`)
  }
  break
}
```

**연쇄 수정**:

| 파일 | 변경 |
|------|------|
| `hookBotTypes.ts` — `TrackedSession` | `observed?: boolean` 필드 추가 |
| `hookBotTypes.ts` — `HookNotification.completion` | `duration` 타입을 `number` 유지, 0이면 unknown 의미 |
| `hookBotAdapter.ts:279` | duration 표시 로직 수정: `duration > 0 ? formatDuration(duration) : 'unknown'` |
| `completionWatcher.ts:62` | duration 계산 보강: `const duration = tracked.busySince > 0 ? Date.now() - tracked.busySince : 0` |

### 2B. seed된 세션의 duration 정확도 표시

**문제**: `seedBusySessions()`에서 `busySince = Date.now()` → 실제 시작 시간이 아닌 hookbot 시작 시간이 기록됨.

**수정**: 2A에서 `TrackedSession.observed` 필드를 추가하므로, seed 시 `observed: false`로 마킹.

```typescript
// seedBusySessions() 수정:
busySessions.set(key, {
  sessionId,
  directory,
  projectName,
  busySince: now,
  lastActivityTime: now,
  observed: false,  // 실제 busy 이벤트를 본 게 아님
})

// session.busy 이벤트 핸들러:
busySessions.set(key, {
  ...
  observed: true,  // 실제 이벤트로 확인
})
```

completion 알림에서:
- `observed: true` → `⏱ 3m 42s` (정확)
- `observed: false` → `⏱ ~3m 42s` (근사치) 또는 duration 생략

---

## Phase 3: Question 처리 통합 (Main Bot 수준)

### 3A. HookBot용 인프라 구축

#### HookBot StateStore 구현

**신규 파일**: `adapters/persistence/hookBotStateStore.ts`

Main bot의 `jsonStateStore.ts`를 참고하되 단순화:
- 단일 chatId만 관리 (hookbot은 1개 chat에만 알림)
- `ChatState`에서 `pendingInteractions` + `awaitingInput` + `awaitingInteractionId`만 사용
- 나머지 ChatState 필드는 빈 기본값

구현 인터페이스: `StateStore` (기존 포트 재사용)

#### HookBot ChatOutputPort 구현

hookbot의 `bot.api.sendMessage`/`editMessageText`를 `ChatOutputPort` 인터페이스로 래핑.

필요한 메서드:
- `sendText(chatId, text, parseMode?)` → `bot.api.sendMessage()`
- `editText(chatId, handle, text, parseMode?)` → `bot.api.editMessageText()`
- `sendInteraction(chatId, text, buttons)` → `bot.api.sendMessage()` with InlineKeyboard
- `editInteraction(chatId, handle, text, buttons)` → `bot.api.editMessageText()` with InlineKeyboard
- `sendFile(chatId, buffer, filename, caption?)` → `bot.api.sendDocument()`

이미 hookBotAdapter에 `sendText`, `sendFile`, `deliverSafe` 등이 있으므로 이를 ChatOutputPort 형태로 정리.

#### PendingInteraction에 `directory` 필드 추가

**파일**: `domain/models.ts`

```typescript
export interface PendingInteraction {
  // ... 기존 필드
  directory?: string  // hookbot용: question/permission reply 시 필요
}
```

**이유**: main bot은 `chatState.activeProjectDirectory`에서 directory를 가져오지만, hookbot은 프로젝트마다 다른 directory를 가짐. interaction 생성 시 directory를 함께 저장해야 reply 시 올바른 directory를 전달할 수 있음.

### 3B. interactiveFlow 통합

#### Composition root 변경 (`hookBot.ts`)

```typescript
const hookBotState = createHookBotStateStore(config.chatId, stateFilePath)
const hookBotOutput = createHookBotChatOutputAdapter(bot)
const interactiveFlow = createInteractiveFlow({
  openCode,
  state: hookBotState,
  output: hookBotOutput,
})
```

#### completionWatcher 알림 → interactiveFlow 호출

permission.asked / question.asked 이벤트가 오면 `notificationPort.notify()`를 거치지 않고 직접 `interactiveFlow`를 호출하도록 변경.

**방법 1 (권장)**: completionWatcher에 콜백 주입
```typescript
interface CompletionWatcherDeps {
  openCode: OpenCodePort
  notificationPort: HookNotificationPort
  onPermissionAsked?: (event: PermissionAsked, directory: string) => Promise<void>
  onQuestionAsked?: (event: QuestionAsked, directory: string) => Promise<void>
}
```

hookBot.ts에서:
```typescript
const watcher = createCompletionWatcher({
  openCode,
  notificationPort,
  onPermissionAsked: (event, directory) =>
    interactiveFlow.handlePermissionEvent(config.chatId, event),
  onQuestionAsked: (event, directory) =>
    interactiveFlow.handleQuestionEvent(config.chatId, event),
})
```

**방법 2**: notificationPort에서 interactiveFlow를 호출 (현재 구조 유지)
- notification의 permission/question 타입을 받으면 interactiveFlow로 위임
- 단, notificationPort가 interactiveFlow에 의존하게 되어 포트 순수성이 약간 깨짐

#### 콜백 등록 (`hookBotAdapter.ts`)

기존 `hp:`/`hq:` 콜백을 제거하고, main bot과 동일한 `perm:`/`q:` 형식으로 전환:

```typescript
// perm:{interactionId}:{response}
bot.callbackQuery(/^perm:/, async (ctx) => { ... })

// q:{interactionId}:{questionIdx}:{action}
bot.callbackQuery(/^q:/, async (ctx) => { ... })
```

hookbot은 별도 bot token이라 main bot과 콜백 데이터 충돌 없음.

#### 텍스트 입력 지원

`on('message:text')` 핸들러에서 wizard가 아닌 경우 `interactiveFlow.handleFreeTextAnswer()` 호출 추가.

### 3C. 기존 hookbot question 코드 제거

| 제거 대상 | 파일 | 라인 |
|-----------|------|------|
| `TrackedRequest` 타입 + `requestMap` | `hookBotAdapter.ts` | 174-203 |
| `notifyPermission()` | `hookBotAdapter.ts` | 297-310 |
| `notifyQuestion()` | `hookBotAdapter.ts` | 312-336 |
| `hp:` 콜백 핸들러 | `hookBotAdapter.ts` | 394-438 |
| `hq:` 콜백 핸들러 | `hookBotAdapter.ts` | 441-482 |

**효과**: 
- 재시작해도 상태 유지 (JSON 파일 기반)
- 멀티질문, 멀티셀렉트, 텍스트입력, 네비게이션, 확인 단계 전부 자동 지원
- 버튼 텍스트 scraping 대신 원본 옵션 문자열 사용 (fragile 제거)

---

## 파일별 변경 범위 요약

| 파일 | Phase | 변경 유형 | 규모 |
|------|-------|-----------|------|
| `hookBot.ts` | 1A, 1B | 삭제 ~150줄, 수정 ~20줄 | 대 |
| `completionWatcher.ts` | 1C, 2A, 2B | 삭제 ~40줄, 수정 ~30줄 | 중 |
| `hookBotTypes.ts` | 1C, 2A, 2B | `assistant.reply` 제거, `observed` 추가 | 소 |
| `hookBotAdapter.ts` | 1C, 1B, 3B, 3C | 삭제 ~150줄, 추가 ~100줄 | 대 |
| `domain/models.ts` | 3A | `directory?` 필드 1줄 추가 | 소 |
| `adapters/persistence/hookBotStateStore.ts` | 3A | **신규** ~60줄 | 소 |
| `interactiveFlow.ts` | 3A | directory fallback 소폭 수정 | 소 |
| `HookNotificationPort.ts` | — | 변경 없음 | — |

## 실행 순서 & 배포 전략

| 순서 | Phase | 작업 | 난이도 | 예상 시간 | 배포 |
|------|-------|------|--------|-----------|------|
| 1 | 1A | Backfill 전체 제거 | 쉬움 | 30분 | ✅ 단독 배포 가능 |
| 2 | 1C | `assistant.reply` 제거 + completion 보강 | 쉬움 | 30분 | ✅ 단독 배포 가능 |
| 3 | 2A | `session.idle` busy 무관 completion | 쉬움 | 30분 | ✅ 단독 배포 가능 |
| 4 | 2B | seed 세션 duration 정확도 | 쉬움 | 15분 | ✅ 2A와 함께 |
| 5 | 1B | Discovery 폴링 제거 + `/scan` 추가 | 쉬움 | 1시간 | ✅ 단독 배포 가능 |
| 6 | 3A | HookBot StateStore + ChatOutputPort | 중간 | 2시간 | ⚠️ 3B와 함께 |
| 7 | 3B | interactiveFlow 통합 + 콜백 등록 | 중간 | 2시간 | ⚠️ 3A와 함께 |
| 8 | 3C | 기존 question/permission 코드 제거 | 쉬움 | 30분 | ⚠️ 3B와 함께 |

**총 예상 시간**: ~7시간

**배포 전략**:
- Phase 1+2 (순서 1-5): 독립적으로 하나씩 배포 가능. 리스크 낮음.
- Phase 3 (순서 6-8): 한 번에 진행 필수. 상태 관리가 인메모리→파일로 전환되므로.

---

## 컴퓨터 세션 추적 검증

### 시나리오별 커버리지

| # | 시나리오 | 현재 | 개선 후 |
|---|---------|------|---------|
| 1 | HookBot 감시 중 + CLI 세션 busy→idle | ✅ | ✅ |
| 2 | HookBot 시작 시 이미 busy인 CLI 세션 | ⚠️ duration 부정확 | ✅ `observed: false` + ~표시 |
| 3 | SSE 끊김 사이 busy+idle 발생 | ⚠️ reconcile이 이미 idle이라 무시 | ✅ 2A 수정으로 idle 도착 시 무조건 알림 |
| 4 | 새 디렉토리 CLI 세션 (discovery 전 완료) | ❌ 완전 놓침 | ⚠️ /scan 수동 실행 필요 |
| 5 | busy 없이 idle만 도착 | ❌ 무시 | ✅ 2A 수정 |
| 6 | permission/question (CLI 세션) | ⚠️ 단일+옵션만 | ✅ 모든 유형 지원 |

### 시나리오 4 대응 방안

`mode=all`이면 시작 시 1회 전체 스캔으로 기존 프로젝트는 잡힘.
이후 완전히 새로운 디렉토리에서 CLI 세션이 시작+완료되면 → `/scan` 전까지 놓침.

**수용 가능한 이유**: 
- 새 프로젝트 생성은 드문 이벤트
- 사용자가 새 프로젝트를 만들었다면 `/scan` 한 번 누르면 됨
- 5초 폴링의 리소스 낭비 대비 훨씬 합리적인 트레이드오프

---

## Oracle 검증 결과 (2026-02-08)

### 검증 통과 항목

| 시나리오 | 결과 |
|---------|------|
| A: HookBot 감시 중 + CLI busy→idle | ✅ 2A로 완전 커버 |
| B: 시작 시 이미 busy | ✅ seed + `observed: false`로 커버 |
| D: 미발견 디렉토리 | ✅ `/scan` 수동 트리거로 수용 (설계 의도) |
| F: 콜백 네임스페이스 충돌 | ✅ `hbs:` vs `perm:`/`q:` — prefix 분리로 안전 |

### Oracle이 추가 요구한 보강 사항

#### 1. Completion 중복 알림 방지 (Scenario E)

**문제**: SSE 재연결 시 같은 세션에 대해 `session.idle`이 여러 번 도착할 수 있음. 2A 수정으로 untracked idle도 알림하면, 같은 세션에 completion이 2번 이상 발송될 위험.

**해결**: completion dedupe guard 추가.

```typescript
// completionWatcher.ts에 추가:
const recentlyNotifiedCompletions = new Map<string, number>() // key → timestamp
const COMPLETION_DEDUPE_TTL_MS = 5 * 60 * 1000 // 5분

function shouldNotifyCompletion(key: string): boolean {
  const lastNotified = recentlyNotifiedCompletions.get(key)
  if (lastNotified && Date.now() - lastNotified < COMPLETION_DEDUPE_TTL_MS) {
    return false // 최근 5분 내 이미 알림 → 중복 방지
  }
  recentlyNotifiedCompletions.set(key, Date.now())
  return true
}

// session.idle 핸들러에서:
case 'session.idle': {
  const key = compositeKey(directory, event.data.sessionId)
  if (!shouldNotifyCompletion(key)) {
    logger.debug('hookbot', `Dedupe: skipping duplicate idle for ${event.data.sessionId}`)
    break
  }
  // ... 기존 로직
}
```

#### 2. Scenario C: SSE 끊김 사이 busy+idle 발생 — 한계 인정

**문제**: SSE가 끊어진 동안 세션이 busy→idle을 모두 마친 경우, `reconcileOnReconnect()`는 이미 idle인 세션을 발견하지만 busySessions에 없으므로 알림하지 않음. 2A 수정은 **실시간 idle 이벤트**에만 적용되므로, 끊긴 사이 완료된 세션은 여전히 놓침.

**현재 계획의 한계**: 이건 SSE 자체의 구조적 한계. 과거 이벤트를 replay하지 않으므로, 끊긴 사이 완료된 세션을 100% 잡으려면 reconcile 시 "마지막으로 내가 알고 있던 상태 vs 현재 상태" 비교가 필요.

**수용 판단**: 사용자가 "과거 세션 추적 불필요"라고 명시했으므로, 이 한계는 수용. 단, reconcile 로직에 **간단한 보강** 추가:

```typescript
// reconcileOnReconnect() 보강:
// 기존: busySessions에 있는 것만 체크
// 추가: 서버에서 가져온 idle 세션 중 "마지막 업데이트가 최근 N분 이내"인 것 감지

// → 복잡도가 높아지므로, 현재는 수용하고 추후 필요 시 개선
```

#### 3. `duration` 타입 개선

**Oracle 권장**: `duration: 0`은 "즉시 완료"와 "unknown"이 구분 불가. `number | null`로 변경하여 명확하게.

```typescript
// hookBotTypes.ts
type: 'completion'
duration: number | null  // null = unknown, number = measured ms
```

```typescript
// hookBotAdapter.ts
const durationText = n.duration !== null ? formatDuration(n.duration) : 'unknown'
```

#### 4. `fetchAndNotifyCompletion()` 삭제된 세션 처리

**문제**: untracked session에 대해 `fetchAndNotifyCompletion()`을 호출했는데, 서버에서 세션이 이미 삭제되었으면 에러 발생.

**해결**: 기존 catch 블록이 이미 에러를 로깅하고 넘어가므로 (line 88-90) 치명적이지는 않음. 다만 에러 로그가 불필요하게 쌓이므로 `SessionNotFoundError`를 조용히 무시하도록 개선:

```typescript
async function fetchAndNotifyCompletion(...): Promise<void> {
  try {
    const session = await deps.openCode.getSession(sessionId, directory)
    if (!session) {
      logger.debug('hookbot', `Session ${sessionId} not found, skipping notification`)
      return  // 삭제된 세션은 조용히 무시
    }
    // ... 나머지 로직
  } catch (err) {
    // SessionNotFoundError는 debug 레벨로
    if (err instanceof SessionNotFoundError) {
      logger.debug('hookbot', `Session ${sessionId} deleted, skipping notification`)
      return
    }
    logger.error('hookbot', `Failed to fetch/notify completion for session ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
  }
}
```

#### 5. interactiveFlow 재사용 시 directory 전파 주의

**Oracle 주의사항**: `interactiveFlow`의 `submitAllAnswers()`에서 `chatState.activeProjectDirectory`를 사용. HookBot에서는 이 값이 비어있을 수 있으므로, `interaction.directory`를 우선 사용하도록 변경 필수.

```typescript
// interactiveFlow.ts의 submitAllAnswers() 수정:
const directory = interaction.directory ?? chatState.activeProjectDirectory
if (!directory) {
  await deps.output.sendText(chatId, '❌ No active project directory')
  return
}
```

같은 패턴이 `handlePermissionCallback()`에도 적용되어야 함.

---

## 최종 변경 목록 (Oracle 피드백 반영)

| 항목 | 원래 계획 | Oracle 피드백 | 최종 |
|------|-----------|--------------|------|
| duration 타입 | `number` (0=unknown) | `number \| null` 권장 | `number \| null` 채택 |
| idle 중복 알림 | 미고려 | dedupe guard 필요 | `recentlyNotifiedCompletions` Map 추가 |
| SSE 끊김 사이 완료 | 2A로 해결 가정 | 2A는 실시간 이벤트만 → 여전히 놓침 | 한계 수용 (사용자 동의) |
| 삭제된 세션 fetch | 기존 catch로 충분 | SessionNotFoundError 조용히 처리 | debug 레벨로 변경 |
| interactiveFlow directory | `interaction.directory` 추가 | 전파 누락 위험 지적 | `submitAllAnswers` + `handlePermissionCallback` 모두 수정 |
| backfill 제거 | 전체 제거 | "사용자가 의존할 수 있다" 주의 | 사용자가 직접 불필요 판단 → 전체 제거 유지 |
