import { promises as fs } from 'node:fs'
import {
  createHookBot,
  createHookBotNotificationAdapter,
  createHookBotAuthGuard,
  registerHookBotHandlers,
} from './adapters/telegram/hookBotAdapter.js'
import { createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createHookBotStateStore } from './adapters/persistence/hookBotStateStore.js'
import { createInteractiveFlow } from './app/usecases/interactiveFlow.js'
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

  if (!config.botToken || !config.chatId) {
    logger.error('hookbot', 'Invalid config: botToken and chatId are required')
    process.exit(1)
  }

  logger.info('hookbot', 'Starting Hook Bot (Claude-Go mode)...')

  const projects = config.projects || []

  const bot = createHookBot(config.botToken)

  bot.use(createHookBotAuthGuard(config.chatId))

  const hookBotState = createHookBotStateStore()
  const hookBotOutput = createChatOutputAdapter(bot)
  const interactiveFlow = createInteractiveFlow({
    state: hookBotState,
    output: hookBotOutput,
  })

  const notificationPort = createHookBotNotificationAdapter(bot, config.chatId, config, interactiveFlow)
  const watcher = createCompletionWatcher({ notificationPort })

  await watcher.startWatching(projects)

  const discoverAndWatch = async (): Promise<number> => {
    const discovered: Array<{ directory: string; name: string }> = []

    for (const project of projects) {
      const claudeDir = `${project.directory}/.claude`
      try {
        await fs.access(claudeDir)
        discovered.push(project)
      } catch {
        logger.info('hookbot', `Skipping ${project.name}: no .claude directory found`)
      }
    }

    const currentWatchedDirs = new Set(
      watcher.getStatus().projects.map(p => p.directory)
    )

    const newProjects = discovered.filter(p => !currentWatchedDirs.has(p.directory))

    if (newProjects.length > 0) {
      await watcher.startWatching(newProjects)
      logger.info('hookbot', `Discovered ${newProjects.length} new project(s)`)
    }

    return newProjects.length
  }

  registerHookBotHandlers(bot, config, { watcher, discoverAndWatch, interactiveFlow })

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
