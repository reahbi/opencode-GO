import type { Context } from 'grammy'

type SessionCommands = {
  abortSession(chatId: number): Promise<void>
}

export function abortCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    await sessionCommands.abortSession(chatId)
  }
}
