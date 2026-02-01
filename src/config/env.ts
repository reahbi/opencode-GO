import { DEFAULT_SERVER_URL } from '../shared/constants.js'

export interface EnvConfig {
  botToken: string
  allowedUserIds: number[]
  openCodeServerUrl: string
  openCodeServerUsername: string
  openCodeServerPassword: string | null
  defaultProject: string
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

  const openCodeServerUrl = process.env.OPENCODE_SERVER_URL ?? DEFAULT_SERVER_URL
  const openCodeServerUsername = process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'
  const openCodeServerPassword = process.env.OPENCODE_SERVER_PASSWORD || null
  const defaultProject = process.env.DEFAULT_PROJECT ?? ''

  if (!defaultProject) {
    throw new Error('DEFAULT_PROJECT is required. Set it in .env file.')
  }

  return {
    botToken,
    allowedUserIds,
    openCodeServerUrl,
    openCodeServerUsername,
    openCodeServerPassword,
    defaultProject,
  }
}
