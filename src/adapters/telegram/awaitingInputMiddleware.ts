import type { Context, NextFunction } from 'grammy'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatState } from '../../domain/models.js'

export const AWAITING_INPUT_LABELS: Record<NonNullable<ChatState['awaitingInput']>, string> = {
  tunnel_port: 'Tunnel port input',
  threshold: 'Summary threshold input',
  histlimit: 'History limit input',
  debaterounds: 'Debate rounds input',
  addbot_token: 'Bot token input',
  addbot_project: 'Project selection',
  makeagent_describe: 'Custom agent description input',
  makeagent_name: 'Custom agent naming input',
  makeagent_edit: 'Custom agent prompt edit input',
  addhookbot_token: 'Hook bot token input',
  addhookbot_chatid: 'Hook bot chat ID input',
  question: 'Question response',
} as const

const NON_DESTRUCTIVE_COMMANDS = new Set([
  'help',
  'status',
  'list',
  'bots',
  'showqueue',
  'cancel',
])

function extractCommandName(text: string, offset: number, length: number): string {
  const cmdWithSlash = text.slice(offset, offset + length)
  return cmdWithSlash.replace(/^\//, '').replace(/@.*$/, '').toLowerCase()
}

export function createAwaitingInputMiddleware(state: StateStore) {
  return async (ctx: Context, next: NextFunction) => {
    const chatId = ctx.chat?.id
    const entities = ctx.message?.entities
    const text = ctx.message?.text

    if (!chatId || !entities || !text) {
      return next()
    }

    const cmdEntity = entities.find(e => e.type === 'bot_command')
    if (!cmdEntity) {
      return next()
    }

    const cmdName = extractCommandName(text, cmdEntity.offset, cmdEntity.length)

    if (NON_DESTRUCTIVE_COMMANDS.has(cmdName)) {
      return next()
    }

    const chatState = await state.getChatState(chatId)
    if (chatState.awaitingInput) {
      const label = AWAITING_INPUT_LABELS[chatState.awaitingInput]
      await ctx.reply(`⚠️ ${label} cancelled.`)

      chatState.awaitingInput = null
      chatState.awaitingInteractionId = null
      await state.saveChatState(chatId, chatState)
    }

    return next()
  }
}
