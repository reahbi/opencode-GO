import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { createCompletionWatcher } from '../../app/usecases/completionWatcher.js'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import type { HookNotification } from '../../domain/hookBotTypes.js'
import { LIMITS } from '../../app/policies/limits.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('createCompletionWatcher', () => {
  let testDir: string
  let notifications: HookNotification[] = []
  let notificationPort: HookNotificationPort

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-watcher-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    notifications = []
    notificationPort = {
      notify: mock(async (n: HookNotification) => {
        notifications.push(n)
      }),
    }
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('creates watcher with required methods', () => {
    const watcher = createCompletionWatcher({ notificationPort })
    expect(watcher.startWatching).toBeDefined()
    expect(watcher.stopAll).toBeDefined()
    expect(watcher.getStatus).toBeDefined()
  })

  it('startWatching initializes watchers for projects', async () => {
    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([
      { directory: testDir, name: 'Test Project' },
    ])

    const status = watcher.getStatus()
    expect(status.projects).toHaveLength(1)
    expect(status.projects[0].name).toBe('Test Project')
    expect(status.projects[0].directory).toBe(testDir)

    watcher.stopAll()
  })

  it('detects .claude directory when present', async () => {
    const claudeDir = join(testDir, '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(join(claudeDir, 'test.jsonl'), 'test content')

    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'Test' }])

    // Give it a moment to poll
    await new Promise(resolve => setTimeout(resolve, 100))

    const status = watcher.getStatus()
    expect(status.projects[0].connected).toBe(true)

    watcher.stopAll()
  })

  it('marks project as disconnected when .claude dir missing', async () => {
    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'Test' }])

    await new Promise(resolve => setTimeout(resolve, 100))

    const status = watcher.getStatus()
    expect(status.projects[0].connected).toBe(false)

    watcher.stopAll()
  })

  it('stopAll clears all watchers', async () => {
    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([
      { directory: testDir, name: 'Test1' },
      { directory: join(testDir, 'test2'), name: 'Test2' },
    ])

    expect(watcher.getStatus().projects).toHaveLength(2)

    watcher.stopAll()

    expect(watcher.getStatus().projects).toHaveLength(0)
  })

  it('getStatus returns current watcher state', async () => {
    const watcher = createCompletionWatcher({ notificationPort })
    const status1 = watcher.getStatus()
    expect(status1.projects).toEqual([])

    await watcher.startWatching([{ directory: testDir, name: 'Test' }])

    const status2 = watcher.getStatus()
    expect(status2.projects).toHaveLength(1)
    expect(status2.projects[0]).toMatchObject({
      directory: testDir,
      name: 'Test',
      connected: false,
      busyCount: 0,
    })

    watcher.stopAll()
  })

  it('does not re-add existing watchers', async () => {
    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'Test' }])
    await watcher.startWatching([{ directory: testDir, name: 'Test' }])

    const status = watcher.getStatus()
    expect(status.projects).toHaveLength(1)

    watcher.stopAll()
  })
})

