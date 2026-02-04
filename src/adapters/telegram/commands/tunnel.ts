import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { TunnelManager } from '../../../app/usecases/tunnelManager.js'
import { escapeHtml } from '../../../shared/formatResponse.js'

const COMMON_PORTS = [
  { port: 3000, label: '3000 (React/Next)' },
  { port: 5173, label: '5173 (Vite)' },
  { port: 8080, label: '8080 (General)' },
  { port: 4000, label: '4000 (GraphQL)' },
]

export function tunnelCommand(tunnel: TunnelManager) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const match = ctx.match as string | undefined
    const arg = match?.trim()

    if (arg === 'stop') {
      const current = tunnel.get(chatId)
      if (!current?.isActive) {
        await ctx.reply('No active tunnel.')
        return
      }
      await tunnel.stop(chatId)
      await ctx.reply('Tunnel stopped.')
      return
    }

    if (arg && /^\d+$/.test(arg)) {
      const port = parseInt(arg, 10)
      if (port < 1 || port > 65535) {
        await ctx.reply('Invalid port. Enter a number between 1-65535.')
        return
      }
      await startTunnelWithFeedback(ctx, chatId, port, tunnel)
      return
    }

    const current = tunnel.get(chatId)
    if (current?.isActive && current.url) {
      const lines = [
        '<b>Tunnel Active</b>',
        '',
        `<code>${current.url}</code>`,
        '',
        `Port: ${current.port}`,
      ]
      const kb = new InlineKeyboard()
        .url('Open', current.url)
        .text('Stop', 'tunnel:stop')
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
      return
    }

    const installed = await tunnel.isCloudflaredInstalled()
    if (!installed) {
      const lines = [
        '<b>cloudflared not installed</b>',
        '',
        'Install it first:',
        '',
        '<b>Linux/WSL:</b>',
        '<code>curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared</code>',
        '',
        '<b>macOS:</b>',
        '<code>brew install cloudflared</code>',
        '',
        '<b>Windows:</b>',
        '<code>winget install Cloudflare.cloudflared</code>',
      ]
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
      return
    }

    const kb = new InlineKeyboard()
    for (const { port, label } of COMMON_PORTS) {
      kb.text(label, `tunnel:${port}`).row()
    }
    kb.text('Enter custom port...', 'tunnel:custom')

    await ctx.reply('<b>Select port to tunnel:</b>', { parse_mode: 'HTML', reply_markup: kb })
  }
}

export async function startTunnelWithFeedback(
  ctx: Context,
  chatId: number,
  port: number,
  tunnel: TunnelManager,
): Promise<void> {
  const msg = await ctx.reply(`Starting tunnel on port ${port}...`)

  try {
    const state = await tunnel.start(chatId, port)

    if (state.url) {
      const lines = [
        '<b>Tunnel Active</b>',
        '',
        `<code>${state.url}</code>`,
        '',
        `Port: ${port}`,
      ]
      const kb = new InlineKeyboard()
        .url('Open', state.url)
        .text('Stop', 'tunnel:stop')

      await ctx.api.editMessageText(chatId, msg.message_id, lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
    } else {
      await ctx.api.editMessageText(
        chatId,
        msg.message_id,
        `Tunnel started on port ${port}, but URL not detected. Check cloudflared logs.`,
      )
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    await ctx.api.editMessageText(chatId, msg.message_id, `Failed to start tunnel: ${escapeHtml(errMsg)}`)
  }
}

export async function handleTunnelPortInput(
  ctx: Context,
  text: string,
  state: StateStore,
  tunnel: TunnelManager,
): Promise<boolean> {
  const chatId = ctx.chat?.id
  if (!chatId) return false

  const chatState = await state.getChatState(chatId)
  if (chatState.awaitingInput !== 'tunnel_port') return false

  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  const port = parseInt(text.trim(), 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    await ctx.reply('Invalid port. Enter a number between 1-65535, or use /tunnel to select.')
    return true
  }

  await startTunnelWithFeedback(ctx, chatId, port, tunnel)
  return true
}
