import type { CoordinationEvent, CoordinationPort } from '../../domain/ports/CoordinationPort.js'
import { logger } from '../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const BUFFER_SIZE = 64 * 1024

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function createFileCoordinationAdapter(coordinationDir: string): CoordinationPort {
  let lastDate = formatDate(new Date())

  function currentDate(): string {
    return formatDate(new Date())
  }

  function resolveFilePath(date: string): string {
    return resolve(coordinationDir, `events-${date}.jsonl`)
  }

  async function publish(event: Omit<CoordinationEvent, 'id' | 'timestamp'>): Promise<void> {
    const today = currentDate()
    lastDate = today
    const filepath = resolveFilePath(today)
    const payload: CoordinationEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
    }
    const line = `${JSON.stringify(payload)}\n`
    await fs.appendFile(filepath, line, 'utf-8')
  }

  async function poll(sinceOffset: number): Promise<{ events: CoordinationEvent[]; newOffset: number }> {
    const today = currentDate()
    const shouldReset = lastDate !== today
    lastDate = today
    const filepath = resolveFilePath(today)
    const events: CoordinationEvent[] = []
    const startOffset = shouldReset ? 0 : sinceOffset

    let fileHandle: fs.FileHandle | null = null
    try {
      fileHandle = await fs.open(filepath, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { events, newOffset: 0 }
      }
      throw error
    }

    let position = startOffset
    let totalRead = 0
    let pending = Buffer.alloc(0)
    const buffer = Buffer.alloc(BUFFER_SIZE)

    try {
      while (true) {
        const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) {
          break
        }
        const chunk = buffer.subarray(0, bytesRead)
        position += bytesRead
        totalRead += bytesRead
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

        let newlineIndex = pending.indexOf(10)
        while (newlineIndex !== -1) {
          const lineBuffer = pending.subarray(0, newlineIndex)
          pending = pending.subarray(newlineIndex + 1)
          const line = lineBuffer[lineBuffer.length - 1] === 13
            ? lineBuffer.subarray(0, lineBuffer.length - 1)
            : lineBuffer
          const text = line.toString('utf-8').trim()
          if (text.length > 0) {
            try {
              events.push(JSON.parse(text) as CoordinationEvent)
            } catch (parseError) {
              logger.warn('coordination', `Failed to parse coordination event line: ${parseError}`)
            }
          }
          newlineIndex = pending.indexOf(10)
        }
      }
    } finally {
      await fileHandle.close()
    }

    const newOffset = startOffset + totalRead
    if (pending.length > 0) {
      const text = pending.toString('utf-8').trim()
      if (text.length > 0) {
        try {
          events.push(JSON.parse(text) as CoordinationEvent)
        } catch (parseError) {
          logger.warn('coordination', `Failed to parse coordination event line: ${parseError}`)
        }
      }
    }

    return { events, newOffset }
  }

  async function currentOffset(): Promise<number> {
    const today = currentDate()
    lastDate = today
    const filepath = resolveFilePath(today)
    try {
      const stats = await fs.stat(filepath)
      return stats.size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0
      }
      throw error
    }
  }

  return {
    publish,
    poll,
    currentOffset,
  }
}
