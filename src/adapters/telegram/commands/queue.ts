import type { Context } from 'grammy'
import type { ChatState, QueuedMessage } from '../../../domain/models.js'
import { enqueueMessage, clearQueue, getQueueLength } from '../../../app/queue/messageQueue.js'

type StateStore = {
  getChatState(chatId: number): Promise<ChatState>
  saveChatState(chatId: number, state: ChatState): Promise<void>
}

type PromptFlow = {
  sendPrompt(chatId: number, text: string, userId?: number): Promise<void>
}

export function queueCommand(
  state: StateStore,
  promptFlow: PromptFlow,
) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const text = ctx.match as string | undefined
    if (!text?.trim()) {
      await ctx.reply('Usage: /queue <message>')
      return
    }

    const chatState = await state.getChatState(chatId)

    if (!chatState.activeSessionId || !chatState.activeProjectDirectory) {
      await ctx.reply('No active session. Use /new to create one.')
      return
    }

    const msg: QueuedMessage = {
      text: text.trim(),
      timestamp: Date.now(),
      actorUserId: ctx.from?.id
    }

    const result = enqueueMessage(chatState, msg)
    await state.saveChatState(chatId, chatState)

    let response = `📥 Queued at position ${result.position}`
    if (result.dropped && result.dropped > 0) {
      response += ` (${result.dropped} old message(s) dropped)`
    }
    await ctx.reply(response)
  }
}

export function clearQueueCommand(state: StateStore) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)
    const count = clearQueue(chatState)
    await state.saveChatState(chatId, chatState)

    if (count === 0) {
      await ctx.reply('Queue is already empty.')
    } else {
      await ctx.reply(`🗑️ Cleared ${count} queued message(s).`)
    }
  }
}

export function showQueueCommand(state: StateStore) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)
    const length = getQueueLength(chatState)

    if (length === 0) {
      await ctx.reply('Queue is empty.')
    } else {
      await ctx.reply(`📋 ${length} message(s) in queue.`)
    }
  }
}
