import { describe, it, expect, beforeEach } from 'bun:test'

import { createInteractiveFlow } from '../../app/usecases/interactiveFlow.js'
import {
  buildChatState,
  buildPendingInteraction,
  buildQuestionEvent,
  createMockChatOutputPort,
  createMockStateStore,
} from '../helpers/index.js'

const chatId = 7
const directory = '/test'
const sessionId = 'ses-1'

describe('interactiveFlow', () => {
  let output: ReturnType<typeof createMockChatOutputPort>
  let state: ReturnType<typeof createMockStateStore>

  beforeEach(() => {
    output = createMockChatOutputPort()
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: sessionId,
    }))
  })

  it('stores question interactions and sends initial prompt', async () => {
    const flow = createInteractiveFlow({ output, state })
    const event = buildQuestionEvent({
      sessionId,
      questions: [
        { id: 'q1', text: 'First', options: ['A', 'B'] },
        { id: 'q2', text: 'Second', options: ['C', 'D'] },
      ],
    })

    await flow.handleQuestionEvent(chatId, event)

    const updated = state._store.get(chatId)
    expect(updated?.pendingInteractions.length).toBe(1)
    expect(updated?.pendingInteractions[0]?.type).toBe('question')
    expect(updated?.pendingInteractions[0]?.collectedAnswers?.length).toBe(2)
    expect(updated?.pendingInteractions[0]?.currentQuestionIndex).toBe(0)
    expect(updated?.pendingInteractions[0]?.phase).toBe('answering')
    expect(output.sendInteraction).toHaveBeenCalledWith(chatId, expect.any(String), expect.any(Array))
  })

  it('records answers and advances to the next question', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [null, null],
      currentQuestionIndex: 0,
      phase: 'answering',
      messageHandle: 'msg-1',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionAnswer(chatId, 'int-1', 0, 1)

    const updated = state._store.get(chatId)?.pendingInteractions[0]
    expect(updated?.collectedAnswers?.[0]).toEqual(['B'])
    expect(updated?.currentQuestionIndex).toBe(1)
    expect(updated?.phase).toBe('answering')
    expect(output.editInteraction).toHaveBeenCalledWith(chatId, 'msg-1', expect.any(String), expect.any(Array))
  })

  it('records skips and advances to the next question', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [null, null],
      currentQuestionIndex: 0,
      phase: 'answering',
      messageHandle: 'msg-1',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionSkip(chatId, 'int-1', 0)

    const updated = state._store.get(chatId)?.pendingInteractions[0]
    expect(updated?.collectedAnswers?.[0]).toEqual([])
    expect(updated?.currentQuestionIndex).toBe(1)
    expect(output.editInteraction).toHaveBeenCalledWith(chatId, 'msg-1', expect.any(String), expect.any(Array))
  })

  it('moves back to the previous question', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [['A'], null],
      currentQuestionIndex: 1,
      phase: 'confirm',
      messageHandle: 'msg-1',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionBack(chatId, 'int-1', 1)

    const updated = state._store.get(chatId)?.pendingInteractions[0]
    expect(updated?.currentQuestionIndex).toBe(0)
    expect(updated?.phase).toBe('answering')
    expect(output.editInteraction).toHaveBeenCalledWith(chatId, 'msg-1', expect.any(String), expect.any(Array))
  })

  it('falls back to sending a new interaction when edits fail', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [['A'], null],
      currentQuestionIndex: 1,
      phase: 'confirm',
      messageHandle: 'msg-1',
    })
    output = createMockChatOutputPort({
      editInteraction: () => Promise.reject(new Error('fail')),
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionBack(chatId, 'int-1', 1)

    expect(output.sendInteraction).toHaveBeenCalledWith(chatId, expect.any(String), expect.any(Array))
    const updated = state._store.get(chatId)?.pendingInteractions[0]
    expect(updated?.messageHandle).toBe('interaction-1')
  })

  it('sets awaiting input on type answer requests', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [{ text: 'First', options: ['A', 'B'] }],
      collectedAnswers: [null],
      currentQuestionIndex: 0,
      phase: 'answering',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionType(chatId, 'int-1', 0)

    const updated = state._store.get(chatId)
    expect(updated?.awaitingInput).toBe('question')
    expect(updated?.awaitingInteractionId).toBe('int-1')
    expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('Type your answer'))
  })

  it('handles free-text answers and advances', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [null, null],
      currentQuestionIndex: 0,
      phase: 'answering',
      messageHandle: 'msg-1',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
      awaitingInput: 'question',
      awaitingInteractionId: 'int-1',
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleFreeTextAnswer(chatId, 'typed')

    const updated = state._store.get(chatId)
    const stored = updated?.pendingInteractions[0]
    expect(updated?.awaitingInput).toBe(null)
    expect(updated?.awaitingInteractionId).toBe(null)
    expect(stored?.collectedAnswers?.[0]).toEqual(['typed'])
    expect(stored?.currentQuestionIndex).toBe(1)
    expect(output.editInteraction).toHaveBeenCalledWith(chatId, 'msg-1', expect.any(String), expect.any(Array))
  })

  it('submits answers on confirm and clears interaction', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      requestId: 'req-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [['A'], []],
      currentQuestionIndex: 1,
      phase: 'confirm',
      messageHandle: 'msg-1',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
      awaitingInput: 'question',
      awaitingInteractionId: 'int-1',
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionConfirm(chatId, 'int-1')

    const updated = state._store.get(chatId)
    expect(updated?.pendingInteractions.length).toBe(0)
    expect(updated?.awaitingInput).toBe(null)
    expect(updated?.awaitingInteractionId).toBe(null)
    expect(output.editInteraction).toHaveBeenCalledWith(chatId, 'msg-1', expect.any(String), [])
  })

  it('resets answers and returns to first question', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [
        { text: 'First', options: ['A', 'B'] },
        { text: 'Second', options: ['C', 'D'] },
      ],
      collectedAnswers: [['A'], ['C']],
      currentQuestionIndex: 1,
      phase: 'confirm',
      messageHandle: 'msg-1',
    })
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      pendingInteractions: [interaction],
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionReset(chatId, 'int-1')

    const updated = state._store.get(chatId)?.pendingInteractions[0]
    expect(updated?.collectedAnswers).toEqual([null, null])
    expect(updated?.currentQuestionIndex).toBe(0)
    expect(updated?.phase).toBe('answering')
    expect(output.editInteraction).toHaveBeenCalledWith(chatId, 'msg-1', expect.any(String), expect.any(Array))
  })

  it('removes expired interactions during cleanup', async () => {
    const expired = buildPendingInteraction({ interactionId: 'int-old', expiresAt: Date.now() - 1000 })
    const active = buildPendingInteraction({ interactionId: 'int-new', expiresAt: Date.now() + 10000 })
    state = createMockStateStore(buildChatState({ pendingInteractions: [expired, active] }))
    const flow = createInteractiveFlow({ output, state })

    await flow.cleanupExpired(chatId)

    const updated = state._store.get(chatId)
    expect(updated?.pendingInteractions.length).toBe(1)
    expect(updated?.pendingInteractions[0]?.interactionId).toBe('int-new')
  })

  it('returns expired notices for stale questions', async () => {
    const interaction = buildPendingInteraction({
      interactionId: 'int-1',
      type: 'question',
      questions: [{ text: 'First', options: ['A', 'B'] }],
      collectedAnswers: [null],
      currentQuestionIndex: 0,
      phase: 'answering',
      expiresAt: Date.now() - 1000,
    })
    state = createMockStateStore(buildChatState({
      pendingInteractions: [interaction],
      activeProjectDirectory: directory,
    }))
    const flow = createInteractiveFlow({ output, state })

    await flow.handleQuestionAnswer(chatId, 'int-1', 0, 0)

    expect(output.sendText).toHaveBeenCalledWith(chatId, expect.any(String))
  })

})
