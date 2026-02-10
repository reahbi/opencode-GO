import type {
  MessageUpdated,
  OpenCodeEvent,
  PermissionAsked,
  QuestionAsked,
  QuestionInfo,
  SessionBusy,
  SessionError,
  SessionIdle,
  SessionRetry,
  ToolPartUpdated,
} from '../../domain/events.js'

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function getEventBase(event: unknown): { type: string; properties: RecordLike } | null {
  if (!isRecord(event)) return null
  const type = getString(event.type)
  if (!type) return null
  const properties = isRecord(event.properties) ? event.properties : {}
  return { type, properties }
}

function mapQuestionInfo(value: unknown, index: number): QuestionInfo {
  if (!isRecord(value)) {
    return { id: String(index), text: '' }
  }

  const text = getString(value.question) ?? getString(value.header) ?? ''
  const optionsRaw = value.options
  let options: string[] | undefined

  if (Array.isArray(optionsRaw)) {
    const labels = optionsRaw
      .map((option) => {
        if (typeof option === 'string') return option
        if (isRecord(option)) return getString(option.label)
        return undefined
      })
      .filter(isString)
    if (labels.length > 0) {
      options = labels
    }
  }

  const multiple = typeof value.multiple === 'boolean' ? value.multiple : undefined

  const question: QuestionInfo = { id: String(index), text }
  if (options) question.options = options
  if (multiple !== undefined) question.multiple = multiple
  return question
}

export function mapSdkEvent(event: unknown): OpenCodeEvent | null {
  const base = getEventBase(event)
  if (!base) return null
  const properties = base.properties

  switch (base.type) {
    case 'permission.asked': {
      const requestId = getString(properties.id)
      const sessionId = getString(properties.sessionID)
      const permission = getString(properties.permission)
      if (!requestId || !sessionId || permission === null) return null

      const patterns = Array.isArray(properties.patterns)
        ? properties.patterns.filter(isString)
        : []

      const data: PermissionAsked = {
        requestId,
        sessionId,
        permission,
        patterns,
        title: permission,
      }

      return { type: 'permission.asked', data }
    }

    case 'question.asked': {
      const requestId = getString(properties.id)
      const sessionId = getString(properties.sessionID)
      if (!requestId || !sessionId) return null

      const questionsRaw = Array.isArray(properties.questions) ? properties.questions : []
      const questions = questionsRaw.map((item, index) => mapQuestionInfo(item, index))
      const data: QuestionAsked = { requestId, sessionId, questions }

      return { type: 'question.asked', data }
    }

    case 'session.idle': {
      const sessionId = getString(properties.sessionID)
      if (!sessionId) return null
      const data: SessionIdle = { sessionId }
      return { type: 'session.idle', data }
    }

    case 'session.error': {
      const sessionId = getString(properties.sessionID)
      if (!sessionId) return null
      let error = ''
      if (typeof properties.error === 'string') {
        error = properties.error
      } else if (isRecord(properties.error)) {
        const errData = isRecord(properties.error.data) ? properties.error.data : null
        error = getString(errData?.message) ?? getString(properties.error.name) ?? ''
      }
      const data: SessionError = { sessionId, error }
      return { type: 'session.error', data }
    }

    case 'session.status': {
      const status = isRecord(properties.status) ? properties.status : null
      const statusType = status ? getString(status.type) : null
      const sessionId = getString(properties.sessionID)
      if (!sessionId) return null

      if (statusType === 'busy') {
        const data: SessionBusy = { sessionId }
        return { type: 'session.busy', data }
      }
      if (statusType === 'retry') {
        const data: SessionRetry = {
          sessionId,
          attempt: typeof status!.attempt === 'number' ? status!.attempt : 0,
          message: typeof status!.message === 'string' ? status!.message : '',
          next: typeof status!.next === 'number' ? status!.next : 0,
        }
        return { type: 'session.retry', data }
      }
      if (statusType === 'idle') {
        const data: SessionIdle = { sessionId }
        return { type: 'session.idle', data }
      }
      return null
    }

    case 'message.updated': {
      const info = isRecord(properties.info) ? properties.info : null
      if (!info) return null
      const sessionId = getString(info.sessionID)
      const messageId = getString(info.id)
      const role = getString(info.role)
      if (!sessionId || !messageId || (role !== 'user' && role !== 'assistant')) return null
      return {
        type: 'message.updated',
        data: { sessionId, messageId, role },
      }
    }

    case 'message.part.updated': {
      const part = isRecord(properties.part) ? properties.part : null
      if (!part) return null

      const partType = getString(part.type)
      const sessionId = getString(part.sessionID)
      const partId = getString(part.id)
      const messageId = getString(part.messageID) ?? ''

      if (!sessionId || !partId) return null

      if (partType === 'text') {
        const content = getString(part.text)
        if (content === null) return null

        const finished = isRecord(part.time) && typeof part.time.end === 'number'
        return {
          type: 'message.part.updated',
          data: {
            sessionId,
            partId,
            messageId,
            content,
            finished,
          },
        }
      }

      if (partType === 'tool') {
        const tool = getString(part.tool) ?? 'unknown'
        const state = isRecord(part.state) ? part.state : null
        const title = (state && getString(state.title)) ?? tool
        const stateStatus = state ? getString(state.status) : null

        let status: ToolPartUpdated['status'] = 'pending'
        if (stateStatus === 'running') status = 'running'
        else if (stateStatus === 'completed') status = 'completed'
        else if (stateStatus === 'error') status = 'error'
        else if (isRecord(part.time) && typeof part.time.start === 'number') {
          status = typeof part.time.end === 'number' ? 'completed' : 'running'
        }

        return {
          type: 'tool.part.updated',
          data: {
            sessionId,
            partId,
            messageId,
            tool,
            title,
            status,
          },
        }
      }

      return null
    }

    default:
      return null
  }
}
