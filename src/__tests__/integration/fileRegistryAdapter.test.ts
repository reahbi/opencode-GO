import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileRegistryAdapter } from '../../adapters/coordination/fileRegistryAdapter.js'
import type { BotRegistryEntry } from '../../domain/models.js'

describe('fileRegistryAdapter integration', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'opencode-telegram-registry-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const registryPath = () => join(tempDir, 'registry.json')
  const lockPath = () => join(tempDir, 'registry.json.lock')

  const buildEntry = (instanceName: string, overrides: Partial<BotRegistryEntry> = {}): BotRegistryEntry => ({
    instanceName,
    botUsername: 'test_bot',
    botRole: 'writer',
    projectDir: '/tmp/project',
    serverUrl: 'http://127.0.0.1:4096',
    lastSeen: Date.now(),
    ...overrides,
  })

  it('register creates registry file', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await adapter.register(buildEntry('bot-1'))

    const stats = await fs.stat(registryPath())
    expect(stats.isFile()).toBe(true)
  })

  it('register and list', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await adapter.register(buildEntry('bot-1'))
    await adapter.register(buildEntry('bot-2', { botUsername: 'other_bot' }))

    const list = await adapter.list()
    const names = list.map(entry => entry.instanceName).sort()
    expect(names).toEqual(['bot-1', 'bot-2'])
  })

  it('unregister removes bot', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await adapter.register(buildEntry('bot-1'))
    await adapter.register(buildEntry('bot-2'))
    await adapter.unregister('bot-1')

    const list = await adapter.list()
    expect(list.length).toBe(1)
    expect(list[0].instanceName).toBe('bot-2')
  })

  it('findByRole filters correctly', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await adapter.register(buildEntry('writer-1', { botRole: 'writer' }))
    await adapter.register(buildEntry('reader-1', { botRole: 'reader' }))

    const writers = await adapter.findByRole('writer')
    expect(writers.length).toBe(1)
    expect(writers[0].instanceName).toBe('writer-1')
  })

  it('register updates existing entry', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await adapter.register(buildEntry('bot-1', { botUsername: 'old_bot' }))
    await adapter.register(buildEntry('bot-1', { botUsername: 'new_bot', serverUrl: 'http://localhost:9999' }))

    const list = await adapter.list()
    expect(list.length).toBe(1)
    expect(list[0].botUsername).toBe('new_bot')
    expect(list[0].serverUrl).toBe('http://localhost:9999')
  })

  it('list returns empty when no file', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    const list = await adapter.list()
    expect(list).toEqual([])
  })

  it('concurrent register does not corrupt', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => adapter.register(buildEntry(`bot-${index}`)))
    )

    const list = await adapter.list()
    expect(list.length).toBe(5)
  })

  it('lock prevents race condition', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    const entryA = buildEntry('bot-a', { botUsername: 'bot_a' })
    const entryB = buildEntry('bot-b', { botUsername: 'bot_b' })

    await Promise.all(
      Array.from({ length: 10 }, (_, index) => adapter.register(index % 2 === 0 ? entryA : entryB))
    )

    const list = await adapter.list()
    const names = list.map(entry => entry.instanceName).sort()
    expect(names).toEqual(['bot-a', 'bot-b'])
  })

  it('handles missing directory', async () => {
    const missingDir = join(tempDir, 'missing')
    const adapter = createFileRegistryAdapter(missingDir)
    await fs.mkdir(missingDir, { recursive: true })
    await adapter.register(buildEntry('bot-1'))

    const stats = await fs.stat(join(missingDir, 'registry.json'))
    expect(stats.isFile()).toBe(true)
  })

  it('stale lock is broken', async () => {
    const adapter = createFileRegistryAdapter(tempDir)
    await fs.writeFile(lockPath(), `${process.pid}:${Date.now() - 20_000}`, 'utf-8')

    await adapter.register(buildEntry('bot-1'))
    const list = await adapter.list()
    expect(list.length).toBe(1)
  })
})
