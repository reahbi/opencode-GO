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
    .text('🔊 Voice', 'settings:sub_voice')
}

// ── Agent & Mode Submenu ──

export function agentSubText(
  agents: Array<{ name: string; description?: string }>,
  currentAgent: string | null,
  settings: UserSettings,
  botRole?: string,
): string {
  const review = resolveReviewMode(settings, botRole) ? 'ON 🔒' : 'OFF'
  const lines = [
    '<b>🤖 Agent & Mode</b>',
    '',
    `Agent: <code>${currentAgent || 'Not set'}</code>`,
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
    `Status: ${status}`,
    `Model: <code>${model}</code>`,
    `Trigger: ${threshold}+ chars`,
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
    `Format: ${format}`,
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
    `File format: ${histFmt}`,
    `Include: ${histLimit}`,
  ].join('\n')
}

export function historySubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📜 Toggle Format', 'settings:histformat')
    .text('📜 Set Limit', 'settings:histlimit')
    .row()
    .text('◀️ Back', 'settings:back')
}

function formatSpeed(speed: number): string {
  if (speed === 1.0) return '1.0x (기본)'
  return `${speed}x`
}

function formatLength(length: number): string {
  return `${length}자`
}

export function voiceSubText(s: UserSettings): string {
  const status = s.voiceMode ? 'ON ✅' : 'OFF'
  const length = formatLength(s.voiceSummaryLength)
  const speed = formatSpeed(s.voiceSpeed)
  const gender = s.voiceGender === 'female' ? '여성 👩' : '남성 👨'

  return [
    '<b>🔊 Voice</b>',
    '',
    `상태: ${status}`,
    `요약 길이: ${length}`,
    `속도: ${speed}`,
    `음성: ${gender}`,
  ].join('\n')
}

export function voiceSubKeyboard(s: UserSettings): InlineKeyboard {
  const kb = new InlineKeyboard()

  kb.text(s.voiceMode ? '🔇 끄기' : '🔊 켜기', 'settings:voice_toggle').row()

  const lengths = [500, 800, 1200, 2000]
  for (const len of lengths) {
    const label = s.voiceSummaryLength === len ? `✅ ${len}자` : `${len}자`
    kb.text(label, `settings:voice_len:${len}`)
  }
  kb.row()

  const speeds = [1.0, 1.25, 1.5, 2.0]
  for (const spd of speeds) {
    const label = s.voiceSpeed === spd ? `✅ ${spd}x` : `${spd}x`
    kb.text(label, `settings:voice_spd:${spd}`)
  }
  kb.row()

  kb.text(s.voiceGender === 'female' ? '✅ 여성' : '여성', 'settings:voice_gender:female')
  kb.text(s.voiceGender === 'male' ? '✅ 남성' : '남성', 'settings:voice_gender:male')
  kb.row()

  kb.text('◀️ Back', 'settings:back')
  return kb
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
