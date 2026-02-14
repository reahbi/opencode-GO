import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { ClaudeAgentPort } from '../../../domain/ports/ClaudeAgentPort.js'

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function agentsCommand(state: StateStore, claude: ClaudeAgentPort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)
    if (!chatState.activeProjectDirectory) {
      await ctx.reply('No active project. Set DEFAULT_PROJECT in .env.')
      return
    }

    try {
      const models = await claude.getSupportedModels()
      if (models.length === 0) {
        await ctx.reply('No models available.')
        return
      }

      const current = chatState.activeAgent
      const keyboard = new InlineKeyboard()

      for (const model of models) {
        const isActive = model.id === current
        const label = isActive ? `✅ ${model.name}` : model.name
        keyboard.text(label, `agent:${model.id}`).row()
      }

      const lines = [`<b>Select Model</b>`]
      if (current) {
        lines.push(`Current: <code>${escapeHtml(current)}</code>`)
      }
      lines.push('')
      for (const model of models) {
        const prefix = model.id === current ? '▸ ' : '  '
        lines.push(`${prefix}<b>${escapeHtml(model.name)}</b> (<code>${escapeHtml(model.id)}</code>)`)
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await ctx.reply(`Failed to load models: ${message}`)
    }
  }
}
