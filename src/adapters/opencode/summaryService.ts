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

function buildVoiceSummaryPrompt(content: string, maxLength: number): string {
  const minLength = Math.min(Math.floor(maxLength * 0.7), maxLength - 100)
  return `You are a senior engineer listening to work updates while driving.
Summarize this AI response into a conversational audio script.

CRITICAL RULES:
- Output PLAIN TEXT ONLY — no HTML, no markdown, no special formatting
- No code blocks, no file paths with slashes, no technical symbols
- Write as if speaking to a colleague: natural, conversational Korean
- No bullet points or list markers — use flowing sentences
- Spell out abbreviations (e.g., "TypeScript" not "TS")
- LENGTH: Aim for ${minLength}-${maxLength} characters. Use the full length to provide useful detail.

STRUCTURE (speak naturally, not as a list):
1. Start with the outcome: success, failure, or needs input
2. Explain what was done in detail (2-4 sentences)
3. Mention key files or components that were changed
4. If there are errors or questions, explain them clearly
5. End with any next steps if relevant

Example good output (note the detail level):
"작업이 성공적으로 완료됐어요. 먼저 helper.ts 파일에 날짜 포맷팅, 문자열 변환, 그리고 배열 유틸리티 함수 세 개를 추가했습니다. 각 함수에 타입 정의도 포함시켰고, index.ts에서 익스포트하도록 수정했어요. 마지막으로 유닛 테스트 다섯 개를 작성해서 모두 통과했습니다. 다음 단계로 이 함수들을 실제 컴포넌트에 적용하면 됩니다."

Example bad output (too short, DO NOT do this):
"작업 완료됐어요. 함수 추가했습니다."

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

    async summarizeForVoice(directory, content, model, maxLength) {
      const prompt = buildVoiceSummaryPrompt(content, maxLength)
      return runSummarySession(directory, prompt, model, maxLength, '...')
    },
  }
}
