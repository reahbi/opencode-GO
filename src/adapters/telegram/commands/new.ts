import type { Context } from 'grammy'

type SessionCommands = {
  createSession(chatId: number, title: string): Promise<void>
}

export function newCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const title = ctx.match?.toString().trim() || 'New Session'
    await sessionCommands.createSession(chatId, title)
  }
}
