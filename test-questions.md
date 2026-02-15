# Interactive Question Flow Test Scenarios

## Test Setup
Bot이 실행 중이어야 하며, 활성 세션이 있어야 합니다.

## 시나리오 1: 단일 질문 + 단일 선택
**사용자 입력:** "선택지가있는 질문 해봐"
**기대 동작:**
1. ❓ 질문이 표시됨 (여러 선택지 버튼)
2. 사용자가 선택지 클릭 (예: "코드 리뷰")
3. ✅ "Answered: 코드 리뷰" 표시
4. **자동으로 Claude Code에 답변 전송**
5. Claude Code가 답변을 받고 다음 응답 생성

**확인 포인트:**
- [ ] 질문 UI가 올바르게 표시됨
- [ ] 선택 후 답변이 포맷팅됨
- [ ] 답변이 자동으로 다음 프롬프트로 전송됨
- [ ] Claude Code가 답변을 이해하고 응답함

## 시나리오 2: 여러 질문 + 여러 선택지
**사용자 입력:** "2개 질문 만들어봐"
**기대 동작:**
1. ❓ 첫 번째 질문 표시
2. 사용자가 "✏️ Type answer" 클릭
3. 텍스트 입력 (예: "르르")
4. 자동으로 두 번째 질문으로 이동
5. 사용자가 "✏️ Type answer" 클릭
6. 텍스트 입력 (예: "ㅇㅇ")
7. ✅ "2 questions answered" 요약 표시
8. **자동으로 Claude Code에 답변 전송**
9. Claude Code가 두 답변을 모두 받고 응답

**확인 포인트:**
- [ ] 질문 간 이동이 자동으로 진행됨
- [ ] 모든 답변이 수집됨
- [ ] 요약이 올바르게 표시됨
- [ ] 답변이 자동으로 전송됨
- [ ] Claude Code가 포맷된 답변을 받음 (Q: ... A: ...)

## 시나리오 3: multiSelect 질문
**사용자 입력:** "multiSelect 질문 만들어봐"
**기대 동작:**
1. ❓ 질문 표시 (체크박스 버튼)
2. 사용자가 여러 옵션 클릭 (☐ → ✓)
3. "Next (2 selected) →" 클릭
4. ✅ "Answered: 옵션1, 옵션2" 표시
5. **자동으로 Claude Code에 답변 전송**
6. Claude Code가 여러 선택을 이해하고 응답

**확인 포인트:**
- [ ] multiSelect UI가 올바르게 표시됨
- [ ] 여러 선택이 정상 작동함
- [ ] 답변이 쉼표로 구분되어 포맷팅됨
- [ ] 답변이 자동으로 전송됨

## 시나리오 4: Skip 옵션
**사용자 입력:** "질문 만들어봐"
**기대 동작:**
1. ❓ 질문 표시
2. 사용자가 "⏭️ Skip" 클릭
3. ✅ "Answered: ⏭️ skipped" 표시
4. **자동으로 Claude Code에 "(skipped)" 전송**
5. Claude Code가 스킵된 질문을 인지하고 응답

**확인 포인트:**
- [ ] Skip 동작이 정상 작동함
- [ ] (skipped) 텍스트가 전송됨
- [ ] Claude Code가 계속 진행함

## 시나리오 5: 복합 시나리오 (여러 질문 + 다양한 입력 방식)
**사용자 입력:** "3개 질문 만들어봐 (선택지, 텍스트, multiSelect)"
**기대 동작:**
1. 첫 번째: 선택지 클릭
2. 두 번째: ✏️ Type answer → 텍스트 입력
3. 세 번째: multiSelect → 여러 개 선택 → Next
4. "✅ Submit" 확인 화면 표시
5. Submit 클릭
6. ✅ "3 questions answered" 요약
7. **자동으로 Claude Code에 모든 답변 전송**
8. Claude Code가 3개 답변을 모두 받고 종합 응답

**확인 포인트:**
- [ ] 다양한 입력 방식이 모두 작동함
- [ ] 확인 단계가 표시됨
- [ ] 모든 답변이 올바르게 포맷됨
- [ ] 답변이 자동으로 전송됨

## 디버깅 로그 확인
다음 로그를 확인하여 정상 작동 여부를 검증:

```
[interactive] Submitting N answers for requestId=...
[interactive] Auto-submitting answers to Claude SDK for chat ...
[session] Query started for session ...
```

## 성공 기준
- ✅ 모든 시나리오에서 답변이 **자동으로** Claude Code에 전송됨
- ✅ 사용자가 수동으로 추가 메시지를 보낼 필요가 없음
- ✅ Claude Code가 포맷된 답변(Q: ... A: ...)을 받고 올바르게 응답함
- ✅ 다양한 질문 타입(단일/다중, 선택지/텍스트/multiSelect)이 모두 작동함
