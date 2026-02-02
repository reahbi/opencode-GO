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
      await ctx.reply('활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
      return
    }

    try {
      const agents = await openCode.listAgents(chatState.activeProjectDirectory)
      if (agents.length === 0) {
        await ctx.reply('사용 가능한 에이전트가 없습니다.')
        return
      }

      const current = chatState.activeAgent
      const keyboard = new InlineKeyboard()

      for (const agent of agents) {
        const isActive = agent.name === current
        const label = isActive ? `✅ ${agent.name}` : agent.name
        keyboard.text(label, `agent:${agent.name}`).row()
      }

      const lines = [`<b>에이전트 선택</b>`]
      if (current) {
        lines.push(`현재: <code>${current}</code>`)
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
      await ctx.reply(`에이전트 목록 조회 실패: ${message}`)
    }
  }
}
