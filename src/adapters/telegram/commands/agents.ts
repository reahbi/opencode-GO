import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'

export function agentsCommand(state: StateStore, openCode: OpenCodePort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)
    if (!chatState.activeProjectDirectory) {
      await ctx.reply('No active project. Set DEFAULT_PROJECT in .env.')
      return
    }

    try {
      const agents = await openCode.listAgents(chatState.activeProjectDirectory)
      if (agents.length === 0) {
        await ctx.reply('No available agents.')
        return
      }

      const current = chatState.activeAgent
      const keyboard = new InlineKeyboard()

      for (const agent of agents) {
        const isActive = agent.name === current
        const label = isActive ? `✅ ${agent.name}` : agent.name
        keyboard.text(label, `agent:${agent.name}`).row()
      }

      const lines = [`<b>Select Agent</b>`]
      if (current) {
        lines.push(`Current: <code>${current}</code>`)
      }
      lines.push('')
      for (const agent of agents) {
        const prefix = agent.name === current ? '▸ ' : '  '
        const desc = agent.description ? ` — ${agent.description}` : ''
        lines.push(`${prefix}<b>${agent.name}</b>${desc}`)
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await ctx.reply(`Failed to load agents: ${message}`)
    }
  }
}
