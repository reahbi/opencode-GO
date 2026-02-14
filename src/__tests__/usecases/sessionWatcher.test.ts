import { describe, it, expect, mock, beforeEach } from 'bun:test'

import type { ClaudeEvent } from '../../domain/events.js'
import type { QueryHandle } from '../../domain/ports/ClaudeAgentPort.js'
import { createSessionWatcher } from '../../app/usecases/sessionWatcher.js'
import {
  buildChatState,
  buildUserSettings,
  buildQuestionEvent,
  createMockChatOutputPort,
  createMockStateStore,
  waitFor,
} from '../helpers/index.js'

const chatId = 99
const directory = '/test'
const sessionId = 'ses-1'

function createMockQueryHandle(events: ClaudeEvent[]): QueryHandle {
  async function* generator() {
    for (const event of events) {
      yield event
    }
  }

  return {
    messages: generator(),
    abort: mock(() => undefined),
    sessionId,
  }
}

describe('sessionWatcher', () => {
  let output: ReturnType<typeof createMockChatOutputPort>
  let state: ReturnType<typeof createMockStateStore>
  let summary: { summarize: ReturnType<typeof mock>; summarizeForVoice: ReturnType<typeof mock> }
  let onQuestionAsked: ReturnType<typeof mock>

  beforeEach(() => {
    output = createMockChatOutputPort()
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: sessionId,
      settings: buildUserSettings({ summaryMode: false, summaryModel: null }),
    }))
    summary = {
      summarize: mock(() => Promise.resolve('summarized text')),
      summarizeForVoice: mock(() => Promise.resolve('voice summary')),
    }
    onQuestionAsked = mock(() => Promise.resolve())
  })

  it('starts watching and stops cleanly', async () => {
    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)

    expect(watcher.isWatching(chatId)).toBe(true)

    watcher.stop(chatId)
    expect(watcher.isWatching(chatId)).toBe(false)
  })

  it('uses a prompt handle for user-initiated queries', async () => {
    const events: ClaudeEvent[] = [
      { type: 'text.delta', sessionId, content: 'hello' },
      { type: 'text.done', sessionId, content: 'hello world', uuid: 'uuid-1' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: true })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.editText).toHaveBeenCalled())
    expect(output.sendText).not.toHaveBeenCalled()
    expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String))

    watcher.stop(chatId)
  })

  it('delivers a final response on result success', async () => {
    const events: ClaudeEvent[] = [
      { type: 'text.delta', sessionId, content: 'short ' },
      { type: 'text.delta', sessionId, content: 'response' },
      { type: 'text.done', sessionId, content: 'short response', uuid: 'uuid-1' },
      { type: 'result', sessionId, subtype: 'success' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.editText).toHaveBeenCalled())

    watcher.stop(chatId)
  })

  it('sends a file when the final response exceeds the file threshold', async () => {
    const longContent = 'x'.repeat(20000)
    const events: ClaudeEvent[] = [
      { type: 'text.delta', sessionId, content: longContent },
      { type: 'text.done', sessionId, content: longContent, uuid: 'uuid-1' },
      { type: 'result', sessionId, subtype: 'success' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
    watcher.stop(chatId)
  })

  it('reports errors to the chat', async () => {
    const events: ClaudeEvent[] = [
      { type: 'result', sessionId, subtype: 'error', errorMessage: 'Something went wrong' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.sendText).toHaveBeenCalled())

    const calls = (output.sendText as any).mock.calls
    const errorCall = calls.find((c: any) => c[1]?.includes('Error'))
    expect(errorCall).toBeDefined()

    watcher.stop(chatId)
  })

  it('dispatches question events', async () => {
    const questionEvent = buildQuestionEvent({ sessionId })

    // Create AskUserQuestion tool.use event
    const events: ClaudeEvent[] = [
      {
        type: 'tool.use',
        sessionId,
        toolName: 'AskUserQuestion',
        input: { questions: questionEvent.questions },
        toolUseId: 'tool-1',
      },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptContext(chatId, { actorUserId: 55 })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(onQuestionAsked).toHaveBeenCalled())

    watcher.stop(chatId)
  })

  it('displays tool use events', async () => {
    const events: ClaudeEvent[] = [
      { type: 'tool.use', sessionId, toolName: 'Read', input: { file: '/test.ts' }, toolUseId: 'tool-1' },
      { type: 'tool.result', sessionId, toolUseId: 'tool-1', output: 'file contents' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: true })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.editText).toHaveBeenCalled())

    watcher.stop(chatId)
  })

  it('shows thinking indicator', async () => {
    const events: ClaudeEvent[] = [
      { type: 'thinking', sessionId, content: 'analyzing...' },
      { type: 'text.delta', sessionId, content: 'done' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: true })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.editText).toHaveBeenCalled())

    watcher.stop(chatId)
  })

  it('respects liveUpdatesEnabled when streaming', async () => {
    const events: ClaudeEvent[] = [
      { type: 'text.delta', sessionId, content: 'streaming' },
      { type: 'text.done', sessionId, content: 'streaming content', uuid: 'uuid-1' },
      { type: 'result', sessionId, subtype: 'success' },
    ]

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptHandle(chatId, 'prompt-1')
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.editText).toHaveBeenCalled())

    // With liveUpdatesEnabled: false, should only edit once at the end
    expect(output.sendTypingAction).not.toHaveBeenCalled()

    watcher.stop(chatId)
  })

  it('creates a new live message when no prompt handle exists', async () => {
    const events: ClaudeEvent[] = [
      { type: 'text.delta', sessionId, content: 'hello' },
    ]

    output = createMockChatOutputPort({
      sendText: mock(async () => 'live-msg-1'),
    })

    const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

    await watcher.watch(chatId)
    watcher.setPromptContext(chatId, { liveUpdatesEnabled: true })

    const handle = createMockQueryHandle(events)
    watcher.watchQuery(chatId, handle)

    await waitFor(() => expect(output.sendText).toHaveBeenCalled())
    expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('activity detected'))

    watcher.stop(chatId)
  })

  describe('delivery strategies', () => {
    it('delivers chunked responses when formatting splits messages', async () => {
      const chunked = `${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}`
      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: chunked },
        { type: 'text.done', sessionId, content: chunked, uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.editText).toHaveBeenCalled())

      watcher.stop(chatId)
    })

    it('delivers formatted content as a file when oversized', async () => {
      const longContent = 'x'.repeat(16000)
      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: longContent },
        { type: 'text.done', sessionId, content: longContent, uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

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
      let callCount = 0
      output = createMockChatOutputPort({
        editText: mock(async () => {
          callCount += 1
          if (callCount === 1) {
            throw new Error("can't parse entities")
          }
        }),
      })

      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: 'content' },
        { type: 'text.done', sessionId, content: 'safe content', uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledTimes(2)

      watcher.stop(chatId)
    })
  })

  describe('raw and summary modes', () => {
    it('escapes raw output and sends inline response', async () => {
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({ outputMode: 'raw' }),
      }))

      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: '<b>raw</b>' },
        { type: 'text.done', sessionId, content: '<b>raw</b>', uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      const firstCall = (output.editText as any).mock.calls[0]
      expect(firstCall[2]).toContain('&lt;b&gt;raw&lt;/b&gt;')
      expect(firstCall[3]).toBe('HTML')
      expect(output.sendFile).not.toHaveBeenCalled()

      watcher.stop(chatId)
    })

    it('sends raw output as a file when too long', async () => {
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({ outputMode: 'raw' }),
      }))

      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: 'x'.repeat(4000) },
        { type: 'text.done', sessionId, content: 'x'.repeat(4000), uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      watcher.stop(chatId)
    })

    it('summarizes long content and attaches the full response', async () => {
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({
          summaryMode: true,
          summaryModel: { providerID: 'test', modelID: 'model' },
          summaryThreshold: 100,
        }),
      }))
      summary = {
        summarize: mock(() => Promise.resolve('<b>summarized</b>')),
        summarizeForVoice: mock(() => Promise.resolve('voice summary')),
      }

      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: 'x'.repeat(200) },
        { type: 'text.done', sessionId, content: 'x'.repeat(200), uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.sendFile).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String), 'HTML')
      expect(output.sendFile).toHaveBeenCalledWith(
        chatId,
        expect.any(Uint8Array),
        'response.md',
        '📄 Full response',
      )

      watcher.stop(chatId)
    })

    it('falls back to formatted delivery when summary fails', async () => {
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: directory,
        activeSessionId: sessionId,
        settings: buildUserSettings({
          summaryMode: true,
          summaryModel: { providerID: 'test', modelID: 'model' },
          summaryThreshold: 100,
        }),
      }))
      summary = {
        summarize: mock(() => Promise.reject(new Error('summary failed'))),
        summarizeForVoice: mock(() => Promise.resolve('voice summary')),
      }

      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: 'x'.repeat(200) },
        { type: 'text.done', sessionId, content: 'x'.repeat(200), uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'success' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      expect(output.editText).toHaveBeenCalledWith(chatId, 'prompt-1', expect.any(String), 'MarkdownV2')

      watcher.stop(chatId)
    })
  })

  describe('watcher lifecycle', () => {
    it('skips watching when no active directory is set', async () => {
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: null,
        activeSessionId: null,
      }))

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)

      expect(watcher.isWatching(chatId)).toBe(false)
    })

    it('returns early when already watching the same session', async () => {
      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      await watcher.ensureWatching(chatId)

      expect(watcher.isWatching(chatId)).toBe(true)

      watcher.stop(chatId)
    })

    it('re-watches when the active project changes', async () => {
      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)

      // Change the project directory
      state._store.set(String(chatId), buildChatState({
        activeProjectDirectory: '/new/project',
        activeSessionId: 'ses-2',
      }))

      await watcher.ensureWatching(chatId)

      expect(watcher.isWatching(chatId)).toBe(true)

      watcher.stop(chatId)
    })
  })

  describe('system.init event', () => {
    it('processes system.init event without errors', async () => {
      const events: ClaudeEvent[] = [
        { type: 'system.init', sessionId: 'new-session-id', model: 'claude-4', tools: ['Read', 'Write'] },
        { type: 'text.delta', sessionId, content: 'hello' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: true })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      // Just verify the watcher processes the events without crashing
      await waitFor(() => expect(output.editText).toHaveBeenCalled())

      watcher.stop(chatId)
    })
  })

  describe('error handling', () => {
    it('handles stream error events', async () => {
      const events: ClaudeEvent[] = [
        { type: 'error', sessionId, message: 'Stream error occurred' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.sendText).toHaveBeenCalled())

      const calls = (output.sendText as any).mock.calls
      const errorCall = calls.find((c: any) => c[1]?.includes('Error'))
      expect(errorCall).toBeDefined()

      watcher.stop(chatId)
    })

    it('delivers accumulated content before reporting result errors', async () => {
      const events: ClaudeEvent[] = [
        { type: 'text.delta', sessionId, content: 'partial' },
        { type: 'text.done', sessionId, content: 'partial content', uuid: 'uuid-1' },
        { type: 'result', sessionId, subtype: 'error', errorMessage: 'Query failed' },
      ]

      const watcher = createSessionWatcher({ state, output, summary, onQuestionAsked })

      await watcher.watch(chatId)
      watcher.setPromptHandle(chatId, 'prompt-1')
      watcher.setPromptContext(chatId, { liveUpdatesEnabled: false })

      const handle = createMockQueryHandle(events)
      watcher.watchQuery(chatId, handle)

      await waitFor(() => expect(output.editText).toHaveBeenCalled())
      await waitFor(() => expect(output.sendText).toHaveBeenCalled())

      watcher.stop(chatId)
    })
  })
})
