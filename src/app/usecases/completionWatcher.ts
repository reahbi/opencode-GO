import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../policies/limits.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

interface CompletionWatcherDeps {
  notificationPort: HookNotificationPort
}

interface ProjectWatcher {
  directory: string
  name: string
  pollInterval: ReturnType<typeof setInterval> | null
  lastActivityTime: number
  busySessions: Map<string, { busySince: number; lastActivity: number }>
  connected: boolean
}

const POLL_INTERVAL_MS = 5_000
const IDLE_THRESHOLD_MS = 30_000

async function findClaudeSessionDir(projectDir: string): Promise<string | null> {
  // Claude CLI stores projects under ~/.claude/projects/
  // The project directory hash is used as the subfolder name
  const claudeDir = join(projectDir, '.claude')
  try {
    await fs.access(claudeDir)
    return claudeDir
  } catch {
    return null
  }
}

async function getLatestModTime(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    let latest = 0
    for (const entry of entries) {
      try {
        const stat = await fs.stat(join(dir, entry.name))
        if (stat.mtimeMs > latest) latest = stat.mtimeMs
      } catch {
        // skip inaccessible files
      }
    }
    return latest
  } catch {
    return 0
  }
}

export function createCompletionWatcher(deps: CompletionWatcherDeps) {
  const watchers = new Map<string, ProjectWatcher>()

  async function pollProject(pw: ProjectWatcher): Promise<void> {
    const claudeDir = await findClaudeSessionDir(pw.directory)
    if (!claudeDir) {
      if (pw.connected) {
        pw.connected = false
        logger.info('hookbot', `No .claude dir found in ${pw.directory}`)
      }
      return
    }

    if (!pw.connected) {
      pw.connected = true
      logger.info('hookbot', `Connected to ${pw.directory}`)
    }

    const latestMod = await getLatestModTime(claudeDir)

    if (latestMod > pw.lastActivityTime) {
      // New activity detected
      const wasIdle = pw.busySessions.size === 0
      const sessionKey = 'default'

      if (!pw.busySessions.has(sessionKey)) {
        pw.busySessions.set(sessionKey, {
          busySince: Date.now(),
          lastActivity: latestMod,
        })
        if (wasIdle) {
          logger.info('hookbot', `Activity detected in ${pw.name}`)
        }
      } else {
        const session = pw.busySessions.get(sessionKey)!
        session.lastActivity = latestMod
      }

      pw.lastActivityTime = latestMod
    } else {
      // Check for sessions that have gone idle
      const now = Date.now()
      for (const [sessionKey, session] of pw.busySessions.entries()) {
        if (now - session.lastActivity > IDLE_THRESHOLD_MS) {
          const duration = now - session.busySince
          pw.busySessions.delete(sessionKey)

          logger.info('hookbot', `Session completed in ${pw.name} (duration: ${Math.round(duration / 1000)}s)`)

          await deps.notificationPort.notify({
            type: 'completion',
            sessionId: sessionKey,
            directory: pw.directory,
            projectName: pw.name,
            duration,
          })
        }
      }
    }

    // Stall detection
    const now = Date.now()
    for (const [sessionKey, session] of pw.busySessions.entries()) {
      const stalledFor = now - session.lastActivity
      if (stalledFor > (LIMITS.HOOK_STALL_WARNING_MS ?? 300_000)) {
        logger.info('hookbot', `Stall detected in ${pw.name}: ${Math.round(stalledFor / 1000)}s inactive`)

        await deps.notificationPort.notify({
          type: 'stall',
          sessionId: sessionKey,
          directory: pw.directory,
          projectName: pw.name,
          inactiveDuration: stalledFor,
        })
      }
    }
  }

  async function startWatching(projects: Array<{ directory: string; name: string }>): Promise<void> {
    for (const project of projects) {
      if (watchers.has(project.directory)) continue

      const pw: ProjectWatcher = {
        directory: project.directory,
        name: project.name,
        pollInterval: null,
        lastActivityTime: Date.now(),
        busySessions: new Map(),
        connected: false,
      }

      pw.pollInterval = setInterval(() => {
        pollProject(pw).catch(err => {
          logger.error('hookbot', `Poll error for ${project.name}: ${err instanceof Error ? err.message : String(err)}`)
        })
      }, POLL_INTERVAL_MS)

      watchers.set(project.directory, pw)
      logger.info('hookbot', `Watching ${project.name} (${project.directory})`)

      // Initial poll
      await pollProject(pw)
    }
  }

  function stopAll(): void {
    for (const [dir, pw] of watchers.entries()) {
      if (pw.pollInterval) {
        clearInterval(pw.pollInterval)
        pw.pollInterval = null
      }
      watchers.delete(dir)
    }
    logger.info('hookbot', 'All watchers stopped')
  }

  function getStatus() {
    const projects: Array<{ directory: string; name: string; connected: boolean; busyCount: number }> = []
    for (const pw of watchers.values()) {
      projects.push({
        directory: pw.directory,
        name: pw.name,
        connected: pw.connected,
        busyCount: pw.busySessions.size,
      })
    }
    return { projects }
  }

  return { startWatching, stopAll, getStatus }
}
