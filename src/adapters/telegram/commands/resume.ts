import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'

type SessionCommands = {
  resumeSession(chatId: number, sessionIndex: number): Promise<void>
  resumeSessionForHistory(chatId: number, sessionIndex: number): Promise<{ sessionId: string; title: string } | null>
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
    const result = await sessionCommands.resumeSessionForHistory(chatId, index)
    if (!result) return

    const kb = new InlineKeyboard().text('📜 Get History', `hist:${result.sessionId}`)
    await ctx.reply(`✅ Session resumed: <b>${escapeHtml(result.title)}</b>`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    })
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
