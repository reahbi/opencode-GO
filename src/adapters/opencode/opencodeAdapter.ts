import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { SessionRef, HistoryMessage, HistoryPart } from '../../domain/models.js'
import type { AgentOutput } from '../../domain/events.js'
import { OpenCodeApiError, OpenCodeConnectionError, SessionNotFoundError } from '../../domain/errors.js'
import { logger } from '../../shared/logger.js'
import { mapSdkEvent } from './eventMapper.js'

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isConnectionError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.code === 'ConnectionRefused' || error.code === 'ECONNREFUSED'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  if (isRecord(error) && typeof error.code === 'string') return `Connection error: ${error.code}`
  if (isRecord(error)) {
    const data = error.data
    if (isRecord(data) && typeof data.message === 'string') return data.message
  }
  return 'Unknown error'
}

function isDomainError(
  error: unknown
): error is OpenCodeApiError | OpenCodeConnectionError | SessionNotFoundError {
  return (
    error instanceof OpenCodeApiError ||
    error instanceof OpenCodeConnectionError ||
    error instanceof SessionNotFoundError
  )
}

function toSessionRef(session: unknown): SessionRef | null {
  if (!isRecord(session)) return null
  const id = getString(session.id)
  const title = getString(session.title)
  const time = isRecord(session.time) ? session.time : null
  const created = time && typeof time.created === 'number' ? time.created : null
  const updated = time && typeof time.updated === 'number' ? time.updated : null
  if (!id || title === null || created === null || updated === null) return null
  return {
    id,
    title,
    createdAt: new Date(created).toISOString(),
    updatedAt: new Date(updated).toISOString(),
  }
}

function unwrap<T>(result: { data?: T; error?: unknown }, method: string, serverUrl: string, sessionId?: string): T {
  if (result.error) {
    const err = result.error
    if (isConnectionError(err)) {
      throw new OpenCodeConnectionError(serverUrl)
    }
    const message = getErrorMessage(err)
    if (sessionId && message.toLowerCase().includes('not found')) {
      throw new SessionNotFoundError(sessionId)
    }
    throw new OpenCodeApiError(method, 0, message)
  }
  return result.data as T
}

function extractEventPayload(event: unknown): unknown {
  if (isRecord(event) && 'payload' in event) {
    return event.payload
  }
  return event
}

