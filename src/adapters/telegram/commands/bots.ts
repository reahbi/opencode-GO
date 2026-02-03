import type { Context } from 'grammy'
import type { BotRegistryPort } from '../../../domain/ports/BotRegistryPort.js'
import { LIMITS } from '../../../app/policies/limits.js'

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function botsCommand(registry: BotRegistryPort) {
  return async (ctx: Context) => {
    const bots = await registry.list()
    if (bots.length === 0) {
      await ctx.reply('등록된 봇이 없습니다.')
      return
    }

    const now = Date.now()
    const lines: string[] = ['<b>🤖 Registered Bots</b>', '']

    for (const bot of bots) {
      const isOnline = (now - bot.lastSeen) < LIMITS.REGISTRY_STALE_THRESHOLD_MS
      const status = isOnline ? '🟢' : '⚪️'
      const role = bot.botRole === 'writer' ? '✏️ Writer'
        : bot.botRole === 'reader' ? '🔒 Reader'
        : '⚙️ Standalone'

      lines.push(`${status} <b>@${escapeHtml(bot.botUsername)}</b> (${escapeHtml(bot.instanceName)})`)
      lines.push(`   ${role} · ${escapeHtml(bot.projectDir)}`)
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }
}
