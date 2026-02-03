import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { createSessionCommands } from '../../app/usecases/sessionCommands.js'
import {
  createMockOpenCodePort,
  createMockStateStore,
  createMockChatOutputPort,
  buildChatState,
  buildSessionRef,
  buildHistoryMessage,
  buildUserSettings,
} from '../helpers/index.js'
import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import { AppError } from '../../domain/errors.js'

describe('sessionCommands', () => {
  let openCode: OpenCodePort
  let state: StateStore
  let output: ChatOutputPort

  beforeEach(() => {
    openCode = createMockOpenCodePort()
    state = createMockStateStore()
    output = createMockChatOutputPort()
  })

  describe('createSession', () => {
    it('creates session and updates state with activeSessionId', async () => {
      const chatId = 123
      const title = 'New Session'
      const mockSession = buildSessionRef({ id: 'ses-new', title })
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      let createSessionCalled = false
      let createSessionArgs: any[] = []
      
      openCode = createMockOpenCodePort()
      openCode.createSession = async (dir, t) => {
        createSessionCalled = true
        createSessionArgs = [dir, t]
        return mockSession
      }

      const commands = createSessionCommands({ openCode, state, output })
      await commands.createSession(chatId, title)

      expect(createSessionCalled).toBe(true)
      expect(createSessionArgs).toEqual(['/test/project', title])
      expect(state.saveChatState).toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Session created'),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore({ activeProjectDirectory: null })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.createSession(chatId, 'Test')

      expect(openCode.createSession).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })

    it('escapes HTML in session title', async () => {
      const chatId = 123
      const title = '<script>alert("xss")</script>'
      const mockSession = buildSessionRef({ id: 'ses-1', title })
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.createSession = async () => mockSession

      const commands = createSessionCommands({ openCode, state, output })
      await commands.createSession(chatId, title)

      const call = (output.sendText as any).mock.calls[0]
      const sentMessage = call[1]
      
      expect(sentMessage).toContain('<script>')
    })

    it('handles AppError from openCode', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.createSession = async () => {
        throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
      }

      const commands = createSessionCommands({ openCode, state, output })
      await commands.createSession(chatId, 'Test')

      expect(output.sendText).toHaveBeenCalledWith(chatId, 'Project not found')
    })

    it('handles generic error from openCode', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.createSession = async () => {
        throw new Error('Network error')
      }

      const commands = createSessionCommands({ openCode, state, output })
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
      const sessions = [
        buildSessionRef({ id: 'ses-1', title: 'First Session' }),
        buildSessionRef({ id: 'ses-2', title: 'Second Session' }),
      ]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
      })
      
      openCode = createMockOpenCodePort()
      openCode.listSessions = async () => sessions

      const commands = createSessionCommands({ openCode, state, output })
      await commands.listSessions(chatId)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('First Session'),
      )
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Second Session'),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore({ activeProjectDirectory: null })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.listSessions(chatId)

      expect(openCode.listSessions).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })

    it('sends message when session list is empty', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.listSessions = async () => []

      const commands = createSessionCommands({ openCode, state, output })
      await commands.listSessions(chatId)

      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No sessions'),
      )
    })

    it('marks active session with indicator', async () => {
      const chatId = 123
      const sessions = [
        buildSessionRef({ id: 'ses-active', title: 'Active' }),
        buildSessionRef({ id: 'ses-inactive', title: 'Inactive' }),
      ]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-active',
      })
      
      openCode = createMockOpenCodePort()
      openCode.listSessions = async () => sessions

      const commands = createSessionCommands({ openCode, state, output })
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
      const sessions = [
        buildSessionRef({ id: 'ses-1', title: 'First' }),
        buildSessionRef({ id: 'ses-2', title: 'Second' }),
      ]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.listSessions = async () => sessions

      const commands = createSessionCommands({ openCode, state, output })
      await commands.resumeSession(chatId, 2)

      expect(state.saveChatState).toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Second'),
      )
    })

    it('sends error for invalid session index (too low)', async () => {
      const chatId = 123
      const sessions = [buildSessionRef({ id: 'ses-1', title: 'First' })]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.listSessions = async () => sessions

      const commands = createSessionCommands({ openCode, state, output })
      await commands.resumeSession(chatId, 0)

      expect(state.saveChatState).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Invalid session number'),
      )
    })

    it('sends error for invalid session index (too high)', async () => {
      const chatId = 123
      const sessions = [buildSessionRef({ id: 'ses-1', title: 'First' })]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
      })
      
      openCode = createMockOpenCodePort()
      openCode.listSessions = async () => sessions

      const commands = createSessionCommands({ openCode, state, output })
      await commands.resumeSession(chatId, 5)

      expect(state.saveChatState).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Invalid session number'),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore({ activeProjectDirectory: null })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.resumeSession(chatId, 1)

      expect(openCode.listSessions).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })
  })

  describe('abortSession', () => {
    it('aborts active session and clears pending interactions', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: 'ses-1',
        pendingInteractions: [
          { interactionId: 'int-1', sessionId: 'ses-1', requestId: 'req-1', type: 'permission', expiresAt: Date.now() + 300000 },
        ],
      })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.abortSession(chatId)

      expect(openCode.abortSession).toHaveBeenCalledWith('ses-1', '/test/project')
      expect(state.saveChatState).toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Session aborted'),
      )
    })

    it('sends error when no active session', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: null,
      })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.abortSession(chatId)

      expect(openCode.abortSession).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active session to abort'),
      )
    })

    it('sends error when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore({ activeProjectDirectory: null })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.abortSession(chatId)

      expect(openCode.abortSession).not.toHaveBeenCalled()
      expect(output.sendText).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('No active project'),
      )
    })
  })

  describe('exportSessionHistory', () => {
    it('exports session history as markdown by default', async () => {
      const chatId = 123
      const sessionId = 'ses-1'
      const messages = [
        buildHistoryMessage({
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        }),
        buildHistoryMessage({
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hi there' }],
        }),
      ]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: sessionId,
        settings: buildUserSettings({ historyFormat: 'md' }),
      })
      
      openCode = createMockOpenCodePort()
      openCode.getSession = async () => buildSessionRef({ id: sessionId, title: 'Test Session' })
      openCode.getSessionMessages = async () => messages

      const commands = createSessionCommands({ openCode, state, output })
      const result = await commands.exportSessionHistory(chatId)

      expect(result).not.toBeNull()
      expect(result?.format).toBe('md')
      expect(result?.content).toContain('Test Session')
      expect(result?.content).toContain('Hello')
      expect(result?.content).toContain('Hi there')
    })

    it('exports session history as HTML when configured', async () => {
      const chatId = 123
      const sessionId = 'ses-1'
      const messages = [
        buildHistoryMessage({
          role: 'user',
          parts: [{ type: 'text', text: 'Test message' }],
        }),
      ]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: sessionId,
        settings: buildUserSettings({ historyFormat: 'html' }),
      })
      
      openCode = createMockOpenCodePort()
      openCode.getSession = async () => buildSessionRef({ id: sessionId, title: 'Test' })
      openCode.getSessionMessages = async () => messages

      const commands = createSessionCommands({ openCode, state, output })
      const result = await commands.exportSessionHistory(chatId)

      expect(result).not.toBeNull()
      expect(result?.format).toBe('html')
      expect(result?.content).toContain('<!DOCTYPE html>')
      expect(result?.content).toContain('Test message')
    })

    it('returns null when no messages exist', async () => {
      const chatId = 123
      const sessionId = 'ses-1'
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: sessionId,
      })
      
      openCode = createMockOpenCodePort()
      openCode.getSession = async () => buildSessionRef({ id: sessionId })
      openCode.getSessionMessages = async () => []

      const commands = createSessionCommands({ openCode, state, output })
      const result = await commands.exportSessionHistory(chatId)

      expect(result).toBeNull()
    })

    it('respects history limit setting', async () => {
      const chatId = 123
      const sessionId = 'ses-1'
      const messages = [
        buildHistoryMessage({ role: 'user', parts: [{ type: 'text', text: 'Msg 1' }] }),
        buildHistoryMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Msg 2' }] }),
        buildHistoryMessage({ role: 'user', parts: [{ type: 'text', text: 'Msg 3' }] }),
        buildHistoryMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Msg 4' }] }),
      ]
      
      state = createMockStateStore({
        activeProjectDirectory: '/test/project',
        activeSessionId: sessionId,
        settings: buildUserSettings({ historyLimit: 2 }),
      })
      
      openCode = createMockOpenCodePort()
      openCode.getSession = async () => buildSessionRef({ id: sessionId })
      openCode.getSessionMessages = async () => messages

      const commands = createSessionCommands({ openCode, state, output })
      const result = await commands.exportSessionHistory(chatId)

      expect(result).not.toBeNull()
      expect(result?.content).toContain('Msg 3')
      expect(result?.content).toContain('Msg 4')
      expect(result?.content).not.toContain('Msg 1')
    })

    it('returns null when no active project directory', async () => {
      const chatId = 123
      state = createMockStateStore({ activeProjectDirectory: null })

      const commands = createSessionCommands({ openCode, state, output })
      const result = await commands.exportSessionHistory(chatId)

      expect(result).toBeNull()
    })
  })

  describe('revertSession', () => {
    it('should send error if no active session', async () => {
      const chatId = 123
      state = createMockStateStore({ activeSessionId: undefined })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.revertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, 'No active session.')
    })

    it('should send error if no lastAssistantMessageId', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeSessionId: 'ses-1',
        activeProjectDirectory: '/test',
        lastAssistantMessageId: undefined,
      })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.revertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, 'Nothing to undo.')
    })

    it('should call revertSession and send success message', async () => {
      const chatId = 123
      const mockState = buildChatState({
        activeSessionId: 'ses-1',
        activeProjectDirectory: '/test',
        lastAssistantMessageId: 'msg-1',
      })
      
      state = createMockStateStore(mockState)
      
      const revertSessionMock = mock(() => Promise.resolve({ 
        messageId: 'msg-1', 
        diff: '- old\n+ new' 
      }))
      
      openCode = createMockOpenCodePort()
      openCode.revertSession = revertSessionMock

      const commands = createSessionCommands({ openCode, state, output })
      await commands.revertSession(chatId)

      expect(revertSessionMock).toHaveBeenCalledWith('ses-1', '/test', 'msg-1')
      expect(output.sendText).toHaveBeenCalledWith(chatId, '⏪ Reverted to previous state.')
      
      const savedState = (state.saveChatState as any).mock.calls[0][1]
      expect(savedState.redoAvailable).toBe(true)
    })

    it('should handle revert without diff', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeSessionId: 'ses-1',
        activeProjectDirectory: '/test',
        lastAssistantMessageId: 'msg-1',
      })
      
      const revertSessionMock = mock(() => Promise.resolve({ messageId: 'msg-1' }))
      
      openCode = createMockOpenCodePort()
      openCode.revertSession = revertSessionMock

      const commands = createSessionCommands({ openCode, state, output })
      await commands.revertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, '⏪ Reverted to previous state.')
    })
  })

  describe('unrevertSession', () => {
    it('should return if no active session', async () => {
      const chatId = 123
      state = createMockStateStore({ activeSessionId: undefined })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.unrevertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, 'No active session.')
      expect(openCode.unrevertSession).not.toHaveBeenCalled()
    })

    it('should return if redoAvailable is false', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeSessionId: 'ses-1',
        activeProjectDirectory: '/test',
        redoAvailable: false,
      })

      const commands = createSessionCommands({ openCode, state, output })
      await commands.unrevertSession(chatId)

      expect(output.sendText).toHaveBeenCalledWith(chatId, 'Nothing to redo.')
      expect(openCode.unrevertSession).not.toHaveBeenCalled()
    })

    it('should call unrevertSession and send success message', async () => {
      const chatId = 123
      state = createMockStateStore({
        activeSessionId: 'ses-1',
        activeProjectDirectory: '/test',
        redoAvailable: true,
      })
      
      const unrevertSessionMock = mock(() => Promise.resolve())
      
      openCode = createMockOpenCodePort()
      openCode.unrevertSession = unrevertSessionMock

      const commands = createSessionCommands({ openCode, state, output })
      await commands.unrevertSession(chatId)

      expect(unrevertSessionMock).toHaveBeenCalledWith('ses-1', '/test')
      expect(output.sendText).toHaveBeenCalledWith(chatId, '⏩ Restored previous state.')
      
      const savedState = (state.saveChatState as any).mock.calls[0][1]
      expect(savedState.redoAvailable).toBe(false)
    })
  })
})
