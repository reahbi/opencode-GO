import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { GroupSettingsPort } from '../../../domain/ports/GroupSettingsPort.js'
import type { BotRegistryPort } from '../../../domain/ports/BotRegistryPort.js'
import type { GroupSettings, BotRegistryEntry } from '../../../domain/models.js'

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function roleIcon(role: string): string {
  if (role === 'writer') return '✏️'
  if (role === 'reader') return '🔒'
  return '⚙️'
}

export function groupSettingsMainText(gs: GroupSettings, bots: BotRegistryEntry[]): string {
  const rounds = gs.debateRounds === 0 ? '♾️ Unlimited' : `${gs.debateRounds}`
  const now = Date.now()

  const botLines = bots.map(b => {
    const online = (now - b.lastSeen) < 3 * 60 * 1000 ? '🟢' : '🔴'
    const agent = b.currentAgent || 'default'
    return `${online} <b>@${escapeHtml(b.botUsername)}</b>\n   ${roleIcon(b.botRole)} ${b.botRole} · 🤖 ${escapeHtml(agent)}`
  })

  return [
    '<b>⚙️ Group Settings</b>',
    '<i>Applies to all bots in this chat</i>',
    '',
    `🎭 Debate: ${rounds} rounds`,
    '',
    ...botLines,
  ].join('\n')
}

export function groupSettingsMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🎭 Debate Settings', 'gs:sub_debate')
    .text('🤖 Bot Details', 'gs:sub_bots')
}

export function debateSubText(gs: GroupSettings): string {
  const rounds = gs.debateRounds === 0 ? '♾️ Unlimited' : `${gs.debateRounds} rounds`
  return [
    '<b>🎭 Debate Settings</b>',
    '<i>Shared group settings</i>',
    '',
    `Rounds: ${rounds}`,
    '',
    'Use <code>/debate [rounds] topic</code>',
    'to override inline.',
  ].join('\n')
}

export function debateSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('3', 'gs:dr:3')
    .text('6', 'gs:dr:6')
    .text('10', 'gs:dr:10')
    .text('♾️', 'gs:dr:0')
    .row()
    .text('✏️ Enter manually', 'gs:debaterounds')
    .row()
    .text('◀️ Back', 'gs:back')
}

export function botsSubText(bots: BotRegistryEntry[]): string {
  const now = Date.now()

  if (bots.length === 0) {
    return '<b>🤖 Bots</b>\n\nNo bots registered in this chat.'
  }

  const lines = ['<b>🤖 Bots</b>', '<i>Bot status in this chat</i>', '']
  for (const b of bots) {
    const online = (now - b.lastSeen) < 3 * 60 * 1000 ? '🟢' : '🔴'
    const agent = b.currentAgent || 'default'
    lines.push(
      `${online} <b>@${escapeHtml(b.botUsername)}</b>`,
      `   ${roleIcon(b.botRole)} ${b.botRole}`,
      `   🤖 Agent: <code>${escapeHtml(agent)}</code>`,
      `   📁 ${escapeHtml(b.projectDir)}`,
      '',
    )
  }

  lines.push('To change agent: <code>@botname /settings</code>')
  return lines.join('\n')
}

export function botsSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('◀️ Back', 'gs:back')
}

export async function filterBotsInChat(
  ctx: Context,
  chatId: number,
  bots: BotRegistryEntry[],
): Promise<BotRegistryEntry[]> {
  const results: BotRegistryEntry[] = []
  for (const bot of bots) {
    if (!bot.botUserId) continue
    try {
      const member = await ctx.api.getChatMember(chatId, bot.botUserId)
      if (member.status !== 'left' && member.status !== 'kicked') {
        results.push(bot)
      }
    } catch {
      // Bot not in chat or API error — skip
    }
  }
  return results
}

export function groupSettingsCommand(
  groupSettings: GroupSettingsPort,
  registry: BotRegistryPort,
  instanceName: string,
) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    if (!isGroup) {
      await ctx.reply('Only available in group chats.\nFor personal settings, use /settings.')
      return
    }

    const allBots = await registry.list()
    const botsInChat = await filterBotsInChat(ctx, chatId, allBots)

    // Only the first bot alphabetically responds to avoid duplicate messages
    const sortedBots = [...botsInChat].sort((a, b) => a.instanceName.localeCompare(b.instanceName))
    const responder = sortedBots[0]
    if (!responder || responder.instanceName !== instanceName) {
      return
    }

    const gs = await groupSettings.getGroupSettings()

    await ctx.reply(
      groupSettingsMainText(gs, botsInChat),
      { parse_mode: 'HTML', reply_markup: groupSettingsMainKeyboard() },
    )
  }
}
