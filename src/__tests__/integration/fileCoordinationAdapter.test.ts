import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileCoordinationAdapter } from '../../adapters/coordination/fileCoordinationAdapter.js'
import type { CoordinationEvent } from '../../domain/ports/CoordinationPort.js'

describe('fileCoordinationAdapter integration', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'claude-go-coord-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const todayFile = () => join(tempDir, `events-${new Date().toISOString().slice(0, 10)}.jsonl`)
  const createEvent = (overrides: Partial<Omit<CoordinationEvent, 'id' | 'timestamp'>> = {}): Omit<CoordinationEvent, 'id' | 'timestamp'> => ({
    type: 'debate.request',
    fromBot: 'bot-a',
    toBot: 'bot-b',
    sessionId: 'ses-1',
    debateId: 'debate-1',
    chatId: 123,
    payload: { topic: 'test' },
    ...overrides,
  })

  it('publish creates JSONL file', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await adapter.publish(createEvent())

    const stats = await fs.stat(todayFile())
    expect(stats.isFile()).toBe(true)
  })

  it('publish appends events', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await adapter.publish(createEvent({ payload: { topic: 'one' } }))
    await adapter.publish(createEvent({ payload: { topic: 'two' } }))

    const content = await fs.readFile(todayFile(), 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
  })

  it('poll returns empty when no file exists', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    const result = await adapter.poll(0)
    expect(result.events.length).toBe(0)
    expect(result.newOffset).toBe(0)
  })

  it('poll reads published events', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await adapter.publish(createEvent({ payload: { topic: 'one' } }))
    await adapter.publish(createEvent({ payload: { topic: 'two' } }))
    await adapter.publish(createEvent({ payload: { topic: 'three' } }))

    const result = await adapter.poll(0)
    expect(result.events.length).toBe(3)
    expect(result.newOffset).toBeGreaterThan(0)
  })

  it('poll with offset returns only new events', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await adapter.publish(createEvent({ payload: { topic: 'one' } }))
    await adapter.publish(createEvent({ payload: { topic: 'two' } }))

    const first = await adapter.poll(0)
    await adapter.publish(createEvent({ payload: { topic: 'three' } }))
    const second = await adapter.poll(first.newOffset)
    expect(second.events.length).toBe(1)
  })

  it('poll handles malformed JSONL lines', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    const goodEvent: CoordinationEvent = {
      ...createEvent(),
      id: 'evt-1',
      timestamp: Date.now(),
    }
    const payload = `${JSON.stringify(goodEvent)}\n{bad\n`
    await fs.writeFile(todayFile(), payload, 'utf-8')

    const result = await adapter.poll(0)
    expect(result.events.length).toBe(1)
    expect(result.events[0].id).toBe('evt-1')
  })

  it('currentOffset returns file size', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await adapter.publish(createEvent({ payload: { topic: 'one' } }))
    await adapter.publish(createEvent({ payload: { topic: 'two' } }))

    const stats = await fs.stat(todayFile())
    const offset = await adapter.currentOffset()
    expect(offset).toBe(stats.size)
  })

  it('currentOffset returns 0 for nonexistent file', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    const offset = await adapter.currentOffset()
    expect(offset).toBe(0)
  })

  it('concurrent publishes do not corrupt file', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => adapter.publish(createEvent({ payload: { topic: `t-${index}` } })))
    )

    const result = await adapter.poll(0)
    expect(result.events.length).toBe(10)
  })

  it('events have unique id and timestamp', async () => {
    const adapter = createFileCoordinationAdapter(tempDir)
    await adapter.publish(createEvent({ payload: { topic: 'one' } }))
    await adapter.publish(createEvent({ payload: { topic: 'two' } }))

    const result = await adapter.poll(0)
    expect(result.events.length).toBe(2)
    expect(result.events[0].id).not.toBe(result.events[1].id)
    expect(result.events[0].timestamp).toBeGreaterThan(0)
    expect(result.events[1].timestamp).toBeGreaterThan(0)
  })
})
