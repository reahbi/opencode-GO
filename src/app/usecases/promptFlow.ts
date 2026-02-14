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

  async function handleUserMessage(chatId: number, text: string, opts?: { actorUserId?: number; isGroup?: boolean; images?: ImageAttachment[] }): Promise<void> {
    const state = await deps.state.getChatState(chatId)
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

    state.lastPrompt = text
    await deps.state.saveChatState(chatId, state)

    await deps.watcher.ensureWatching(chatId)
    deps.watcher.setPromptContext(chatId, {
      actorUserId: opts?.actorUserId,
      liveUpdatesEnabled: !opts?.isGroup,
      userPrompt: text,
    })

    const handle = await deps.output.sendText(chatId, '⏳ Processing...')
    deps.watcher.setPromptHandle(chatId, handle)

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

      const queryHandle = deps.claude.runQuery({
        prompt: effectiveText,
        sessionId,
        isNewSession,
        cwd: directory,
        images: opts?.images,
        maxThinkingTokens: thinkingTokens,
        maxBudgetUsd: deps.config.maxBudgetUsd ?? undefined,
        systemPrompt,
      })

      // Pass the query handle to the watcher for event processing
      deps.watcher.watchQuery(chatId, queryHandle)

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
