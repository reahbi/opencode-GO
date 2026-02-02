export type ParsedCallback =
  | { type: 'permission'; interactionId: string; response: 'once' | 'always' | 'reject' }
  | { type: 'question_answer'; interactionId: string; questionIndex: number; answerIndex: number }
  | { type: 'question_skip'; interactionId: string; questionIndex: number }
  | { type: 'question_type'; interactionId: string; questionIndex: number }
  | { type: 'question_back'; interactionId: string; questionIndex: number }
  | { type: 'question_confirm'; interactionId: string }
  | { type: 'question_reset'; interactionId: string }
  | { type: 'agent'; agentName: string }
  | { type: 'settings'; action: string; value?: string }
  | { type: 'selectmodel'; value: string }
  | { type: 'listpage'; page: number }
  | { type: 'listsel'; sessionId: string }
  | { type: 'history'; sessionId: string }
  | { type: 'unknown'; raw: string }

const VALID_PERM_RESPONSES = new Set(['once', 'always', 'reject'] as const)

export function parseCallback(data: string): ParsedCallback {
  if (data.startsWith('perm:')) {
    const parts = data.split(':')
    const interactionId = parts[1]
    const response = parts[2]
    if (!interactionId || !response || !VALID_PERM_RESPONSES.has(response as 'once' | 'always' | 'reject')) {
      return { type: 'unknown', raw: data }
    }
    return { type: 'permission', interactionId, response: response as 'once' | 'always' | 'reject' }
  }

  if (data.startsWith('agent:')) {
    const agentName = data.slice('agent:'.length)
    if (!agentName) {
      return { type: 'unknown', raw: data }
    }
    return { type: 'agent', agentName }
  }

  if (data.startsWith('sm:')) {
    const value = data.slice(3)
    if (!value) return { type: 'unknown', raw: data }
    return { type: 'selectmodel', value }
  }

  if (data.startsWith('settings:')) {
    const parts = data.split(':')
    const action = parts[1]
    const value = parts.slice(2).join(':') || undefined
    if (!action) return { type: 'unknown', raw: data }
    return { type: 'settings', action, value }
  }

  if (data.startsWith('lp:')) {
    const page = parseInt(data.slice(3), 10)
    if (!Number.isFinite(page) || page < 1) return { type: 'unknown', raw: data }
    return { type: 'listpage', page }
  }

  if (data.startsWith('ls:')) {
    const sessionId = data.slice(3)
    if (!sessionId) return { type: 'unknown', raw: data }
    return { type: 'listsel', sessionId }
  }

  if (data.startsWith('hist:')) {
    const sessionId = data.slice(5)
    if (!sessionId) return { type: 'unknown', raw: data }
    return { type: 'history', sessionId }
  }

  // Question callbacks: q:{interactionId}:{action}
  // Formats:
  //   q:{id}:{qIdx}:{answerIdx}  — select option answer
  //   q:{id}:{qIdx}:skip         — skip question
  //   q:{id}:{qIdx}:type         — type custom answer
  //   q:{id}:{qIdx}:back         — go to previous question
  //   q:{id}:ok                  — confirm/submit all
  //   q:{id}:redo                — reset all answers
  if (data.startsWith('q:')) {
    const parts = data.split(':')
    const interactionId = parts[1]
    if (!interactionId) return { type: 'unknown', raw: data }

    if (parts[2] === 'ok' && parts.length === 3) {
      return { type: 'question_confirm', interactionId }
    }

    if (parts[2] === 'redo' && parts.length === 3) {
      return { type: 'question_reset', interactionId }
    }

    const questionIndex = parseInt(parts[2], 10)
    if (!Number.isFinite(questionIndex) || questionIndex < 0) {
      return { type: 'unknown', raw: data }
    }

    const action = parts[3]
    if (action === undefined) return { type: 'unknown', raw: data }

    if (action === 'skip') {
      return { type: 'question_skip', interactionId, questionIndex }
    }
    if (action === 'type') {
      return { type: 'question_type', interactionId, questionIndex }
    }
    if (action === 'back') {
      return { type: 'question_back', interactionId, questionIndex }
    }

    const answerIndex = parseInt(action, 10)
    if (Number.isFinite(answerIndex) && answerIndex >= 0) {
      return { type: 'question_answer', interactionId, questionIndex, answerIndex }
    }

    return { type: 'unknown', raw: data }
  }

  return { type: 'unknown', raw: data }
}
