import type { SessionStorePort, SessionMeta } from '../../domain/ports/SessionStorePort.js'
import type { QueryHandle } from '../../domain/ports/ClaudeAgentPort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { HistoryMessage } from '../../domain/models.js'
import { AppError } from '../../domain/errors.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml } from '../../shared/formatResponse.js'
import { generateUUID } from '../../shared/uuid.js'

const SESSIONS_PER_PAGE = 10

export interface SessionPageItem {
  globalIndex: number
  title: string
  id: string
  isActive: boolean
  isBusy: boolean
  source: 'bot' | 'local'
  messageCount: number
  lastActiveAt: number
}

export interface SessionPageData {
  items: SessionPageItem[]
  page: number
  totalPages: number
  totalSessions: number
}

interface SessionCommandsDeps {
  sessionStore: SessionStorePort
  state: StateStore
  output: ChatOutputPort
  getActiveQueryHandle?: (chatId: number, threadId?: number) => QueryHandle | null
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
  async function createSession(chatId: number, title: string, threadId?: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId, threadId)

      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env.')
        return
      }

      const sessionId = globalThis.crypto?.randomUUID?.() || generateUUID()
      const meta: SessionMeta = {
        sessionId,
        title: title || `Session ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: 0,
        status: 'idle',
        cwd: state.activeProjectDirectory,
      }

      await deps.sessionStore.createSession(meta)
      state.activeSessionId = sessionId
      await deps.state.saveChatState(chatId, state, threadId)

      await deps.output.sendText(chatId, `Session created: <b>${escapeHtml(meta.title)}</b>\nID: <code>${sessionId}</code>`)
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'createSession failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  async function listSessions(chatId: number, threadId?: number): Promise<void> {
    try {
      const page = await getSessionPage(chatId, 1, threadId)
      if (!page) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env.')
        return
      }
      if (page.items.length === 0) {
        await deps.output.sendText(chatId, 'No sessions.')
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
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  async function getSessionPage(chatId: number, page: number, threadId?: number): Promise<SessionPageData | null> {
    const state = await deps.state.getChatState(chatId, threadId)
    if (!state.activeProjectDirectory) return null

    const sessions = await deps.sessionStore.listSessions(state.activeProjectDirectory)

    if (sessions.length === 0) {
      return { items: [], page: 1, totalPages: 1, totalSessions: 0 }
    }

    // Sort by lastActiveAt descending (most recent first)
    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

    const totalPages = Math.ceil(sessions.length / SESSIONS_PER_PAGE)
    const safePage = Math.max(1, Math.min(page, totalPages))
    const start = (safePage - 1) * SESSIONS_PER_PAGE
    const pageItems = sessions.slice(start, start + SESSIONS_PER_PAGE)

    return {
      items: pageItems.map((s, i) => ({
        globalIndex: start + i + 1,
        title: s.title || 'Untitled',
        id: s.sessionId,
        isActive: s.sessionId === state.activeSessionId,
        isBusy: s.status === 'busy',
        source: s.source ?? 'bot',
        messageCount: s.messageCount,
        lastActiveAt: s.lastActiveAt,
      })),
      page: safePage,
      totalPages,
      totalSessions: sessions.length,
    }
  }

  async function resumeSessionById(chatId: number, sessionId: string, threadId?: number): Promise<string | null> {
    try {
      const state = await deps.state.getChatState(chatId, threadId)
      if (!state.activeProjectDirectory) return null

      const session = await deps.sessionStore.getSession(sessionId)
      if (!session) return null

      state.activeSessionId = session.sessionId
      await deps.state.saveChatState(chatId, state, threadId)
      return session.title || 'Untitled'
    } catch (error) {
      logger.error('session', 'resumeSessionById failed:', error)
      return null
    }
  }

  async function resumeSession(chatId: number, sessionIndex: number, threadId?: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId, threadId)

      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env.')
        return
      }

      const sessions = await deps.sessionStore.listSessions(state.activeProjectDirectory)
      sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

      if (sessionIndex < 1 || sessionIndex > sessions.length) {
        await deps.output.sendText(chatId, `Invalid session number. Select between 1-${sessions.length}.`)
        return
      }

      const session = sessions[sessionIndex - 1]
      state.activeSessionId = session.sessionId
      await deps.state.saveChatState(chatId, state, threadId)

      await deps.output.sendText(chatId, `Session resumed: <b>${escapeHtml(session.title || 'Untitled')}</b>`)
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'resumeSession failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
    }
  }

  async function resumeSessionForHistory(chatId: number, sessionIndex: number, threadId?: number): Promise<{ sessionId: string; title: string } | null> {
    try {
      const state = await deps.state.getChatState(chatId, threadId)
      if (!state.activeProjectDirectory) {
        await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env.')
        return null
      }

      const sessions = await deps.sessionStore.listSessions(state.activeProjectDirectory)
      sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

      if (sessionIndex < 1 || sessionIndex > sessions.length) {
        await deps.output.sendText(chatId, `Invalid session number. Select between 1-${sessions.length}.`)
        return null
      }

      const session = sessions[sessionIndex - 1]
      state.activeSessionId = session.sessionId
      await deps.state.saveChatState(chatId, state, threadId)

      return { sessionId: session.sessionId, title: session.title || 'Untitled' }
    } catch (error) {
      if (error instanceof AppError) {
        await deps.output.sendText(chatId, error.message)
      } else {
        logger.error('session', 'resumeSessionForHistory failed:', error)
        await deps.output.sendText(chatId, 'An error occurred. Please try again.')
      }
      return null
    }
  }

  async function abortSession(chatId: number, threadId?: number): Promise<void> {
    try {
      const state = await deps.state.getChatState(chatId, threadId)

      if (!state.activeSessionId) {
        await deps.output.sendText(chatId, 'No active session to abort.')
        return
      }

      // Abort via query handle if available
      const handle = deps.getActiveQueryHandle?.(chatId, threadId)
      if (handle) {
        handle.abort()
      }

      state.pendingInteractions = []
      await deps.state.saveChatState(chatId, state, threadId)

      if (state.activeSessionId) {
        await deps.sessionStore.updateSession(state.activeSessionId, {
          status: 'idle',
          lastActiveAt: Date.now(),
        })
      }

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

  async function exportSessionHistory(
    chatId: number,
    sessionId?: string,
    threadId?: number,
  ): Promise<{ content: string; title: string; format: 'md' | 'html' } | null> {
    try {
      const state = await deps.state.getChatState(chatId, threadId)
      const targetSessionId = sessionId || state.activeSessionId

      if (!targetSessionId) {
        await deps.output.sendText(chatId, 'No session to export.')
        return null
      }

      const session = await deps.sessionStore.getSession(targetSessionId)
      if (!session) {
        await deps.output.sendText(chatId, 'Session not found.')
        return null
      }

      const messages = session.messages || []
      if (messages.length === 0) {
        await deps.output.sendText(chatId, 'No messages in session history.')
        return null
      }

      const format = state.settings.historyFormat
      const limit = state.settings.historyLimit
      const limitedMessages = limit ? messages.slice(-limit) : messages

      const content = format === 'html'
        ? messagesToHtml(session.title, targetSessionId, limitedMessages)
        : messagesToMarkdown(session.title, targetSessionId, limitedMessages)

      return { content, title: session.title, format }
    } catch (error) {
      logger.error('session', 'exportSessionHistory failed:', error)
      return null
    }
  }

  async function revertSession(chatId: number, threadId?: number): Promise<void> {
    const chatState = await deps.state.getChatState(chatId, threadId)
    if (!chatState.activeSessionId) {
      await deps.output.sendText(chatId, '⚠️ No active session.')
      return
    }
    if (!chatState.lastAssistantResponse?.content) {
      await deps.output.sendText(chatId, '⚠️ No response to undo.')
      return
    }
    // Try to get the query handle for rewindFiles
    const handle = deps.getActiveQueryHandle?.(chatId, threadId)
    if (handle?.rewindFiles) {
      // Use the message UUID from lastAssistantResponse if available
      const success = await handle.rewindFiles(chatState.lastAssistantResponse.sessionId)
      if (success) {
        chatState.redoAvailable = true
        await deps.state.saveChatState(chatId, chatState, threadId)
        await deps.output.sendText(chatId, '↩️ Last response undone. File changes reverted.')
        return
      }
    }
    await deps.output.sendText(chatId, '⚠️ Undo is not available for this session. File checkpointing may not be active.')
  }

  async function unrevertSession(chatId: number, threadId?: number): Promise<void> {
    const chatState = await deps.state.getChatState(chatId, threadId)
    if (!chatState.redoAvailable) {
      await deps.output.sendText(chatId, '⚠️ No undo to redo.')
      return
    }
    // SDK rewindFiles doesn't support "un-rewind" - we'd need to track redo state manually
    await deps.output.sendText(chatId, '⚠️ Redo is not directly supported. Use /revert to undo the current state.')
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
    revertSession,
    unrevertSession,
  }
}
