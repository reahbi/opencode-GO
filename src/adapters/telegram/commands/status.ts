import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'
import type { TunnelManager } from '../../../app/usecases/tunnelManager.js'

export function statusCommand(state: StateStore, openCode: OpenCodePort, instanceName?: string, tunnel?: TunnelManager) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const chatState = await state.getChatState(chatId)
    const healthy = await openCode.healthCheck()

    const tunnelState = tunnel?.get(chatId)
    const tunnelActive = tunnelState?.isActive && tunnelState?.url

    const lines = [
      `<b>Status</b>${instanceName ? ` — ${instanceName}` : ''}`,
      `Server: ${healthy ? '🟢 Online' : '🔴 Offline'}`,
      `Project: <code>${chatState.activeProjectDirectory ?? 'None'}</code>`,
      `Session: <code>${chatState.activeSessionId ?? 'None'}</code>`,
      `Agent: <code>${chatState.activeAgent ?? 'default'}</code>`,
      `Pending interactions: ${chatState.pendingInteractions.length}`,
    ]

    if (tunnelActive) {
      lines.push(`Tunnel: 🟢 <code>${tunnelState.url}</code>`)
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
