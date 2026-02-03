import { describe, it, expect, mock, beforeEach } from 'bun:test'

import type { OpenCodeEvent } from '../../domain/events.js'
import type { SessionStatus } from '../../domain/models.js'
import { createSessionWatcher } from '../../app/usecases/sessionWatcher.js'
import {
  buildChatState,
  buildAgentOutput,
  buildHistoryMessage,
  buildUserSettings,
  buildPermissionEvent,
  buildQuestionEvent,
  createDeferredPromise,
  createMockChatOutputPort,
  createMockOpenCodePort,
  createMockStateStore,
  flushPromises,
  waitFor,
} from '../helpers/index.js'

const chatId = 99
const directory = '/test'
const sessionId = 'ses-1'

const assistantMessage = (messageId = 'msg-1'): OpenCodeEvent => ({
  type: 'message.updated',
  data: { sessionId, messageId, role: 'assistant' },
})

const messagePart = (content: string, messageId = 'msg-1'): OpenCodeEvent => ({
  type: 'message.part.updated',
  data: { sessionId, partId: 'part-1', messageId, content, finished: false },
})

const sessionIdle: OpenCodeEvent = { type: 'session.idle', data: { sessionId } }
const sessionBusy: OpenCodeEvent = { type: 'session.busy', data: { sessionId } }
const sessionError: OpenCodeEvent = { type: 'session.error', data: { sessionId, error: 'boom' } }
const sessionRetry: OpenCodeEvent = {
  type: 'session.retry',
  data: { sessionId, attempt: 2, message: 'retrying', next: 0 },
}

type StreamGate = { promise: Promise<void> }

const createOpenCodeWithEvents = (
  events: OpenCodeEvent[],
  options: { gate?: StreamGate; statuses?: Record<string, SessionStatus> } = {},
) => {
  const streamEvents = mock(async (_dir, handler, signal) => {
    if (options.gate) {
      await options.gate.promise
    }
    for (const event of events) {
      await handler(event)
    }
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  })

  const getSessionStatuses = mock(async () => options.statuses ?? {})

  return createMockOpenCodePort({ streamEvents, getSessionStatuses })
}

