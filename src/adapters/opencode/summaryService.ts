import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { SummaryPort } from '../../domain/ports/SummaryPort.js'
import type { OpenCodeEvent } from '../../domain/events.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../../app/policies/limits.js'

export type { SummaryPort }
export type SummaryService = SummaryPort

const SUMMARY_TIMEOUT_MS = 60_000
const SUMMARY_SESSION_TITLE = '_summary'
const MAX_INPUT_CHARS = 30_000

function truncateInput(content: string): string {
  return content.length > MAX_INPUT_CHARS
    ? content.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated]'
    : content
}

function buildSummaryPrompt(content: string): string {
  return `You are a senior engineer checking work on your phone via Telegram.
Rewrite this AI response into a compact, mobile-friendly summary using Telegram HTML.

Allowed HTML tags ONLY: <b>, <i>, <code>, <pre>, <a href="">, <s>, <u>, <blockquote>
Telegram has NO heading or list tags. Use these conventions:
- Headings: <b>Section Title</b> on its own line
- Bullets: start line with • or ▸ character
- File paths: wrap in <code>path/to/file</code>
- Code snippets: wrap in <code>inline</code> or <pre>block</pre>

Adaptive structure — include only sections that are relevant:

<b>Outcome</b>
• ALWAYS include. One line: ✅ OK | ⚠️ NEEDS INPUT | ❌ FAILED + short reason

<b>Key Points</b>
• ALWAYS include. 2-5 bullets of what was done and why

<b>Files</b>
• Include ONLY if files were modified. Top 10 files max, if more add "(+N more)"

<b>Commands</b>
• Include ONLY if there are commands to run or verify

<b>Errors</b>
• Include ONLY if errors or warnings occurred

<b>Questions</b>
• Include ONLY if the response asks the user something

Rules:
- Maximum ${LIMITS.SUMMARY_OUTPUT_TARGET} characters total
- Same language as the original response
- No filler phrases — every word must earn its place
- Avoid long URLs; prefer short link text, omit querystrings
- Do NOT use markdown syntax (no **, no \`\`\`, no #)
- Output ONLY the HTML summary, nothing else

---
${truncateInput(content)}`
}

function buildVoiceSummaryPrompt(content: string, maxLength: number, language: 'ko' | 'en'): string {
  const langName = language === 'ko' ? 'Korean' : 'English'
  const goodExample = language === 'ko'
    ? '"작업이 성공적으로 완료됐어요. 이번에 진행한 내용을 설명드릴게요. 먼저 인증 모듈을 전면 리팩토링했습니다. 기존에는 auth.ts 파일 하나에 모든 로직이 있었는데, 이걸 세 개의 파일로 분리했어요. authService.ts에는 로그인과 로그아웃 핵심 로직을, tokenManager.ts에는 JWT 토큰 생성과 검증 로직을, 그리고 authMiddleware.ts에는 Express 미들웨어를 넣었습니다. 이렇게 분리한 이유는 테스트하기 쉽게 만들고, 나중에 OAuth 같은 다른 인증 방식을 추가할 때 확장성을 확보하기 위해서예요. 토큰 만료 시간은 기존 1시간에서 24시간으로 늘렸고, 리프레시 토큰도 새로 구현했습니다. 테스트는 총 12개를 작성했는데 모두 통과했습니다. 다음으로 해주셔야 할 건 환경 변수에 JWT_SECRET 값을 설정하시는 거예요."'
    : '"The task completed successfully. First, I completely refactored the authentication module. Previously, all the logic was in a single auth.ts file, but I split it into three separate files. authService.ts now contains the core login and logout logic, tokenManager.ts handles JWT token generation and validation, and authMiddleware.ts has the Express middleware. The reason for this separation is to make testing easier and to ensure extensibility when adding other auth methods like OAuth later. I changed the token expiration from 1 hour to 24 hours and implemented refresh tokens as well. I wrote 12 tests total and they all pass. The next thing you need to do is set the JWT_SECRET environment variable."'

  return `Convert this AI coding assistant response into a spoken summary in ${langName}.
This text will be read aloud by text-to-speech. Write for listening, not reading.

OUTPUT LANGUAGE: ${langName} only. All output must be in ${langName}.

CRITICAL RULES:
- PLAIN TEXT ONLY — no HTML, no markdown, no formatting, no special symbols
- No code blocks, no file paths with slashes, no technical symbols
- Natural, conversational tone — write as spoken language
- No bullet points or lists — use flowing, connected sentences
- Spell out abbreviations (TypeScript not TS, JavaScript not JS)
- START IMMEDIATELY with the substance. ABSOLUTELY NO greetings, introductions, or filler at the start. No "Hello", no "Hi", no "So", no "여보세요", no "안녕하세요", no "네"
- LENGTH: approximately ${maxLength} characters. Prioritize COMPLETENESS — include all key points, decisions, and outcomes. Go up to ${maxLength * 2} if needed for completeness. Shorter is fine for simple content. Never pad with filler.

WHAT TO INCLUDE (cover ALL that apply):
- Result: success, failure, or needs input — and why
- Changes: which files were modified and how, specifically
- Logic: why this approach was chosen
- Details: function names, component names, config values
- Errors: any errors or warnings, in detail
- Next steps: what the user needs to do

Example of good output:
${goodExample}

---
${truncateInput(content)}`
}

