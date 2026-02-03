import type { OpenCodePort, ModelInfo } from '../../domain/ports/OpenCodePort.js'
import type { SessionRef, AgentInfo, HistoryMessage, SessionStatus } from '../../domain/models.js'
import type { AgentOutput, EventHandler } from '../../domain/events.js'
import { mock } from 'bun:test'

export function createMockOpenCodePort(overrides: Partial<OpenCodePort> = {}): OpenCodePort {
  const createSession: OpenCodePort['createSession'] = mock(() =>
    Promise.resolve<SessionRef>({
      id: 'test-session',
      title: 'Test',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }),
  )

  const getSession: OpenCodePort['getSession'] = mock(() =>
    Promise.resolve<SessionRef | null>(null),
  )

  const listSessions: OpenCodePort['listSessions'] = mock(() =>
    Promise.resolve<SessionRef[]>([]),
  )

  const deleteSession: OpenCodePort['deleteSession'] = mock(() => Promise.resolve())

  const sendPrompt: OpenCodePort['sendPrompt'] = mock(() =>
    Promise.resolve<AgentOutput>({
      sessionId: 'test-session',
      parts: [{ type: 'text', content: 'mock response' }],
    }),
  )

  const sendPromptAsync: OpenCodePort['sendPromptAsync'] = mock(() => Promise.resolve())

  const abortSession: OpenCodePort['abortSession'] = mock(() => Promise.resolve())

  const getSessionMessages: OpenCodePort['getSessionMessages'] = mock(() =>
    Promise.resolve<HistoryMessage[]>([]),
  )

  const listAgents: OpenCodePort['listAgents'] = mock(() => Promise.resolve<AgentInfo[]>([]))

  const listModels: OpenCodePort['listModels'] = mock(() => Promise.resolve<ModelInfo[]>([]))

  const streamEvents: OpenCodePort['streamEvents'] = mock(
    (_directory: string, _handler: EventHandler, _signal: AbortSignal) => Promise.resolve(),
  )

  const replyPermission: OpenCodePort['replyPermission'] = mock(() => Promise.resolve())

  const replyQuestion: OpenCodePort['replyQuestion'] = mock(() => Promise.resolve())

  const rejectQuestion: OpenCodePort['rejectQuestion'] = mock(() => Promise.resolve())

  const getSessionStatuses: OpenCodePort['getSessionStatuses'] = mock(() =>
    Promise.resolve<Record<string, SessionStatus>>({}),
  )

  const healthCheck: OpenCodePort['healthCheck'] = mock(() => Promise.resolve(true))

  const defaults: OpenCodePort = {
    createSession,
    getSession,
    listSessions,
    deleteSession,
    sendPrompt,
    sendPromptAsync,
    abortSession,
    getSessionMessages,
    listAgents,
    listModels,
    streamEvents,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    getSessionStatuses,
    healthCheck,
  }

  return { ...defaults, ...overrides }
}
