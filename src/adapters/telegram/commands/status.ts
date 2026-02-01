import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'

export function statusCommand(state: StateStore, openCode: OpenCodePort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const chatState = await state.getChatState(chatId)
    const healthy = await openCode.healthCheck()
    const lines = [
      `<b>Status</b>`,
      `Server: ${healthy ? '🟢 Online' : '🔴 Offline'}`,
      `Project: <code>${chatState.activeProjectDirectory ?? 'None'}</code>`,
      `Session: <code>${chatState.activeSessionId ?? 'None'}</code>`,
      `Agent: <code>${chatState.activeAgent ?? 'default'}</code>`,
      `Pending interactions: ${chatState.pendingInteractions.length}`,
    ]
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }
}
