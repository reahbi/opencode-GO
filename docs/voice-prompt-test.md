# Voice Summary Prompt Test - 수준별 비교

## 사용법

1. 아래 3개 프롬프트를 각각 새 세션에서 테스트
2. 프롬프트 전체를 복사 → Gemini Flash 세션에 붙여넣기
3. 결과를 비교하여 선택

---

## 테스트용 AI 응답 원본 (3200자+)

아래는 "voice summary" 기능 개선 작업의 실제 AI 응답을 기반으로 만든 테스트 데이터입니다.
3개 프롬프트 모두 동일한 이 내용을 `---` 아래에 포함하고 있습니다.

---

## PROMPT 1: 🎮 Vibe Coder

```
Convert this AI coding assistant response into a spoken summary in Korean.
This text will be read aloud by text-to-speech. Write for listening, not reading.

OUTPUT LANGUAGE: Korean only. All output must be in Korean.

AUDIENCE: Non-technical user who builds apps using AI without coding knowledge (vibe coder).
- NEVER use technical jargon: no file names, no function names, no type names, no "JWT", no "middleware", no "port", no "adapter"
- Explain everything in terms of what the USER experiences: "login stays longer", "voice plays automatically", "settings page has new option"
- Use everyday analogies when helpful
- Focus on: what changed for the user, what works differently now, what they need to do next
- Tone: friendly assistant explaining to a non-technical friend

CRITICAL RULES:
- PLAIN TEXT ONLY — no HTML, no markdown, no formatting, no special symbols
- No code blocks, no file paths with slashes, no technical symbols
- Natural, conversational tone — write as spoken language
- No bullet points or lists — use flowing, connected sentences
- START IMMEDIATELY with the substance. ABSOLUTELY NO greetings, introductions, or filler at the start. No "여보세요", no "안녕하세요", no "네"
- LENGTH: approximately 800 characters. Prioritize COMPLETENESS — include all key points. Go up to 1600 if needed. Shorter is fine for simple content. Never pad with filler.

Example of good output:
"작업이 잘 끝났어요. 음성 기능을 좀 더 편하게 만들었어요. 이전에는 AI가 답변하면 음성 듣기 버튼을 직접 눌러야 했는데, 이제 설정에서 자동 모드를 켜면 답변이 끝나자마자 음성 파일이 알아서 와요. 따로 버튼을 누를 필요가 없어요. 그리고 음성 내용도 더 자세해졌어요. 이전에는 너무 짧게 요약해서 중요한 내용이 빠졌는데, 이제는 핵심을 다 포함해서 들려줘요."

---
I've completed a comprehensive voice feature overhaul across Phase 1 and Phase 2.

Phase 1 - Voice Quality Improvements:
1. Changed default voiceSummaryLength from 500 to 800 characters for more complete summaries
2. Added new LIMITS constants: VOICE_SUMMARY_HARD_CAP (5000 chars safety limit) and VOICE_AUTO_MIN_CONTENT (200 chars minimum for auto-voice trigger)
3. Split SummaryPort.summarizeForVoice signature - separated targetLength (prompt hint for AI) from hardCap (safety truncation limit). Previously maxLength served dual duty causing a bug where the AI was told "write at least 500 chars" but output was truncated at 500 chars
4. Rewrote voice prompts: removed rigid "MUST be N chars or more" requirement. New prompt prioritizes completeness over exact length - "approximately N chars, but include ALL key points even if longer, up to Nx2"
5. Unified Korean and English prompt builders into single buildVoiceSummaryPrompt() with language parameter. All instructions in English for better LLM compliance.
6. Removed "over the phone" roleplay phrasing that caused AI to add greetings like "여보세요" at the start

Phase 2 - Auto-Voice Mode:
1. Added voiceAutoMode boolean to UserSettings (default: false)
2. Implemented sendVoiceResponseDirect() in VoiceFlow - bypasses stored VoiceResponse lookup for auto-triggered voice
3. Extracted duplicate voice button logic in sessionWatcher into handleVoiceResponse() helper
4. Auto-voice fires on session.idle when content >= 200 chars, runs fire-and-forget via .catch() to avoid blocking idle handling
5. Added Settings UI: voice submenu shows Auto ON/OFF status with toggle button
6. Wired voiceFlow through to sessionWatcher deps via registerCommands

Additional changes:
- Switched from bot.api.sendAudio to bot.api.sendVoice for voice message bubble UX (waveform display instead of music player widget)
- Updated ChatOutputPort interface: sendAudio -> sendVoice
- All test mocks updated accordingly

Files changed: domain/models.ts, domain/ports/SummaryPort.ts, domain/ports/ChatOutputPort.ts, app/policies/limits.ts, app/usecases/voiceFlow.ts, app/usecases/sessionWatcher.ts, adapters/opencode/summaryService.ts, adapters/telegram/bot.ts, adapters/telegram/commands/settings.ts, adapters/telegram/commands/index.ts, __tests__/helpers/mockChatOutputPort.ts, __tests__/usecases/sessionWatcher.test.ts

TypeScript typecheck passes. 300 tests pass, 0 failures. Build succeeds.
```

