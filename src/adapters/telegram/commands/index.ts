import { InlineKeyboard } from 'grammy'
import type { BotInstance } from '../bot.js'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { ChatQueue } from '../../../app/queue/chatQueue.js'
import { newCommand } from './new.js'
import { listCommand } from './list.js'
import { resumeCommand } from './resume.js'
import { abortCommand } from './abort.js'
import { helpCommand } from './help.js'
import { statusCommand } from './status.js'
import { agentsCommand } from './agents.js'
import { settingsCommand, settingsText, settingsKeyboard } from './settings.js'
import { createSessionCommands } from '../../../app/usecases/sessionCommands.js'
import { createPromptFlow } from '../../../app/usecases/promptFlow.js'
import { createInteractiveFlow } from '../../../app/usecases/interactiveFlow.js'
import { createSummaryService } from '../../opencode/summaryService.js'
import { parseCallback } from '../ui/callbacks.js'
import type { ModelInfo } from '../../../domain/ports/OpenCodePort.js'
import { logger } from '../../../shared/logger.js'

const EXCLUDE_MODEL = /embed|tts|audio|image|live/i
const OLD_MODEL = /1\.5-|20240|3-opus|3-sonnet-2024/i
const DATED_PREVIEW = /preview-\d{2}-\d{2}|\d{8}$/i
const LIGHTWEIGHT = /\bflash\b|\blite\b|\bhaiku\b|\bmini\b|\bnano\b/i

function isSummaryCandidate(m: ModelInfo): boolean {
  const id = m.modelID
  if (EXCLUDE_MODEL.test(id)) return false
  if (OLD_MODEL.test(id)) return false
  if (DATED_PREVIEW.test(id)) return false
  if (LIGHTWEIGHT.test(id)) return true
  if (m.providerID === 'opencode') return true
  return false
}

interface RegisterCommandsDeps {
  bot: BotInstance
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  queue: ChatQueue
}

export function registerCommands(deps: RegisterCommandsDeps): void {
  const { bot, openCode, state, output, queue } = deps

  const summary = createSummaryService(openCode)
  const sessionCommands = createSessionCommands({ openCode, state, output })
  const promptFlow = createPromptFlow({ openCode, state, output, summary })
  const interactiveFlow = createInteractiveFlow({ openCode, state, output })

  // Register commands
  bot.command('new', newCommand(sessionCommands))
  bot.command('list', listCommand(sessionCommands))
  bot.command('resume', resumeCommand(sessionCommands))
  bot.command('abort', abortCommand(sessionCommands))
  bot.command('help', helpCommand())
  bot.command('start', helpCommand())
  bot.command('status', statusCommand(state, openCode))
  bot.command('agents', agentsCommand(state, openCode))
  bot.command('settings', settingsCommand(state))

  // Handle callback queries (permission/question buttons)
  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const data = ctx.callbackQuery.data
    const parsed = parseCallback(data)

    await ctx.answerCallbackQuery()

    switch (parsed.type) {
      case 'permission':
        await queue.enqueue(chatId, () =>
          interactiveFlow.handlePermissionCallback(chatId, parsed.interactionId, parsed.response)
        )
        break
      case 'question':
        await queue.enqueue(chatId, () =>
          interactiveFlow.handleQuestionCallback(chatId, parsed.interactionId, parsed.answerIndex)
        )
        break
      case 'agent': {
        const chatState = await state.getChatState(chatId)
        chatState.activeAgent = parsed.agentName
        await state.saveChatState(chatId, chatState)
        await ctx.editMessageText(`Agent switched to <b>${parsed.agentName}</b>`, { parse_mode: 'HTML' })
        break
      }
      case 'settings': {
        const chatState = await state.getChatState(chatId)
        switch (parsed.action) {
          case 'format':
            chatState.settings.outputMode = chatState.settings.outputMode === 'formatted' ? 'raw' : 'formatted'
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(settingsText(chatState.settings), { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
            break
          case 'summary':
            chatState.settings.summaryMode = !chatState.settings.summaryMode
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(settingsText(chatState.settings), { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
            break
          case 'threshold':
            chatState.awaitingInput = 'threshold'
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(
              `📏 Enter summary threshold in characters.\nResponses longer than this will be summarized.\n\nCurrent: ${chatState.settings.summaryThreshold.toLocaleString()} chars\nExamples: 2000, 4000, 8000, 15000`,
              { parse_mode: 'HTML' }
            )
            break
          case 'model': {
            try {
              const allModels = await openCode.listModels(chatState.activeProjectDirectory || '')
              const summaryModels = allModels.filter(isSummaryCandidate)
              const kb = new InlineKeyboard()
              for (const m of summaryModels) {
                kb.text(`${m.name} (${m.providerID})`, `sm:${m.providerID}/${m.modelID}`).row()
              }
              kb.text('◀️ Back', 'settings:back')
              await ctx.editMessageText('🤖 Select summary model:', { parse_mode: 'HTML', reply_markup: kb })
            } catch {
              await ctx.editMessageText('Failed to load models. Is the OpenCode server running?', { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
            }
            break
          }
          case 'back':
            await ctx.editMessageText(settingsText(chatState.settings), { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
            break
        }
        break
      }
      case 'selectmodel': {
        const chatState = await state.getChatState(chatId)
        const slashIdx = parsed.value.indexOf('/')
        if (slashIdx > 0) {
          chatState.settings.summaryModel = {
            providerID: parsed.value.slice(0, slashIdx),
            modelID: parsed.value.slice(slashIdx + 1),
          }
          await state.saveChatState(chatId, chatState)
        }
        await ctx.editMessageText(settingsText(chatState.settings), { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
        break
      }
      default:
        break
    }
  })

  // Handle text messages (prompts to OpenCode)
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id
    const text = ctx.message.text
    if (text.startsWith('/')) return

    const chatState = await state.getChatState(chatId)
    if (chatState.awaitingInput === 'threshold') {
      chatState.awaitingInput = null
      const num = parseInt(text.trim(), 10)
      if (!Number.isFinite(num) || num < 500 || num > 50000) {
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, 'Invalid value. Enter a number between 500 and 50000, or send /settings to go back.')
        return
      }
      chatState.settings.summaryThreshold = num
      await state.saveChatState(chatId, chatState)
      await output.sendText(chatId, `✅ Summary threshold set to ${num.toLocaleString()} chars.`)
      return
    }

    try {
      await queue.enqueue(chatId, () => promptFlow.handleUserMessage(chatId, text))
    } catch (err) {
      logger.error('bot', `Unhandled message error: ${err instanceof Error ? err.message : err}`)
    }
  })
}
