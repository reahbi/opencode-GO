import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { execFileSync } from 'node:child_process'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { CustomAgent, UserSettings } from '../../../domain/models.js'
import type { CustomAgentPort } from '../../../domain/ports/CustomAgentPort.js'

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
    customAgentName?: string | null
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
  const customAgent = opts.customAgentName || null
  const review = resolveReviewMode(s, opts.botRole) ? '🔒' : 'OFF'

  const summaryStatus = s.summaryMode ? '✅' : 'OFF'
  const summaryModel = s.summaryModel ? s.summaryModel.modelID.split('/').pop() : '-'
  const outputFmt = s.outputMode === 'formatted' ? 'Fmt' : 'Raw'
  const histFmt = s.historyFormat === 'html' ? 'HTML' : 'MD'
  const histLimit = s.historyLimit ? `${s.historyLimit}` : 'All'
  const voiceStatus = s.voiceMode ? '✅' : 'OFF'
  const voiceAuto = s.voiceAutoMode ? '🔄' : ''
  const voiceLang = s.voiceLanguage === 'ko' ? '🇰🇷' : '🇺🇸'

  return [
    header,
    '',
    `${server} · Session: ${session}`,
    '',
    `<b>🤖 Agent:</b> ${agent} · Review: ${review}`,
    `<b>🎭 Custom Agent:</b> ${customAgent || 'None'}`,
    `<b>📊 Summary:</b> ${summaryStatus} · ${formatExpertise(s.userExpertise)} · Model: ${summaryModel}`,
    `<b>📝 Output:</b> ${outputFmt} · <b>📜 History:</b> ${histFmt}/${histLimit}`,
    `<b>🔊 Voice:</b> ${voiceStatus} ${voiceAuto} ${voiceLang} · ${s.voiceSummaryLength}자 · ${s.voiceSpeed}x`,
  ].join('\n')
}

export function settingsMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🤖 Agent & Mode', 'settings:sub_agent')
    .text('📊 Summary', 'settings:sub_summary')
    .row()
    .text('🎭 Custom Agent', 'settings:sub_custom_agent')
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

export function customAgentSubText(
  agents: CustomAgent[],
  currentAgent: CustomAgent | null,
): string {
  const lines = [
    '<b>🎭 Custom Agent</b>',
    '',
    `Current: ${currentAgent ? `<b>${currentAgent.name}</b>` : 'None'}`,
    currentAgent ? `Description: ${currentAgent.description || '-'}` : 'Description: -',
    '',
  ]

  if (agents.length === 0) {
    lines.push('No custom agents available yet. Use /makeagent to create one.')
  } else {
    lines.push('Select an agent:')
  }

  return lines.join('\n')
}

export function customAgentSubKeyboard(
  agents: CustomAgent[],
  currentAgentId: string | null | undefined,
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const agent of agents) {
    const isActive = agent.id === currentAgentId
    kb.text(isActive ? `✅ ${agent.name}` : agent.name, `sca:${agent.id}`).row()
  }
  kb.text('🧹 Remove', 'sca:remove').row()
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
    `Level: ${formatExpertise(s.userExpertise)}`,
  ].join('\n')
}

export function summarySubKeyboard(s: UserSettings): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Toggle Summary', 'settings:summary')
    .row()
    .text('🤖 Select Model', 'settings:model')
    .text('📏 Set Threshold', 'settings:threshold')
    .row()
    .text(s.userExpertise === 'vibe' ? '✅ 🎮 Vibe' : '🎮 Vibe', 'settings:expertise:vibe')
    .text(s.userExpertise === 'developer' ? '✅ 👨‍💻 Dev' : '👨‍💻 Dev', 'settings:expertise:developer')
    .text(s.userExpertise === 'beginner' ? '✅ 🌱 Begin' : '🌱 Begin', 'settings:expertise:beginner')
    .row()
    .text('◀️ Back', 'settings:back')
}

// ── Model Selection Submenu ──

const SUMMARY_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', description: 'Fast & cheap' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', description: 'Most capable' },
] as const

export function modelSelectText(s: UserSettings): string {
  const current = s.summaryModel?.modelID || 'not selected'
  return [
    '<b>🤖 Summary Model</b>',
    '',
    `Current: <code>${current}</code>`,
    '',
    'Select a model for AI summary generation:',
  ].join('\n')
}

