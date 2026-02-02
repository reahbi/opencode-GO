import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import { AppError } from '../../domain/errors.js'
import { logger } from '../../shared/logger.js'

const SESSIONS_PER_PAGE = 10

export interface SessionPageItem {
  globalIndex: number
  title: string
  id: string
  isActive: boolean
}

export interface SessionPageData {
  items: SessionPageItem[]
  page: number
  totalPages: number
  totalSessions: number
}

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
        await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
        return
      }

      const session = await deps.openCode.createSession(state.activeProjectDirectory, title)
      
      state.activeSessionId = session.id
      await deps.state.saveChatState(chatId, state)
      
      await deps.output.sendText(chatId, `세션 생성됨: <b>${session.title}</b>\nID: <code>${session.id}</code>`)
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'createSession failed:', error)
        await deps.output.sendText(chatId, '오류가 발생했습니다. 다시 시도해 주세요.')
      }
    }
  }

  async function listSessions(chatId: number): Promise<void> {
    try {
      const page = await getSessionPage(chatId, 1)
      if (!page) {
        await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
        return
      }
      if (page.items.length === 0) {
        await deps.output.sendText(chatId, '세션이 없습니다.')
        return
      }
      const lines = page.items.map((item) => {
        const active = item.isActive ? ' ✦' : ''
        return `${item.globalIndex}. <b>${escapeHtml(item.title)}</b>${active}`
      })
      await deps.output.sendText(chatId, lines.join('\n'))
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'listSessions failed:', error)
        await deps.output.sendText(chatId, '오류가 발생했습니다. 다시 시도해 주세요.')
      }
    }
  }

  async function getSessionPage(chatId: number, page: number): Promise<SessionPageData | null> {
    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory) return null

    const sessions = await deps.openCode.listSessions(state.activeProjectDirectory)
    if (sessions.length === 0) {
      return { items: [], page: 1, totalPages: 1, totalSessions: 0 }
    }

    // Sort by updatedAt descending (most recent first)
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    const totalPages = Math.ceil(sessions.length / SESSIONS_PER_PAGE)
    const safePage = Math.max(1, Math.min(page, totalPages))
    const start = (safePage - 1) * SESSIONS_PER_PAGE
    const pageItems = sessions.slice(start, start + SESSIONS_PER_PAGE)

    return {
      items: pageItems.map((s, i) => ({
        globalIndex: start + i + 1,
        title: s.title || 'Untitled',
        id: s.id,
        isActive: s.id === state.activeSessionId,
      })),
      page: safePage,
      totalPages,
      totalSessions: sessions.length,
    }
  }

  async function resumeSessionById(chatId: number, sessionId: string): Promise<string | null> {
    try {
      const state = await deps.state.getChatState(chatId)
      if (!state.activeProjectDirectory) return null

      const session = await deps.openCode.getSession(sessionId, state.activeProjectDirectory)
      if (!session) return null

      state.activeSessionId = session.id
      await deps.state.saveChatState(chatId, state)
      return session.title || 'Untitled'
    } catch (error) {
      logger.error('session', 'resumeSessionById failed:', error)
      return null
    }
  }

  async function resumeSession(chatId: number, sessionIndex: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId)
      
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
        return
      }

      const sessions = await deps.openCode.listSessions(state.activeProjectDirectory)
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      
      if (sessionIndex < 1 || sessionIndex > sessions.length) {
        await deps.output.sendText(chatId, `잘못된 세션 번호입니다. 1-${sessions.length} 사이의 번호를 선택하세요.`)
        return
      }

      const session = sessions[sessionIndex - 1]
      state.activeSessionId = session.id
      await deps.state.saveChatState(chatId, state)
      
      await deps.output.sendText(chatId, `세션 재개됨: <b>${escapeHtml(session.title || 'Untitled')}</b>`)
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'resumeSession failed:', error)
        await deps.output.sendText(chatId, '오류가 발생했습니다. 다시 시도해 주세요.')
      }
    }
  }

  async function abortSession(chatId: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId)
      
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
        return
      }

      if (!state.activeSessionId) {
        await deps.output.sendText(chatId, '중단할 활성 세션이 없습니다.')
        return
      }

      await deps.openCode.abortSession(state.activeSessionId, state.activeProjectDirectory)
      
      state.pendingInteractions = []
      await deps.state.saveChatState(chatId, state)
      
      await deps.output.sendText(chatId, '세션이 중단되었습니다.')
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'abortSession failed:', error)
        await deps.output.sendText(chatId, '오류가 발생했습니다. 다시 시도해 주세요.')
      }
    }
  }

  return {
    createSession,
    listSessions,
    resumeSession,
    abortSession,
    getSessionPage,
    resumeSessionById,
  }
}
