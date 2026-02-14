import { logger } from './logger.js'

export interface WaitForServerOptions {
  serverUrl: string
  username: string
  password: string | null
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  logContext?: 'bot' | 'hookbot'
}

export function isRunningUnderPM2(): boolean {
  return 'PM2_HOME' in process.env || 'pm_id' in process.env
}

export async function waitForServer(options: WaitForServerOptions): Promise<boolean> {
  const {
    serverUrl,
    username,
    password,
    maxAttempts = 120,
    initialDelayMs = 2_000,
    maxDelayMs = 15_000,
    logContext = 'bot',
  } = options

  const headers: Record<string, string> = {}
  if (password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`${serverUrl}/project`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      })
      if (resp.ok) {
        if (attempt > 1) {
          logger.info(logContext, `Server is ready (after ${attempt} attempts)`)
        }
        return true
      }
    } catch {
      // Connection refused, timeout, etc. — expected while server is starting
    }

    if (attempt === 1) {
      logger.info(logContext, `Waiting for server at ${serverUrl}...`)
    } else if (attempt % 10 === 0) {
      logger.info(logContext, `Still waiting for server... (attempt ${attempt}/${maxAttempts})`)
    }

    // Exponential backoff: 2s, 4s, 8s, 15s, 15s, ...
    const baseDelay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
    // Add ±20% jitter to avoid thundering herd from multiple bots
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
    await new Promise(resolve => setTimeout(resolve, baseDelay + jitter))
  }

  logger.error(logContext, `Server did not become available after ${maxAttempts} attempts`)
  return false
}
