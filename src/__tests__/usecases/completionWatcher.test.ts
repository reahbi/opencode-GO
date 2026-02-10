import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { createCompletionWatcher } from '../../app/usecases/completionWatcher.js'
import { LIMITS } from '../../app/policies/limits.js'
import { createMockOpenCodePort } from '../helpers/mockOpenCodePort.js'
import type { OpenCodeEvent } from '../../domain/events.js'
import type { HookNotification } from '../../domain/hookBotTypes.js'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'

type Project = { directory: string; name: string }

function sleepTick(): Promise<void> {
  return Promise.resolve()
}

async function waitFor(condition: () => boolean, maxSpins = 2000): Promise<void> {
  let spins = 0
  while (!condition()) {
    if (spins >= maxSpins) {
      throw new Error('Timed out waiting for condition')
    }
    spins += 1
    await sleepTick()
  }
}

function createTestHarness(options?: {
  statuses?: Record<string, { type: 'busy' | 'idle' }>
}) {
  let sseHandler: ((event: OpenCodeEvent) => Promise<void>) | null = null
  let lastSignal: AbortSignal | null = null

  const mockNotify = jest.fn<(n: HookNotification) => Promise<void>>().mockResolvedValue(undefined)
  const notificationPort: HookNotificationPort = { notify: mockNotify }

  const mockStreamEvents = jest.fn().mockImplementation(
    async (_dir: string, handler: (e: OpenCodeEvent) => Promise<void>, signal: AbortSignal) => {
      sseHandler = handler
      lastSignal = signal
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    },
  )

  const mockGetSessionStatuses = jest
    .fn()
    .mockResolvedValue(options?.statuses ?? {})

  const openCode = createMockOpenCodePort()
  openCode.streamEvents = mockStreamEvents as typeof openCode.streamEvents
  openCode.getSessionStatuses = mockGetSessionStatuses as typeof openCode.getSessionStatuses

  const watcher = createCompletionWatcher({ openCode, notificationPort })

  async function emit(event: OpenCodeEvent): Promise<void> {
    if (!sseHandler) {
      throw new Error('SSE handler has not been registered')
    }
    await sseHandler(event)
  }

  return {
    watcher,
    openCode,
    mockNotify,
    mockStreamEvents,
    mockGetSessionStatuses,
    emit,
    getSignal: () => lastSignal,
  }
}

