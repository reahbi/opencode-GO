import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'
import type { UserSettings } from '../../../domain/models.js'

export function resolveReviewMode(settings: UserSettings, botRole?: string): boolean {
  if (settings.reviewMode !== undefined) return settings.reviewMode
  return botRole === 'reader'
}

// ── Main Screen ──

export function settingsMainText(
  s: UserSettings,
  opts: {
    healthy?: boolean
    hasSession?: boolean
    activeAgent?: string | null
    instanceName?: string
    botRole?: string
  },
): string {
  const header = opts.instanceName
    ? `<b>⚙️ Settings</b> <i>(${opts.instanceName})</i>`
    : '<b>⚙️ Settings</b>'

  const server = opts.healthy ? '🟢 Online' : '🔴 Offline'
  const session = opts.hasSession ? 'active' : 'None'
  const agent = opts.activeAgent || 'default'
  const review = resolveReviewMode(s, opts.botRole) ? '🔒 ON' : 'OFF'

  return [
    header,
    '',
    `${server} · Session: ${session}`,
    `🤖 ${agent} · Review: ${review}`,
  ].join('\n')
}

export function settingsMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🤖 Agent & Mode', 'settings:sub_agent')
    .text('📊 Summary', 'settings:sub_summary')
    .row()
    .text('📝 Output', 'settings:sub_output')
    .text('📜 History Export', 'settings:sub_history')
    .row()
    .text('🎭 Debate', 'settings:sub_debate')
}

// ── Agent & Mode Submenu ──

export function agentSubText(
  agents: Array<{ name: string; description?: string }>,
  currentAgent: string | null,
  settings: UserSettings,
  botRole?: string,
  defaultAgent?: string | null,
): string {
  const review = resolveReviewMode(settings, botRole) ? 'ON 🔒' : 'OFF'
  const lines = [
    '<b>🤖 Agent & Mode</b>',
    '',
    `현재 채팅: <code>${currentAgent || 'default'}</code>`,
    `🌐 기본값: <code>${defaultAgent || 'none'}</code>`,
    `Review Mode: ${review}`,
    '',
  ]
  for (const a of agents) {
    const prefix = a.name === currentAgent ? '▸ ' : '  '
    const desc = a.description ? ` — ${a.description}` : ''
    lines.push(`${prefix}<b>${a.name}</b>${desc}`)
  }
  return lines.join('\n')
}

export function agentSubKeyboard(
  agents: Array<{ name: string }>,
  currentAgent: string | null,
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const a of agents) {
    const isActive = a.name === currentAgent
    const label = isActive ? `✅ ${a.name}` : a.name
    kb.text(label, `sa:${a.name}`).row()
  }
  kb.text('🔒 Toggle Review Mode', 'settings:review')
  kb.row()
  kb.text('◀️ Back', 'settings:back')
  return kb
}

// ── Summary Submenu ──

export function summarySubText(s: UserSettings): string {
  const status = s.summaryMode ? 'ON ✅' : 'OFF'
  const model = s.summaryModel
    ? `${s.summaryModel.modelID} (${s.summaryModel.providerID})`
    : 'not selected'
  const threshold = s.summaryThreshold.toLocaleString()

  return [
    '<b>📊 AI Summary</b>',
    '',
    `상태: ${status}`,
    `모델: <code>${model}</code>`,
    `트리거: ${threshold}+ chars`,
  ].join('\n')
}

export function summarySubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Toggle Summary', 'settings:summary')
    .row()
    .text('🤖 Select Model', 'settings:model')
    .text('📏 Set Threshold', 'settings:threshold')
    .row()
    .text('◀️ Back', 'settings:back')
}

// ── Output Submenu ──

export function outputSubText(s: UserSettings): string {
  const format = s.outputMode === 'formatted' ? 'Formatted ✅' : 'Raw'
  return [
    '<b>📝 Output</b>',
    '',
    `형식: ${format}`,
  ].join('\n')
}

export function outputSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Toggle Format', 'settings:format')
    .row()
    .text('◀️ Back', 'settings:back')
}

// ── History Export Submenu ──

export function historySubText(s: UserSettings): string {
  const histFmt = s.historyFormat === 'html' ? 'HTML ✅' : 'Markdown'
  const histLimit = s.historyLimit ? `Last ${s.historyLimit} messages` : 'All messages'
  return [
    '<b>📜 History Export</b>',
    '',
    `파일 형식: ${histFmt}`,
    `포함 범위: ${histLimit}`,
  ].join('\n')
}

export function historySubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📜 Toggle Format', 'settings:histformat')
    .text('📜 Set Limit', 'settings:histlimit')
    .row()
    .text('◀️ Back', 'settings:back')
}

// ── Debate Submenu ──

export function debateSubText(s: UserSettings): string {
  const rounds = s.debateRounds === 0 ? '♾️ Unlimited' : `${s.debateRounds} rounds`
  return [
    '<b>🎭 Debate</b>',
    '',
    `라운드 수: ${rounds}`,
    '',
    '<code>/debate [라운드] 주제</code> 형식으로',
    '인라인 지정도 가능합니다.',
  ].join('\n')
}

export function debateSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('3', 'settings:dr:3')
    .text('6', 'settings:dr:6')
    .text('10', 'settings:dr:10')
    .text('♾️', 'settings:dr:0')
    .row()
    .text('✏️ 직접 입력', 'settings:debaterounds')
    .row()
    .text('◀️ Back', 'settings:back')
}

// ── Command ──

export function settingsCommand(state: StateStore, openCode: OpenCodePort, instanceName?: string, botRole?: string) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const chatState = await state.getChatState(chatId)
    let healthy = false
    try { healthy = await openCode.healthCheck() } catch { /* offline */ }

    await ctx.reply(
      settingsMainText(chatState.settings, {
        healthy,
        hasSession: !!chatState.activeSessionId,
        activeAgent: chatState.activeAgent,
        instanceName: isGroup ? instanceName : undefined,
        botRole,
      }),
      { parse_mode: 'HTML', reply_markup: settingsMainKeyboard() },
    )
  }
}
