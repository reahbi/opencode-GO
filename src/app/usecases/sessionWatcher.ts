import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { SummaryPort } from '../../domain/ports/SummaryPort.js'
import type { OutputHandle, UserSettings, QueuedMessage } from '../../domain/models.js'
import type { OpenCodeEvent, PermissionAsked, QuestionAsked } from '../../domain/events.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml, sanitizeTelegramHtml, stripHtml } from '../../shared/formatResponse.js'
import { routeDelivery } from '../policies/deliveryRouter.js'
import { structuralExtract } from '../../shared/structuralExtract.js'

const STREAM_DISPLAY_LIMIT = 3500
const EDIT_THROTTLE_MS = 1000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const MDV2 = 'MarkdownV2'

interface SessionWatcherDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  summary: SummaryPort
  onPermissionAsked: (chatId: number, event: PermissionAsked, actorUserId?: number) => Promise<void>
  onQuestionAsked: (chatId: number, event: QuestionAsked, actorUserId?: number) => Promise<void>
  isDebateActive?: (chatId: number) => boolean
  onQueueDrain?: (chatId: number, messages: QueuedMessage[]) => Promise<void>
}

interface WatcherEntry {
  directory: string
  sessionId: string
  abort: AbortController
  generation: number
  /** Telegram message handle for current streaming response */
  liveMsgHandle: OutputHandle | null
  /** Handle pre-created by promptFlow for user-initiated prompts */
  promptHandle: OutputHandle | null
  lastContent: string
  lastEditTime: number
  pendingEditTimer: ReturnType<typeof setTimeout> | null
  assistantMessageIds: Set<string>
  currentMessageId: string | null
  typingInterval: ReturnType<typeof setInterval> | null
  liveUpdatesEnabled: boolean
  actorUserId: number | null
  /** Prevents duplicate busy/retry notifications from REST + SSE race */
  busyNotified: boolean
}

export interface SessionWatcher {
  /** Start watching the active session for a chat. Stops any existing watcher. */
  watch(chatId: number): Promise<void>
  /** Stop watching for a chat. */
  stop(chatId: number): void
  /** Start watching if not already watching the correct session. */
  ensureWatching(chatId: number): Promise<void>
  /** Check if a watcher is running for a chat. */
  isWatching(chatId: number): boolean
  /** Register a pre-created Telegram message handle for the next assistant response. */
  setPromptHandle(chatId: number, handle: OutputHandle): void
  setPromptContext(chatId: number, ctx: { actorUserId?: number; liveUpdatesEnabled?: boolean }): void
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hasErrorCode(err: unknown, code: string): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes(code)
}

