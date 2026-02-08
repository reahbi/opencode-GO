import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createOpenCodeAdapter } from './adapters/opencode/opencodeAdapter.js'
import {
  createHookBot,
  createHookBotNotificationAdapter,
  createHookBotAuthGuard,
  registerHookBotHandlers,
} from './adapters/telegram/hookBotAdapter.js'
import { createCompletionWatcher } from './app/usecases/completionWatcher.js'
import type { HookBotConfig } from './domain/hookBotTypes.js'
import { logger } from './shared/logger.js'

async function main() {
  const configPath = process.env.HOOK_CONFIG_PATH || 'data/hook-config.json'

  let config: HookBotConfig
  try {
    const configData = await fs.readFile(configPath, 'utf-8')
    config = JSON.parse(configData)
  } catch (err) {
    logger.error('hookbot', `Failed to load config from ${configPath}: ${err instanceof Error ? err.message : 'unknown'}`)
    process.exit(1)
  }

  if (!config.botToken || !config.chatId || !config.serverUrl) {
    logger.error('hookbot', 'Invalid config: botToken, chatId, and serverUrl are required')
    process.exit(1)
  }

  logger.info('hookbot', 'Starting Hook Bot composition root...')

  const openCode = createOpenCodeAdapter(config.serverUrl, config.serverUsername, config.serverPassword)

  let projects = config.projects || []
  if (config.mode === 'all') {
    logger.info('hookbot', 'Mode is "all", discovering projects from server...')
    try {
      const headers: Record<string, string> = {}
      if (config.serverPassword) {
        const auth = Buffer.from(`${config.serverUsername}:${config.serverPassword}`).toString('base64')
        headers['Authorization'] = `Basic ${auth}`
      }

      const response = await fetch(`${config.serverUrl}/project`, { headers })
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as any[]
      projects = data.map(p => ({
        directory: p.worktree,
        name: p.name || path.basename(p.worktree),
      }))
    } catch (err) {
      logger.error('hookbot', `Project discovery failed: ${err instanceof Error ? err.message : 'unknown'}`)
      process.exit(1)
    }
  }

  const bot = createHookBot(config.botToken)
  
  bot.use(createHookBotAuthGuard(config.chatId))

  registerHookBotHandlers(bot, openCode, config)

  const notificationPort = createHookBotNotificationAdapter(bot, config.chatId, openCode, config)
  const watcher = createCompletionWatcher({ openCode, notificationPort })

  await watcher.startWatching(projects)

  bot.start({
    drop_pending_updates: true,
    onStart: (botInfo) => {
      logger.info('hookbot', `Hook bot started — monitoring ${projects.length} project(s)`)
      logger.info('hookbot', `Bot: @${botInfo.username}, Chat: ${config.chatId}`)
    }
  })

  async function shutdown(signal: string) {
    logger.info('hookbot', `Received ${signal}, shutting down...`)
    watcher.stopAll()
    await bot.stop()
    logger.info('hookbot', 'Hook bot stopped')
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.error('hookbot', `Fatal error: ${err instanceof Error ? err.message : 'unknown'}`)
  process.exit(1)
})
