import type { Context } from 'grammy'

type SessionCommands = {
  revertSession(chatId: number, threadId?: number): Promise<void>
  unrevertSession(chatId: number, threadId?: number): Promise<void>
}

export function undoCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined
    await sessionCommands.revertSession(chatId, threadId)
  }
}

export function redoCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined
    await sessionCommands.unrevertSession(chatId, threadId)
  }
}
