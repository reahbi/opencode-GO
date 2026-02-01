import type { Context } from 'grammy'

type SessionCommands = {
  resumeSession(chatId: number, sessionIndex: number): Promise<void>
}

export function resumeCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const indexStr = ctx.match?.toString().trim()
    const index = indexStr ? parseInt(indexStr, 10) : NaN
    if (isNaN(index)) {
      await ctx.reply('Usage: /resume [number]\nUse /list to see available sessions.')
      return
    }
    await sessionCommands.resumeSession(chatId, index)
  }
}
