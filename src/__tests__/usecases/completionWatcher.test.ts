import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { createCompletionWatcher } from '../../app/usecases/completionWatcher.js'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import type { HookNotification } from '../../domain/hookBotTypes.js'
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