describe('sessionWatcher', () => {
  let output: ReturnType<typeof createMockChatOutputPort>
  let state: ReturnType<typeof createMockStateStore>
  let summary: { summarize: ReturnType<typeof mock> }
  let onPermissionAsked: ReturnType<typeof mock>
  let onQuestionAsked: ReturnType<typeof mock>

  beforeEach(() => {
    output = createMockChatOutputPort()
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: sessionId,
    }))
    summary = { summarize: mock(() => Promise.resolve('summarized text')) }
    onPermissionAsked = mock(() => Promise.resolve())
    onQuestionAsked = mock(() => Promise.resolve())
  })

  it('starts streaming on watch and stops cleanly', async () => {
    const openCode = createOpenCodeWithEvents([])
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)

    expect(openCode.streamEvents).toHaveBeenCalledWith(
      directory,
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(watcher.isWatching(chatId)).toBe(true)

    watcher.stop(chatId)
    expect(watcher.isWatching(chatId)).toBe(false)
  })

  it('uses a prompt handle without creating a new live message', async () => {
    const gate = createDeferredPromise<void>()
    const openCode = createOpenCodeWithEvents(
      [assistantMessage(), messagePart('hello')],
      { gate },
    )
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    gate.resolve()

    await waitFor(() => expect(output.editText).toHaveBeenCalled())
    expect(output.sendText).not.toHaveBeenCalled()
    expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String))

    watcher.stop(chatId)
  })

  it('ignores message parts that are not from tracked assistant messages', async () => {
    const openCode = createOpenCodeWithEvents([messagePart('ignored', 'msg-x')])
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    await waitFor(() => expect(openCode.streamEvents).toHaveBeenCalled())
    await flushPromises()

    expect(output.editText).not.toHaveBeenCalled()
    expect(output.sendText).not.toHaveBeenCalled()

    watcher.stop(chatId)
  })

  it('delivers a final inline response on session idle', async () => {
    const gate = createDeferredPromise<void>()
    const openCode = createOpenCodeWithEvents(
      [assistantMessage(), messagePart('short response'), sessionIdle],
      { gate },
    )
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
    gate.resolve()

    await waitFor(() => expect(output.editText).toHaveBeenCalled())
    expect(output.sendFile).not.toHaveBeenCalled()

    watcher.stop(chatId)
  })

  it('sends a file when the final response exceeds the file threshold', async () => {
    const gate = createDeferredPromise<void>()
    const longContent = 'x'.repeat(20000)
    const openCode = createOpenCodeWithEvents(
      [assistantMessage(), messagePart(longContent), sessionIdle],
      { gate },
    )
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
    gate.resolve()

    await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
    watcher.stop(chatId)
  })

  it('reports session errors to the chat', async () => {
    const openCode = createOpenCodeWithEvents([sessionError])
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    await waitFor(() => expect(output.sendText).toHaveBeenCalled())

    expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('Error'))
    watcher.stop(chatId)
  })

  it('notifies busy status once even if repeated', async () => {
    const openCode = createOpenCodeWithEvents([sessionBusy, sessionBusy])
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    await waitFor(() => expect(output.sendText).toHaveBeenCalled())

    expect(output.sendText).toHaveBeenCalledTimes(1)
    watcher.stop(chatId)
  })

  it('sends retry notifications when session.retry arrives', async () => {
    const openCode = createOpenCodeWithEvents([sessionRetry])
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    await waitFor(() => expect(output.sendText).toHaveBeenCalled())

    expect(output.sendText).toHaveBeenCalledWith(chatId, expect.any(String))
    watcher.stop(chatId)
  })

  it('dispatches permission events with actor context', async () => {
    const gate = createDeferredPromise<void>()
    const permissionEvent = buildPermissionEvent({ sessionId })
    const openCode = createOpenCodeWithEvents([permissionEvent], { gate })
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptContext(chatId, { actorUserId: 123 })
    gate.resolve()

    await waitFor(() => expect(onPermissionAsked).toHaveBeenCalled())
    expect(onPermissionAsked).toHaveBeenCalledWith(
      chatId,
      permissionEvent.data,
      123,
    )

    watcher.stop(chatId)
  })

  it('dispatches question events with actor context', async () => {
    const gate = createDeferredPromise<void>()
    const questionEvent = buildQuestionEvent({ sessionId })
    const openCode = createOpenCodeWithEvents([questionEvent], { gate })
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptContext(chatId, { actorUserId: 55 })
    gate.resolve()

    await waitFor(() => expect(onQuestionAsked).toHaveBeenCalled())
    expect(onQuestionAsked).toHaveBeenCalledWith(
      chatId,
      questionEvent.data,
      55,
    )

    watcher.stop(chatId)
  })

  it('announces retry status on initial session check', async () => {
    const statuses: Record<string, SessionStatus> = {
      [sessionId]: { type: 'retry', attempt: 2, message: 'retrying', next: 0 },
    }
    const openCode = createOpenCodeWithEvents([], { statuses })
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)

    await waitFor(() => expect(output.sendText).toHaveBeenCalled())
    expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('2'))

    watcher.stop(chatId)
  })

  it('respects liveUpdatesEnabled when streaming parts', async () => {
    const gate = createDeferredPromise<void>()
    const openCode = createOpenCodeWithEvents(
      [assistantMessage(), messagePart('streamed')],
      { gate },
    )
    const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
    gate.resolve()

    await waitFor(() => expect(openCode.streamEvents).toHaveBeenCalled())
    await flushPromises()

    expect(output.editText).not.toHaveBeenCalled()
    watcher.stop(chatId)
  })

  describe('delivery strategies', () => {
    it('delivers chunked responses when formatting splits messages', async () => {
      const gate = createDeferredPromise<void>()
      const chunked = `${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}`
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart(chunked), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String), 'MarkdownV2')
      expect(output.sendText).toHaveBeenCalledTimes(1)
      expect(output.sendFile).not.toHaveBeenCalled()

      watcher.stop(chatId)
    })

    it('delivers formatted content as a file when oversized', async () => {
      const gate = createDeferredPromise<void>()
      const longContent = 'x'.repeat(16000)
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart(longContent), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(
        chatId,
        'prompt-1',
        expect.stringContaining('full response attached'),
        'HTML',
      )

      watcher.stop(chatId)
    })

    it('falls back to file delivery when parsing fails', async () => {
      const gate = createDeferredPromise<void>()
      let callCount = 0
      output = createMockChatOutputPort({
        editText: mock(async () => {
          callCount += 1
          if (callCount === 1) {
            throw new Error("can't parse entities")
          }
        }),
      })
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('safe content'), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledTimes(2)

      watcher.stop(chatId)
    })

    it('reports unexpected delivery errors during idle handling', async () => {
      const gate = createDeferredPromise<void>()
      const editText = mock(async (
        _chatId: number,
        _handle: string,
        _text: string,
        _parseMode?: string,
      ) => {
        throw new Error('network blew up')
      })
      output = createMockChatOutputPort({ editText })
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('formatted'), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(
        chatId,
        'prompt-1',
        expect.stringContaining('Delivery error'),
      )

      watcher.stop(chatId)
    })
  })

  describe('raw and summary modes', () => {
    it('escapes raw output and sends inline response', async () => {
      const gate = createDeferredPromise<void>()
      const editText = mock((
        _chatId: number,
        _handle: string,
        _text: string,
        _parseMode?: string,
      ) => Promise.resolve())
      output = createMockChatOutputPort({ editText })
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({ outputMode: 'raw' }),
      }))
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('<b>raw</b>'), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      const firstCall = editText.mock.calls[0]
      expect(firstCall[2]).toContain('&lt;b&gt;raw&lt;/b&gt;')
      expect(firstCall[3]).toBe('HTML')
      expect(output.sendFile).not.toHaveBeenCalled()

      watcher.stop(chatId)
    })

    it('sends raw output as a file when too long', async () => {
      const gate = createDeferredPromise<void>()
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({ outputMode: 'raw' }),
      }))
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('x'.repeat(4000)), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('summarizes long content and attaches the full response', async () => {
      const gate = createDeferredPromise<void>()
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({
          summaryMode: true,
          summaryModel: { providerID: 'test', modelID: 'model' },
          summaryThreshold: 100,
        }),
      }))
      summary = { summarize: mock(() => Promise.resolve('<b>summarized</b>')) }
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('x'.repeat(200)), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String), 'HTML')
      expect(output.sendFile).toHaveBeenCalledWith(
        chatId,
        expect.any(Buffer),
        'response.md',
        '📄 Full response',
      )

      watcher.stop(chatId)
    })

    it('strips summary HTML when Telegram rejects sanitized markup', async () => {
      const gate = createDeferredPromise<void>()
      let callCount = 0
      const editText = mock(async (
        _chatId: number,
        _handle: string,
        _text: string,
        _parseMode?: string,
      ) => {
        callCount += 1
        if (callCount === 1) {
          throw new Error("can't parse entities")
        }
      })
      output = createMockChatOutputPort({
        editText,
      })
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({
          summaryMode: true,
          summaryModel: { providerID: 'test', modelID: 'model' },
          summaryThreshold: 100,
        }),
      }))
      summary = { summarize: mock(() => Promise.resolve('<b>summarized</b>')) }
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('x'.repeat(200)), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledTimes(2)
      const calls = editText.mock.calls
      expect(calls[0][3]).toBe('HTML')
      expect(calls[1][3]).toBeUndefined()

      watcher.stop(chatId)
    })

    it('falls back to formatted delivery when summary fails', async () => {
      const gate = createDeferredPromise<void>()
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({
          summaryMode: true,
          summaryModel: { providerID: 'test', modelID: 'model' },
          summaryThreshold: 100,
        }),
      }))
      summary = { summarize: mock(() => Promise.reject(new Error('summary failed'))) }
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('x'.repeat(200)), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String), 'MarkdownV2')

      watcher.stop(chatId)
    })
  })

  describe('streaming edits and live messages', () => {
    it('delays edits when updates arrive within the throttle window', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('first'), messagePart('second')],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalledTimes(2), 2500, 50)
      watcher.stop(chatId)
    })

    it('creates a new live message when no prompt handle exists', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('hello')],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())
      expect(output.sendText).toHaveBeenCalledWith(chatId, '📡 Session activity detected...')

      watcher.stop(chatId)
    })

    it('retries live message creation after sendText failures', async () => {
      const gate = createDeferredPromise<void>()
      let callCount = 0
      output = createMockChatOutputPort({
        sendText: mock(async () => {
          callCount += 1
          if (callCount === 1) {
            throw new Error('send failed')
          }
          return 'msg-1'
        }),
      })
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('hello')],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      gate.resolve()

      await waitFor(() => expect(output.sendText).toHaveBeenCalledTimes(2))
      watcher.stop(chatId)
    })

    it('truncates long streamed content for live edits', async () => {
      const gate = createDeferredPromise<void>()
      const longContent = 'x'.repeat(4000)
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart(longContent)],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(
        chatId,
        'prompt-1',
        expect.stringContaining('... streaming (will send full response when done)'),
      )

      watcher.stop(chatId)
    })

    it('clears pending edits and typing indicators on idle', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('first'), messagePart('second'), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      gate.resolve()

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())
      await waitFor(() => expect(output.editText).toHaveBeenCalled())

      watcher.stop(chatId)
    })

    it('clears pending edit timers when new parts arrive quickly', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('first'), messagePart('second'), messagePart('third')],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('re-enables live updates via prompt context', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('streamed')],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: true })
      watcher.setPromptHandle(chatId, 'prompt-1')
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      watcher.stop(chatId)
    })
  })

  describe('status handling', () => {
    it('reports delivery errors when idle handling fails', async () => {
      const gate = createDeferredPromise<void>()
      const baseState = buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
      })
      state = createMockStateStore(baseState)
      let callCount = 0
      state.getChatState = mock(async () => {
        callCount += 1
        if (callCount === 1) return baseState
        throw new Error('state down')
      })
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('content'), sessionIdle],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(
        chatId,
        'prompt-1',
        expect.stringContaining('Delivery error'),
      )

      watcher.stop(chatId)
    })

    it('delivers accumulated content before reporting session errors', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('final content'), sessionError],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalled()

      watcher.stop(chatId)
    })

    it('clears timers when session error arrives during throttling', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('first'), messagePart('second'), sessionError],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      gate.resolve()

      await waitFor(() => expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('Error')))
      watcher.stop(chatId)
    })

    it('delivers last assistant response when session is idle on watch start', async () => {
      const openCode = createOpenCodeWithEvents([])
      openCode.getSessionMessages = mock(async () => [
        buildHistoryMessage({
          role: 'assistant',
          parts: [{ type: 'text', text: 'last reply' }],
        }),
      ])
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())
      expect(output.sendText).toHaveBeenCalledWith(chatId, '📋 Loading last response...')
      expect(output.editText).toHaveBeenCalled()

      watcher.stop(chatId)
    })

    it('announces busy status on initial session check', async () => {
      const statuses: Record<string, SessionStatus> = {
        [sessionId]: { type: 'busy' },
      }
      const openCode = createOpenCodeWithEvents([], { statuses })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())
      expect(output.sendText).toHaveBeenCalledWith(chatId, '🔄 AI is working...')

      watcher.stop(chatId)
    })

    it('falls back to truncated content when session error delivery fails', async () => {
      const gate = createDeferredPromise<void>()
      const baseState = buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
      })
      state = createMockStateStore(baseState)
      let callCount = 0
      state.getChatState = mock(async () => {
        callCount += 1
        if (callCount === 1) return baseState
        throw new Error('state failed')
      })
      const openCode = createOpenCodeWithEvents(
        [assistantMessage(), messagePart('content'), sessionError],
        { gate },
      )
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })
      gate.resolve()

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('logs permission handler failures without crashing', async () => {
      const gate = createDeferredPromise<void>()
      const permissionEvent = buildPermissionEvent({ sessionId })
      onPermissionAsked = mock(() => Promise.reject(new Error('perm fail')))
      const openCode = createOpenCodeWithEvents([permissionEvent], { gate })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      gate.resolve()

      await waitFor(() => expect(onPermissionAsked).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('logs question handler failures without crashing', async () => {
      const gate = createDeferredPromise<void>()
      const questionEvent = buildQuestionEvent({ sessionId })
      onQuestionAsked = mock(() => Promise.reject(new Error('question fail')))
      const openCode = createOpenCodeWithEvents([questionEvent], { gate })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      gate.resolve()

      await waitFor(() => expect(onQuestionAsked).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('handles failures during initial status checks', async () => {
      const openCode = createMockOpenCodePort({
        getSessionStatuses: mock(() => Promise.reject(new Error('status fail'))),
        streamEvents: mock(async (_dir, _handler, signal) => {
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve()
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        }),
      })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      await waitFor(() => expect(openCode.getSessionStatuses).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('ignores unhandled events', async () => {
      const gate = createDeferredPromise<void>()
      const openCode = createOpenCodeWithEvents([
        { type: 'agent.output', data: buildAgentOutput({ sessionId }) },
      ], { gate })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      gate.resolve()

      await waitFor(() => expect(openCode.streamEvents).toHaveBeenCalled())
      expect(output.sendText).not.toHaveBeenCalled()
      expect(output.editText).not.toHaveBeenCalled()

      watcher.stop(chatId)
    })

    it('handles failures while loading the last response', async () => {
      const openCode = createOpenCodeWithEvents([])
      openCode.getSessionMessages = mock(() => Promise.reject(new Error('history failed')))
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      await waitFor(() => expect(openCode.getSessionMessages).toHaveBeenCalled())
      watcher.stop(chatId)
    })
  })

  describe('watcher lifecycle', () => {
    it('skips watching when no active session is set', async () => {
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: null,
        activeSessionId: null,
      }))
      const openCode = createOpenCodeWithEvents([])
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      expect(openCode.streamEvents).not.toHaveBeenCalled()
      expect(watcher.isWatching(chatId)).toBe(false)
    })

    it('reconnects after SSE errors with backoff', async () => {
      let callCount = 0
      const streamEvents = mock(async (_dir, _handler, signal) => {
        callCount += 1
        if (callCount === 1) {
          throw new Error('sse down')
        }
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      })
      const openCode = createMockOpenCodePort({ streamEvents })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      await waitFor(() => expect(openCode.streamEvents).toHaveBeenCalledTimes(2), 3000, 100)
      watcher.stop(chatId)
    })

    it('reconnects after clean SSE disconnects', async () => {
      const streamEvents = mock(async () => Promise.resolve())
      const openCode = createMockOpenCodePort({ streamEvents })
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)

      await waitFor(() => expect(openCode.streamEvents).toHaveBeenCalledTimes(2), 3000, 100)
      watcher.stop(chatId)
    })

    it('returns early when already watching the same session', async () => {
      const openCode = createOpenCodeWithEvents([])
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      await watcher.ensureWatching(chatId)

      expect(openCode.streamEvents).toHaveBeenCalledTimes(1)
      watcher.stop(chatId)
    })

    it('re-watches when the active session changes', async () => {
      const openCode = createOpenCodeWithEvents([])
      const watcher = createSessionWatcher({ openCode, state, output, summary, onPermissionAsked, onQuestionAsked })

      await watcher.watch(chatId)
      state._store.set(chatId, buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: 'ses-2',
      }))

      await watcher.ensureWatching(chatId)

      await waitFor(() => expect(openCode.streamEvents).toHaveBeenCalledTimes(2))
      watcher.stop(chatId)
    })
  })
})
