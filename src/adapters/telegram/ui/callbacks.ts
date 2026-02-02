export type ParsedCallback =
  | { type: 'permission'; interactionId: string; response: 'once' | 'always' | 'reject' }
  | { type: 'question'; interactionId: string; answerIndex: number | null }
  | { type: 'agent'; agentName: string }
  | { type: 'settings'; action: string; value?: string }
  | { type: 'selectmodel'; value: string }
  | { type: 'listpage'; page: number }
  | { type: 'listsel'; sessionId: string }
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

  if (data.startsWith('q:')) {
    const parts = data.split(':')
    const interactionId = parts[1]
    const answerPart = parts[2]
    if (!interactionId || answerPart === undefined) {
      return { type: 'unknown', raw: data }
    }
    if (answerPart === 'skip') {
      return { type: 'question', interactionId, answerIndex: null }
    }
    const answerIndex = parseInt(answerPart, 10)
    if (!Number.isFinite(answerIndex) || answerIndex < 0) {
      return { type: 'unknown', raw: data }
    }
    return { type: 'question', interactionId, answerIndex }
  }

  return { type: 'unknown', raw: data }
}
