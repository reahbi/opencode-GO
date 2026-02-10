import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import type { OpenCodeEvent } from '../../domain/events.js'
import type { HistoryMessage } from '../../domain/models.js'
import type { TrackedSession } from '../../domain/hookBotTypes.js'
import { LIMITS } from '../policies/limits.js'
import { logger } from '../../shared/logger.js'

interface CompletionWatcherDeps {
  openCode: OpenCodePort
  notificationPort: HookNotificationPort
}

interface ProjectWatcher {
  directory: string
  name: string
  abort: AbortController
  connected: boolean
  stallTimer: ReturnType<typeof setInterval> | null
  pollTimer: ReturnType<typeof setInterval> | null
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export function createCompletionWatcher(deps: CompletionWatcherDeps) {
  const projectWatchers = new Map<string, ProjectWatcher>()
  const busySessions = new Map<string, TrackedSession>()
  const lastStallWarningTimes = new Map<string, number>()
  const recentlyNotifiedCompletions = new Map<string, number>()
  const lastPolledUpdatedAt = new Map<string, number>()

  const COMPLETION_DEDUPE_TTL_MS = 5 * 60 * 1000

  function compositeKey(directory: string, sessionId: string): string {
    return `${directory}:${sessionId}`
  }

  function shouldIgnoreSessionTitle(title: string | null | undefined): boolean {
    if (!title) return false

    // Skip ephemeral sessions created by our own summaryService
    if (title === '_summary') return true

    // Skip agent-call/subagent sessions (explore/librarian/oracle/artistry/etc.).
    // These are typically titled like "Explore: ... (@explore subagent)".
    if (/\(@[^)]+\s+subagent\)/i.test(title)) return true
    if (/^(Explore|Librarian|Oracle|Artistry|Metis|Momus):\s*/i.test(title)) return true

    return false
  }

  function parseIsoMs(value: string): number | null {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }

  function extractLastAssistantText(messages: HistoryMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== 'assistant') continue

