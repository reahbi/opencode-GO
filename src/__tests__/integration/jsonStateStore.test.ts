import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJsonStateStore } from '../../adapters/persistence/jsonStateStore.js'
import { createDefaultChatState } from '../../domain/models.js'
import { LIMITS } from '../../app/policies/limits.js'
import type { ChatState } from '../../domain/models.js'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('jsonStateStore integration', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'claude-go-state-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createStore = () => createJsonStateStore(tempDir)
  const statePath = () => join(tempDir, 'state.json')

  it('creates state file on first access', async () => {
    const store = createStore()
    await store.getChatState(1)
    const stats = await fs.stat(statePath())
    expect(stats.isFile()).toBe(true)
  })

  it('returns default state for unknown chatId', async () => {
    const store = createStore()
    const state = await store.getChatState(999)
    expect(state).toEqual(createDefaultChatState())
  })

  it('saves and retrieves state', async () => {
    const store = createStore()
    const chatId = 42
    const state: ChatState = {
      ...createDefaultChatState(),
      activeProjectDirectory: '/tmp/project',
      activeSessionId: 'ses-1',
      activeAgent: 'agent-a',
      lastPrompt: 'Hello',
      awaitingInput: 'question',
      awaitingInteractionId: 'interaction-1',
    }

    await store.saveChatState(chatId, state)
    const loaded = await store.getChatState(chatId)
    expect(loaded).toEqual(state)
  })

  it('persists across instances', async () => {
    const chatId = 7
    const state: ChatState = {
      ...createDefaultChatState(),
      activeProjectDirectory: '/tmp/project',
      activeSessionId: 'ses-2',
      activeAgent: 'agent-b',
      lastPrompt: 'Persist',
    }

    const storeA = createStore()
    await storeA.saveChatState(chatId, state)

    const storeB = createStore()
    const loaded = await storeB.getChatState(chatId)
    expect(loaded).toEqual(state)
  })

  it('handles concurrent saves with withChatLock', async () => {
    const store = createStore()
    const chatId = 101
    const firstState: ChatState = {
      ...createDefaultChatState(),
      activeSessionId: 'ses-first',
      lastPrompt: 'first',
    }
    const secondState: ChatState = {
      ...createDefaultChatState(),
      activeSessionId: 'ses-second',
      lastPrompt: 'second',
    }

    await Promise.all([
      store.withChatLock(chatId, async () => {
        await delay(50)
        await store.saveChatState(chatId, firstState)
      }),
      store.withChatLock(chatId, async () => {
        await store.saveChatState(chatId, secondState)
      }),
    ])

    const loaded = await store.getChatState(chatId)
    expect(loaded).toEqual(secondState)
  })

  it('migrates old state format', async () => {
    const store = createStore()
    const chatId = 55
    const legacy = {
      activeSessionId: 'legacy-session',
      settings: {
        summaryMode: true,
        summaryThreshold: 1,
      },
    }
    await fs.writeFile(statePath(), JSON.stringify({ [chatId]: legacy }, null, 2), 'utf-8')

    const state = await store.getChatState(chatId)
    expect(state.activeSessionId).toBe('legacy-session')
    expect(state.settings.summaryMode).toBe(true)
    expect(state.settings.summaryThreshold).toBeGreaterThanOrEqual(LIMITS.SUMMARY_MIN_TRIGGER)
    expect(state.settings.outputMode).toBe('formatted')
    expect(state.awaitingInput).toBeNull()
    expect(state.awaitingInteractionId).toBeNull()
  })

  it('atomic write does not leave temp files', async () => {
    const store = createStore()
    await store.saveChatState(1, createDefaultChatState())

    const files = await fs.readdir(tempDir)
    expect(files).toContain('state.json')
    expect(files.some(file => file.includes('.tmp.'))).toBe(false)
  })

  it('handles corrupted JSON gracefully', async () => {
    const store = createStore()
    await fs.writeFile(statePath(), '{not-json', 'utf-8')

    const state = await store.getChatState(1)
    expect(state).toEqual(createDefaultChatState())
  })

  it('withChatLock serializes operations', async () => {
    const store = createStore()
    const chatId = 9
    let firstEnd = 0
    let secondStart = 0

    await Promise.all([
      store.withChatLock(chatId, async () => {
        await delay(80)
        firstEnd = Date.now()
      }),
      store.withChatLock(chatId, async () => {
        secondStart = Date.now()
      }),
    ])

    expect(secondStart).toBeGreaterThanOrEqual(firstEnd)
  })

  it('withChatLock allows parallel operations for different chatIds', async () => {
    const store = createStore()
    let aStart = 0
    let aEnd = 0
    let bStart = 0
    let bEnd = 0

    await Promise.all([
      store.withChatLock(1, async () => {
        aStart = Date.now()
        await delay(100)
        aEnd = Date.now()
      }),
      store.withChatLock(2, async () => {
        bStart = Date.now()
        await delay(100)
        bEnd = Date.now()
      }),
    ])

    const overlap = Math.max(aStart, bStart) < Math.min(aEnd, bEnd)
    expect(overlap).toBe(true)
  })
})