---

## PROMPT 2: 👨‍💻 Developer

```
Convert this AI coding assistant response into a spoken summary in Korean.
This text will be read aloud by text-to-speech. Write for listening, not reading.

OUTPUT LANGUAGE: Korean only. All output must be in Korean.

AUDIENCE: Professional software developer who understands code architecture and patterns.
- Use exact technical terms: file names, function names, type names, config values
- Include architecture reasoning and trade-offs when mentioned
- Mention test results, type safety, and build status
- Focus on: what was changed technically, why this approach was chosen, what needs attention
- Tone: concise peer engineer status update — no hand-holding, no over-explaining basics

CRITICAL RULES:
- PLAIN TEXT ONLY — no HTML, no markdown, no formatting, no special symbols
- No code blocks, no file paths with slashes, no technical symbols
- Natural, conversational tone — write as spoken language
- No bullet points or lists — use flowing, connected sentences
- Spell out abbreviations (TypeScript not TS, JavaScript not JS)
- START IMMEDIATELY with the substance. ABSOLUTELY NO greetings, introductions, or filler at the start. No "여보세요", no "안녕하세요", no "네"
- LENGTH: approximately 800 characters. Prioritize COMPLETENESS — include all key points. Go up to 1600 if needed. Shorter is fine for simple content. Never pad with filler.

Example of good output:
"인증 모듈 리팩토링을 완료했어요. auth.ts 단일 파일을 authService, tokenManager, authMiddleware 세 파일로 분리했습니다. 분리한 이유는 테스트 용이성과 OAuth 같은 인증 방식 확장을 위해서입니다. 토큰 만료는 1시간에서 24시간으로 변경하고 리프레시 토큰도 구현했어요. types 폴더에 AuthUser, TokenPayload 인터페이스를 추가했고 테스트 12개 전부 통과했습니다. 환경 변수에 JWT_SECRET 설정이 필요해요."

---
I've completed a comprehensive voice feature overhaul across Phase 1 and Phase 2.

Phase 1 - Voice Quality Improvements:
1. Changed default voiceSummaryLength from 500 to 800 characters for more complete summaries
2. Added new LIMITS constants: VOICE_SUMMARY_HARD_CAP (5000 chars safety limit) and VOICE_AUTO_MIN_CONTENT (200 chars minimum for auto-voice trigger)
3. Split SummaryPort.summarizeForVoice signature - separated targetLength (prompt hint for AI) from hardCap (safety truncation limit). Previously maxLength served dual duty causing a bug where the AI was told "write at least 500 chars" but output was truncated at 500 chars
4. Rewrote voice prompts: removed rigid "MUST be N chars or more" requirement. New prompt prioritizes completeness over exact length - "approximately N chars, but include ALL key points even if longer, up to Nx2"
5. Unified Korean and English prompt builders into single buildVoiceSummaryPrompt() with language parameter. All instructions in English for better LLM compliance.
6. Removed "over the phone" roleplay phrasing that caused AI to add greetings like "여보세요" at the start

Phase 2 - Auto-Voice Mode:
1. Added voiceAutoMode boolean to UserSettings (default: false)
2. Implemented sendVoiceResponseDirect() in VoiceFlow - bypasses stored VoiceResponse lookup for auto-triggered voice
3. Extracted duplicate voice button logic in sessionWatcher into handleVoiceResponse() helper
4. Auto-voice fires on session.idle when content >= 200 chars, runs fire-and-forget via .catch() to avoid blocking idle handling
5. Added Settings UI: voice submenu shows Auto ON/OFF status with toggle button
6. Wired voiceFlow through to sessionWatcher deps via registerCommands

Additional changes:
- Switched from bot.api.sendAudio to bot.api.sendVoice for voice message bubble UX (waveform display instead of music player widget)
- Updated ChatOutputPort interface: sendAudio -> sendVoice
- All test mocks updated accordingly

Files changed: domain/models.ts, domain/ports/SummaryPort.ts, domain/ports/ChatOutputPort.ts, app/policies/limits.ts, app/usecases/voiceFlow.ts, app/usecases/sessionWatcher.ts, adapters/opencode/summaryService.ts, adapters/telegram/bot.ts, adapters/telegram/commands/settings.ts, adapters/telegram/commands/index.ts, __tests__/helpers/mockChatOutputPort.ts, __tests__/usecases/sessionWatcher.test.ts

TypeScript typecheck passes. 300 tests pass, 0 failures. Build succeeds.
```

---

## PROMPT 3: 🌱 Beginner