describe('completionWatcher stall/idle behavior', () => {
  let testDir: string
  let notifications: HookNotification[]
  let notificationPort: HookNotificationPort

  const origIdleMs = LIMITS.HOOK_IDLE_THRESHOLD_MS
  const origStallMs = LIMITS.HOOK_STALL_WARNING_MS

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-watcher-stall-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(join(testDir, '.claude'), { recursive: true })
    notifications = []
    notificationPort = {
      notify: mock(async (n: HookNotification) => {
        notifications.push(n)
      }),
    }
  })

  afterEach(async () => {
    ;(LIMITS as any).HOOK_IDLE_THRESHOLD_MS = origIdleMs
    ;(LIMITS as any).HOOK_STALL_WARNING_MS = origStallMs
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch { /* ignore */ }
  })

  /**
   * Create a file inside .claude with mtime forced 100ms into the future
   * to guarantee latestMod > lastActivityTime (which is Date.now() at watcher creation).
   * The session's lastActivity will be ~100ms ahead, so idle/stall waits must compensate.
   */
  const MTIME_OFFSET = 100
  async function triggerActivity(dir: string): Promise<void> {
    const filePath = join(dir, '.claude', `activity-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
    await fs.writeFile(filePath, 'activity\n')
    const ahead = new Date(Date.now() + MTIME_OFFSET)
    await fs.utimes(filePath, ahead, ahead)
  }

  it('sends stall notification only once per stall period', async () => {
    // Use very short stall threshold; idle threshold longer so completion doesn't fire first
    ;(LIMITS as any).HOOK_STALL_WARNING_MS = 50
    ;(LIMITS as any).HOOK_IDLE_THRESHOLD_MS = 600_000

    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'StallTest' }])

    // Create activity after watcher starts (mtime > lastActivityTime)
    await triggerActivity(testDir)
    await watcher._testPollAll()
    expect(watcher.getStatus().projects[0].busyCount).toBe(1)

    // Wait past stall threshold (compensate for MTIME_OFFSET + threshold + margin)
    await new Promise(r => setTimeout(r, 200))
    await watcher._testPollAll()

    const stallNotifs1 = notifications.filter(n => n.type === 'stall')
    expect(stallNotifs1).toHaveLength(1)

    // Poll again — should NOT send another stall notification
    await new Promise(r => setTimeout(r, 200))
    await watcher._testPollAll()

    const stallNotifs2 = notifications.filter(n => n.type === 'stall')
    expect(stallNotifs2).toHaveLength(1)

    watcher.stopAll()
  })

  it('resets stallWarnedAt on new activity', async () => {
    ;(LIMITS as any).HOOK_STALL_WARNING_MS = 50
    ;(LIMITS as any).HOOK_IDLE_THRESHOLD_MS = 600_000

    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'ResetTest' }])

    await triggerActivity(testDir)
    await watcher._testPollAll()

    // Wait past stall threshold
    await new Promise(r => setTimeout(r, 200))
    await watcher._testPollAll()

    expect(notifications.filter(n => n.type === 'stall')).toHaveLength(1)

    // New activity resets stallWarnedAt
    await triggerActivity(testDir)
    await watcher._testPollAll()

    // Wait past stall threshold again — should fire a second stall
    await new Promise(r => setTimeout(r, 200))
    await watcher._testPollAll()

    expect(notifications.filter(n => n.type === 'stall')).toHaveLength(2)

    watcher.stopAll()
  })

  it('detects recursive mod time in subdirectories', async () => {
    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'RecursiveTest' }])

    // Create a nested file under .claude/projects/hash/ after watcher starts
    const subDir = join(testDir, '.claude', 'projects', 'abc123')
    await fs.mkdir(subDir, { recursive: true })
    const nestedFile = join(subDir, 'session.jsonl')
    await fs.writeFile(nestedFile, 'nested activity\n')
    const ahead = new Date(Date.now() + MTIME_OFFSET)
    await fs.utimes(nestedFile, ahead, ahead)

    await watcher._testPollAll()

    // Should detect the nested file as activity
    expect(watcher.getStatus().projects[0].connected).toBe(true)
    expect(watcher.getStatus().projects[0].busyCount).toBe(1)

    watcher.stopAll()
  })

  it('uses LIMITS.HOOK_IDLE_THRESHOLD_MS for completion', async () => {
    // Set a very short idle threshold so completion triggers quickly
    ;(LIMITS as any).HOOK_IDLE_THRESHOLD_MS = 50
    ;(LIMITS as any).HOOK_STALL_WARNING_MS = 600_000

    const watcher = createCompletionWatcher({ notificationPort })
    await watcher.startWatching([{ directory: testDir, name: 'IdleTest' }])

    await triggerActivity(testDir)
    await watcher._testPollAll()

    // Session should be active
    expect(watcher.getStatus().projects[0].busyCount).toBe(1)

    // Wait past idle threshold (compensate for MTIME_OFFSET + threshold + margin)
    await new Promise(r => setTimeout(r, 200))
    await watcher._testPollAll()

    // Should have sent a completion notification
    const completions = notifications.filter(n => n.type === 'completion')
    expect(completions).toHaveLength(1)
    expect(completions[0].type === 'completion' && completions[0].projectName).toBe('IdleTest')

    // Session should be removed
    expect(watcher.getStatus().projects[0].busyCount).toBe(0)

    watcher.stopAll()
  })
})
