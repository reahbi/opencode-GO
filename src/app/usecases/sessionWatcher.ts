import type { QueryHandle } from '../../domain/ports/ClaudeAgentPort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { SummaryPort } from '../../domain/ports/SummaryPort.js'
import type { OutputHandle, UserSettings, QueuedMessage, ChatState, HistoryMessage, HistoryPart } from '../../domain/models.js'
import type { ClaudeEvent, QuestionAsked } from '../../domain/events.js'
import type { TunnelManager } from './tunnelManager.js'
import { isAskUserQuestion, parseAskUserQuestion } from '../../adapters/claude/claudeEventMapper.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml, sanitizeTelegramHtml, stripHtml } from '../../shared/formatResponse.js'
import { routeDelivery } from '../policies/deliveryRouter.js'
import { structuralExtract } from '../../shared/structuralExtract.js'
import { LIMITS } from '../policies/limits.js'

const STREAM_DISPLAY_LIMIT = 3500
const EDIT_THROTTLE_MS = 1000
const MDV2 = 'MarkdownV2'

interface SessionWatcherDeps {
  state: StateStore
  output: ChatOutputPort
  summary: SummaryPort
  onQuestionAsked: (chatId: number, event: QuestionAsked, actorUserId?: number) => Promise<void>
  isDebateActive?: (chatId: number) => boolean
  onQueueDrain?: (chatId: number, messages: QueuedMessage[]) => Promise<void>
  tunnel?: TunnelManager
  voiceFlow?: { sendVoiceResponseDirect(chatId: number, content: string, directory: string): Promise<void> }
  sessionStore?: import('../../domain/ports/SessionStorePort.js').SessionStorePort
}

interface ToolPartState {
  tool: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

type DeliveryState = 'idle' | 'pending' | 'delivering' | 'delivered' | 'done'

interface WatcherEntry {
  directory: string
  sessionId: string
  generation: number
  liveMsgHandle: OutputHandle | null
  promptHandle: OutputHandle | null
  lastContent: string
  lastEditTime: number
  pendingEditTimer: ReturnType<typeof setTimeout> | null
  assistantMessageIds: Set<string>
  currentMessageId: string | null
  typingInterval: ReturnType<typeof setInterval> | null
  liveUpdatesEnabled: boolean
  actorUserId: number | null
  busyNotified: boolean
  textParts: Map<string, string>
  toolParts: Map<string, ToolPartState>
  partOrder: string[]
  lastActivityTime: number
  inactivityCheckTimer: ReturnType<typeof setInterval> | null
  lastWarningTime: number
  deliveryState: DeliveryState
  turnGeneration: number
  lastDeliveredTurnGen: number
  queryHandle: QueryHandle | null
  /** Accumulated text from text.delta events for the current text block */
  accumulatedText: string
  /** Counter for generating unique text part IDs */
  textPartCounter: number
  /** Current text part ID being accumulated */
  currentTextPartId: string | null
  /** Whether thinking indicator has been shown for this turn */
  thinkingShown: boolean
  /** Current assistant message being built for history */
  currentAssistantMessage: HistoryMessage | null
  /** User prompt text for the current turn */
  currentUserPrompt: string | null
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
  setPromptContext(chatId: number, ctx: { actorUserId?: number; liveUpdatesEnabled?: boolean; userPrompt?: string }): void
  /** Start watching events from a query handle */
  watchQuery(chatId: number, queryHandle: QueryHandle): void
}

function hasErrorCode(err: unknown, code: string): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes(code)
}

