import type { Context } from 'grammy'
import { escapeHtml } from '../../../shared/formatResponse.js'

type SessionCommands = {
  revertSession(chatId: number): Promise<string | null>
  unrevertSession(chatId: number): Promise<void>
}

export function undoCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    
    const diff = await sessionCommands.revertSession(chatId)
    if (diff) {
      const truncated = diff.length > 1500 ? diff.slice(0, 1500) + '\n...(truncated)' : diff
      await ctx.reply(`⏪ <b>Undone</b>\n<pre>${escapeHtml(truncated)}</pre>`, { parse_mode: 'HTML' })
    } else if (diff === null) {
      // Error message already sent by revertSession
    }
  }
}

export function redoCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    await sessionCommands.unrevertSession(chatId)
  }
}