export function createSessionWatcher(deps: SessionWatcherDeps): SessionWatcher {
  const watchers = new Map<number, WatcherEntry>()

  // ── Display helpers ───────────────────────────────────────

  function truncateForDisplay(content: string): string {
    if (content.length <= STREAM_DISPLAY_LIMIT) return escapeHtml(content)
    const truncated = content.slice(0, STREAM_DISPLAY_LIMIT)
    return escapeHtml(truncated) + '\n\n<i>... streaming (will send full response when done)</i>'
  }

  // ── Delivery (same logic as the original promptFlow) ──────

  async function deliverFormatted(
    chatId: number,
    handle: OutputHandle,
    content: string,
  ): Promise<void> {
    const plan = routeDelivery(content)
    switch (plan.strategy) {
      case 'inline':
        await deps.output.editText(chatId, handle, plan.messages![0], MDV2)
        break
      case 'chunk': {
        const msgs = plan.messages!
        await deps.output.editText(chatId, handle, msgs[0], MDV2)
        for (let i = 1; i < msgs.length; i++) {
          await deps.output.sendText(chatId, msgs[i], MDV2)
        }
        break
      }
      case 'file': {
        const preview = structuralExtract(content).slice(0, 2000)
        await deps.output.editText(
          chatId, handle,
          preview + '\n\n<i>... (full response attached)</i>',
          'HTML',
        )
        const buffer = Buffer.from(plan.fileContent!, 'utf-8')
        await deps.output.sendFile(chatId, buffer, 'response.md', 'Full response attached.')
        break
      }
    }
  }

  async function deliverSafe(
    chatId: number,
    handle: OutputHandle,
    content: string,
  ): Promise<void> {
    try {
      await deliverFormatted(chatId, handle, content)
      return
    } catch (err) {
      if (!hasErrorCode(err, "can't parse entities") && !hasErrorCode(err, 'MESSAGE_TOO_LONG')) {
        throw err
      }
      logger.warn('watcher', `Delivery failed (${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}), forcing file delivery`)
    }

    const preview = structuralExtract(content).slice(0, 2000)
    await deps.output.editText(chatId, handle, preview + '\n\n<i>... (full response attached)</i>', 'HTML')
    await deps.output.sendFile(chatId, Buffer.from(content, 'utf-8'), 'response.md', 'Full response attached.')
  }

  async function sendFinalResponse(
    chatId: number,
    handle: OutputHandle,
    content: string,
    settings: UserSettings,
    directory: string,
  ): Promise<void> {
    if (settings.outputMode === 'raw') {
      const escaped = escapeHtml(content)
      if (escaped.length <= 3500) {
        await deps.output.editText(chatId, handle, escaped, 'HTML')
      } else {
        const preview = escaped.slice(0, 2000) + '\n\n<i>... (full response attached)</i>'
        await deps.output.editText(chatId, handle, preview, 'HTML')
        await deps.output.sendFile(chatId, Buffer.from(content, 'utf-8'), 'response.md', 'Full response attached.')
      }
      return
    }

    if (settings.summaryMode && settings.summaryModel && content.length > settings.summaryThreshold) {
      try {
        const rawSummary = await deps.summary.summarize(directory, content, settings.summaryModel)
        const safeSummary = sanitizeTelegramHtml(rawSummary)
        try {
          await deps.output.editText(chatId, handle, safeSummary, 'HTML')
        } catch (htmlErr) {
          if (!hasErrorCode(htmlErr, "can't parse entities")) throw htmlErr
          logger.warn('watcher', 'Sanitized HTML still rejected, stripping tags')
          await deps.output.editText(chatId, handle, stripHtml(safeSummary))
        }
        await deps.output.sendFile(chatId, Buffer.from(content, 'utf-8'), 'response.md', '📄 Full response')
        return
      } catch (err) {
        logger.warn('watcher', `Summary failed, falling back: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    await deliverSafe(chatId, handle, content)
  }

  // ── Per-turn state management ─────────────────────────────

  function resetTurnState(entry: WatcherEntry): void {
    if (entry.pendingEditTimer) {
      clearTimeout(entry.pendingEditTimer)
      entry.pendingEditTimer = null
    }
    if (entry.typingInterval) {
      clearInterval(entry.typingInterval)
      entry.typingInterval = null
    }
    entry.liveMsgHandle = null
    entry.promptHandle = null
    entry.lastContent = ''
    entry.lastEditTime = 0
    entry.currentMessageId = null
    entry.assistantMessageIds.clear()
    entry.busyNotified = false
  }

  // ── Throttled streaming edits ─────────────────────────────

  function throttledEdit(chatId: number, entry: WatcherEntry, content: string): void {
    if (!entry.liveUpdatesEnabled) return

    if (entry.pendingEditTimer) {
      clearTimeout(entry.pendingEditTimer)
      entry.pendingEditTimer = null
    }

    const handle = entry.liveMsgHandle
    if (!handle) return

    const now = Date.now()
    const elapsed = now - entry.lastEditTime

    if (elapsed >= EDIT_THROTTLE_MS) {
      entry.lastEditTime = now
      deps.output.editText(chatId, handle, truncateForDisplay(content)).catch(() => {})
    } else {
      entry.pendingEditTimer = setTimeout(() => {
        entry.lastEditTime = Date.now()
        entry.pendingEditTimer = null
        deps.output.editText(chatId, handle, truncateForDisplay(content)).catch(() => {})
      }, EDIT_THROTTLE_MS - elapsed)
    }
  }

  // ── Live message management ───────────────────────────────

  async function ensureLiveMessage(chatId: number, entry: WatcherEntry): Promise<void> {
    if (entry.liveMsgHandle) return

    // Use pre-created handle from promptFlow (user-initiated prompt)
    if (entry.promptHandle) {
      entry.liveMsgHandle = entry.promptHandle
      entry.promptHandle = null
      return
    }

    // Create new message for external activity (from computer/terminal)
    try {
      const handle = await deps.output.sendText(chatId, '📡 Session activity detected...')
      entry.liveMsgHandle = handle
      entry.typingInterval = setInterval(() => {
        deps.output.sendTypingAction(chatId).catch(() => {})
      }, 5000)
    } catch (err) {
      logger.error('watcher', `Failed to create live message for chat ${chatId}: ${err}`)
    }
  }

  // ── Event handler ─────────────────────────────────────────

  async function handleEvent(
    chatId: number,
    entry: WatcherEntry,
    gen: number,
    event: OpenCodeEvent,
  ): Promise<void> {
    const current = watchers.get(chatId)
    if (!current || current.generation !== gen) return
    if (entry.abort.signal.aborted) return

    const debateActive = deps.isDebateActive?.(chatId) ?? false
    const suppressDisplay = debateActive && event.type !== 'permission.asked' && event.type !== 'question.asked'

    switch (event.type) {
      case 'message.updated': {
        if (event.data.sessionId !== entry.sessionId) return
        if (suppressDisplay) break
        if (event.data.role === 'assistant') {
          entry.assistantMessageIds.add(event.data.messageId)
          if (entry.currentMessageId !== event.data.messageId) {
            entry.currentMessageId = event.data.messageId
            await ensureLiveMessage(chatId, entry)
            // Track for undo
            const state = await deps.state.getChatState(chatId)
            state.lastAssistantMessageId = event.data.messageId
            state.redoAvailable = false  // New work invalidates redo
            await deps.state.saveChatState(chatId, state)
          }
        }
        break
      }

      case 'message.part.updated': {
        if (suppressDisplay) break
        const { sessionId: evtSessionId, messageId, content } = event.data
        if (evtSessionId !== entry.sessionId) return
        if (messageId && !entry.assistantMessageIds.has(messageId)) return

        if (!entry.liveMsgHandle) {
          await ensureLiveMessage(chatId, entry)
        }

        entry.lastContent = content
        if (content.length > 0) {
          throttledEdit(chatId, entry, content)
        }
        break
      }

      case 'session.idle': {
        if (event.data.sessionId !== entry.sessionId) return
        logger.debug('watcher', `Session idle: ${entry.sessionId}`)

        if (entry.pendingEditTimer) {
          clearTimeout(entry.pendingEditTimer)
          entry.pendingEditTimer = null
        }
        if (entry.typingInterval) {
          clearInterval(entry.typingInterval)
          entry.typingInterval = null
        }

        if (!suppressDisplay && entry.lastContent && entry.liveMsgHandle) {
          try {
            const state = await deps.state.getChatState(chatId)
            await sendFinalResponse(chatId, entry.liveMsgHandle, entry.lastContent, state.settings, entry.directory)
          } catch (err) {
            logger.error('watcher', `Final delivery failed: ${err instanceof Error ? err.message : 'unknown'}`)
            if (entry.liveMsgHandle) {
              try {
                await deps.output.editText(chatId, entry.liveMsgHandle, `❌ Delivery error: ${escapeHtml(err instanceof Error ? err.message : 'Unknown')}`)
              } catch { /* give up */ }
            }
          }
        }

        resetTurnState(entry)

        // Drain queued messages
        if (deps.onQueueDrain) {
          const state = await deps.state.getChatState(chatId)
          const queued = [...state.queuedMessages]
          if (queued.length > 0) {
            state.queuedMessages = []
            await deps.state.saveChatState(chatId, state)
            void deps.onQueueDrain(chatId, queued)
          }
        }
        break
      }

      case 'session.error': {
        if (event.data.sessionId !== entry.sessionId) return
        logger.warn('watcher', `Session error: ${entry.sessionId}: ${event.data.error}`)

        if (entry.pendingEditTimer) {
          clearTimeout(entry.pendingEditTimer)
          entry.pendingEditTimer = null
        }
        if (entry.typingInterval) {
          clearInterval(entry.typingInterval)
          entry.typingInterval = null
        }

        if (entry.lastContent && entry.liveMsgHandle) {
          try {
            const state = await deps.state.getChatState(chatId)
            await sendFinalResponse(chatId, entry.liveMsgHandle, entry.lastContent, state.settings, entry.directory)
          } catch {
            if (entry.liveMsgHandle) {
              await deps.output.editText(chatId, entry.liveMsgHandle, truncateForDisplay(entry.lastContent)).catch(() => {})
            }
          }
        }

        const errorMsg = `❌ Error: ${escapeHtml(event.data.error)}`
        try { await deps.output.sendText(chatId, errorMsg) } catch { /* give up */ }

        resetTurnState(entry)
        break
      }

      case 'session.busy': {
        if (event.data.sessionId !== entry.sessionId) return
        if (suppressDisplay) break
        if (entry.promptHandle || entry.liveMsgHandle) {
          entry.busyNotified = true
          break
        }
        if (!entry.busyNotified) {
          entry.busyNotified = true
          logger.info('watcher', `Session ${entry.sessionId} became busy (external)`)
          await deps.output.sendText(chatId, '🔄 AI is working...').catch(() => {})
        }
        break
      }

      case 'session.retry': {
        if (event.data.sessionId !== entry.sessionId) return
        if (suppressDisplay) break
        entry.busyNotified = true
        if (entry.promptHandle || entry.liveMsgHandle) break
        logger.info('watcher', `Session ${entry.sessionId} retrying (attempt ${event.data.attempt})`)
        const retryMsg = `⏳ AI is retrying (attempt ${event.data.attempt})\n<i>${escapeHtml(event.data.message)}</i>`
        await deps.output.sendText(chatId, retryMsg).catch(() => {})
        break
      }

      case 'permission.asked': {
        if (event.data.sessionId !== entry.sessionId) return
        try {
          await deps.onPermissionAsked(chatId, event.data, entry.actorUserId ?? undefined)
        } catch (e) {
          logger.error('watcher', `Permission handler error: ${e}`)
        }
        break
      }

      case 'question.asked': {
        if (event.data.sessionId !== entry.sessionId) return
        try {
          await deps.onQuestionAsked(chatId, event.data, entry.actorUserId ?? undefined)
        } catch (e) {
          logger.error('watcher', `Question handler error: ${e}`)
        }
        break
      }

      default:
        break
    }
  }

  // ── Initial status check on watch ──────────────────────────

  async function deliverLastResponse(chatId: number, entry: WatcherEntry): Promise<void> {
    try {
      const messages = await deps.openCode.getSessionMessages(entry.sessionId, entry.directory)
      if (messages.length === 0) return

      const last = messages[messages.length - 1]
      if (last.role !== 'assistant') return

      const textParts = last.parts.filter(p => p.type === 'text')
      const content = textParts.map(p => ('text' in p ? p.text : '')).join('\n').trim()
      if (!content) return

      const state = await deps.state.getChatState(chatId)
      const handle = await deps.output.sendText(chatId, '📋 Loading last response...')
      await sendFinalResponse(chatId, handle, content, state.settings, entry.directory)
    } catch (err) {
      logger.warn('watcher', `Failed to deliver last response for chat ${chatId}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  async function checkInitialSessionStatus(chatId: number, entry: WatcherEntry): Promise<void> {
    try {
      const statuses = await deps.openCode.getSessionStatuses(entry.directory)
      const status = statuses[entry.sessionId]

      if (!status || status.type === 'idle') {
        logger.info('watcher', `Initial status check: session ${entry.sessionId} is ${status ? 'idle' : `not in status map (${Object.keys(statuses).length} returned)`}`)
        await deliverLastResponse(chatId, entry)
        return
      }

      if (entry.abort.signal.aborted) return
      const current = watchers.get(chatId)
      if (!current || current.generation !== entry.generation) return

      if (status.type === 'busy') {
        logger.info('watcher', `Session ${entry.sessionId} is busy on watch start`)
        if (entry.promptHandle || entry.liveMsgHandle) {
          entry.busyNotified = true
        } else if (!entry.busyNotified) {
          entry.busyNotified = true
          await deps.output.sendText(chatId, '🔄 AI is working...').catch(() => {})
        }
      } else if (status.type === 'retry') {
        logger.info('watcher', `Session ${entry.sessionId} is retrying on watch start (attempt ${status.attempt})`)
        if (entry.promptHandle || entry.liveMsgHandle) {
          entry.busyNotified = true
        } else if (!entry.busyNotified) {
          entry.busyNotified = true
          const msg = `⏳ AI is retrying (attempt ${status.attempt})\n<i>${escapeHtml(status.message)}</i>`
          await deps.output.sendText(chatId, msg).catch(() => {})
        }
      }
    } catch (err) {
      logger.warn('watcher', `Initial status check failed for chat ${chatId}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── SSE reconnect loop ────────────────────────────────────

  async function runSseLoop(chatId: number, entry: WatcherEntry): Promise<void> {
    const gen = entry.generation
    let backoffMs = RECONNECT_BASE_MS

    while (!entry.abort.signal.aborted) {
      try {
        logger.debug('watcher', `SSE connecting for chat ${chatId}, session ${entry.sessionId}`)
        await deps.openCode.streamEvents(
          entry.directory,
          (event) => handleEvent(chatId, entry, gen, event),
          entry.abort.signal,
        )
        // Stream ended normally (server closed connection)
        if (entry.abort.signal.aborted) return
        logger.debug('watcher', `SSE disconnected for chat ${chatId}, reconnecting in ${backoffMs}ms`)
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 1.5, RECONNECT_MAX_MS)
      } catch (err) {
        if (entry.abort.signal.aborted) return
        logger.warn('watcher', `SSE error for chat ${chatId}: ${err instanceof Error ? err.message : 'unknown'}, reconnecting in ${backoffMs}ms`)
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 1.5, RECONNECT_MAX_MS)
      }
    }
  }

  // ── Public API ────────────────────────────────────────────

  async function watch(chatId: number): Promise<void> {
    stop(chatId)

    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory || !state.activeSessionId) {
      logger.debug('watcher', `Cannot watch chat ${chatId}: no project or session`)
      return
    }

    const abort = new AbortController()
    const gen = Date.now()
    const entry: WatcherEntry = {
      directory: state.activeProjectDirectory,
      sessionId: state.activeSessionId,
      abort,
      generation: gen,
      liveMsgHandle: null,
      promptHandle: null,
      lastContent: '',
      lastEditTime: 0,
      pendingEditTimer: null,
      assistantMessageIds: new Set(),
      currentMessageId: null,
      typingInterval: null,
      liveUpdatesEnabled: true,
      actorUserId: null,
      busyNotified: false,
    }

    watchers.set(chatId, entry)
    logger.info('watcher', `Started watching session ${state.activeSessionId} for chat ${chatId}`)

    void runSseLoop(chatId, entry)
    void checkInitialSessionStatus(chatId, entry)
  }

  function stop(chatId: number): void {
    const existing = watchers.get(chatId)
    if (existing) {
      if (existing.pendingEditTimer) clearTimeout(existing.pendingEditTimer)
      if (existing.typingInterval) clearInterval(existing.typingInterval)
      existing.abort.abort()
      watchers.delete(chatId)
      logger.info('watcher', `Stopped watching for chat ${chatId}`)
    }
  }

  async function ensureWatching(chatId: number): Promise<void> {
    const existing = watchers.get(chatId)
    if (existing) {
      const state = await deps.state.getChatState(chatId)
      if (
        existing.sessionId === state.activeSessionId &&
        existing.directory === state.activeProjectDirectory
      ) {
        return
      }
    }
    await watch(chatId)
  }

  function isWatching(chatId: number): boolean {
    return watchers.has(chatId)
  }

  function setPromptHandle(chatId: number, handle: OutputHandle): void {
    const entry = watchers.get(chatId)
    if (entry) {
      entry.promptHandle = handle
      // Prevent "AI is working" message for user-initiated prompts
      entry.busyNotified = true
    }
  }

  function setPromptContext(chatId: number, ctx: { actorUserId?: number; liveUpdatesEnabled?: boolean }): void {
    const entry = watchers.get(chatId)
    if (!entry) return
    if (ctx.actorUserId !== undefined) entry.actorUserId = ctx.actorUserId
    if (ctx.liveUpdatesEnabled !== undefined) entry.liveUpdatesEnabled = ctx.liveUpdatesEnabled
  }

  return { watch, stop, ensureWatching, isWatching, setPromptHandle, setPromptContext }
}
