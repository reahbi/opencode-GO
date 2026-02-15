import type { ClaudeAgentPort } from '../../domain/ports/ClaudeAgentPort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { CustomAgentPort } from '../../domain/ports/CustomAgentPort.js'
import type { SessionStorePort } from '../../domain/ports/SessionStorePort.js'
import type { ImageAttachment } from '../../domain/models.js'
import type { SessionWatcher } from './sessionWatcher.js'
import { getThinkingLevel } from '../../adapters/claude/claudeEventMapper.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml } from '../../shared/formatResponse.js'
import { updateChatState } from './stateUpdate.js'
import { enqueueMessage } from '../queue/messageQueue.js'

interface PromptFlowDeps {
  claude: ClaudeAgentPort
  state: StateStore
  output: ChatOutputPort
  watcher: SessionWatcher
  sessionStore?: SessionStorePort
  botRole?: 'writer' | 'reader' | 'standalone'
  customAgents?: CustomAgentPort
  config: {
    maxThinkingTokens: number
    maxBudgetUsd: number | null
  }
}

export function createPromptFlow(deps: PromptFlowDeps) {

  async function handleUserMessage(chatId: number, text: string, opts?: { actorUserId?: number; isGroup?: boolean; images?: ImageAttachment[]; threadId?: number; fromQueueDrain?: boolean }): Promise<void> {
    const state = await deps.state.getChatState(chatId, opts?.threadId)
    if (!state.activeProjectDirectory) {
      await deps.output.sendText(chatId, 'No active project. Set DEFAULT_PROJECT in .env.')
      return
    }
    if (!state.activeSessionId) {
      await deps.output.sendText(chatId, 'No active session. Use /new to start one.')
      return
    }

    const directory = state.activeProjectDirectory
    const sessionId = state.activeSessionId

    const activeQuery = deps.watcher.getActiveQueryHandle(chatId, opts?.threadId)
    if (activeQuery) {
      if (opts?.images?.length) {
        await deps.output.sendText(chatId, '⏳ A request is already processing. Please retry file/image upload after it completes.')
        return
      }

      const queueResult = await updateChatState(deps.state, chatId, (chatState) =>
        enqueueMessage(chatState, {
          text,
          timestamp: Date.now(),
          actorUserId: opts?.actorUserId,
        }),
      opts?.threadId)

      const droppedNotice = queueResult.dropped && queueResult.dropped > 0
        ? ` (${queueResult.dropped} older message${queueResult.dropped === 1 ? '' : 's'} dropped)`
        : ''
      // Only show "Already processing" message if not from queue drain (to avoid duplicate notifications)
      if (!opts?.fromQueueDrain) {
        await deps.output.sendText(chatId, `⏳ Already processing. Queued at position ${queueResult.position}${droppedNotice}.`)
      }
      return
    }

    await updateChatState(deps.state, chatId, (chatState) => {
      chatState.lastPrompt = text
    }, opts?.threadId)

    await deps.watcher.ensureWatching(chatId, opts?.threadId)
    deps.watcher.setPromptContext(chatId, {
      actorUserId: opts?.actorUserId,
      liveUpdatesEnabled: !opts?.isGroup,
      userPrompt: text,
    }, opts?.threadId)

    const handle = await deps.output.sendText(chatId, '⏳ Processing...')
    deps.watcher.setPromptHandle(chatId, handle, opts?.threadId)

    try {
      const isReview = state.settings.reviewMode !== undefined
        ? state.settings.reviewMode
        : deps.botRole === 'reader'
      let effectiveText = isReview
        ? '[REVIEW MODE] This session is read-only. Do not modify, create, or delete files. Only perform code review and analysis.\n\n' + text
        : text

      let systemPrompt: string | undefined
      if (state.customAgentId && deps.customAgents) {
        const agent = await deps.customAgents.get(state.customAgentId)
        if (agent) {
          systemPrompt = agent.systemPrompt
        }
      }

      // Determine thinking level from message keywords
      const thinkingTokens = getThinkingLevel(text) || deps.config.maxThinkingTokens

      // Check if this is a brand-new session (no messages yet on disk)
      let isNewSession = true
      if (deps.sessionStore) {
        const session = await deps.sessionStore.getSession(sessionId)
        isNewSession = !session || session.messageCount === 0
      }

      let runtimeModel = state.activeAgent || undefined
      if (state.activeAgent) {
        try {
          const supportedModels = await deps.claude.getSupportedModels()
          const isModelAvailable = supportedModels.some(model => model.id === state.activeAgent)
          if (!isModelAvailable) {
            runtimeModel = undefined
            await updateChatState(deps.state, chatId, (chatState) => {
              chatState.activeAgent = null
            }, opts?.threadId)
            await deps.output.sendText(
              chatId,
              `⚠️ Selected model <code>${escapeHtml(state.activeAgent)}</code> is unavailable. Switched to default model.`,
              'HTML',
            )
          }
        } catch (modelErr) {
          logger.warn('session', `Model availability check failed: ${modelErr instanceof Error ? modelErr.message : 'unknown'}`)
        }
      }

      const queryHandle = deps.claude.runQuery({
        prompt: effectiveText,
        sessionId,
        isNewSession,
        cwd: directory,
        model: runtimeModel,
        images: opts?.images,
        maxThinkingTokens: thinkingTokens,
        maxBudgetUsd: deps.config.maxBudgetUsd ?? undefined,
        permissionMode: state.settings.permissionMode,
        systemPrompt,
      })

      // Pass the query handle to the watcher for event processing
      deps.watcher.watchQuery(chatId, queryHandle, opts?.threadId)

      if (deps.sessionStore && !deps.watcher.isWatching(chatId, opts?.threadId)) {
        throw new Error('Session watcher is unavailable. Please use /resume and retry.')
      }

      // Mark session as busy
      if (deps.sessionStore) {
        deps.sessionStore.updateSession(sessionId, { status: 'busy' }).catch(err =>
          logger.warn('session', `Failed to mark session busy: ${err instanceof Error ? err.message : 'unknown'}`))
      }

      logger.debug('session', `Query started for session ${sessionId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('session', `Query failed: ${message}`)
      try {
        await deps.output.editText(chatId, handle, `❌ Error: ${escapeHtml(message)}`)
      } catch {
        try { await deps.output.sendText(chatId, `❌ Error: ${escapeHtml(message)}`) } catch { /* swallow */ }
      }
    }
  }

  return {
    handleUserMessage,
  }
}
