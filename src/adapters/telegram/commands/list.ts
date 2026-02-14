import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { SessionPageData } from '../../../app/usecases/sessionCommands.js'

type SessionCommands = {
  getSessionPage(chatId: number, page: number, threadId?: number): Promise<SessionPageData | null>
}

export function buildSessionListText(data: SessionPageData): string {
  if (data.items.length === 0) return 'No sessions.'
  const lines = data.items.map((item) => {
    const source = item.source === 'local' ? 'local' : 'bot'
    const active = item.isActive ? ' ✦' : ''
    const busy = item.isBusy ? ' 🔄' : ''
    const ts = new Date(item.lastActiveAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    return `${item.globalIndex}. <b>${item.title.slice(0, 50)}</b>${active}${busy}\n&nbsp;&nbsp;&nbsp;&nbsp;<code>${source}</code> · <code>${item.messageCount} msgs</code> · <code>${ts}</code>`
  })

  return `📋 <b>Sessions</b> (${data.totalSessions} total, page ${data.page}/${data.totalPages})\n\n${lines.join('\n')}`
}

export function buildSessionListKeyboard(data: SessionPageData): InlineKeyboard {
  const kb = new InlineKeyboard()

  for (const item of data.items) {
    const busy = item.isBusy ? '🔄 ' : ''
    const active = item.isActive ? '✦ ' : ''
    const source = item.source === 'local' ? '💻 ' : ''
    const label = `${busy}${active}${source}${item.globalIndex}. ${item.title.slice(0, 30)}`
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
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined

    const data = await sessionCommands.getSessionPage(chatId, 1, threadId)
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
