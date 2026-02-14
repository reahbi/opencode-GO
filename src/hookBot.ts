import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import {
  createHookBot,
  createHookBotNotificationAdapter,
  createHookBotAuthGuard,
  registerHookBotHandlers,
  fetchServerProjects,
} from './adapters/telegram/hookBotAdapter.js'
import { createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createHookBotStateStore } from './adapters/persistence/hookBotStateStore.js'
import { createInteractiveFlow } from './app/usecases/interactiveFlow.js'
import { createCompletionWatcher } from './app/usecases/completionWatcher.js'
import { createTurnWatcher } from './app/usecases/turnWatcher.js'
import type { HookBotConfig } from './domain/hookBotTypes.js'
import { logger } from './shared/logger.js'

/** Read registry.json to discover project directories */
async function discoverProjectsFromRegistry(): Promise<Array<{ directory: string; name: string }>> {
  const paths = [
    resolve(process.cwd(), 'data', 'registry.json'),
    resolve(process.env.STATE_DIR || 'data', 'registry.json'),
  ]
  for (const registryPath of paths) {
    try {
      const raw = await fs.readFile(registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as { bots?: Record<string, { projectDir?: string; instanceName?: string }> }
      const entries = Object.values(parsed.bots ?? {})
      const results = entries
        .filter(e => e.projectDir && e.projectDir.length > 1)
        .map(e => ({
          directory: e.projectDir!,
          name: e.instanceName || e.projectDir!.split('/').pop() || e.projectDir!,
        }))
      if (results.length > 0) return results
    } catch {
      // try next path
    }
  }
  return []
}

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

  let projects = config.projects || []

  // For 'all' mode with no configured projects, discover from registry or server
  if (config.mode === 'all' && projects.length === 0) {
    logger.info('hookbot', 'Mode is "all" with no configured projects, discovering...')

    // Try server first
    if (config.serverUrl) {
      try {
        projects = await fetchServerProjects(config)
        logger.info('hookbot', `Discovered ${projects.length} project(s) from server`)
      } catch {
        logger.debug('hookbot', 'Server project discovery failed')
      }
    }

    // Fall back to registry file
    if (projects.length === 0) {
      projects = await discoverProjectsFromRegistry()
      if (projects.length > 0) {
        logger.info('hookbot', `Discovered ${projects.length} project(s) from registry`)
      }
    }

    if (projects.length === 0) {
      logger.warn('hookbot', 'No projects discovered. Hook bot will not monitor anything until /scan is used.')
    }
  }

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
  const instancesDir = resolve(process.cwd(), 'data', 'instances')
  const turnWatcher = createTurnWatcher({ notificationPort, projects, instancesDir })

  await watcher.startWatching(projects)
  turnWatcher.start()

  const discoverAndWatch = async (): Promise<number> => {
    // For 'all' mode, discover from server or registry
    let allCandidates: Array<{ directory: string; name: string }> = []

    if (config.mode === 'all') {
      // Try server first
      if (config.serverUrl) {
        try {
          allCandidates = await fetchServerProjects(config)
        } catch {
          logger.debug('hookbot', 'Server discovery failed during scan')
        }
      }
      // Fall back to registry
      if (allCandidates.length === 0) {
        allCandidates = await discoverProjectsFromRegistry()
      }
      // Also include originally configured projects
      for (const p of projects) {
        if (!allCandidates.some(c => c.directory === p.directory)) {
          allCandidates.push(p)
        }
      }
    } else {
      allCandidates = [...projects]
    }

    // Filter to those with .claude directories
    const discovered: Array<{ directory: string; name: string }> = []
    for (const project of allCandidates) {
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

  await bot.api.setMyCommands([
    { command: 'hookstatus', description: 'Show watching status' },
    { command: 'scan', description: 'Discover and watch new projects' },
    { command: 'settings', description: 'Configure hook bot settings' },
    { command: 'cancel', description: 'Cancel pending interaction' },
  ])

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
    turnWatcher.stop()
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