export function createSessionWatcher(deps: SessionWatcherDeps): SessionWatcher {
  const watchers = new Map<number, WatcherEntry>()

  // ── Voice response helpers ────────────────────────────────

  function generateResponseId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  }

  function addVoiceResponse(state: ChatState, content: string, directory: string): string {
    const responseId = generateResponseId()
    const now = Date.now()

    if (!state.voiceResponses) {
      state.voiceResponses = []
    }

    state.voiceResponses = state.voiceResponses.filter(
      r => now - r.createdAt < LIMITS.VOICE_HISTORY_TTL_MS,
    )

    state.voiceResponses.push({
      id: responseId,
      content: content.slice(0, 30_000),
      createdAt: now,
      directory,
    })

    if (state.voiceResponses.length > LIMITS.VOICE_HISTORY_MAX) {
      state.voiceResponses = state.voiceResponses.slice(-LIMITS.VOICE_HISTORY_MAX)
    }

    return responseId
  }

  async function handleVoiceResponse(
    chatId: number,
    state: ChatState,
    content: string,
    directory: string,
  ): Promise<void> {
    if (!state.settings.voiceMode) return

    const responseId = addVoiceResponse(state, content, directory)

    if (state.settings.voiceAutoMode && content.length >= LIMITS.VOICE_AUTO_MIN_CONTENT) {
      if (deps.voiceFlow) {
        deps.voiceFlow.sendVoiceResponseDirect(chatId, content, directory).catch(err => {
          logger.warn('watcher', `Auto-voice failed: ${err instanceof Error ? err.message : 'unknown'}`)
        })
      }
      return
    }

    try {
      await deps.output.sendInteraction(chatId, '🎧', [
        { label: '음성으로 듣기', callbackData: `voice:listen:${responseId}` },
      ])
    } catch (voiceErr) {
      logger.warn('watcher', `Failed to send voice button: ${voiceErr instanceof Error ? voiceErr.message : 'unknown'}`)
    }
  }

  // ── Display helpers ───────────────────────────────────────

  function truncateForDisplay(content: string): string {
    if (content.length <= STREAM_DISPLAY_LIMIT) return escapeHtml(content)
    const truncated = content.slice(0, STREAM_DISPLAY_LIMIT)
    return escapeHtml(truncated) + '\n\n<i>... streaming (will send full response when done)</i>'
  }

  function getToolStatusIcon(status: ToolPartState['status']): string {
    switch (status) {
      case 'pending': return '⏳'
      case 'running': return '🔄'
      case 'completed': return '✅'
      case 'error': return '❌'
    }
  }

  function buildStreamingDisplay(entry: WatcherEntry): string {
    const parts: string[] = []

    for (const partId of entry.partOrder) {
      if (entry.toolParts.has(partId)) {
        const tool = entry.toolParts.get(partId)!
        const icon = getToolStatusIcon(tool.status)
        parts.push(`${icon} <b>${escapeHtml(tool.title)}</b>`)
      } else if (entry.textParts.has(partId)) {
        const text = entry.textParts.get(partId)!
        if (text.trim()) {
          parts.push(escapeHtml(text))
        }
      }
    }

    const combined = parts.join('\n\n')
    if (combined.length <= STREAM_DISPLAY_LIMIT) return combined
    return combined.slice(0, STREAM_DISPLAY_LIMIT) + '\n\n<i>... streaming (will send full response when done)</i>'
  }

  function getFullTextContent(entry: WatcherEntry): string {
    const texts: string[] = []
    for (const partId of entry.partOrder) {
      if (entry.textParts.has(partId)) {
        const text = entry.textParts.get(partId)!
        if (text.trim()) texts.push(text)
      }
    }
    return texts.join('\n\n')
  }

  function startTypingIndicator(chatId: number, entry: WatcherEntry): void {
    if (!entry.liveUpdatesEnabled || entry.typingInterval) return
    deps.output.sendTypingAction(chatId).catch(() => {})
    entry.typingInterval = setInterval(() => {
      deps.output.sendTypingAction(chatId).catch(() => {})
    }, LIMITS.TYPING_INTERVAL_MS)
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
        const rawSummary = await deps.summary.summarize(directory, content, settings.summaryModel, settings.userExpertise)
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

  // ── Inactivity detection ──────────────────────────────────

  function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes}분`
    const hours = Math.floor(minutes / 60)
    const remainingMins = minutes % 60
    return remainingMins > 0 ? `${hours}시간 ${remainingMins}분` : `${hours}시간`
  }

  function startInactivityCheck(chatId: number, entry: WatcherEntry): void {
    stopInactivityCheck(entry)
    entry.lastActivityTime = Date.now()
    entry.lastWarningTime = 0

    entry.inactivityCheckTimer = setInterval(() => {
      const now = Date.now()
      const inactiveDuration = now - entry.lastActivityTime
      const timeSinceLastWarning = now - entry.lastWarningTime

      if (inactiveDuration >= LIMITS.INACTIVITY_WARNING_MS) {
        const shouldWarn = entry.lastWarningTime === 0 || timeSinceLastWarning >= LIMITS.INACTIVITY_WARNING_MS

        if (shouldWarn) {
          entry.lastWarningTime = now
          const duration = formatDuration(inactiveDuration)
          const msg = `⚠️ AI가 <b>${duration}</b> 동안 응답이 없습니다.\n작업이 멈췄거나 오류가 발생했을 수 있습니다.\n\n<i>/abort로 중단하거나 계속 기다릴 수 있습니다.</i>`
          deps.output.sendText(chatId, msg, 'HTML').catch(() => {})
          logger.warn('watcher', `Inactivity warning for chat ${chatId}: ${duration} since last activity`)
        }
      }
    }, LIMITS.INACTIVITY_CHECK_INTERVAL_MS)
  }

  function stopInactivityCheck(entry: WatcherEntry): void {
    if (entry.inactivityCheckTimer) {
      clearInterval(entry.inactivityCheckTimer)
      entry.inactivityCheckTimer = null
    }
    entry.lastWarningTime = 0
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
    stopInactivityCheck(entry)
    entry.liveMsgHandle = null
    entry.promptHandle = null
    entry.lastContent = ''
    entry.lastEditTime = 0
    entry.currentMessageId = null
    entry.assistantMessageIds.clear()
    entry.busyNotified = false
    entry.textParts.clear()
    entry.toolParts.clear()
    entry.partOrder = []
    entry.deliveryState = 'done'
    entry.accumulatedText = ''
    entry.currentTextPartId = null
    entry.thinkingShown = false
    entry.currentAssistantMessage = null
  }

  // ── Message history helpers ───────────────────────────────

  async function saveMessagesToSession(sessionId: string, userMessage: HistoryMessage | null, assistantMessage: HistoryMessage | null): Promise<void> {
    if (!deps.sessionStore || !sessionId) return

    try {
      const session = await deps.sessionStore.getSession(sessionId)
      if (!session) return

      const messages = session.messages || []
      if (userMessage) messages.push(userMessage)
      if (assistantMessage) messages.push(assistantMessage)

      await deps.sessionStore.updateSession(sessionId, {
        messages,
        messageCount: messages.length,
      })
    } catch (err) {
      logger.warn('watcher', `Failed to save messages to session: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  function buildHistoryMessage(entry: WatcherEntry): HistoryMessage {
    const parts: HistoryPart[] = []

    for (const partId of entry.partOrder) {
      if (entry.textParts.has(partId)) {
        const text = entry.textParts.get(partId)!
        if (text.trim()) {
          parts.push({ type: 'text', text })
        }
      } else if (entry.toolParts.has(partId)) {
        const tool = entry.toolParts.get(partId)!
        parts.push({
          type: 'tool',
          tool: tool.tool,
          title: tool.title,
          status: tool.status,
        })
      }
    }

    return {
      role: 'assistant',
      createdAt: Date.now(),
      parts,
    }
  }

  // ── Throttled streaming edits ─────────────────────────────

  function throttledEdit(chatId: number, entry: WatcherEntry, htmlContent: string): void {
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
      deps.output.editText(chatId, handle, htmlContent).catch(() => {})
    } else {
      entry.pendingEditTimer = setTimeout(() => {
        entry.lastEditTime = Date.now()
        entry.pendingEditTimer = null
        deps.output.editText(chatId, handle, htmlContent).catch(() => {})
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
      startTypingIndicator(chatId, entry)
      return
    }

    // Create new message for external activity (from computer/terminal)
    try {
      const handle = await deps.output.sendText(chatId, '📡 Session activity detected...')
      entry.liveMsgHandle = handle
      startTypingIndicator(chatId, entry)
    } catch (err) {
      logger.error('watcher', `Failed to create live message for chat ${chatId}: ${err}`)
    }
  }

  // ── Event handler (maps ClaudeEvent to display logic) ─────

  async function handleEvent(
    chatId: number,
    entry: WatcherEntry,
    event: ClaudeEvent,
  ): Promise<void> {
    const current = watchers.get(chatId)
    if (!current || current !== entry) return

    const debateActive = deps.isDebateActive?.(chatId) ?? false
    const suppressDisplay = debateActive && event.type !== 'tool.use'

    switch (event.type) {
      case 'system.init': {
        if (!entry.sessionId) {
          entry.sessionId = event.sessionId
          // Persist to state store
          try {
            const state = await deps.state.getChatState(chatId)
            state.activeSessionId = event.sessionId
            await deps.state.saveChatState(chatId, state)
          } catch (err) {
            logger.warn('watcher', `Failed to persist sessionId: ${err instanceof Error ? err.message : 'unknown'}`)
          }
        }
        logger.debug('watcher', `system.init: session=${event.sessionId} model=${event.model} tools=${event.tools.length}`)
        break
      }

      case 'thinking': {
        if (suppressDisplay) break
        if (!entry.thinkingShown) {
          entry.thinkingShown = true
          await ensureLiveMessage(chatId, entry)
          throttledEdit(chatId, entry, '💭 Thinking...')
        }
        try {
          const st = await deps.state.getChatState(chatId)
          st.lastThinkingEnabled = true
          await deps.state.saveChatState(chatId, st)
        } catch { /* ignore */ }
        break
      }

      case 'text.delta': {
        if (suppressDisplay) break
        entry.lastActivityTime = Date.now()

        if (!entry.liveMsgHandle) {
          await ensureLiveMessage(chatId, entry)
        }

        // Start inactivity check on first activity
        if (!entry.inactivityCheckTimer) {
          startInactivityCheck(chatId, entry)
        }

        // Create or accumulate into a text part
        if (!entry.currentTextPartId) {
          const partId = `text-${entry.textPartCounter++}`
          entry.currentTextPartId = partId
          if (!entry.partOrder.includes(partId)) {
            entry.partOrder.push(partId)
          }
          entry.accumulatedText = ''
        }

        entry.accumulatedText += event.content
        entry.textParts.set(entry.currentTextPartId, entry.accumulatedText)
        entry.lastContent = getFullTextContent(entry)

        if (entry.lastContent && entry.deliveryState === 'idle') {
          entry.deliveryState = 'pending'
        }

        if (entry.accumulatedText.length > 0) {
          throttledEdit(chatId, entry, buildStreamingDisplay(entry))
        }
        break
      }

      case 'text.done': {
        if (suppressDisplay) break
        // Finalize the current text part with the full content
        if (entry.currentTextPartId) {
          entry.textParts.set(entry.currentTextPartId, event.content)
        } else {
          // No current part (edge case) - create one
          const partId = `text-${entry.textPartCounter++}`
          entry.currentTextPartId = partId
          if (!entry.partOrder.includes(partId)) {
            entry.partOrder.push(partId)
          }
          entry.textParts.set(partId, event.content)
        }
        entry.lastContent = getFullTextContent(entry)
        // Reset for next text block
        entry.currentTextPartId = null
        entry.accumulatedText = ''
        break
      }

      case 'tool.use': {
        // Check for AskUserQuestion before anything else
        if (isAskUserQuestion({ ...event, type: 'tool.use' })) {
          const question = parseAskUserQuestion(event)
          if (question) {
            try {
              await deps.onQuestionAsked(chatId, question, entry.actorUserId ?? undefined)
            } catch (e) {
              logger.error('watcher', `Question handler error: ${e}`)
            }
            break
          }
        }

        if (suppressDisplay) break
        entry.lastActivityTime = Date.now()

        if (!entry.liveMsgHandle) {
          await ensureLiveMessage(chatId, entry)
        }

        // Start inactivity check on first activity
        if (!entry.inactivityCheckTimer) {
          startInactivityCheck(chatId, entry)
        }

        // End current text part if any (tool interrupts text)
        entry.currentTextPartId = null
        entry.accumulatedText = ''

        const toolPartId = `tool-${event.toolUseId}`
        if (!entry.partOrder.includes(toolPartId)) {
          entry.partOrder.push(toolPartId)
        }
        entry.toolParts.set(toolPartId, {
          tool: event.toolName,
          title: event.toolName,
          status: 'running',
        })

        throttledEdit(chatId, entry, buildStreamingDisplay(entry))
        break
      }

      case 'tool.result': {
        if (suppressDisplay) break
        entry.lastActivityTime = Date.now()

        const toolResultPartId = `tool-${event.toolUseId}`
        const existing = entry.toolParts.get(toolResultPartId)
        if (existing) {
          existing.status = 'completed'
          entry.toolParts.set(toolResultPartId, existing)
        }

        throttledEdit(chatId, entry, buildStreamingDisplay(entry))
        break
      }

      case 'result': {
        const turnGen = entry.turnGeneration

        if (entry.pendingEditTimer) {
          clearTimeout(entry.pendingEditTimer)
          entry.pendingEditTimer = null
        }
        if (entry.typingInterval) {
          clearInterval(entry.typingInterval)
          entry.typingInterval = null
        }
        stopInactivityCheck(entry)

        if (event.subtype === 'success') {
          if (entry.deliveryState === 'delivering' || entry.deliveryState === 'delivered' || entry.deliveryState === 'done') {
            logger.debug('watcher', `Result success ignored (already ${entry.deliveryState})`)
            break
          }
          logger.debug('watcher', `Result success for chat ${chatId}`)

          try {
            const state = await deps.state.getChatState(chatId)

            if (event.costUsd && event.costUsd > 0) {
              state.sessionCostUsd = (state.sessionCostUsd ?? 0) + event.costUsd
            }

            if (!suppressDisplay && entry.lastContent) {
              let deliveryHandle = entry.liveMsgHandle
              if (!deliveryHandle) {
                try {
                  deliveryHandle = await deps.output.sendText(chatId, '📋 Loading response...')
                  logger.debug('watcher', `Created fallback handle for delivery in chat ${chatId}`)
                } catch (handleErr) {
                  logger.error('watcher', `Failed to create fallback handle: ${handleErr}`)
                }
              }

              if (deliveryHandle) {
                entry.deliveryState = 'delivering'
                await sendFinalResponse(chatId, deliveryHandle, entry.lastContent, state.settings, entry.directory)

                const MAX_STORED_RESPONSE_LENGTH = 30_000
                state.lastAssistantResponse = {
                  content: entry.lastContent.slice(0, MAX_STORED_RESPONSE_LENGTH),
                  sessionId: entry.sessionId,
                  timestamp: Date.now(),
                }

                // Guard: only send voice/tunnel if still in same turn
                if (entry.turnGeneration === turnGen) {
                  await handleVoiceResponse(chatId, state, entry.lastContent, entry.directory)

                  const tunnelState = deps.tunnel?.get(chatId)
                  if (tunnelState?.isActive && tunnelState.url) {
                    try {
                      await deps.output.sendInteraction(chatId, '🔗 Preview available', [
                        { label: '🌐 Open Preview', url: tunnelState.url },
                        { label: '⏹ Stop Tunnel', callbackData: 'tunnel:stop' },
                      ])
                    } catch (tunnelErr) {
                      logger.warn('watcher', `Failed to send tunnel button: ${tunnelErr instanceof Error ? tunnelErr.message : 'unknown'}`)
                    }
                  }
                }
                entry.deliveryState = 'delivered'
                entry.lastDeliveredTurnGen = turnGen
              }
            }

            // Save message history
            if (entry.lastContent) {
              const assistantMessage = buildHistoryMessage(entry)
              const userMessage = entry.currentUserPrompt ? {
                role: 'user' as const,
                createdAt: Date.now(),
                parts: [{ type: 'text' as const, text: entry.currentUserPrompt }],
              } : null
              await saveMessagesToSession(entry.sessionId, userMessage, assistantMessage)
            }

            resetTurnState(entry)

            const queued = [...state.queuedMessages]
            if (queued.length > 0) {
              state.queuedMessages = []
            }
            await deps.state.saveChatState(chatId, state)

            if (event.costUsd && event.costUsd > 0 && deps.sessionStore && entry.sessionId) {
              deps.sessionStore.updateSession(entry.sessionId, {
                totalCostUsd: state.sessionCostUsd,
                lastActiveAt: Date.now(),
              }).catch(err => logger.warn('watcher', `Failed to update session cost: ${err instanceof Error ? err.message : 'unknown'}`))
            }

            if (deps.onQueueDrain && queued.length > 0) {
              void deps.onQueueDrain(chatId, queued)
            }
          } catch (err) {
            logger.error('watcher', `Result handling failed: ${err instanceof Error ? err.message : 'unknown'}`)
            entry.deliveryState = 'pending'
            if (entry.liveMsgHandle) {
              try {
                await deps.output.editText(chatId, entry.liveMsgHandle, `❌ Delivery error: ${escapeHtml(err instanceof Error ? err.message : 'Unknown')}`)
              } catch { /* give up */ }
            }
            resetTurnState(entry)
          }
        } else {
          // event.subtype === 'error'
          const errorText = event.errorMessage ?? 'Unknown error'
          logger.warn('watcher', `Result error for chat ${chatId}: ${errorText}`)

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

          const errorMsg = `❌ Error: ${escapeHtml(errorText)}`
          try { await deps.output.sendText(chatId, errorMsg) } catch { /* give up */ }

          resetTurnState(entry)
        }
        break
      }

      case 'error': {
        logger.warn('watcher', `Stream error for chat ${chatId}: ${event.message}`)
        const errorMsg = `❌ Error: ${escapeHtml(event.message)}`
        try { await deps.output.sendText(chatId, errorMsg) } catch { /* give up */ }
        break
      }

      default:
        break
    }
  }

  // ── Query event iteration ──────────────────────────────────

  async function iterateQueryEvents(
    chatId: number,
    entry: WatcherEntry,
    handle: QueryHandle,
  ): Promise<void> {
    try {
      for await (const event of handle.messages) {
        const current = watchers.get(chatId)
        if (!current || current !== entry) break
        await handleEvent(chatId, entry, event)
      }
    } catch (err) {
      const current = watchers.get(chatId)
      if (!current || current !== entry) return

      logger.error('watcher', `Query iteration error for chat ${chatId}: ${err instanceof Error ? err.message : 'unknown'}`)

      // Deliver any accumulated content
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

      const errorMsg = `❌ Stream error: ${escapeHtml(err instanceof Error ? err.message : 'Unknown')}`
      try { await deps.output.sendText(chatId, errorMsg) } catch { /* give up */ }

      resetTurnState(entry)
    }
  }

  // ── Public API ────────────────────────────────────────────

  async function watch(chatId: number): Promise<void> {
    stop(chatId)

    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory) {
      logger.debug('watcher', `Cannot watch chat ${chatId}: no project directory`)
      return
    }

    const gen = Date.now()
    const entry: WatcherEntry = {
      directory: state.activeProjectDirectory,
      sessionId: state.activeSessionId ?? '',
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
      textParts: new Map(),
      toolParts: new Map(),
      partOrder: [],
      lastActivityTime: 0,
      inactivityCheckTimer: null,
      lastWarningTime: 0,
      deliveryState: 'idle',
      turnGeneration: 0,
      lastDeliveredTurnGen: -1,
      queryHandle: null,
      accumulatedText: '',
      textPartCounter: 0,
      currentTextPartId: null,
      thinkingShown: false,
      currentAssistantMessage: null,
      currentUserPrompt: null,
    }

    watchers.set(chatId, entry)
    logger.info('watcher', `Started watching for chat ${chatId} (dir=${state.activeProjectDirectory})`)
  }

  function stop(chatId: number): void {
    const existing = watchers.get(chatId)
    if (existing) {
      if (existing.pendingEditTimer) clearTimeout(existing.pendingEditTimer)
      if (existing.typingInterval) clearInterval(existing.typingInterval)
      stopInactivityCheck(existing)
      if (existing.queryHandle) {
        existing.queryHandle.abort()
      }
      watchers.delete(chatId)
      logger.info('watcher', `Stopped watching for chat ${chatId}`)
    }
  }

  async function ensureWatching(chatId: number): Promise<void> {
    const existing = watchers.get(chatId)
    if (existing) {
      const state = await deps.state.getChatState(chatId)
      if (
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

  function setPromptContext(chatId: number, ctx: { actorUserId?: number; liveUpdatesEnabled?: boolean; userPrompt?: string }): void {
    const entry = watchers.get(chatId)
    if (!entry) return

    entry.turnGeneration++
    entry.deliveryState = 'idle'
    entry.lastContent = ''
    entry.textParts.clear()
    entry.toolParts.clear()
    entry.partOrder = []
    entry.currentMessageId = null
    entry.busyNotified = false
    entry.accumulatedText = ''
    entry.currentTextPartId = null
    entry.thinkingShown = false
    entry.currentAssistantMessage = null

    if (ctx.actorUserId !== undefined) entry.actorUserId = ctx.actorUserId
    if (ctx.liveUpdatesEnabled !== undefined) entry.liveUpdatesEnabled = ctx.liveUpdatesEnabled
    if (ctx.userPrompt !== undefined) entry.currentUserPrompt = ctx.userPrompt
  }

  function watchQuery(chatId: number, queryHandle: QueryHandle): void {
    const entry = watchers.get(chatId)
    if (!entry) return

    entry.queryHandle = queryHandle
    entry.turnGeneration++
    entry.deliveryState = 'idle'
    entry.lastContent = ''
    entry.textParts.clear()
    entry.toolParts.clear()
    entry.partOrder = []
    entry.currentMessageId = null
    entry.busyNotified = true
    entry.accumulatedText = ''
    entry.textPartCounter = 0
    entry.currentTextPartId = null
    entry.thinkingShown = false

    // Capture sessionId from query handle if available
    if (queryHandle.sessionId) {
      entry.sessionId = queryHandle.sessionId
    }

    // Start async iteration in background
    void iterateQueryEvents(chatId, entry, queryHandle)
  }

  return { watch, stop, ensureWatching, isWatching, setPromptHandle, setPromptContext, watchQuery }
}
