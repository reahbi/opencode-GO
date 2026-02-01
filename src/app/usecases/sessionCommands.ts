import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import { AppError } from '../../domain/errors.js'
import { logger } from '../../shared/logger.js'

interface SessionCommandsDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createSessionCommands(deps: SessionCommandsDeps) {
  async function createSession(chatId: number, title: string): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId)
      
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env or use a project command.')
        return
      }

      const session = await deps.openCode.createSession(state.activeProjectDirectory, title)
      
      state.activeSessionId = session.id
      await deps.state.saveChatState(chatId, state)
      
      await deps.output.sendText(chatId, `Session created: <b>${session.title}</b>\nID: <code>${session.id}</code>`)
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'createSession failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  async function listSessions(chatId: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId)
      
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env or use a project command.')
        return
      }

      const sessions = await deps.openCode.listSessions(state.activeProjectDirectory)
      
      if (sessions.length === 0) {
        await deps.output.sendText(chatId, 'No sessions found.')
        return
      }

      const lines = sessions.map((s, i) => {
        const active = s.id === state.activeSessionId ? ' ✦' : ''
        return `${i + 1}. <b>${escapeHtml(s.title || 'Untitled')}</b>${active}\n   <code>${s.id}</code>`
      })
      
      await deps.output.sendText(chatId, lines.join('\n'))
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'listSessions failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  async function resumeSession(chatId: number, sessionIndex: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId)
      
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env or use a project command.')
        return
      }

      const sessions = await deps.openCode.listSessions(state.activeProjectDirectory)
      
      if (sessionIndex < 1 || sessionIndex > sessions.length) {
        await deps.output.sendText(chatId, `Invalid session index. Please choose 1-${sessions.length}.`)
        return
      }

      const session = sessions[sessionIndex - 1]
      state.activeSessionId = session.id
      await deps.state.saveChatState(chatId, state)
      
      await deps.output.sendText(chatId, `Resumed session: <b>${escapeHtml(session.title || 'Untitled')}</b>`)
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'resumeSession failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  async function abortSession(chatId: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId)
      
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env or use a project command.')
        return
      }

      if (!state.activeSessionId) {
        await deps.output.sendText(chatId, 'No active session to abort.')
        return
      }

      await deps.openCode.abortSession(state.activeSessionId, state.activeProjectDirectory)
      
      state.pendingInteractions = []
      await deps.state.saveChatState(chatId, state)
      
      await deps.output.sendText(chatId, 'Session aborted.')
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'abortSession failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  return {
    createSession,
    listSessions,
    resumeSession,
    abortSession
  }
}
