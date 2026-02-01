import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { OpenCodeEvent } from '../../domain/events.js'
import { logger } from '../../shared/logger.js'

const SUMMARY_TIMEOUT_MS = 60_000
const SUMMARY_SESSION_TITLE = '_summary'
const MAX_INPUT_CHARS = 30_000

function buildSummaryPrompt(content: string, threshold: number): string {
  const truncated =
    content.length > MAX_INPUT_CHARS
      ? content.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated]'
      : content

  return `You are a senior engineer checking work on your phone via Telegram.
Rewrite this AI response into a mobile-friendly summary using Telegram HTML.

Allowed HTML tags ONLY: <b>, <i>, <code>, <pre>, <a href="">, <s>, <u>, <blockquote>
Telegram has NO heading or list tags. Use these conventions:
- Headings: <b>Section Title</b> on its own line
- Bullets: start line with • or ▸ character
- File paths: wrap in <code>path/to/file</code>
- Code snippets: wrap in <code>inline</code> or <pre>block</pre>

Structure:
<b>Files</b>
• list modified files

<b>Summary</b>
• 2-5 bullets of what was done and why

<b>Next</b>
• commands to run or things to verify

Rules:
- Maximum ${threshold} characters total
- Same language as the original response
- No filler phrases
- Do NOT use markdown syntax (no **, no \`\`\`, no #)
- Output ONLY the HTML summary, nothing else

---
${truncated}`
}

export interface SummaryService {
  summarize(
    directory: string,
    content: string,
    model: { providerID: string; modelID: string },
    threshold: number,
  ): Promise<string>
}

export function createSummaryService(openCode: OpenCodePort): SummaryService {
  return {
    async summarize(directory, content, model, threshold) {
      const prompt = buildSummaryPrompt(content, threshold)

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

        if (summaryText.length > threshold + 200) {
          summaryText = summaryText.slice(0, threshold) + '\n\n<i>... (truncated)</i>'
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
    },
  }
}