export function createSummaryService(openCode: OpenCodePort): SummaryPort {

  async function runSummarySession(
    directory: string,
    prompt: string,
    model: { providerID: string; modelID: string },
    hardCap: number,
    truncationSuffix: string,
  ): Promise<string> {
    const session = await openCode.createSession(directory, SUMMARY_SESSION_TITLE)
    const sessionId = session.id
    logger.debug('summary', `Created temp session ${sessionId}`)

    try {
      const abortController = new AbortController()
      let summaryText = ''
      const assistantMessageIds = new Set<string>()

      const eventHandler = async (event: OpenCodeEvent) => {
        switch (event.type) {
          case 'message.updated': {
            if (event.data.sessionId !== sessionId) return
            if (event.data.role === 'assistant') {
              assistantMessageIds.add(event.data.messageId)
            }
            break
          }
          case 'message.part.updated': {
            if (event.data.sessionId !== sessionId) return
            if (event.data.messageId && !assistantMessageIds.has(event.data.messageId)) return
            summaryText = event.data.content
            break
          }
          case 'session.idle': {
            if (event.data.sessionId !== sessionId) return
            abortController.abort()
            break
          }
          case 'session.error': {
            if (event.data.sessionId !== sessionId) return
            logger.warn('summary', `Session error: ${event.data.error || '(empty)'}`)
            abortController.abort()
            break
          }
          default:
            break
        }
      }

      const ssePromise = openCode
        .streamEvents(directory, eventHandler, abortController.signal)
        .catch((err) => {
          if (abortController.signal.aborted) return
          logger.error('summary', `SSE error: ${err instanceof Error ? err.message : 'unknown'}`)
        })

      await openCode.sendPromptAsync(sessionId, directory, prompt, model)
      logger.debug('summary', `Prompt sent to temp session ${sessionId}`)

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null
      await Promise.race([
        ssePromise,
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(() => {
            logger.warn('summary', `Summary timed out after ${SUMMARY_TIMEOUT_MS / 1000}s`)
            if (!abortController.signal.aborted) {
              abortController.abort()
            }
            resolve()
          }, SUMMARY_TIMEOUT_MS)
        }),
      ])

      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle)
      }

      if (!abortController.signal.aborted) {
        abortController.abort()
      }

      if (!summaryText) {
        throw new Error('Summary produced no output')
      }

      if (summaryText.length > hardCap) {
        summaryText = summaryText.slice(0, hardCap) + truncationSuffix
      }

      logger.info('summary', `Summary generated: ${summaryText.length} chars`)
      return summaryText
    } finally {
      try {
        await openCode.deleteSession(sessionId, directory)
        logger.debug('summary', `Deleted temp session ${sessionId}`)
      } catch (err) {
        logger.warn('summary', `Failed to delete temp session ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }
  }

  return {
    async summarize(directory, content, model) {
      const prompt = buildSummaryPrompt(content)
      return runSummarySession(directory, prompt, model, LIMITS.SUMMARY_HTML_HARD_CAP, '\n\n<i>... (truncated)</i>')
    },

    async summarizeForVoice(directory, content, model, targetLength, language, hardCap) {
      const prompt = buildVoiceSummaryPrompt(content, targetLength, language)
      return runSummarySession(directory, prompt, model, hardCap, '...')
    },
  }
}
