import { logger } from './logger.js'

export async function pm2Save(): Promise<void> {
  try {
    const proc = Bun.spawn(['pm2', 'save'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
  } catch {
    logger.warn('hookbot', 'pm2 save failed')
  }
}
