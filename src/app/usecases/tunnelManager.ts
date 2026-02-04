import { spawn, type Subprocess } from 'bun'
import type { TunnelState } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'

const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const TUNNEL_START_TIMEOUT_MS = 15000

interface TunnelEntry {
  process: Subprocess
  state: TunnelState
}

const tunnels = new Map<number, TunnelEntry>()

export interface TunnelManager {
  start(chatId: number, port: number): Promise<TunnelState>
  stop(chatId: number): Promise<void>
  get(chatId: number): TunnelState | null
  stopAll(): Promise<void>
  isCloudflaredInstalled(): Promise<boolean>
}

async function checkCloudflaredInstalled(): Promise<boolean> {
  try {
    const proc = spawn(['cloudflared', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

async function startTunnel(chatId: number, port: number): Promise<TunnelState> {
  const existing = tunnels.get(chatId)
  if (existing) {
    logger.info('tunnel', `Stopping existing tunnel for chat ${chatId} before starting new one`)
    await stopTunnel(chatId)
  }

  logger.info('tunnel', `Starting tunnel for chat ${chatId} on port ${port}`)

  const proc = spawn(['cloudflared', 'tunnel', '--url', `http://localhost:${port}`], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const state: TunnelState = {
    isActive: true,
    url: null,
    port,
    startedAt: Date.now(),
  }

  const entry: TunnelEntry = { process: proc, state }
  tunnels.set(chatId, entry)

  const urlPromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), TUNNEL_START_TIMEOUT_MS)

    const readStream = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          logger.debug('tunnel', `cloudflared output: ${text.trim()}`)
          const match = text.match(TUNNEL_URL_REGEX)
          if (match) {
            clearTimeout(timeout)
            resolve(match[0])
            return
          }
        }
      } catch {
      }
    }

    void readStream(proc.stderr as ReadableStream<Uint8Array>)
    void readStream(proc.stdout as ReadableStream<Uint8Array>)
  })

  const url = await urlPromise

  if (url) {
    state.url = url
    logger.info('tunnel', `Tunnel started for chat ${chatId}: ${url}`)
  } else {
    logger.warn('tunnel', `Tunnel URL not detected for chat ${chatId} within timeout`)
  }

  proc.exited.then((code) => {
    const current = tunnels.get(chatId)
    if (current?.process === proc) {
      current.state.isActive = false
      tunnels.delete(chatId)
      logger.info('tunnel', `Tunnel process exited for chat ${chatId} with code ${code}`)
    }
  }).catch(() => {})

  return state
}

async function stopTunnel(chatId: number): Promise<void> {
  const entry = tunnels.get(chatId)
  if (!entry) return

  logger.info('tunnel', `Stopping tunnel for chat ${chatId}`)
  entry.state.isActive = false

  try {
    entry.process.kill()
    await Promise.race([
      entry.process.exited,
      new Promise(resolve => setTimeout(resolve, 3000)),
    ])
  } catch (err) {
    logger.warn('tunnel', `Error stopping tunnel: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  tunnels.delete(chatId)
}

function getTunnel(chatId: number): TunnelState | null {
  const entry = tunnels.get(chatId)
  return entry?.state ?? null
}

async function stopAllTunnels(): Promise<void> {
  const chatIds = Array.from(tunnels.keys())
  await Promise.all(chatIds.map(id => stopTunnel(id)))
  logger.info('tunnel', `Stopped all tunnels (${chatIds.length})`)
}

export function createTunnelManager(): TunnelManager {
  return {
    start: startTunnel,
    stop: stopTunnel,
    get: getTunnel,
    stopAll: stopAllTunnels,
    isCloudflaredInstalled: checkCloudflaredInstalled,
  }
}
