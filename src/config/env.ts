import { basename, resolve } from 'node:path'

export type BotRole = 'writer' | 'reader' | 'standalone'

export interface EnvConfig {
  botToken: string
  allowedUserIds: number[]
  defaultProject: string
  defaultAgent: string | null
  defaultCustomAgent: string | null
  instanceName: string
  stateDir: string
  botRole: BotRole
  groupChatEnabled: boolean
  coordinationDir: string
  /** Claude model ID for the agent SDK (e.g. claude-sonnet-4-5) */
  claudeModel: string
  /** Path to Claude Code executable (optional) */
  claudeCodePath: string | null
  /** Default max thinking tokens (0 = disabled) */
  maxThinkingTokens: number
  /** Max budget per session in USD (optional) */
  maxBudgetUsd: number | null
  /** OpenAI API key for Whisper STT (optional, Phase 4) */
  openaiApiKey: string | null
}

export function loadEnvConfig(): EnvConfig {
  const botToken = process.env.BOT_TOKEN
  if (!botToken) {
    throw new Error('BOT_TOKEN is required. Set it in .env file.')
  }

  const allowedRaw = process.env.ALLOWED_USER_IDS ?? ''
  const allowedUserIds = allowedRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s)
      if (!Number.isFinite(n)) throw new Error(`Invalid user ID: ${s}`)
      return n
    })

  if (allowedUserIds.length === 0) {
    throw new Error('ALLOWED_USER_IDS is required. At least one Telegram user ID must be set.')
  }

  const defaultProject = process.env.DEFAULT_PROJECT ?? ''

  if (!defaultProject) {
    throw new Error('DEFAULT_PROJECT is required. Set it in .env file.')
  }

  const instanceName = process.env.INSTANCE_NAME || basename(defaultProject)
  const stateDir = process.env.STATE_DIR || resolve(process.cwd(), 'data')

  const rawRole = (process.env.BOT_ROLE ?? 'standalone').toLowerCase()
  const botRole: BotRole = rawRole === 'writer' || rawRole === 'reader' ? rawRole : 'standalone'

  const groupChatEnabled = ['1', 'true', 'yes'].includes(
    (process.env.GROUP_CHAT_ENABLED ?? '').toLowerCase(),
  )

  const coordinationDir = process.env.COORDINATION_DIR || ''
  const defaultAgent = process.env.DEFAULT_AGENT || null
  const defaultCustomAgent = process.env.DEFAULT_CUSTOM_AGENT || null

  const claudeModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5'
  const claudeCodePath = process.env.CLAUDE_CODE_PATH || null
  const maxThinkingTokens = parseInt(process.env.MAX_THINKING_TOKENS ?? '0', 10) || 0
  const rawBudget = process.env.MAX_BUDGET_USD
  const maxBudgetUsd = rawBudget ? parseFloat(rawBudget) : null
  const openaiApiKey = process.env.OPENAI_API_KEY || null

  return {
    botToken,
    allowedUserIds,
    defaultProject,
    defaultAgent,
    defaultCustomAgent,
    instanceName,
    stateDir,
    botRole,
    groupChatEnabled,
    coordinationDir,
    claudeModel,
    claudeCodePath,
    maxThinkingTokens,
    maxBudgetUsd,
    openaiApiKey,
  }
}
