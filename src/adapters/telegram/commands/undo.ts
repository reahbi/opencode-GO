import type { Context } from 'grammy'

type SessionCommands = {
  revertSession(chatId: number): Promise<void>
  unrevertSession(chatId: number): Promise<void>
}

export function undoCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    await sessionCommands.revertSession(chatId)
  }
}

export function redoCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    await sessionCommands.unrevertSession(chatId)
  }
}