      const texts = msg.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text.trim())
        .filter((t) => t.length > 0)

      if (texts.length > 0) {
        return texts.join('\n')
      }
    }

    return undefined
  }

  // ── Fire-and-forget completion fetch + notify ──────────────────────

  async function fetchAndNotifyCompletion(
    sessionId: string,
    directory: string,
    projectName: string,
    tracked: TrackedSession,
  ): Promise<void> {
    try {
      const session = await deps.openCode.getSession(sessionId, directory)

      if (shouldIgnoreSessionTitle(session?.title ?? null)) {
        logger.debug('hookbot', `Skipping notification for ignored session ${sessionId} (${session?.title ?? 'unknown title'})`)
        return
      }

      const messages = await deps.openCode.getSessionMessages(sessionId, directory)

      const lastMessagePreview = extractLastAssistantText(messages)

      const duration = tracked.observed ? Date.now() - tracked.busySince : null

      await deps.notificationPort.notify({
        type: 'completion',
        sessionId,
        directory,
        projectName,
        sessionTitle: session?.title ?? tracked.sessionTitle,
        duration,
        lastMessage: lastMessagePreview,
      })
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        logger.debug('hookbot', `Session ${sessionId} not found (may have been deleted), skipping completion`)
        return
      }
      logger.error('hookbot', `Failed to fetch/notify completion for session ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  async function fetchAndNotifyCompletionIfHasAssistant(
    sessionId: string,
    directory: string,
    projectName: string,
    tracked: TrackedSession,
  ): Promise<void> {
    try {
      const messages = await deps.openCode.getSessionMessages(sessionId, directory)

      const lastAssistantText = extractLastAssistantText(messages)
      if (!lastAssistantText) {
        logger.debug('hookbot', `Poll: skipping ${sessionId} (no assistant text yet)`)
        return
      }
    } catch (err) {
      logger.debug('hookbot', `Poll: unable to check messages for ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
      return
    }

    await fetchAndNotifyCompletion(sessionId, directory, projectName, tracked)
  }

  async function pollForCompletions(watcher: ProjectWatcher): Promise<void> {
    if (watcher.abort.signal.aborted) return

    try {
      const [sessions, statuses] = await Promise.all([
        deps.openCode.listSessions(watcher.directory),
        deps.openCode.getSessionStatuses(watcher.directory),
      ])

      const now = Date.now()
      const recentWindowMs = LIMITS.HOOK_COMPLETION_POLL_RECENT_WINDOW_MS

      for (const session of sessions) {
        // Skip agent-call sessions early to avoid unnecessary work.
        if (shouldIgnoreSessionTitle(session.title ?? null)) continue

        const updatedMs = parseIsoMs(session.updatedAt)
        if (updatedMs === null) continue
        if (now - updatedMs > recentWindowMs) continue

        const key = compositeKey(watcher.directory, session.id)

        const lastSeenUpdated = lastPolledUpdatedAt.get(key)
        if (lastSeenUpdated !== undefined && lastSeenUpdated >= updatedMs) continue

        // If currently busy, wait for a future poll.
        const status = statuses[session.id]
        if (status && status.type === 'busy') continue

        // Extra safety dedupe to avoid repeated notifications on quick successive updates.
        const lastNotified = recentlyNotifiedCompletions.get(key)
        if (lastNotified && now - lastNotified < COMPLETION_DEDUPE_TTL_MS) {
          lastPolledUpdatedAt.set(key, updatedMs)
          continue
        }

        lastPolledUpdatedAt.set(key, updatedMs)
        recentlyNotifiedCompletions.set(key, now)

        const tracked: TrackedSession = {
          sessionId: session.id,
          directory: watcher.directory,
          projectName: watcher.name,
          busySince: updatedMs,
          lastActivityTime: updatedMs,
          observed: false,
          sessionTitle: session.title,
        }
        void fetchAndNotifyCompletionIfHasAssistant(session.id, watcher.directory, watcher.name, tracked)
        logger.info('hookbot', `Poll: candidate completion ${session.id} in ${watcher.name} (updated ${session.updatedAt})`)
      }
    } catch (err) {
      logger.error('hookbot', `Poll failed for ${watcher.name}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── SSE event handler (synchronous — must NOT block) ───────────────

  function handleEvent(directory: string, projectName: string, event: OpenCodeEvent): void {
    switch (event.type) {
      case 'session.busy': {
        const key = compositeKey(directory, event.data.sessionId)
        if (!busySessions.has(key)) {
          const now = Date.now()
          busySessions.set(key, {
            sessionId: event.data.sessionId,
            directory,
            projectName,
            busySince: now,
            lastActivityTime: now,
            observed: true,
          })
        }
        break
      }

      case 'session.idle': {
        const key = compositeKey(directory, event.data.sessionId)
        const tracked = busySessions.get(key)
        if (tracked) {
          void fetchAndNotifyCompletion(event.data.sessionId, directory, projectName, tracked)
          busySessions.delete(key)
          lastStallWarningTimes.delete(key)
          recentlyNotifiedCompletions.set(key, Date.now())
          logger.info('hookbot', `Session ${event.data.sessionId} completed in ${projectName}`)
        } else {
          const now = Date.now()
          const lastNotified = recentlyNotifiedCompletions.get(key)
          if (lastNotified && now - lastNotified < COMPLETION_DEDUPE_TTL_MS) break

          recentlyNotifiedCompletions.set(key, now)
          const untrackedSession: TrackedSession = {
            sessionId: event.data.sessionId,
            directory,
            projectName,
            busySince: now,
            lastActivityTime: now,
            observed: false,
          }
          void fetchAndNotifyCompletion(event.data.sessionId, directory, projectName, untrackedSession)
          logger.info('hookbot', `Untracked session ${event.data.sessionId} idle in ${projectName}, notifying completion`)
        }
        break
      }

      case 'session.error': {
        const key = compositeKey(directory, event.data.sessionId)
        void deps.notificationPort.notify({
          type: 'error',
          sessionId: event.data.sessionId,
          directory,
          projectName,
          error: event.data.error,
        }).catch(err => {
          logger.error('hookbot', `Failed to notify error: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        busySessions.delete(key)
        lastStallWarningTimes.delete(key)
        break
      }

      case 'permission.asked': {
        void deps.notificationPort.notify({
          type: 'permission',
          sessionId: event.data.sessionId,
          directory,
          projectName,
          requestId: event.data.requestId,
          permission: event.data.permission,
          patterns: event.data.patterns,
          title: event.data.title,
        }).catch(err => {
          logger.error('hookbot', `Failed to notify permission: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        break
      }

      case 'question.asked': {
        void deps.notificationPort.notify({
          type: 'question',
          sessionId: event.data.sessionId,
          directory,
          projectName,
          requestId: event.data.requestId,
          questions: event.data.questions.map(q => ({
            text: q.text,
            options: q.options,
            multiple: q.multiple,
          })),
        }).catch(err => {
          logger.error('hookbot', `Failed to notify question: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        break
      }

      case 'message.part.updated':
      case 'tool.part.updated':
      case 'session.retry': {
        const key = compositeKey(directory, event.data.sessionId)
        const tracked = busySessions.get(key)
        if (tracked) {
          tracked.lastActivityTime = Date.now()
        } else {
          const now = Date.now()
          busySessions.set(key, {
            sessionId: event.data.sessionId,
            directory,
            projectName,
            busySince: now,
            lastActivityTime: now,
            observed: false,
          })
          logger.info('hookbot', `Auto-registered session ${event.data.sessionId} in ${projectName} (from ${event.type})`)
        }
        break
      }

      default:
        break
    }
  }

  // ── Reconnect reconciliation ───────────────────────────────────────

  async function reconcileOnReconnect(directory: string, projectName: string): Promise<void> {
    try {
      const statuses = await deps.openCode.getSessionStatuses(directory)

      // Check tracked sessions — if now idle, emit completion
      for (const [key, tracked] of busySessions) {
        if (tracked.directory !== directory) continue
        const status = statuses[tracked.sessionId]
        if (!status || status.type === 'idle') {
          void fetchAndNotifyCompletion(tracked.sessionId, directory, projectName, tracked)
          busySessions.delete(key)
          lastStallWarningTimes.delete(key)
          logger.info('hookbot', `Reconcile: session ${tracked.sessionId} completed while disconnected`)
        }
      }

      // Discover newly busy sessions
      for (const [sessionId, status] of Object.entries(statuses)) {
        if (status.type === 'busy') {
          const key = compositeKey(directory, sessionId)
          if (!busySessions.has(key)) {
            const now = Date.now()
            busySessions.set(key, {
              sessionId,
              directory,
              projectName,
              busySince: now,
              lastActivityTime: now,
              observed: false,
            })
            logger.info('hookbot', `Reconcile: discovered busy session ${sessionId} in ${projectName}`)
          }
        }
      }
    } catch (err) {
      logger.error('hookbot', `Reconcile failed for ${projectName}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── Sleep helper (abort-aware) ─────────────────────────────────────

  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(); return }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
  }

  // ── SSE reconnection loop ─────────────────────────────────────────

  async function runSseLoop(watcher: ProjectWatcher): Promise<void> {
    let backoffMs = RECONNECT_BASE_MS

    while (!watcher.abort.signal.aborted) {
      try {
        // Reconcile on each (re)connect
        await reconcileOnReconnect(watcher.directory, watcher.name)
        if (watcher.abort.signal.aborted) return

        watcher.connected = true
        backoffMs = RECONNECT_BASE_MS
        logger.info('hookbot', `SSE connected for project ${watcher.name}`)

        await deps.openCode.streamEvents(
          watcher.directory,
          (event) => handleEvent(watcher.directory, watcher.name, event),
          watcher.abort.signal,
        )

        if (watcher.abort.signal.aborted) return
        watcher.connected = false
        logger.debug('hookbot', `SSE disconnected for project ${watcher.name}, reconnecting in ${backoffMs}ms`)

        await sleep(backoffMs, watcher.abort.signal)
        backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS)
      } catch (err) {
        if (watcher.abort.signal.aborted) return
        watcher.connected = false
        logger.warn('hookbot', `SSE error for project ${watcher.name}: ${err instanceof Error ? err.message : 'unknown'}, reconnecting in ${backoffMs}ms`)

        await sleep(backoffMs, watcher.abort.signal)
        backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS)
      }
    }
  }

  // ── Stall detection (per-project interval) ─────────────────────────

  function startStallDetection(watcher: ProjectWatcher): void {
    watcher.stallTimer = setInterval(() => {
      if (watcher.abort.signal.aborted) {
        if (watcher.stallTimer) clearInterval(watcher.stallTimer)
        return
      }

      const now = Date.now()
      for (const [key, tracked] of busySessions) {
        if (tracked.directory !== watcher.directory) continue

        const inactiveDuration = now - tracked.lastActivityTime
        if (inactiveDuration < LIMITS.HOOK_STALL_WARNING_MS) continue

        // Only warn once per stall — cleared when session goes idle/error/reconciled
        if (lastStallWarningTimes.has(key)) continue

        lastStallWarningTimes.set(key, now)
        void deps.notificationPort.notify({
          type: 'stall',
          sessionId: tracked.sessionId,
          directory: tracked.directory,
          projectName: tracked.projectName,
          inactiveDuration,
        }).catch(err => {
          logger.error('hookbot', `Failed to notify stall: ${err instanceof Error ? err.message : 'unknown'}`)
        })
      }
    }, LIMITS.HOOK_STALL_CHECK_INTERVAL_MS)
  }

  // ── Startup seeding ────────────────────────────────────────────────

  async function seedBusySessions(directory: string, projectName: string): Promise<void> {
    try {
      const statuses = await deps.openCode.getSessionStatuses(directory)
      const now = Date.now()

      for (const [sessionId, status] of Object.entries(statuses)) {
        if (status.type === 'busy') {
          const key = compositeKey(directory, sessionId)
          if (!busySessions.has(key)) {
            busySessions.set(key, {
              sessionId,
              directory,
              projectName,
              busySince: now,
              lastActivityTime: now,
              observed: false,
            })
            lastStallWarningTimes.set(key, now)
            logger.info('hookbot', `Seeded busy session ${sessionId} in ${projectName} (stall-suppressed)`)
          }
        }
      }
    } catch (err) {
      logger.error('hookbot', `Failed to seed sessions for ${projectName}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  async function startWatching(projects: Array<{ directory: string; name: string }>): Promise<void> {
    for (const project of projects) {
      if (projectWatchers.has(project.directory)) continue

      const watcher: ProjectWatcher = {
        directory: project.directory,
        name: project.name,
        abort: new AbortController(),
        connected: false,
        stallTimer: null,
        pollTimer: null,
      }

      projectWatchers.set(project.directory, watcher)

      // Seed busy sessions before starting SSE
      await seedBusySessions(project.directory, project.name)

      // Start stall detection
      startStallDetection(watcher)

      // Start SSE loop (fire and forget)
      void runSseLoop(watcher)

      // Start poll-based completion backfill (for sessions created outside server event bus)
      watcher.pollTimer = setInterval(() => {
        void pollForCompletions(watcher)
      }, LIMITS.HOOK_COMPLETION_POLL_INTERVAL_MS)

      logger.info('hookbot', `Started watching project ${project.name} at ${project.directory}`)
    }
  }

  function stopAll(): void {
    for (const [, watcher] of projectWatchers) {
      watcher.abort.abort()
      if (watcher.stallTimer) {
        clearInterval(watcher.stallTimer)
        watcher.stallTimer = null
      }
      if (watcher.pollTimer) {
        clearInterval(watcher.pollTimer)
        watcher.pollTimer = null
      }
      watcher.connected = false
      logger.info('hookbot', `Stopped watching project ${watcher.name}`)
    }
    projectWatchers.clear()
    busySessions.clear()
    lastStallWarningTimes.clear()
    recentlyNotifiedCompletions.clear()
    lastPolledUpdatedAt.clear()
  }

  function getStatus() {
    const projects: Array<{ directory: string; name: string; connected: boolean; busyCount: number }> = []
    for (const [, watcher] of projectWatchers) {
      let busyCount = 0
      for (const [, tracked] of busySessions) {
        if (tracked.directory === watcher.directory) busyCount++
      }
      projects.push({
        directory: watcher.directory,
        name: watcher.name,
        connected: watcher.connected,
        busyCount,
      })
    }
    return { projects }
  }

  return { startWatching, stopAll, getStatus }
}
