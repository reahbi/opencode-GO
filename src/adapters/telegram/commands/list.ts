import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { SessionPageData } from '../../../app/usecases/sessionCommands.js'

type SessionCommands = {
  getSessionPage(chatId: number, page: number): Promise<SessionPageData | null>
}

export function buildSessionListText(data: SessionPageData): string {
  if (data.items.length === 0) return 'No sessions.'
  return `📋 <b>Sessions</b> (${data.totalSessions} total, page ${data.page}/${data.totalPages})`
}

export function buildSessionListKeyboard(data: SessionPageData): InlineKeyboard {
  const kb = new InlineKeyboard()

  for (const item of data.items) {
    const active = item.isActive ? ' ✦' : ''
    const label = `${item.globalIndex}. ${item.title.slice(0, 35)}${active}`
    kb.text(label, `ls:${item.id}`).row()
  }

  if (data.totalPages > 1) {
    if (data.page > 1) {
      kb.text('◀ Prev', `lp:${data.page - 1}`)
    }
    kb.text(`${data.page}/${data.totalPages}`, `lp:${data.page}`)
    if (data.page < data.totalPages) {
      kb.text('Next ▶', `lp:${data.page + 1}`)
    }
    kb.row()
  }

  return kb
}

export function listCommand(sessionCommands: SessionCommands) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const data = await sessionCommands.getSessionPage(chatId, 1)
    if (!data) {
      await ctx.reply('No active project. Set DEFAULT_PROJECT in .env.')
      return
    }
    if (data.items.length === 0) {
      await ctx.reply('No sessions.')
      return
    }

    await ctx.reply(buildSessionListText(data), {
      parse_mode: 'HTML',
      reply_markup: buildSessionListKeyboard(data),
    })
  }
}
