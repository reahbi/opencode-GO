import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import { escapeHtml } from '../../../shared/formatResponse.js'

export function startCommand(state: StateStore, instanceName?: string) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)

    const header = instanceName
      ? `<b>Claude-Go</b> — ${instanceName}`
      : `<b>Claude-Go</b>`

    const sessionInfo = chatState.activeSessionId
      ? `Active session — send a message to continue`
      : `No active session — use /new to start one`

    const project = chatState.activeProjectDirectory ?? 'Not set'

    const lines = [
      header,
      '',
      `Remotely control your AI coding assistant via Telegram.`,
      '',
      `<b>Status</b>`,
      `  Claude: 🟢 Ready`,
      `  Project: <code>${escapeHtml(project)}</code>`,
      `  Session: ${sessionInfo}`,
      '',
      `<b>Getting Started</b>`,
      `/new — Create a new session to start chatting with AI`,
      `/help — View all commands`,
      '',
      `Having issues? Run <code>bun run doctor</code> in terminal.`,
    ]

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }
}
