import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { createSessionCommands } from '../../app/usecases/sessionCommands.js'
import {
  createMockSessionStore,
  createMockStateStore,
  createMockChatOutputPort,
  buildChatState,
  buildUserSettings,
} from '../helpers/index.js'
import type { SessionStorePort, SessionMeta } from '../../domain/ports/SessionStorePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { QueryHandle } from '../../domain/ports/ClaudeAgentPort.js'
import { AppError } from '../../domain/errors.js'

describe('sessionCommands', () => {
  let sessionStore: SessionStorePort
  let state: StateStore
  let output: ChatOutputPort
  let getActiveQueryHandle: ((chatId: number) => QueryHandle | null) | undefined

  beforeEach(() => {
    sessionStore = createMockSessionStore()
    state = createMockStateStore()
    output = createMockChatOutputPort()
    getActiveQueryHandle = undefined
  })

  describe('createSession', () => {
    it('creates session and updates state with activeSessionId', async () => {
      const chatId = 123
      const title = 'New Session'

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.createSession(chatId, title)

      expect(sessionStore.createSession).toHaveBeenCalled()
      const createCall = (sessionStore.createSession as any).mock.calls[0][0] as SessionMeta
      expect(createCall.title).toBe(title)
      expect(createCall.cwd).toBe('/test/project')
      expect(createCall.status).toBe('idle')
      expect(state.saveChatState).toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Session created'),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({ activeProjectDirectory: null }))

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.createSession(chatId, 'Test')

      expect(sessionStore.createSession).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })

    it('escapes HTML in session title', async () => {
      const chatId = 123
      const title = '<script>alert("xss")</script>'

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.createSession(chatId, title)

      const call = (output.sendText as any).mock.calls[0]
      const sentMessage = call[1]

      expect(sentMessage).toContain('&lt;script&gt;')
      expect(sentMessage).not.toContain('<script>')
    })

    it('handles errors gracefully', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore.createSession = mock(async () => {
        throw new Error('Storage error')
      })

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.createSession(chatId, 'Test')

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('An error occurred'),
      )
    })
  })

  describe('listSessions', () => {
    it('lists sessions with proper formatting', async () => {
      const chatId = 123
      const sessions: SessionMeta[] = [
        {
          sessionId: 'ses-1',
          title: 'First Session',
          createdAt: Date.now() - 2000,
          lastActiveAt: Date.now() - 1000,
          messageCount: 5,
          status: 'idle',
          cwd: '/test/project',
        },
        {
          sessionId: 'ses-2',
          title: 'Second Session',
          createdAt: Date.now() - 1000,
          lastActiveAt: Date.now(),
          messageCount: 3,
          status: 'idle',
          cwd: '/test/project',
        },
      ]

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      }))

      sessionStore = createMockSessionStore(sessions)

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.listSessions(chatId)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('First Session'),
      )
      const message = (output.sendText as any).mock.calls[0][1]
      expect(message).toContain('Second Session')
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({ activeProjectDirectory: null }))

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.listSessions(chatId)

      expect(sessionStore.listSessions).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })

    it('sends message when session list is empty', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore = createMockSessionStore([])

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.listSessions(chatId)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No sessions'),
      )
    })

    it('marks active session with indicator', async () => {
      const chatId = 123
      const sessions: SessionMeta[] = [
        {
          sessionId: 'ses-active',
          title: 'Active',
          createdAt: Date.now() - 1000,
          lastActiveAt: Date.now(),
          messageCount: 2,
          status: 'idle',
          cwd: '/test/project',
        },
        {
          sessionId: 'ses-inactive',
          title: 'Inactive',
          createdAt: Date.now() - 2000,
          lastActiveAt: Date.now() - 1000,
          messageCount: 1,
          status: 'idle',
          cwd: '/test/project',
        },
      ]

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-active',
      }))

      sessionStore = createMockSessionStore(sessions)

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.listSessions(chatId)

      const call = (output.sendText as any).mock.calls[0]
      const message = call[1]
      expect(message).toContain('Active')
      expect(message).toContain('✦')
    })
  })

  describe('resumeSession', () => {
    it('resumes session by index and updates state', async () => {
      const chatId = 123
      const sessions: SessionMeta[] = [
        {
          sessionId: 'ses-1',
          title: 'First',
          createdAt: Date.now() - 2000,
          lastActiveAt: Date.now() - 1000,
          messageCount: 1,
          status: 'idle',
          cwd: '/test/project',
        },
        {
          sessionId: 'ses-2',
          title: 'Second',
          createdAt: Date.now() - 1000,
          lastActiveAt: Date.now(),
          messageCount: 2,
          status: 'idle',
          cwd: '/test/project',
        },
      ]

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore = createMockSessionStore(sessions)

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.resumeSession(chatId, 1)

      expect(state.saveChatState).toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Second'),
      )
    })

    it('sends error for invalid session index (too low)', async () => {
      const chatId = 123
      const sessions: SessionMeta[] = [
        {
          sessionId: 'ses-1',
          title: 'First',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          messageCount: 1,
          status: 'idle',
          cwd: '/test/project',
        },
      ]

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore = createMockSessionStore(sessions)

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.resumeSession(chatId, 0)

      expect(state.saveChatState).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Invalid session number'),
      )
    })

    it('sends error for invalid session index (too high)', async () => {
      const chatId = 123
      const sessions: SessionMeta[] = [
        {
          sessionId: 'ses-1',
          title: 'First',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          messageCount: 1,
          status: 'idle',
          cwd: '/test/project',
        },
      ]

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore = createMockSessionStore(sessions)

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.resumeSession(chatId, 5)

      expect(state.saveChatState).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Invalid session number'),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({ activeProjectDirectory: null }))

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.resumeSession(chatId, 1)

      expect(sessionStore.listSessions).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })
  })

  describe('abortSession', () => {
    it('aborts active session via query handle and clears pending interactions', async () => {
      const chatId = 123
      const abortMock = mock(() => undefined)
      getActiveQueryHandle = mock(() => ({
        messages: (async function*() {})(),
        abort: abortMock,
        sessionId: 'ses-1',
      }))

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
        pendingInteractions: [
          { interactionId: 'int-1', sessionId: 'ses-1', requestId: 'req-1', type: 'question', expiresAt: Date.now() + 300000 },
        ],
      }))

      const commands = createSessionCommands({ sessionStore, state, output, getActiveQueryHandle })
      await commands.abortSession(chatId)

      expect(abortMock).toHaveBeenCalled()
      expect(state.saveChatState).toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Session aborted'),
      )
    })

    it('sends error when no active session', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: null,
      }))

      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.abortSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active session to abort'),
      )
    })
  })

  describe('exportSessionHistory', () => {
    it('returns null when session not found in store', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      }))

      const commands = createSessionCommands({ sessionStore, state, output })
      const result = await commands.exportSessionHistory(chatId)

      expect(result).toBeNull()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Session not found'),
      )
    })
  })

  describe('revertSession and unrevertSession', () => {
    it('revertSession sends error when no active session', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeSessionId: null,
      }))
      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.revertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('No active session'))
    })

    it('revertSession sends error when no lastAssistantResponse', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeSessionId: 'ses-1',
        lastAssistantResponse: undefined,
      }))
      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.revertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('No response to undo'))
    })

    it('revertSession calls rewindFiles when handle is available', async () => {
      const chatId = 123
      const rewindFilesMock = mock(async () => true)
      getActiveQueryHandle = mock(() => ({
        messages: (async function*() {})(),
        abort: mock(() => undefined),
        sessionId: 'ses-1',
        rewindFiles: rewindFilesMock,
      }))

      state = createMockStateStore(buildChatState({
        activeSessionId: 'ses-1',
        lastAssistantResponse: { sessionId: 'msg-uuid-123', content: 'some response', timestamp: Date.now() },
      }))

      const commands = createSessionCommands({ sessionStore, state, output, getActiveQueryHandle })
      await commands.revertSession(chatId)

      expect(rewindFilesMock).toHaveBeenCalledWith('msg-uuid-123')
      expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('Last response undone'))
    })

    it('revertSession sends error when rewindFiles not available', async () => {
      const chatId = 123
      getActiveQueryHandle = mock(() => ({
        messages: (async function*() {})(),
        abort: mock(() => undefined),
        sessionId: 'ses-1',
      }))

      state = createMockStateStore(buildChatState({
        activeSessionId: 'ses-1',
        lastAssistantResponse: { sessionId: 'msg-uuid-123', content: 'some response', timestamp: Date.now() },
      }))

      const commands = createSessionCommands({ sessionStore, state, output, getActiveQueryHandle })
      await commands.revertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('Undo is not available'))
    })

    it('unrevertSession sends error when no redo available', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        redoAvailable: false,
      }))
      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.unrevertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('No undo to redo'))
    })

    it('unrevertSession sends not supported message when redo is available', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        redoAvailable: true,
      }))
      const commands = createSessionCommands({ sessionStore, state, output })
      await commands.unrevertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, expect.stringContaining('Redo is not directly supported'))
    })
  })

  describe('getSessionPage', () => {
    it('returns paginated session list', async () => {
      const chatId = 123
      const sessions: SessionMeta[] = Array.from({ length: 15 }, (_, i) => ({
        sessionId: `ses-${i}`,
        title: `Session ${i}`,
        createdAt: Date.now() - (15 - i) * 1000,
        lastActiveAt: Date.now() - (15 - i) * 1000,
        messageCount: i,
        status: 'idle' as const,
        cwd: '/test/project',
      }))

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-5',
      }))

      sessionStore = createMockSessionStore(sessions)

      const commands = createSessionCommands({ sessionStore, state, output })
      const page = await commands.getSessionPage(chatId, 1)

      expect(page).not.toBeNull()
      expect(page?.items.length).toBe(10)
      expect(page?.totalPages).toBe(2)
      expect(page?.totalSessions).toBe(15)
    })

    it('returns null when no project directory', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({ activeProjectDirectory: null }))

      const commands = createSessionCommands({ sessionStore, state, output })
      const page = await commands.getSessionPage(chatId, 1)

      expect(page).toBeNull()
    })
  })

  describe('resumeSessionById', () => {
    it('resumes session by ID', async () => {
      const chatId = 123
      const session: SessionMeta = {
        sessionId: 'ses-1',
        title: 'Test Session',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: 5,
        status: 'idle',
        cwd: '/test/project',
      }

      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore = createMockSessionStore([session])

      const commands = createSessionCommands({ sessionStore, state, output })
      const result = await commands.resumeSessionById(chatId, 'ses-1')

      expect(result).toBe('Test Session')
      expect(state.saveChatState).toHaveBeenCalled()
    })

    it('returns null when session not found', async () => {
      const chatId = 123
      state = createMockStateStore(buildChatState({
        activeProjectDirectory: '/test/project',
      }))

      sessionStore = createMockSessionStore([])

      const commands = createSessionCommands({ sessionStore, state, output })
      const result = await commands.resumeSessionById(chatId, 'ses-999')

      expect(result).toBeNull()
    })
  })
})