export function modelSelectKeyboard(s: UserSettings): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const m of SUMMARY_MODELS) {
    const isActive = s.summaryModel?.modelID === m.id
    const label = isActive ? `✅ ${m.label}` : `${m.label} — ${m.description}`
    kb.text(label, `sm:anthropic/${m.id}`).row()
  }
  kb.text('◀️ Back', 'settings:sub_summary')
  return kb
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

function formatLanguage(lang: 'ko' | 'en'): string {
  return lang === 'ko' ? '한국어 🇰🇷' : 'English 🇺🇸'
}

function formatExpertise(expertise: 'vibe' | 'developer' | 'beginner'): string {
  switch (expertise) {
    case 'vibe': return '🎮 Vibe'
    case 'developer': return '👨‍💻 Dev'
    case 'beginner': return '🌱 Beginner'
  }
}

export function voiceSubText(s: UserSettings): string {
  const status = s.voiceMode ? 'ON ✅' : 'OFF'
  const lang = formatLanguage(s.voiceLanguage)
  const length = formatLength(s.voiceSummaryLength)
  const speed = formatSpeed(s.voiceSpeed)
  const gender = s.voiceGender === 'female' ? '여성 👩' : '남성 👨'

  return [
    '<b>🔊 Voice</b>',
    '',
    `Status: ${status}`,
    `Auto: ${s.voiceAutoMode ? 'ON 🔄' : 'OFF'}`,
    `Language: ${lang}`,
    `Length: ${length}`,
    `Speed: ${speed}`,
    `Voice: ${gender}`,
    `Level: ${formatExpertise(s.userExpertise)}`,
  ].join('\n')
}

export function voiceSubKeyboard(s: UserSettings): InlineKeyboard {
  const kb = new InlineKeyboard()

  kb.text(s.voiceMode ? '🔇 OFF' : '🔊 ON', 'settings:voice_toggle').row()
  kb.text(s.voiceAutoMode ? '🔄 Auto OFF' : '🔄 Auto ON', 'settings:voice_auto').row()

  kb.text(s.voiceLanguage === 'ko' ? '✅ 한국어' : '한국어', 'settings:voice_lang:ko')
  kb.text(s.voiceLanguage === 'en' ? '✅ English' : 'English', 'settings:voice_lang:en')
  kb.row()

  const lengths = [500, 800, 1200, 2000]
  for (const len of lengths) {
    const label = s.voiceSummaryLength === len ? `✅ ${len}` : `${len}`
    kb.text(label, `settings:voice_len:${len}`)
  }
  kb.row()

  const speeds = [1.0, 1.25, 1.5, 2.0]
  for (const spd of speeds) {
    const label = s.voiceSpeed === spd ? `✅ ${spd}x` : `${spd}x`
    kb.text(label, `settings:voice_spd:${spd}`)
  }
  kb.row()

  kb.text(s.voiceGender === 'female' ? '✅ 👩' : '👩', 'settings:voice_gender:female')
  kb.text(s.voiceGender === 'male' ? '✅ 👨' : '👨', 'settings:voice_gender:male')
  kb.row()

  kb.text(s.userExpertise === 'vibe' ? '✅ 🎮 Vibe' : '🎮 Vibe', 'settings:expertise:vibe')
  kb.text(s.userExpertise === 'developer' ? '✅ 👨‍💻 Dev' : '👨‍💻 Dev', 'settings:expertise:developer')
  kb.text(s.userExpertise === 'beginner' ? '✅ 🌱 Begin' : '🌱 Begin', 'settings:expertise:beginner')
  kb.row()

  kb.text('◀️ Back', 'settings:back')
  return kb
}

// ── Command ──

export function settingsCommand(
  state: StateStore,
  deps?: { instanceName?: string; botRole?: string; customAgents?: CustomAgentPort },
) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const chatState = await state.getChatState(chatId)
    let healthy = false
    try {
      execFileSync('claude', ['--version'], { timeout: 3000, stdio: 'ignore' })
      healthy = true
    } catch { /* Claude Code CLI not available */ }

    await ctx.reply(
      settingsMainText(chatState.settings, {
        healthy,
        hasSession: !!chatState.activeSessionId,
        activeAgent: chatState.activeAgent,
        customAgentName: chatState.customAgentId && deps?.customAgents
          ? (await deps.customAgents.get(chatState.customAgentId))?.name ?? null
          : null,
        instanceName: isGroup ? deps?.instanceName : undefined,
        botRole: deps?.botRole,
      }),
      { parse_mode: 'HTML', reply_markup: settingsMainKeyboard() },
    )
  }
}
