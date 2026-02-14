import type { Context } from 'grammy'
import type { ChatState, QueuedMessage } from '../../../domain/models.js'
import { enqueueMessage, clearQueue, getQueueLength } from '../../../app/queue/messageQueue.js'
import { updateChatState } from '../../../app/usecases/stateUpdate.js'

type StateStore = {
  getChatState(chatId: number, threadId?: number): Promise<ChatState>
  saveChatState(chatId: number, state: ChatState, threadId?: number): Promise<void>
  withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T>
}

type PromptFlow = {
  sendPrompt(chatId: number, text: string, userId?: number, threadId?: number): Promise<void>
}

export function queueCommand(
  state: StateStore,
  promptFlow: PromptFlow,
) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined

    const text = ctx.match as string | undefined
    if (!text?.trim()) {
      await ctx.reply('Usage: /queue <message>')
      return
    }

    const chatState = await state.getChatState(chatId, threadId)
    if (!chatState.activeSessionId || !chatState.activeProjectDirectory) {
      await ctx.reply('No active session. Use /new to create one.')
      return
    }

    const msg: QueuedMessage = {
      text: text.trim(),
      timestamp: Date.now(),
      actorUserId: ctx.from?.id
    }

    const result = await updateChatState(state, chatId, (lockedState) => {
      return enqueueMessage(lockedState, msg)
    }, threadId)

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
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined

    const count = await updateChatState(state, chatId, (lockedState) => {
      return clearQueue(lockedState)
    }, threadId)

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
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined

    const chatState = await state.getChatState(chatId, threadId)
    const length = getQueueLength(chatState)

    if (length === 0) {
      await ctx.reply('Queue is empty.')
    } else {
      await ctx.reply(`📋 ${length} message(s) in queue.`)
    }
  }
}
