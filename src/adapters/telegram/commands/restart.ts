import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { escapeHtml } from '../../../shared/formatResponse.js'
import { logger } from '../../../shared/logger.js'

interface Pm2Process {
  pm_id: number
  name: string
  pm2_env?: {
    status?: string
    restart_time?: number
  }
  monit?: {
    memory?: number
    cpu?: number
  }
}

async function getPm2List(): Promise<Pm2Process[]> {
  try {
    const proc = Bun.spawn(['pm2', 'jlist'], { stdout: 'pipe', stderr: 'pipe' })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    return JSON.parse(text) as Pm2Process[]
  } catch {
    return []
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function statusEmoji(status: string | undefined): string {
  switch (status) {
    case 'online': return '🟢'
    case 'stopping': return '🟡'
    case 'launching': return '🟡'
    default: return '🔴'
  }
}

function buildProcessList(processes: Pm2Process[]): string {
  if (processes.length === 0) return '<b>PM2</b>\n\nNo processes found.'

  const lines = ['<b>PM2 Processes</b>', '']
  for (const p of processes) {
    const status = p.pm2_env?.status ?? 'unknown'
    const mem = p.monit?.memory ? formatBytes(p.monit.memory) : '-'
    const restarts = p.pm2_env?.restart_time ?? 0
    lines.push(`${statusEmoji(status)} <code>${p.pm_id}</code> <b>${escapeHtml(p.name)}</b>`)
    lines.push(`    ${status} | ${mem} | ↺ ${restarts}`)
  }
  return lines.join('\n')
}

function buildRestartKeyboard(processes: Pm2Process[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const p of processes) {
    kb.text(`↻ ${p.name}`, `restart:${p.pm_id}`).row()
  }
  kb.text('↻ Restart All', 'restart:all').row()
  kb.text('🔄 Refresh', 'restart:refresh')
  return kb
}

export function restartCommand() {
  return async (ctx: Context) => {
    const processes = await getPm2List()
    const text = buildProcessList(processes)
    const kb = buildRestartKeyboard(processes)
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb })
  }
}

export async function handleRestartCallback(ctx: Context, action: string): Promise<void> {
  const chatId = ctx.chat?.id
  if (!chatId) return

  if (action === 'refresh') {
    const processes = await getPm2List()
    const text = buildProcessList(processes)
    const kb = buildRestartKeyboard(processes)
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb })
    return
  }

  const target = action === 'all' ? 'all' : action
  const label = action === 'all' ? 'all processes' : `process #${action}`

  try {
    await ctx.editMessageText(`↻ Restarting ${label}...`)
    const proc = Bun.spawn(['pm2', 'restart', target], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
    logger.info('bot', `PM2 restart: ${target}`)

    await new Promise(r => setTimeout(r, 2000))

    const processes = await getPm2List()
    const text = `✅ Restarted ${label}\n\n${buildProcessList(processes)}`
    const kb = buildRestartKeyboard(processes)
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logger.error('bot', `PM2 restart failed: ${msg}`)
    await ctx.editMessageText(`❌ Restart failed: ${escapeHtml(msg)}`, { parse_mode: 'HTML' })
  }
}