describe('createCompletionWatcher', () => {
  const activeWatchers: Array<{ stopAll: () => void }> = []
  const project: Project = { directory: '/repo/project-a', name: 'Project A' }

  beforeEach(() => {
    jest.useRealTimers()
  })

  afterEach(() => {
    for (const watcher of activeWatchers.splice(0)) {
      watcher.stopAll()
    }
    jest.useRealTimers()
  })

  it('busy -> idle triggers completion notification', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.busy', data: { sessionId: 's-1' } })
    await h.emit({ type: 'session.idle', data: { sessionId: 's-1' } })

    await waitFor(() => h.mockNotify.mock.calls.length === 1)
    expect(h.mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completion',
        sessionId: 's-1',
        directory: project.directory,
        projectName: project.name,
      }),
    )
  })

  it('uses latest assistant text even if newest assistant message has no text', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    h.openCode.getSession = async () => ({
      id: 's-1',
      title: 'Test title',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    h.openCode.getSessionMessages = async () => ([
      {
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: 'Do the thing' }],
      },
      {
        role: 'assistant',
        createdAt: 2,
        parts: [{ type: 'text', text: 'Here is the real answer.' }],
      },
      {
        role: 'assistant',
        createdAt: 3,
        parts: [{ type: 'tool', tool: 'bash', title: 'Run tests', status: 'completed' }],
      },
    ])

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.busy', data: { sessionId: 's-1' } })
    await h.emit({ type: 'session.idle', data: { sessionId: 's-1' } })

    await waitFor(() => h.mockNotify.mock.calls.length === 1)
    expect(h.mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completion',
        sessionId: 's-1',
        lastMessage: 'Here is the real answer.',
      }),
    )
  })

  it('idle without prior busy triggers untracked completion', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.idle', data: { sessionId: 's-1' } })

    await waitFor(() => h.mockNotify.mock.calls.length === 1)
    expect(h.mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completion',
        sessionId: 's-1',
        directory: project.directory,
        projectName: project.name,
        duration: null,
      }),
    )
  })

  it('idle without prior busy deduplicates within TTL', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.idle', data: { sessionId: 's-1' } })
    await waitFor(() => h.mockNotify.mock.calls.length === 1)

    await h.emit({ type: 'session.idle', data: { sessionId: 's-1' } })
    await sleepTick()

    expect(h.mockNotify.mock.calls.filter(([n]) => n.type === 'completion')).toHaveLength(1)
  })

  it('session.error triggers error notification', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.error', data: { sessionId: 's-1', error: 'boom' } })
    await waitFor(() => h.mockNotify.mock.calls.length === 1)

    expect(h.mockNotify).toHaveBeenCalledWith({
      type: 'error',
      sessionId: 's-1',
      directory: project.directory,
      projectName: project.name,
      error: 'boom',
    })
  })

  it('permission.asked triggers permission notification', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({
      type: 'permission.asked',
      data: {
        requestId: 'req-1',
        sessionId: 's-1',
        permission: 'filesystem.read',
        patterns: ['src/**'],
        title: 'Read files',
      },
    })

    await waitFor(() => h.mockNotify.mock.calls.length === 1)
    expect(h.mockNotify).toHaveBeenCalledWith({
      type: 'permission',
      sessionId: 's-1',
      directory: project.directory,
      projectName: project.name,
      requestId: 'req-1',
      permission: 'filesystem.read',
      patterns: ['src/**'],
      title: 'Read files',
    })
  })

  it('question.asked triggers question notification', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({
      type: 'question.asked',
      data: {
        requestId: 'q-1',
        sessionId: 's-1',
        questions: [
          { id: '1', text: 'Continue?', options: ['yes', 'no'], multiple: false },
          { id: '2', text: 'Pick one' },
        ],
      },
    })

    await waitFor(() => h.mockNotify.mock.calls.length === 1)
    expect(h.mockNotify).toHaveBeenCalledWith({
      type: 'question',
      sessionId: 's-1',
      directory: project.directory,
      projectName: project.name,
      requestId: 'q-1',
      questions: [
        { text: 'Continue?', options: ['yes', 'no'], multiple: false },
        { text: 'Pick one', options: undefined, multiple: undefined },
      ],
    })
  })

  it('stall detection fires after inactivity', async () => {
    jest.useFakeTimers()
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.busy', data: { sessionId: 's-1' } })
    jest.advanceTimersByTime(
      LIMITS.HOOK_STALL_WARNING_MS + LIMITS.HOOK_STALL_CHECK_INTERVAL_MS,
    )
    await sleepTick()

    await waitFor(() => h.mockNotify.mock.calls.length > 0)
    expect(h.mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stall',
        sessionId: 's-1',
        directory: project.directory,
        projectName: project.name,
      }),
    )
  })

  it('startup seeds busy sessions from getSessionStatuses', async () => {
    const h = createTestHarness({ statuses: { 'seeded-1': { type: 'busy' } } })
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])

    const status = h.watcher.getStatus()
    expect(status.projects).toEqual([
      {
        directory: project.directory,
        name: project.name,
        connected: expect.any(Boolean),
        busyCount: 1,
      },
    ])
  })

  it('stopAll aborts SSE connections', async () => {
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    const signal = h.getSignal()
    expect(signal).not.toBeNull()
    expect(signal?.aborted).toBe(false)

    h.watcher.stopAll()
    expect(signal?.aborted).toBe(true)
  })

  it('message.part.updated refreshes lastActivityTime', async () => {
    jest.useFakeTimers()
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.busy', data: { sessionId: 's-1' } })

    jest.advanceTimersByTime(LIMITS.HOOK_STALL_WARNING_MS - 10)
    await h.emit({
      type: 'message.part.updated',
      data: {
        sessionId: 's-1',
        partId: 'part-1',
        messageId: 'msg-1',
        content: 'typing',
        finished: false,
      },
    })

    jest.advanceTimersByTime(20)
    await sleepTick()
    expect(
      h.mockNotify.mock.calls.some(([n]) => n.type === 'stall'),
    ).toBe(false)

    jest.advanceTimersByTime(LIMITS.HOOK_STALL_WARNING_MS + LIMITS.HOOK_STALL_CHECK_INTERVAL_MS)
    await sleepTick()
    expect(
      h.mockNotify.mock.calls.some(([n]) => n.type === 'stall'),
    ).toBe(true)
  })

  it('getStatus returns correct project info', async () => {
    const h = createTestHarness({ statuses: { 'seeded-1': { type: 'busy' } } })
    activeWatchers.push(h.watcher)

    const secondProject: Project = { directory: '/repo/project-b', name: 'Project B' }
    await h.watcher.startWatching([project, secondProject])
    await waitFor(() => h.mockGetSessionStatuses.mock.calls.length >= 2)

    const status = h.watcher.getStatus()
    expect(status.projects).toHaveLength(2)
    expect(status.projects).toEqual(
      expect.arrayContaining([
        {
          directory: project.directory,
          name: project.name,
          connected: expect.any(Boolean),
          busyCount: 1,
        },
        {
          directory: secondProject.directory,
          name: secondProject.name,
          connected: expect.any(Boolean),
          busyCount: 1,
        },
      ]),
    )
  })

  it('tool.part.updated refreshes lastActivityTime', async () => {
    jest.useFakeTimers()
    const h = createTestHarness()
    activeWatchers.push(h.watcher)

    await h.watcher.startWatching([project])
    await waitFor(() => h.mockStreamEvents.mock.calls.length === 1)

    await h.emit({ type: 'session.busy', data: { sessionId: 's-1' } })
    jest.advanceTimersByTime(LIMITS.HOOK_STALL_WARNING_MS - 10)

    await h.emit({
      type: 'tool.part.updated',
      data: {
        sessionId: 's-1',
        partId: 'tp-1',
        messageId: 'msg-1',
        tool: 'grep',
        title: 'Search',
        status: 'running',
      },
    })

    jest.advanceTimersByTime(20)
    await sleepTick()
    expect(
      h.mockNotify.mock.calls.some(([n]) => n.type === 'stall'),
    ).toBe(false)
  })

  it('uses composite key so same sessionId is independent per directory', async () => {
    const mockNotify = jest.fn<(n: HookNotification) => Promise<void>>().mockResolvedValue(undefined)
    const notificationPort: HookNotificationPort = { notify: mockNotify }

    const mockGetSessionStatuses = jest.fn().mockResolvedValue({
      's-shared': { type: 'busy' },
    })

    const sseHandlers = new Map<string, (e: OpenCodeEvent) => void>()
    const mockStreamEvents = jest.fn().mockImplementation(
      async (dir: string, handler: (e: OpenCodeEvent) => void, signal: AbortSignal) => {
        sseHandlers.set(dir, handler)
        await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true }))
      },
    )

    const openCode = createMockOpenCodePort()
    openCode.streamEvents = mockStreamEvents as typeof openCode.streamEvents
    openCode.getSessionStatuses = mockGetSessionStatuses as typeof openCode.getSessionStatuses

    const watcher = createCompletionWatcher({ openCode, notificationPort })
    activeWatchers.push(watcher)

    const projA: Project = { directory: '/repo/a', name: 'A' }
    const projB: Project = { directory: '/repo/b', name: 'B' }
    await watcher.startWatching([projA, projB])

    // Both projects seeded with s-shared as busy
    expect(watcher.getStatus().projects.find(p => p.directory === '/repo/a')?.busyCount).toBe(1)
    expect(watcher.getStatus().projects.find(p => p.directory === '/repo/b')?.busyCount).toBe(1)

    // Wait for SSE handlers to be registered for both projects
    await waitFor(() => sseHandlers.size >= 2)

    // Emit idle for s-shared only in project A's SSE stream
    sseHandlers.get('/repo/a')!({ type: 'session.idle', data: { sessionId: 's-shared' } })
    await sleepTick()

    // Project A should have 0 busy, Project B still has 1
    await waitFor(() => watcher.getStatus().projects.find(p => p.directory === '/repo/a')?.busyCount === 0)
    expect(watcher.getStatus().projects.find(p => p.directory === '/repo/b')?.busyCount).toBe(1)
  })

  it('reconnect reconciliation detects session went idle while disconnected', async () => {
    jest.useFakeTimers()
    const mockNotify = jest.fn<(n: HookNotification) => Promise<void>>().mockResolvedValue(undefined)
    const notificationPort: HookNotificationPort = { notify: mockNotify }

    let statusCallCount = 0
    const mockGetSessionStatuses = jest.fn().mockImplementation(() => {
      statusCallCount++
      // Calls 1-2: busy (seedBusySessions + first reconcileOnReconnect)
      if (statusCallCount <= 2) {
        return Promise.resolve({ 's-1': { type: 'busy' } })
      }
      // Call 3+: idle (session completed while disconnected)
      return Promise.resolve({ 's-1': { type: 'idle' } })
    })

    let streamCallCount = 0
    const mockStreamEvents = jest.fn().mockImplementation(
      async (_dir: string, _handler: (e: OpenCodeEvent) => void, signal: AbortSignal) => {
        streamCallCount++
        if (streamCallCount === 1) {
          // First connection: resolve immediately to simulate disconnect
          return
        }
        // Subsequent connections: stay open
        await new Promise<void>(r => {
          if (signal.aborted) return r()
          signal.addEventListener('abort', () => r(), { once: true })
        })
      },
    )

    const openCode = createMockOpenCodePort()
    openCode.streamEvents = mockStreamEvents as typeof openCode.streamEvents
    openCode.getSessionStatuses = mockGetSessionStatuses as typeof openCode.getSessionStatuses

    const watcher = createCompletionWatcher({ openCode, notificationPort })
    activeWatchers.push(watcher)

    await watcher.startWatching([project])

    // Wait for first SSE connection and disconnect
    await waitFor(() => streamCallCount >= 1)

    // Advance past the 1-second reconnect backoff
    jest.advanceTimersByTime(1500)

    // Wait for reconciliation to detect the session went idle
    await waitFor(() =>
      mockNotify.mock.calls.some(([n]) => n.type === 'completion'),
    )

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completion',
        sessionId: 's-1',
        directory: project.directory,
        projectName: project.name,
      }),
    )
  })
})