export function createOpenCodeAdapter(serverUrl: string, username: string, password: string | null): OpenCodePort {
  const clientOptions: { baseUrl: string; headers?: Record<string, string> } = {
    baseUrl: serverUrl,
  }
  if (password !== null) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64')
    clientOptions.headers = { Authorization: `Basic ${credentials}` }
  }

  const client: OpencodeClient = createOpencodeClient(clientOptions)

  return {
    async createSession(directory, title) {
      try {
        const result = await client.session.create({ directory, title })
        const data = unwrap(result, 'session.create', serverUrl)
        const sessionRef = toSessionRef(data)
        if (!sessionRef) {
          throw new OpenCodeApiError('session.create', 500, 'Invalid session response')
        }
        return sessionRef
      } catch (error) {
        logger.error('opencode', `session.create failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async getSession(sessionId, directory) {
      try {
        const result = await client.session.get({ sessionID: sessionId, directory })
        const data = unwrap(result, 'session.get', serverUrl, sessionId)
        const sessionRef = toSessionRef(data)
        if (!sessionRef) {
          throw new OpenCodeApiError('session.get', 500, 'Invalid session response')
        }
        return sessionRef
      } catch (error) {
        if (error instanceof SessionNotFoundError) return null
        logger.error('opencode', `session.get failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async listSessions(directory) {
      try {
        const result = await client.session.list({ directory })
        const data = unwrap(result, 'session.list', serverUrl)
        if (!Array.isArray(data)) {
          throw new OpenCodeApiError('session.list', 500, 'Invalid sessions response')
        }
        return data
          .map((session) => toSessionRef(session))
          .filter((session): session is SessionRef => session !== null)
      } catch (error) {
        logger.error('opencode', `session.list failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async deleteSession(sessionId, directory) {
      try {
        const result = await client.session.delete({ sessionID: sessionId, directory })
        unwrap(result, 'session.delete', serverUrl, sessionId)
      } catch (error) {
        logger.error('opencode', `session.delete failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async sendPrompt(sessionId, directory, text, agent) {
      try {
        const result = await client.session.prompt({
          sessionID: sessionId,
          directory,
          ...(agent ? { agent } : {}),
          parts: [{ type: 'text', text }],
        })
        unwrap(result, 'session.prompt', serverUrl, sessionId)
      } catch (error) {
        logger.error('opencode', `session.prompt failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }

      const output: AgentOutput = { sessionId, parts: [] }
      return output
    },

    async sendPromptAsync(sessionId, directory, text, model) {
      try {
        const result = await client.session.prompt({
          sessionID: sessionId,
          directory,
          ...(model ? { model } : {}),
          parts: [{ type: 'text', text }],
        })
        unwrap(result, 'session.prompt (async)', serverUrl, sessionId)
      } catch (error) {
        logger.error('opencode', `session.prompt (async) failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async abortSession(sessionId, directory) {
      try {
        const result = await client.session.abort({ sessionID: sessionId, directory })
        unwrap(result, 'session.abort', serverUrl, sessionId)
      } catch (error) {
        logger.error('opencode', `session.abort failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async getSessionMessages(sessionId, directory) {
      try {
        const result = await client.session.messages({ sessionID: sessionId, directory })
        const data = unwrap(result, 'session.messages', serverUrl, sessionId)
        if (!Array.isArray(data)) {
          throw new OpenCodeApiError('session.messages', 500, 'Invalid messages response')
        }
        return data.map((msg: { info: unknown; parts: unknown[] }) => {
          const info = msg.info as RecordLike
          const role = info.role === 'user' ? 'user' as const : 'assistant' as const
          const time = isRecord(info.time) ? info.time : null
          const createdAt = time && typeof time.created === 'number' ? time.created : Date.now()

          const parts: HistoryPart[] = []
          for (const part of msg.parts) {
            if (!isRecord(part)) continue
            const partType = getString(part.type)
            if (partType === 'text' && typeof part.text === 'string' && part.text.trim()) {
              parts.push({ type: 'text', text: part.text })
            } else if (partType === 'tool' && typeof part.tool === 'string') {
              const state = isRecord(part.state) ? part.state : null
              const status = state && typeof state.status === 'string' ? state.status : 'unknown'
              const title = state && typeof state.title === 'string' ? state.title : part.tool
              parts.push({ type: 'tool', tool: part.tool, title: String(title), status })
            } else if (partType === 'subtask' && typeof part.description === 'string') {
              const agent = typeof part.agent === 'string' ? part.agent : 'unknown'
              parts.push({ type: 'subtask', description: part.description, agent })
            }
          }

          return { role, createdAt, parts } satisfies HistoryMessage
        })
      } catch (error) {
        logger.error('opencode', `session.messages failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async streamEvents(directory, handler, signal) {
      try {
        const sse = await client.event.subscribe({ directory }, signal ? { signal } : undefined)
        for await (const event of sse.stream) {
          if (signal?.aborted) return
          const domainEvent = mapSdkEvent(extractEventPayload(event))
          if (domainEvent) {
            await handler(domainEvent)
          }
        }
      } catch (error) {
        if (signal?.aborted) return
        logger.error('opencode', `event.subscribe failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async replyPermission(requestId, directory, response) {
      try {
        const result = await client.permission.reply({ requestID: requestId, directory, reply: response })
        unwrap(result, 'permission.reply', serverUrl)
      } catch (error) {
        logger.error('opencode', `permission.reply failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async replyQuestion(requestId, directory, answers) {
      try {
        const result = await client.question.reply({ requestID: requestId, directory, answers })
        unwrap(result, 'question.reply', serverUrl)
      } catch (error) {
        logger.error('opencode', `question.reply failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async rejectQuestion(requestId, directory) {
      try {
        const result = await client.question.reject({ requestID: requestId, directory })
        unwrap(result, 'question.reject', serverUrl)
      } catch (error) {
        logger.error('opencode', `question.reject failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async listModels(directory) {
      try {
        const result = await client.config.providers({ directory })
        const data = unwrap(result, 'config.providers', serverUrl)
        const providers = (data as { providers?: unknown[] }).providers
        if (!Array.isArray(providers)) return []
        const models: { providerID: string; modelID: string; name: string }[] = []
        for (const provider of providers) {
          if (!isRecord(provider)) continue
          const pid = getString(provider.id) || ''
          const providerModels = provider.models
          if (!isRecord(providerModels)) continue
          for (const [modelId, modelData] of Object.entries(providerModels)) {
            if (!isRecord(modelData)) continue
            models.push({
              providerID: pid,
              modelID: modelId,
              name: getString(modelData.name) || modelId,
            })
          }
        }
        return models
      } catch (error) {
        logger.error('opencode', `config.providers failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async listAgents(directory) {
      try {
        const result = await client.app.agents({ directory })
        const data = unwrap(result, 'app.agents', serverUrl)
        if (!Array.isArray(data)) {
          throw new OpenCodeApiError('app.agents', 500, 'Invalid agents response')
        }
        return data
          .filter((a: Record<string, unknown>) => !a.hidden)
          .map((a: Record<string, unknown>) => ({
            name: String(a.name ?? ''),
            description: typeof a.description === 'string' ? a.description : undefined,
            mode: (a.mode as 'subagent' | 'primary' | 'all') ?? 'primary',
          }))
      } catch (error) {
        logger.error('opencode', `app.agents failed: ${getErrorMessage(error)}`)
        if (isDomainError(error)) throw error
        throw new OpenCodeConnectionError(serverUrl, error instanceof Error ? error : undefined)
      }
    },

    async healthCheck() {
      try {
        const result = await client.global.health()
        return !result.error
      } catch {
        return false
      }
    },
  }
}
