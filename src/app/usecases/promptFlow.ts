import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { SessionWatcher } from './sessionWatcher.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml } from '../../shared/formatResponse.js'

interface PromptFlowDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  watcher: SessionWatcher
  botRole?: 'writer' | 'reader' | 'standalone'
}

export function createPromptFlow(deps: PromptFlowDeps) {

  async function handleUserMessage(chatId: number, text: string): Promise<void> {
    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory) {
      await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
      return
    }
    if (!state.activeSessionId) {
      await deps.output.sendText(chatId, '활성 세션이 없습니다. /new 로 새 세션을 시작하세요.')
      return
    }

    const directory = state.activeProjectDirectory
    const sessionId = state.activeSessionId

    state.lastPrompt = text
    await deps.state.saveChatState(chatId, state)

    await deps.watcher.ensureWatching(chatId)

    const handle = await deps.output.sendText(chatId, '⏳ Processing...')
    deps.watcher.setPromptHandle(chatId, handle)

    try {
      const effectiveText = deps.botRole === 'reader'
        ? '[REVIEW MODE] 이 세션은 읽기 전용입니다. 파일 수정, 생성, 삭제를 하지 마세요. 코드 리뷰와 분석만 수행하세요.\n\n' + text
        : text
      await deps.openCode.sendPrompt(sessionId, directory, effectiveText, state.activeAgent ?? undefined)
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