```
Convert this AI coding assistant response into a spoken summary in Korean.
This text will be read aloud by text-to-speech. Write for listening, not reading.

OUTPUT LANGUAGE: Korean only. All output must be in Korean.

AUDIENCE: Junior developer or coding student who is learning software development.
- Use technical terms but briefly explain unfamiliar ones on first mention
- For example: "포트라는 건 코드 모듈 사이의 연결 규약인데요" or "미들웨어, 그러니까 요청을 중간에서 처리하는 코드"
- Balance between technical accuracy and accessibility
- Explain WHY things are done, not just WHAT — help them learn
- Focus on: what was done, what the concepts mean, what patterns to learn from
- Tone: patient senior developer mentoring a junior colleague — encouraging but not condescending

CRITICAL RULES:
- PLAIN TEXT ONLY — no HTML, no markdown, no formatting, no special symbols
- No code blocks, no file paths with slashes, no technical symbols
- Natural, conversational tone — write as spoken language
- No bullet points or lists — use flowing, connected sentences
- Spell out abbreviations (TypeScript not TS, JavaScript not JS)
- START IMMEDIATELY with the substance. ABSOLUTELY NO greetings, introductions, or filler at the start. No "여보세요", no "안녕하세요", no "네"
- LENGTH: approximately 800 characters. Prioritize COMPLETENESS — include all key points. Go up to 1600 if needed. Shorter is fine for simple content. Never pad with filler.

Example of good output:
"인증 모듈을 리팩토링했어요. 리팩토링이란 코드의 동작은 그대로 두면서 구조를 더 깔끔하게 바꾸는 거예요. 원래 하나의 큰 파일에 로그인 관련 코드가 전부 들어있었는데, 이걸 역할별로 세 개로 나눴어요. 이렇게 나누면 각 부분을 따로 테스트하기 쉽고, 나중에 구글 로그인 같은 걸 추가할 때도 편해요. 이런 패턴을 단일 책임 원칙이라고 하는데, 하나의 파일이 하나의 역할만 하게 만드는 거예요."

---
I've completed a comprehensive voice feature overhaul across Phase 1 and Phase 2.

Phase 1 - Voice Quality Improvements:
1. Changed default voiceSummaryLength from 500 to 800 characters for more complete summaries
2. Added new LIMITS constants: VOICE_SUMMARY_HARD_CAP (5000 chars safety limit) and VOICE_AUTO_MIN_CONTENT (200 chars minimum for auto-voice trigger)
3. Split SummaryPort.summarizeForVoice signature - separated targetLength (prompt hint for AI) from hardCap (safety truncation limit). Previously maxLength served dual duty causing a bug where the AI was told "write at least 500 chars" but output was truncated at 500 chars
4. Rewrote voice prompts: removed rigid "MUST be N chars or more" requirement. New prompt prioritizes completeness over exact length - "approximately N chars, but include ALL key points even if longer, up to Nx2"
5. Unified Korean and English prompt builders into single buildVoiceSummaryPrompt() with language parameter. All instructions in English for better LLM compliance.
6. Removed "over the phone" roleplay phrasing that caused AI to add greetings like "여보세요" at the start

Phase 2 - Auto-Voice Mode:
1. Added voiceAutoMode boolean to UserSettings (default: false)
2. Implemented sendVoiceResponseDirect() in VoiceFlow - bypasses stored VoiceResponse lookup for auto-triggered voice
3. Extracted duplicate voice button logic in sessionWatcher into handleVoiceResponse() helper
4. Auto-voice fires on session.idle when content >= 200 chars, runs fire-and-forget via .catch() to avoid blocking idle handling
5. Added Settings UI: voice submenu shows Auto ON/OFF status with toggle button
6. Wired voiceFlow through to sessionWatcher deps via registerCommands

Additional changes:
- Switched from bot.api.sendAudio to bot.api.sendVoice for voice message bubble UX (waveform display instead of music player widget)
- Updated ChatOutputPort interface: sendAudio -> sendVoice
- All test mocks updated accordingly

Files changed: domain/models.ts, domain/ports/SummaryPort.ts, domain/ports/ChatOutputPort.ts, app/policies/limits.ts, app/usecases/voiceFlow.ts, app/usecases/sessionWatcher.ts, adapters/opencode/summaryService.ts, adapters/telegram/bot.ts, adapters/telegram/commands/settings.ts, adapters/telegram/commands/index.ts, __tests__/helpers/mockChatOutputPort.ts, __tests__/usecases/sessionWatcher.test.ts

TypeScript typecheck passes. 300 tests pass, 0 failures. Build succeeds.
```

---

## 테스트 방법

1. 텔레그램에서 `/new` 로 새 세션 생성
2. 위 프롬프트 중 하나를 통째로 복사하여 메시지로 전송
3. AI 응답을 확인
4. 3개 모두 테스트 후 비교

## 평가 기준

- **Vibe**: 기술 용어가 없는가? 사용자 경험 중심인가?
- **Developer**: 기술적으로 정확하고 간결한가?
- **Beginner**: 개념 설명이 자연스러운가? 배울 수 있는 내용인가?
- **공통**: 인사말 없이 바로 시작하는가? 핵심을 빠뜨리지 않는가? 듣기 좋은가?
