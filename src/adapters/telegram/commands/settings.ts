import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'
import type { CustomAgent, UserSettings } from '../../../domain/models.js'
import type { CustomAgentPort } from '../../../domain/ports/CustomAgentPort.js'
import { escapeHtml } from '../../../shared/formatResponse.js'

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
    activeProject?: string | null
  },
): string {
  const header = opts.instanceName
    ? `<b>⚙️ Settings</b> <i>(${opts.instanceName})</i>`
    : '<b>⚙️ Settings</b>'

  const project = opts.activeProject || 'Not set'
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
  const voiceModelLabel = s.voiceModel
    ? s.voiceModel.modelID.split('/').pop()
    : null

  return [
    header,
    '',
    `📂 Project: <b>${project}</b>`,
    `${server} · Session: ${session}`,
    '',
    `<b>🤖 Agent:</b> ${agent} · Review: ${review}`,
    `<b>🎭 Custom Agent:</b> ${customAgent || 'None'}`,
    `<b>📊 Summary:</b> ${summaryStatus} · ${formatExpertise(s.userExpertise)} · Model: ${summaryModel}`,
    `<b>📝 Output:</b> ${outputFmt} · <b>📜 History:</b> ${histFmt}/${histLimit}`,
    `<b>🔊 Voice:</b> ${voiceStatus} ${voiceAuto} ${voiceLang} · ${s.voiceSummaryLength}자 · ${s.voiceSpeed}x${voiceModelLabel ? ` · 🎙${voiceModelLabel}` : ''}`,
  ].join('\n')
}

export function settingsMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📂 Project', 'settings:sub_project')
    .row()
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

// ── Project Submenu ──

export interface SettingsProject {
  worktree: string
  name?: string
}

export function projectSubText(
  projects: SettingsProject[],
  activeDirectory: string | null,
): string {
  const current = projects.find(p => p.worktree === activeDirectory)
  const displayName = current
    ? (current.name || current.worktree.split('/').pop() || current.worktree)
    : 'Not set'
  const lines = [
    '<b>📂 Project</b>',
    '',
    `Current: <b>${displayName}</b>`,
  ]
  if (current) {
    lines.push(`Directory: <code>${current.worktree}</code>`)
  }
  lines.push('', 'Select a project:')
  return lines.join('\n')
}

export function projectSubKeyboard(
  projects: SettingsProject[],
  activeDirectory: string | null,
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    const isActive = p.worktree === activeDirectory
    const name = p.name || p.worktree.split('/').pop() || p.worktree
    const label = isActive ? `✅ ${name}` : name
    kb.text(label, `sp:${i}`).row()
  }
  kb.text('◀️ Back', 'settings:back')
  return kb
}

// ── Agent & Mode Submenu ──

export function agentSubText(
  agents: Array<{ name: string; description?: string }>,
  currentAgent: string | null,
  settings: UserSettings,
  botRole?: string,
): string {
  const review = resolveReviewMode(settings, botRole) ? 'ON 🔒' : 'OFF'
  const currentAgentLabel = escapeHtml(currentAgent || 'Not set')
  const lines = [
    '<b>🤖 Agent & Mode</b>',
    '',
    `Agent: <code>${currentAgentLabel}</code>`,
    `Review Mode: ${review}`,
    `Available: ${agents.length}`,
    '',
  ]
  if (agents.length === 0) {
    lines.push('No agents available for this project.')
  } else {
    lines.push('Select an agent from the buttons below.')
  }
  return lines.join('\n')
}

export function agentSubKeyboard(
  agents: Array<{ name: string }>,
  currentAgent: string | null,
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]
    const isActive = a.name === currentAgent
    const label = isActive ? `✅ ${a.name}` : a.name
    kb.text(label, `settings:agent:${i}`).row()
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

  let modelLine: string
  if (s.voiceModel) {
    modelLine = `Model: <code>${s.voiceModel.modelID}</code> (${s.voiceModel.providerID})`
  } else {
    const fallback = s.summaryModel ? `${s.summaryModel.modelID}` : 'not set'
    modelLine = `Model: <code>${fallback}</code> (summary)`
  }

  return [
    '<b>🔊 Voice</b>',
    '',
    `Status: ${status}`,
    `Auto: ${s.voiceAutoMode ? 'ON 🔄' : 'OFF'}`,
    modelLine,
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
  kb.text(s.voiceAutoMode ? '🔄 Auto OFF' : '🔄 Auto ON', 'settings:voice_auto')
  kb.text('🎙 Select Model', 'settings:voice_model').row()

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
  openCode: OpenCodePort,
  deps?: { instanceName?: string; botRole?: string; customAgents?: CustomAgentPort },
) {
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
        customAgentName: chatState.customAgentId && deps?.customAgents
          ? (await deps.customAgents.get(chatState.customAgentId))?.name ?? null
          : null,
        instanceName: isGroup ? deps?.instanceName : undefined,
        botRole: deps?.botRole,
        activeProject: chatState.activeProjectDirectory?.split('/').pop() ?? null,
      }),
      { parse_mode: 'HTML', reply_markup: settingsMainKeyboard() },
    )
  }
}
