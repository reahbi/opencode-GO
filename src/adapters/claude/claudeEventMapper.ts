import type { ClaudeEvent, QuestionAsked, QuestionInfo } from '../../domain/events.js'

/**
 * Check if a tool.use event is an AskUserQuestion tool call.
 */
export function isAskUserQuestion(event: ClaudeEvent): event is Extract<ClaudeEvent, { type: 'tool.use' }> {
  return event.type === 'tool.use' && event.toolName === 'AskUserQuestion'
}

/**
 * Parse an AskUserQuestion tool input into a QuestionAsked object.
 *
 * The AskUserQuestion tool input looks like:
 * {
 *   questions: [
 *     {
 *       question: "Which library should we use?",
 *       header: "Library",
 *       options: [{ label: "Option A", description: "..." }, ...],
 *       multiSelect: false
 *     }
 *   ]
 * }
 */
export function parseAskUserQuestion(event: Extract<ClaudeEvent, { type: 'tool.use' }>): QuestionAsked | null {
  // Parse the input - it could have various shapes
  const input = event.input as Record<string, unknown> | undefined
  if (!input) return null

  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null

  const questions: QuestionInfo[] = rawQuestions.map((q: unknown, index: number) => {
    if (typeof q !== 'object' || q === null) {
      return { id: String(index), text: '' }
    }
    const qObj = q as Record<string, unknown>
    const text = typeof qObj.question === 'string' ? qObj.question : (typeof qObj.header === 'string' ? qObj.header : '')

    let options: string[] | undefined
    if (Array.isArray(qObj.options)) {
      const labels = qObj.options
        .map((opt: unknown) => {
          if (typeof opt === 'string') return opt
          if (typeof opt === 'object' && opt !== null && 'label' in opt) {
            return typeof (opt as Record<string, unknown>).label === 'string' ? (opt as Record<string, unknown>).label as string : undefined
          }
          return undefined
        })
        .filter((l): l is string => l !== undefined)
      if (labels.length > 0) options = labels
    }

    const multiple = typeof qObj.multiSelect === 'boolean' ? qObj.multiSelect : undefined

    const info: QuestionInfo = { id: String(index), text }
    if (options) info.options = options
    if (multiple !== undefined) info.multiple = multiple
    return info
  })

  return {
    requestId: event.toolUseId,
    sessionId: event.sessionId,
    questions,
  }
}

/**
 * Extract thinking keywords to determine thinking level.
 * Returns token budget: 0 (off), 10000 (normal), 50000 (deep).
 */
const THINKING_KEYWORDS = ['think', 'analyze', '분석', '생각', '고민', 'consider', 'reason']
const DEEP_THINKING_KEYWORDS = ['deep think', 'deeply', '깊이', '심층', 'thorough', 'comprehensive']

export function getThinkingLevel(message: string): number {
  const msgLower = message.toLowerCase()
  if (DEEP_THINKING_KEYWORDS.some(k => msgLower.includes(k))) return 50000
  if (THINKING_KEYWORDS.some(k => msgLower.includes(k))) return 10000
  return 0
}
