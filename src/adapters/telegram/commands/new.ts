import type { Context } from 'grammy'

type SessionCommands = {
  createSession(chatId: number, title: string, threadId?: number): Promise<void>
}

export function newCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined
    const title = ctx.match?.toString().trim() || 'New Session'
    await sessionCommands.createSession(chatId, title, threadId)
  }
}
