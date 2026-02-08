import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { CustomAgentPort } from '../../domain/ports/CustomAgentPort.js'
import type { ImageAttachment } from '../../domain/models.js'
import type { SessionWatcher } from './sessionWatcher.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml } from '../../shared/formatResponse.js'

interface PromptFlowDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  watcher: SessionWatcher
  botRole?: 'writer' | 'reader' | 'standalone'
  customAgents?: CustomAgentPort
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

      if (state.customAgentId && deps.customAgents) {
        const agent = await deps.customAgents.get(state.customAgentId)
        if (agent) {
          effectiveText = `[SYSTEM INSTRUCTION]\n${agent.systemPrompt}\n[/SYSTEM INSTRUCTION]\n\n${effectiveText}`
        }
      }

      await deps.openCode.sendPrompt(sessionId, directory, effectiveText, state.activeAgent ?? undefined, opts?.images)
      logger.debug('session', `Prompt sent for session ${sessionId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('session', `Prompt failed: ${message}`)
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
