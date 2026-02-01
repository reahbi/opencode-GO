import type { Context } from 'grammy'

type SessionCommands = {
  listSessions(chatId: number): Promise<void>
}

export function listCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    await sessionCommands.listSessions(chatId)
  }
}
