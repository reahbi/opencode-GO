import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { HistoryMessage } from '../../domain/models.js'
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

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

export function messagesToMarkdown(title: string, sessionId: string, messages: HistoryMessage[]): string {
  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push(`Session: \`${sessionId}\`\n`)
  lines.push('---\n')

  for (const msg of messages) {
    const ts = formatTimestamp(msg.createdAt)
    const roleLabel = msg.role === 'user' ? '👤 User' : '🤖 Assistant'
    lines.push(`## ${roleLabel}`)
    lines.push(`_${ts}_\n`)

    for (const part of msg.parts) {
      switch (part.type) {
        case 'text':
          lines.push(part.text)
          lines.push('')
          break
        case 'tool':
          lines.push(`> 🔧 **${part.tool}**: ${part.title} (${part.status})`)
          lines.push('')
          break
        case 'subtask':
          lines.push(`> 🔀 **Subtask** [${part.agent}]: ${part.description}`)
          lines.push('')
          break
      }
    }

    lines.push('---\n')
  }

  return lines.join('\n')
}

export function messagesToHtml(title: string, sessionId: string, messages: HistoryMessage[]): string {
  const esc = escapeHtml
  const parts: string[] = []
  parts.push('<!DOCTYPE html>')
  parts.push('<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">')
  parts.push(`<title>${esc(title)}</title>`)
  parts.push('<style>')
  parts.push('body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:800px;margin:0 auto;padding:16px;background:#1a1a2e;color:#e0e0e0;font-size:15px;line-height:1.6}')
  parts.push('h1{color:#e94560;border-bottom:2px solid #e94560;padding-bottom:8px}')
  parts.push('.meta{color:#888;font-size:13px;margin-bottom:4px}')
  parts.push('.msg{margin:16px 0;padding:12px;border-radius:8px}')
  parts.push('.user{background:#16213e;border-left:4px solid #0f3460}')
  parts.push('.assistant{background:#1a1a2e;border-left:4px solid #e94560}')
  parts.push('.role{font-weight:700;margin-bottom:4px}')
  parts.push('.role.u{color:#0f3460}.role.a{color:#e94560}')
  parts.push('.tool{background:#0d1117;padding:8px 12px;border-radius:4px;margin:6px 0;font-size:13px;color:#8b949e}')
  parts.push('pre{background:#0d1117;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px}')
  parts.push('code{font-family:monospace}')
  parts.push('hr{border:0;border-top:1px solid #333;margin:20px 0}')
  parts.push('</style></head><body>')
  parts.push(`<h1>${esc(title)}</h1>`)
  parts.push(`<p class="meta">Session: ${esc(sessionId)} | ${messages.length} messages</p>`)
  parts.push('<hr>')

  for (const msg of messages) {
    const ts = formatTimestamp(msg.createdAt)
    const isUser = msg.role === 'user'
    const cls = isUser ? 'user' : 'assistant'
    const roleCls = isUser ? 'u' : 'a'
    const roleLabel = isUser ? '👤 User' : '🤖 Assistant'

    parts.push(`<div class="msg ${cls}">`)
    parts.push(`<div class="role ${roleCls}">${roleLabel}</div>`)
    parts.push(`<div class="meta">${esc(ts)}</div>`)

    for (const part of msg.parts) {
      switch (part.type) {
        case 'text': {
          const text = esc(part.text)
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>')
          parts.push(`<div>${text}</div>`)
          break
        }
        case 'tool':
          parts.push(`<div class="tool">🔧 <b>${esc(part.tool)}</b>: ${esc(part.title)} (${esc(part.status)})</div>`)
          break
        case 'subtask':
          parts.push(`<div class="tool">🔀 <b>Subtask</b> [${esc(part.agent)}]: ${esc(part.description)}</div>`)
          break
      }
    }

    parts.push('</div>')
  }

  parts.push('</body></html>')
  return parts.join('\n')
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

  async function resumeSessionForHistory(chatId: number, sessionIndex: number): Promise<{ sessionId: string; title: string } | null> {
    try {
      const state = await deps.state.getChatState(chatId)
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
        return null
      }

      const sessions = await deps.openCode.listSessions(state.activeProjectDirectory)
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

      if (sessionIndex < 1 || sessionIndex > sessions.length) {
        await deps.output.sendText(chatId, `잘못된 세션 번호입니다. 1-${sessions.length} 사이의 번호를 선택하세요.`)
        return null
      }

      const session = sessions[sessionIndex - 1]
      state.activeSessionId = session.id
      await deps.state.saveChatState(chatId, state)

      return { sessionId: session.id, title: session.title || 'Untitled' }
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'resumeSessionForHistory failed:', error)
        await deps.output.sendText(chatId, '오류가 발생했습니다. 다시 시도해 주세요.')
      }
      return null
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

  async function exportSessionHistory(
    chatId: number,
    sessionId?: string,
  ): Promise<{ content: string; title: string; format: 'md' | 'html' } | null> {
    try {
      const chatState = await deps.state.getChatState(chatId)
      if (!chatState.activeProjectDirectory) return null

      const targetId = sessionId || chatState.activeSessionId
      if (!targetId) return null

      const session = await deps.openCode.getSession(targetId, chatState.activeProjectDirectory)
      if (!session) return null

      let messages = await deps.openCode.getSessionMessages(targetId, chatState.activeProjectDirectory)
      if (messages.length === 0) return null

      const limit = chatState.settings.historyLimit
      if (limit !== null && limit > 0 && messages.length > limit) {
        messages = messages.slice(-limit)
      }

      const title = session.title || 'Untitled'
      const format = chatState.settings.historyFormat
      const content = format === 'html'
        ? messagesToHtml(title, targetId, messages)
        : messagesToMarkdown(title, targetId, messages)

      return { content, title, format }
    } catch (error) {
      logger.error('session', 'exportSessionHistory failed:', error)
      return null
    }
  }

  return {
    createSession,
    listSessions,
    resumeSession,
    resumeSessionForHistory,
    abortSession,
    getSessionPage,
    resumeSessionById,
    exportSessionHistory,
  }
}
