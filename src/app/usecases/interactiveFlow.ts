import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { Button, PendingInteraction } from '../../domain/models.js'
import type { PermissionAsked, QuestionAsked } from '../../domain/events.js'
import { LIMITS } from '../policies/limits.js'
import { logger } from '../../shared/logger.js'
import { randomUUID } from 'node:crypto'

interface InteractiveFlowDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createInteractiveFlow(deps: InteractiveFlowDeps) {
  async function handlePermissionEvent(chatId: number, event: PermissionAsked): Promise<void> {
    try {
      const interactionId = randomUUID()
      const interaction: PendingInteraction = {
        interactionId,
        sessionId: event.sessionId,
        requestId: event.requestId,
        type: 'permission',
        expiresAt: Date.now() + LIMITS.INTERACTION_TTL_MS,
      }

      const chatState = await deps.state.getChatState(chatId)
      chatState.pendingInteractions.push(interaction)
      await deps.state.saveChatState(chatId, chatState)

      const text = `🔐 <b>Permission requested</b>\n${escapeHtml(event.title)}\nPatterns: ${event.patterns.map(escapeHtml).join(', ')}`
      const buttons: Button[] = [
        { label: 'Allow Once', callbackData: `perm:${interactionId}:once` },
        { label: 'Allow Always', callbackData: `perm:${interactionId}:always` },
        { label: 'Deny', callbackData: `perm:${interactionId}:reject` },
      ]

      await deps.output.sendInteraction(chatId, text, buttons)
    } catch (error) {
      logger.error('interactive', 'Failed to handle permission event', { chatId, error })
      await deps.output.sendText(chatId, '❌ Failed to process permission request')
    }
  }

  async function handleQuestionEvent(chatId: number, event: QuestionAsked): Promise<void> {
    try {
      const interactionId = randomUUID()
      const interaction: PendingInteraction = {
        interactionId,
        sessionId: event.sessionId,
        requestId: event.requestId,
        type: 'question',
        expiresAt: Date.now() + LIMITS.INTERACTION_TTL_MS,
      }

      const chatState = await deps.state.getChatState(chatId)
      chatState.pendingInteractions.push(interaction)
      await deps.state.saveChatState(chatId, chatState)

      const text = `❓ <b>Question</b>\n${escapeHtml(event.questions[0]?.text || 'No question text')}`
      const options = event.questions[0]?.options ?? []
      const buttons: Button[] = options.map((opt, i) => ({
        label: opt,
        callbackData: `q:${interactionId}:${i}`,
      }))
      buttons.push({ label: 'Skip', callbackData: `q:${interactionId}:skip` })

      await deps.output.sendInteraction(chatId, text, buttons)
    } catch (error) {
      logger.error('interactive', 'Failed to handle question event', { chatId, error })
      await deps.output.sendText(chatId, '❌ Failed to process question')
    }
  }

   async function handlePermissionCallback(
     chatId: number,
     interactionId: string,
     response: 'once' | 'always' | 'reject'
   ): Promise<void> {
     try {
       await cleanupExpired(chatId)
       const chatState = await deps.state.getChatState(chatId)
      const interaction = chatState.pendingInteractions.find(i => i.interactionId === interactionId)

      if (!interaction || Date.now() > interaction.expiresAt) {
        await deps.output.sendText(chatId, '이 상호작용은 만료되었습니다.')
        return
      }

      const directory = chatState.activeProjectDirectory
      if (!directory) {
        await deps.output.sendText(chatId, '❌ 활성 프로젝트 디렉토리가 없습니다')
        return
      }

      await deps.openCode.replyPermission(interaction.requestId, directory, response)

      chatState.pendingInteractions = chatState.pendingInteractions.filter(
        i => i.interactionId !== interactionId
      )
      await deps.state.saveChatState(chatId, chatState)

      await deps.output.sendText(chatId, `✅ Permission: ${response}`)
    } catch (error) {
      logger.error('interactive', 'Failed to handle permission callback', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process permission response')
    }
  }

   async function handleQuestionCallback(
     chatId: number,
     interactionId: string,
     answerIndex: number | null
   ): Promise<void> {
     try {
       await cleanupExpired(chatId)
       const chatState = await deps.state.getChatState(chatId)
      const interaction = chatState.pendingInteractions.find(i => i.interactionId === interactionId)

      if (!interaction || Date.now() > interaction.expiresAt) {
        await deps.output.sendText(chatId, '이 상호작용은 만료되었습니다.')
        return
      }

      const directory = chatState.activeProjectDirectory
      if (!directory) {
        await deps.output.sendText(chatId, '❌ 활성 프로젝트 디렉토리가 없습니다')
        return
      }

      if (answerIndex === null) {
        await deps.openCode.rejectQuestion(interaction.requestId, directory)
        await deps.output.sendText(chatId, '⏭️ Question skipped')
      } else {
        const answers = [[String(answerIndex)]]
        await deps.openCode.replyQuestion(interaction.requestId, directory, answers)
        await deps.output.sendText(chatId, `✅ Answer submitted: ${answerIndex}`)
      }

      chatState.pendingInteractions = chatState.pendingInteractions.filter(
        i => i.interactionId !== interactionId
      )
      await deps.state.saveChatState(chatId, chatState)
    } catch (error) {
      logger.error('interactive', 'Failed to handle question callback', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process answer')
    }
  }

  async function cleanupExpired(chatId: number): Promise<void> {
    try {
      const chatState = await deps.state.getChatState(chatId)
      const now = Date.now()
      const originalCount = chatState.pendingInteractions.length

      chatState.pendingInteractions = chatState.pendingInteractions.filter(
        i => now <= i.expiresAt
      )

      if (chatState.pendingInteractions.length < originalCount) {
        await deps.state.saveChatState(chatId, chatState)
      }
    } catch (error) {
      logger.error('interactive', 'Failed to cleanup expired interactions', { chatId, error })
    }
  }

  return {
    handlePermissionEvent,
    handleQuestionEvent,
    handlePermissionCallback,
    handleQuestionCallback,
    cleanupExpired,
  }
}
