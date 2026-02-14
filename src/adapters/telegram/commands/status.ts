import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { TunnelManager } from '../../../app/usecases/tunnelManager.js'
import { escapeHtml } from '../../../shared/formatResponse.js'

export function statusCommand(state: StateStore, instanceName?: string, tunnel?: TunnelManager) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const chatState = await state.getChatState(chatId)

    const tunnelState = tunnel?.get(chatId)
    const tunnelActive = tunnelState?.isActive && tunnelState?.url

    const dir = chatState.activeProjectDirectory || '(not set)'
    const sid = chatState.activeSessionId || '(none)'
    const agent = chatState.activeAgent || 'default'
    const cost = chatState.sessionCostUsd !== undefined ? `$${chatState.sessionCostUsd.toFixed(4)}` : '—'

    const lines = [
      `📊 <b>Status</b>${instanceName ? ` [${escapeHtml(instanceName)}]` : ''}`,
      '',
      `📁 Project: <code>${escapeHtml(dir)}</code>`,
      `💬 Session: <code>${escapeHtml(sid)}</code>`,
      `🤖 Agent: ${escapeHtml(agent)}`,
      `💰 Session cost: ${cost}`,
      `📋 Pending interactions: ${chatState.pendingInteractions.length}`,
    ]

    if (tunnelActive) {
      lines.push(`🌐 Tunnel: <code>${escapeHtml(tunnelState.url!)}</code>`)
    }

    if (tunnelActive) {
      const kb = new InlineKeyboard()
        .url('🔗 Preview', tunnelState.url!)
        .text('⏹ Stop', 'tunnel:stop')
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
    } else {
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    }
  }
}
