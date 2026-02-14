import type { Context } from 'grammy'

type SessionCommands = {
  abortSession(chatId: number, threadId?: number): Promise<void>
}

export function abortCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined
    await sessionCommands.abortSession(chatId, threadId)
  }
}
