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
    '<i>이 채팅방의 모든 봇에 적용됩니다</i>',
    '',
    `🎭 Debate: ${rounds} rounds`,
    '',
    ...botLines,
  ].join('\n')
}

export function groupSettingsMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🎭 Debate 설정', 'gs:sub_debate')
    .text('🤖 봇 상세', 'gs:sub_bots')
}

export function debateSubText(gs: GroupSettings): string {
  const rounds = gs.debateRounds === 0 ? '♾️ Unlimited' : `${gs.debateRounds} rounds`
  return [
    '<b>🎭 Debate Settings</b>',
    '<i>그룹 공유 설정</i>',
    '',
    `라운드 수: ${rounds}`,
    '',
    '<code>/debate [라운드] 주제</code> 형식으로',
    '인라인 지정도 가능합니다.',
  ].join('\n')
}

export function debateSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('3', 'gs:dr:3')
    .text('6', 'gs:dr:6')
    .text('10', 'gs:dr:10')
    .text('♾️', 'gs:dr:0')
    .row()
    .text('✏️ 직접 입력', 'gs:debaterounds')
    .row()
    .text('◀️ Back', 'gs:back')
}

export function botsSubText(bots: BotRegistryEntry[]): string {
  const now = Date.now()

  if (bots.length === 0) {
    return '<b>🤖 Bots</b>\n\n이 채팅방에 등록된 봇이 없습니다.'
  }

  const lines = ['<b>🤖 Bots</b>', '<i>이 채팅방의 봇 현황</i>', '']
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

  lines.push('에이전트 변경: 해당 봇에 <code>@봇이름 /settings</code>')
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
      await ctx.reply('그룹 채팅에서만 사용할 수 있습니다.\n개인 설정은 /settings 를 사용하세요.')
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
