import { describe, it, expect, beforeEach } from 'bun:test'
import { createDebateFlow } from '../../app/usecases/debateFlow.js'
import {
  createMockOpenCodePort,
  createMockStateStore,
  createMockChatOutputPort,
  createMockCoordinationPort,
  createMockBotRegistryPort,
  buildChatState,
  buildBotRegistryEntry,
  buildAgentOutput,
  buildHistoryMessage,
  flushPromises,
} from '../helpers/index.js'
import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { CoordinationPort, CoordinationEvent } from '../../domain/ports/CoordinationPort.js'
import type { BotRegistryPort } from '../../domain/ports/BotRegistryPort.js'

describe('debateFlow', () => {
  let openCode: OpenCodePort
  let state: StateStore
  let output: ChatOutputPort
  let coordination: CoordinationPort
  let registry: BotRegistryPort

  const botRole = 'writer'
  const instanceName = 'writer-bot'
  const projectDir = '/test/project'

  beforeEach(() => {
    openCode = createMockOpenCodePort()
    state = createMockStateStore()
    output = createMockChatOutputPort()
    coordination = createMockCoordinationPort()
    registry = createMockBotRegistryPort()
  })

  describe('startDebate', () => {
    it('starts debate and publishes coordination event', async () => {
      const chatId = 123
      const topic = 'Test Debate Topic'
      
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      }))

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry.findByRole = async () => [peerBot]

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, topic)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Starting debate'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'debate.request',
          fromBot: instanceName,
          toBot: 'reader-bot',
        }),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: null,
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, 'topic')

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('활성 프로젝트가 없습니다'),
        'HTML',
      )
      expect(coordination.publish).not.toHaveBeenCalled()
    })

    it('sends error when no active session', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: null,
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, 'topic')

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('활성 세션이 없습니다'),
        'HTML',
      )
      expect(coordination.publish).not.toHaveBeenCalled()
    })

    it('sends error when no peer bot found', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })
      registry.findByRole = async () => []

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, 'topic')

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('단독 모드에서는 /debate'),
        'HTML',
      )
      expect(coordination.publish).not.toHaveBeenCalled()
    })

    it('rejects debate in standalone mode', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole: 'standalone',
        instanceName: 'standalone-bot',
        projectDir,
      })

      await flow.startDebate(chatId, 'topic')

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('단독 모드'),
        'HTML',
      )
      expect(coordination.publish).not.toHaveBeenCalled()
    })
  })

  describe('startReview', () => {
    it('starts review and publishes coordination event', async () => {
      const chatId = 123
      const target = 'auth.ts'
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry.findByRole = async () => [peerBot]

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startReview(chatId, target)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Starting review'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'review.request',
          fromBot: instanceName,
          toBot: 'reader-bot',
        }),
      )
    })

    it('uses default target when none provided', async () => {
      const chatId = 123
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry.findByRole = async () => [peerBot]

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startReview(chatId)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('latest changes'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalled()
    })

    it('sends error when no peer bot found', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })
      registry.findByRole = async () => []

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startReview(chatId, 'target')

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('단독 모드에서는 /review'),
        'HTML',
      )
      expect(coordination.publish).not.toHaveBeenCalled()
    })
  })

  describe('handleCoordinationEvent', () => {
    it('processes debate.request event', async () => {
      const chatId = 123
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      let sendPromptAsyncCalled = false
      
      let msgCallCount = 0
      openCode = createMockOpenCodePort({
        sendPromptAsync: async () => { sendPromptAsyncCalled = true },
        getSessionMessages: async () => {
          msgCallCount++
          if (msgCallCount <= 1) return []
          return [buildHistoryMessage({ role: 'assistant', parts: [{ type: 'text', text: 'My debate argument' }] })]
        },
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'writer-bot',
        botRole: 'writer',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole: 'reader',
        instanceName: 'reader-bot',
        projectDir,
      })

      const event: CoordinationEvent = {
        id: 'evt-1',
        type: 'debate.request',
        fromBot: 'writer-bot',
        toBot: 'reader-bot',
        sessionId: 'ses-1',
        debateId: 'debate-1',
        chatId,
        timestamp: Date.now(),
        payload: { topic: 'Test topic', round: 1 },
      }

      await flow.handleCoordinationEvent(chatId, event)

      expect(sendPromptAsyncCalled).toBe(true)
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('My debate argument'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'debate.response',
        }),
      )
    })

    it('ignores event with wrong toBot', async () => {
      const chatId = 123
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      const event: CoordinationEvent = {
        id: 'evt-1',
        type: 'debate.request',
        fromBot: 'other-bot',
        toBot: 'different-bot',
        sessionId: 'ses-1',
        debateId: 'debate-1',
        chatId,
        timestamp: Date.now(),
        payload: {},
      }

      await flow.handleCoordinationEvent(chatId, event)

      expect(output.sendText).not.toHaveBeenCalled()
      expect(coordination.publish).not.toHaveBeenCalled()
    })

    it('processes review.request event when bot is reader', async () => {
      const chatId = 123
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      let sendPromptAsyncCalled = false
      
      let msgCallCount = 0
      openCode = createMockOpenCodePort({
        sendPromptAsync: async () => { sendPromptAsyncCalled = true },
        getSessionMessages: async () => {
          msgCallCount++
          if (msgCallCount <= 1) return []
          return [buildHistoryMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Code review feedback' }] })]
        },
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'writer-bot',
        botRole: 'writer',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole: 'reader',
        instanceName: 'reader-bot',
        projectDir,
      })

      const event: CoordinationEvent = {
        id: 'evt-1',
        type: 'review.request',
        fromBot: 'writer-bot',
        toBot: 'reader-bot',
        sessionId: 'ses-1',
        debateId: 'review-1',
        chatId,
        timestamp: Date.now(),
        payload: { target: 'auth.ts', description: 'Review this file' },
      }

      await flow.handleCoordinationEvent(chatId, event)

      expect(sendPromptAsyncCalled).toBe(true)
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Code review feedback'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'review.response',
        }),
      )
    })

    it('ignores review.request when bot is not reader', async () => {
      const chatId = 123
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole: 'writer',
        instanceName: 'writer-bot',
        projectDir,
      })

      const event: CoordinationEvent = {
        id: 'evt-1',
        type: 'review.request',
        fromBot: 'other-bot',
        toBot: 'writer-bot',
        sessionId: 'ses-1',
        debateId: 'review-1',
        chatId,
        timestamp: Date.now(),
        payload: { target: 'auth.ts' },
      }

      await flow.handleCoordinationEvent(chatId, event)

      expect(output.sendText).not.toHaveBeenCalled()
      expect(coordination.publish).not.toHaveBeenCalled()
    })
  })

  describe('handleDebateResponse', () => {
    it('sends opponent message, responds, and publishes response', async () => {
      const chatId = 321
      const topic = 'async debate'

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      let msgCallCount = 0
      openCode = createMockOpenCodePort({
        sendPromptAsync: async () => {},
        getSessionMessages: async () => {
          msgCallCount++
          if (msgCallCount <= 1) return []
          return [buildHistoryMessage({ role: 'assistant', parts: [{ type: 'text', text: 'My rebuttal' }] })]
        },
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, topic)

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId

      const event: CoordinationEvent = {
        id: 'evt-response-1',
        type: 'debate.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { topic, round: 1, message: 'Opponent argument' },
      }

      await flow.handleCoordinationEvent(chatId, event)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Opponent'),
        'HTML',
      )
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('My response'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'debate.response',
          debateId,
        }),
      )

      await flow.handleCoordinationEvent(chatId, {
        ...event,
        type: 'debate.end',
        payload: { reason: 'cleanup' },
      })
    })

    it('ends debate when max rounds reached and truncates long opponent message', async () => {
      const chatId = 322
      const topic = 'long debate'

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, topic)

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId

      const longMessage = 'x'.repeat(3600)
      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-max-round',
        type: 'debate.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { topic, round: 6, message: longMessage },
      })

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('(truncated)'),
        'HTML',
      )
      expect(output.sendInteraction).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('토론 종료'),
        expect.arrayContaining([
          expect.objectContaining({ label: '✅ 반영하기' }),
          expect.objectContaining({ label: '❌ 무시하기' }),
        ]),
      )
      expect(openCode.sendPromptAsync).not.toHaveBeenCalled()
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'debate.end' }),
      )
    })

    it('ignores response with mismatched debateId', async () => {
      const chatId = 323

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, 'topic')

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId

      const initialSendCount = (output.sendText as unknown as { mock: { calls: unknown[][] } }).mock.calls.length

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-mismatch',
        type: 'debate.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId: 'other-debate',
        chatId,
        timestamp: Date.now(),
        payload: { topic: 'topic', round: 2, message: 'Ignored' },
      })

      expect((output.sendText as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(initialSendCount)
      expect(openCode.sendPromptAsync).not.toHaveBeenCalled()

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-end',
        type: 'debate.end',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { reason: 'cleanup' },
      })
    })

    it('does nothing when no active debate session exists', async () => {
      const chatId = 324

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-no-session',
        type: 'debate.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId: 'debate-1',
        chatId,
        timestamp: Date.now(),
        payload: { topic: 'topic', round: 1, message: 'Hello' },
      })

      expect(output.sendText).not.toHaveBeenCalled()
      expect(openCode.sendPromptAsync).not.toHaveBeenCalled()
    })

    it('reports error when AI prompt fails and publishes debate.end', async () => {
      const chatId = 325
      const topic = 'failure topic'

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      openCode = createMockOpenCodePort({
        sendPromptAsync: async () => {
          throw new Error('prompt error')
        },
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, topic)

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-fail',
        type: 'debate.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { topic, round: 2, message: 'Opponent' },
      })

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('토론 응답 생성 실패'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'debate.end' }),
      )
    })
  })

  describe('handleReviewResponse', () => {
    it('renders review response with target and no truncation', async () => {
      const chatId = 401

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startReview(chatId, 'auth.ts')

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-review',
        type: 'review.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { message: 'Looks good' },
      })

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Review: auth.ts'),
        'HTML',
      )
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.not.stringContaining('(truncated)'),
        'HTML',
      )
    })

    it('ignores review response with mismatched debateId', async () => {
      const chatId = 402

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startReview(chatId, 'core.ts')

      const initialSendCount = (output.sendText as unknown as { mock: { calls: unknown[][] } }).mock.calls.length

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-review-mismatch',
        type: 'review.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId: 'other-review',
        chatId,
        timestamp: Date.now(),
        payload: { message: 'Ignored' },
      })

      expect((output.sendText as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(initialSendCount)

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId
      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-review-cleanup',
        type: 'review.response',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { message: 'Cleanup' },
      })
    })
  })

  describe('handleDebateRequest error handling', () => {
    it('reports failure and publishes debate.end when prompt fails', async () => {
      const chatId = 501

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      openCode = createMockOpenCodePort({
        sendPromptAsync: async () => {
          throw new Error('boom')
        },
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'writer-bot',
        botRole: 'writer',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole: 'reader',
        instanceName: 'reader-bot',
        projectDir,
      })

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-debate-fail',
        type: 'debate.request',
        fromBot: 'writer-bot',
        toBot: 'reader-bot',
        sessionId: 'ses-1',
        debateId: 'debate-err',
        chatId,
        timestamp: Date.now(),
        payload: { topic: 'Failure', round: 1 },
      })

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('토론 응답 생성 실패'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'debate.end' }),
      )
    })
  })

  describe('debate.end event', () => {
    it('ends debate and publishes debate.end with reason', async () => {
      const chatId = 601

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, 'Ending debate')

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-debate-end',
        type: 'debate.end',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { reason: 'Opponent ended' },
      })

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Debate finished'),
        'HTML',
      )
      expect(coordination.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'debate.end' }),
      )
    })

    it('ignores debate.end with mismatched debateId', async () => {
      const chatId = 602

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      await flow.startDebate(chatId, 'Ending debate')

      const initialSendCount = (output.sendText as unknown as { mock: { calls: unknown[][] } }).mock.calls.length

      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-debate-end-mismatch',
        type: 'debate.end',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId: 'other-id',
        chatId,
        timestamp: Date.now(),
        payload: { reason: 'Ignored' },
      })

      expect((output.sendText as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(initialSendCount)

      const publishCalls = (coordination.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const debateId = (publishCalls[0][0] as { debateId?: string }).debateId
      await flow.handleCoordinationEvent(chatId, {
        id: 'evt-debate-end-cleanup',
        type: 'debate.end',
        fromBot: 'reader-bot',
        toBot: instanceName,
        sessionId: 'ses-1',
        debateId,
        chatId,
        timestamp: Date.now(),
        payload: { reason: 'cleanup' },
      })
    })
  })

  describe('pollOnce', () => {
    it('processes valid events and skips others', async () => {
      const chatId = 701
      const now = Date.now()

      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })

      let reviewDebateId = 'pending'

      const processedOutput = buildAgentOutput({
        parts: [{ type: 'text', content: 'Processed' }],
      })
      const processedPart = processedOutput.parts.find(part => part.type === 'text')
      const processedMessage = processedPart ? processedPart.content : 'Processed'

      coordination = createMockCoordinationPort({
        publish: async (event) => {
          reviewDebateId = typeof event.debateId === 'string' ? event.debateId : reviewDebateId
        },
        poll: async () => ({
          events: [
            {
              id: 'evt-other-bot',
              type: 'review.response',
              fromBot: 'reader-bot',
              toBot: 'other-bot',
              sessionId: 'ses-1',
              debateId: reviewDebateId,
              chatId,
              timestamp: now,
              payload: { message: 'Ignored' },
            },
            {
              id: 'evt-expired',
              type: 'review.response',
              fromBot: 'reader-bot',
              toBot: instanceName,
              sessionId: 'ses-1',
              debateId: reviewDebateId,
              chatId,
              timestamp: now - (10 * 60 * 1000 + 1000),
              payload: { message: 'Expired' },
            },
            {
              id: 'evt-missing-chat',
              type: 'review.response',
              fromBot: 'reader-bot',
              toBot: instanceName,
              sessionId: 'ses-1',
              debateId: reviewDebateId,
              timestamp: now,
              payload: { message: 'Missing chat' },
            },
            {
              id: 'evt-valid',
              type: 'review.response',
              fromBot: 'reader-bot',
              toBot: instanceName,
              sessionId: 'ses-1',
              debateId: reviewDebateId,
              chatId,
              timestamp: now,
              payload: { message: processedMessage },
            },
          ],
          newOffset: 1,
        }),
      })

      const peerBot = buildBotRegistryEntry({
        instanceName: 'reader-bot',
        botRole: 'reader',
        projectDir: '/test/project',
        lastSeen: Date.now(),
      })
      registry = createMockBotRegistryPort({
        findByRole: async () => [peerBot],
      })

      const originalSetInterval = globalThis.setInterval
      const originalClearInterval = globalThis.clearInterval
      const originalSetTimeout = globalThis.setTimeout

      globalThis.setInterval = (((fn: () => void) => {
        void fn()
        return 1 as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof setInterval)
      globalThis.clearInterval = ((() => {}) as unknown as typeof clearInterval)
      globalThis.setTimeout = ((() => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout)

      try {
        const flow = createDebateFlow({
          openCode,
          state,
          output,
          coordination,
          registry,
          botRole,
          instanceName,
          projectDir,
        })

        await flow.startReview(chatId, 'poll.ts')
        await flushPromises()

        expect(output.sendText).toHaveBeenCalledWith(
          chatId,
          expect.stringContaining('Processed'),
          'HTML',
        )
      } finally {
        globalThis.setInterval = originalSetInterval
        globalThis.clearInterval = originalClearInterval
        globalThis.setTimeout = originalSetTimeout
      }
    })
  })

  describe('polling', () => {
    it('starts polling when startPolling is called', () => {
      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      flow.startPolling()

      expect(coordination.poll).toBeDefined()
    })

    it('stops polling when stopPolling is called', () => {
      const flow = createDebateFlow({
        openCode,
        state,
        output,
        coordination,
        registry,
        botRole,
        instanceName,
        projectDir,
      })

      flow.startPolling()
      flow.stopPolling()

      expect(coordination.poll).toBeDefined()
    })
  })
})
