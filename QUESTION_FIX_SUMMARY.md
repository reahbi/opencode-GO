# Interactive Question Flow Fix Summary

## 🐛 문제 설명

기존에는 사용자가 질문에 답변을 완료하면:
1. ✅ 답변이 `chatState.lastPrompt`에 저장됨
2. ✅ UI에 "2 questions answered" 표시됨
3. ❌ **Claude SDK로 답변이 전송되지 않음**
4. ❌ 사용자가 수동으로 다음 메시지를 보내야 함

## ✅ 수정 내용

### 1. `interactiveFlow.ts` 수정

**변경사항:**
- `InteractiveFlowDeps`에 `onAnswersSubmitted` 콜백 추가
- `submitAllAnswers` 함수 마지막에 자동 전송 로직 추가

```typescript
interface InteractiveFlowDeps {
  state: StateStore
  output: ChatOutputPort
  botRole?: 'writer' | 'reader' | 'standalone'
  onAnswersSubmitted?: (chatId: number, formattedAnswers: string, threadId?: number) => Promise<void>  // 추가
}
```

```typescript
async function submitAllAnswers(...) {
  // ... 기존 로직 (답변 포맷팅, UI 업데이트)

  // 자동 전송 추가
  if (deps.onAnswersSubmitted) {
    logger.info('interactive', `Auto-submitting answers to Claude SDK for chat ${chatId}`)
    await deps.onAnswersSubmitted(chatId, formattedAnswers, threadId)
  }
}
```

### 2. `commands/index.ts` 수정

**변경사항:**
- `interactiveFlow` 생성 시 `onAnswersSubmitted` 콜백 제공
- 콜백에서 `promptFlow.handleUserMessage` 호출

```typescript
interactiveFlow = createInteractiveFlow({
  state,
  output,
  botRole: deps.botRole,
  onAnswersSubmitted: async (chatId, formattedAnswers, threadId) => {
    const scopeKey = getQueueScopeKey(chatId, threadId)
    await queue.enqueue(scopeKey, () =>
      promptFlow.handleUserMessage(chatId, formattedAnswers, { threadId, fromQueueDrain: false })
    )
  }
})
```

## 🔄 동작 흐름 (수정 후)

1. 사용자가 질문에 모두 답변
2. `submitAllAnswers` 호출
3. 답변 포맷팅: `"Q: 질문1\nA: 답변1\n\nQ: 질문2\nA: 답변2"`
4. `chatState.lastPrompt`에 저장
5. UI 업데이트
6. **🆕 `onAnswersSubmitted` 콜백 자동 호출**
7. **🆕 `promptFlow.handleUserMessage(chatId, formattedAnswers)` 실행**
8. **🆕 Claude SDK로 답변 전송**
9. Claude Code가 답변을 받고 다음 응답 생성

## 📊 지원되는 시나리오

✅ **단일 질문 + 단일 선택**
- 선택지 클릭 → 자동 전송

✅ **여러 질문 + 여러 선택지**
- 각 질문 답변 → 모두 완료 시 자동 전송

✅ **multiSelect 질문**
- 여러 옵션 선택 → Next → 자동 전송

✅ **텍스트 입력 (Type answer)**
- ✏️ 클릭 → 텍스트 입력 → 자동 전송

✅ **Skip 옵션**
- ⏭️ Skip → "(skipped)" 자동 전송

✅ **복합 시나리오**
- 다양한 입력 방식 혼합 → 자동 전송

## 🧪 테스트 방법

1. 봇 실행: `bun start`
2. Telegram에서 `/new` 명령으로 세션 시작
3. 아무 메시지나 보내서 Claude Code에게 질문 요청:
   - "선택지가 있는 질문 2개 만들어봐"
   - "multiSelect 질문 해봐"
4. 질문에 답변 완료
5. **자동으로 다음 응답이 오는지 확인** (수동 입력 불필요!)

## 📝 로그 확인

정상 작동 시 다음 로그가 표시됨:

```
[interactive] Submitting 2 answers for requestId=abc-123: [["답변1"],["답변2"]]
[interactive] Auto-submitting answers to Claude SDK for chat 12345
[session] Query started for session xyz-789
```

## 🎯 테스트 체크리스트

- [ ] 단일 질문 + 선택지 클릭 → 자동 전송 확인
- [ ] 여러 질문 + ✏️ Type answer → 자동 전송 확인
- [ ] multiSelect → 여러 선택 → 자동 전송 확인
- [ ] Skip → (skipped) 자동 전송 확인
- [ ] Claude Code가 포맷된 답변을 올바르게 받는지 확인

## 💡 주요 개선 사항

**Before:**
```
사용자 답변 → UI 표시 → [사용자가 수동으로 메시지 입력] → Claude 응답
```

**After:**
```
사용자 답변 → UI 표시 → 자동 전송 → Claude 응답
```

**사용자 경험 향상:**
- ❌ 답변 후 "계속", "ok" 등 수동 입력 불필요
- ✅ 답변 완료 즉시 Claude Code가 자동으로 처리
- ✅ 자연스러운 대화 흐름 유지
