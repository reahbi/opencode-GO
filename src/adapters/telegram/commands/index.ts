import { InlineKeyboard } from 'grammy'
import type { BotInstance } from '../bot.js'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { ChatQueue } from '../../../app/queue/chatQueue.js'
import { newCommand } from './new.js'
import { listCommand, buildSessionListText, buildSessionListKeyboard } from './list.js'
import { resumeCommand } from './resume.js'
import { abortCommand } from './abort.js'
import { historyCommand } from './history.js'
import { helpCommand } from './help.js'
import { startCommand } from './start.js'
import { statusCommand } from './status.js'
import { agentsCommand } from './agents.js'
import { settingsCommand, settingsText, settingsKeyboard } from './settings.js'
import { createSessionCommands } from '../../../app/usecases/sessionCommands.js'
import { createPromptFlow } from '../../../app/usecases/promptFlow.js'
import { createInteractiveFlow } from '../../../app/usecases/interactiveFlow.js'
import { createSummaryService } from '../../opencode/summaryService.js'
import { parseCallback } from '../ui/callbacks.js'
import type { ModelInfo } from '../../../domain/ports/OpenCodePort.js'
import { escapeHtml } from '../../../shared/formatResponse.js'
import { logger } from '../../../shared/logger.js'
import { LIMITS } from '../../../app/policies/limits.js'

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
  instanceName?: string
}

export function registerCommands(deps: RegisterCommandsDeps): void {
  const { bot, openCode, state, output, queue } = deps

  const summary = createSummaryService(openCode)
  const sessionCommands = createSessionCommands({ openCode, state, output })
  const interactiveFlow = createInteractiveFlow({ openCode, state, output })
  const promptFlow = createPromptFlow({
    openCode,
    state,
    output,
    summary,
    onPermissionAsked: (cid, e) => interactiveFlow.handlePermissionEvent(cid, e),
    onQuestionAsked: (cid, e) => interactiveFlow.handleQuestionEvent(cid, e),
  })

  // Register commands
  bot.command('new', newCommand(sessionCommands))
  bot.command('list', listCommand(sessionCommands))
  bot.command('resume', resumeCommand(sessionCommands))
  bot.command('abort', abortCommand(sessionCommands))
  bot.command('history', historyCommand(sessionCommands, output))
  bot.command('help', helpCommand(deps.instanceName))
  bot.command('start', startCommand(state, openCode, deps.instanceName))
  bot.command('status', statusCommand(state, openCode, deps.instanceName))
  bot.command('agents', agentsCommand(state, openCode))
  bot.command('settings', settingsCommand(state))

  // Handle callback queries (permission/question buttons)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id
    await ctx.answerCallbackQuery().catch(() => {})

    if (!chatId) {
      logger.warn('bot', `Callback without chat: ${data}`)
      return
    }

    logger.info('bot', `Callback received: ${data}`)
    const parsed = parseCallback(data)

    switch (parsed.type) {
      case 'permission':
        await interactiveFlow.handlePermissionCallback(chatId, parsed.interactionId, parsed.response)
        break
      case 'question_answer':
        await interactiveFlow.handleQuestionAnswer(chatId, parsed.interactionId, parsed.questionIndex, parsed.answerIndex)
        break
      case 'question_skip':
        await interactiveFlow.handleQuestionSkip(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_type':
        await interactiveFlow.handleQuestionType(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_back':
        await interactiveFlow.handleQuestionBack(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_confirm':
        await interactiveFlow.handleQuestionConfirm(chatId, parsed.interactionId)
        break
      case 'question_reset':
        await interactiveFlow.handleQuestionReset(chatId, parsed.interactionId)
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
              `📏 Enter summary trigger threshold in characters.\nResponses longer than this will be summarized.\n(Summary output is always compact ~${LIMITS.SUMMARY_OUTPUT_TARGET} chars)\n\nCurrent: ${chatState.settings.summaryThreshold.toLocaleString()} chars\nExamples: 3000, 6000, 10000`,
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
          case 'histformat':
            chatState.settings.historyFormat = chatState.settings.historyFormat === 'html' ? 'md' : 'html'
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(settingsText(chatState.settings), { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
            break
          case 'histlimit':
            chatState.awaitingInput = 'histlimit'
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(
              [
                '📜 <b>History Export — Message Limit</b>',
                '',
                'How many messages to include when exporting session history?',
                '',
                `Current: <b>${chatState.settings.historyLimit ? `Last ${chatState.settings.historyLimit} messages` : 'All messages (full history)'}</b>`,
                '',
                'Reply with:',
                '  • A number (e.g. <code>20</code>, <code>50</code>) — export only the most recent N messages',
                '  • <code>0</code> or <code>all</code> — export the entire conversation',
              ].join('\n'),
              { parse_mode: 'HTML' }
            )
            break
          case 'back':
            await ctx.editMessageText(settingsText(chatState.settings), { parse_mode: 'HTML', reply_markup: settingsKeyboard() })
            break
        }
        break
      }
      case 'listpage': {
        try {
          const pageData = await sessionCommands.getSessionPage(chatId, parsed.page)
          if (!pageData || pageData.items.length === 0) {
            await ctx.editMessageText('No sessions found.', { parse_mode: 'HTML' })
          } else {
            await ctx.editMessageText(buildSessionListText(pageData), {
              parse_mode: 'HTML',
              reply_markup: buildSessionListKeyboard(pageData),
            })
          }
        } catch {
          await ctx.editMessageText('Failed to load sessions.', { parse_mode: 'HTML' })
        }
        break
      }
      case 'listsel': {
        try {
          const title = await sessionCommands.resumeSessionById(chatId, parsed.sessionId)
          if (title) {
            const histKb = new InlineKeyboard().text('📜 대화내역 받기', `hist:${parsed.sessionId}`)
            await ctx.editMessageText(`✅ Resumed: <b>${escapeHtml(title)}</b>`, {
              parse_mode: 'HTML',
              reply_markup: histKb,
            })
          } else {
            await ctx.editMessageText('Session not found.', { parse_mode: 'HTML' })
          }
        } catch {
          await ctx.editMessageText('Failed to resume session.', { parse_mode: 'HTML' })
        }
        break
      }
      case 'history': {
        try {
          await ctx.editMessageText('📝 대화내역을 생성 중...')
          const histResult = await sessionCommands.exportSessionHistory(chatId, parsed.sessionId)
          if (!histResult) {
            await output.sendText(chatId, '대화내역이 없거나 세션을 찾을 수 없습니다.')
            break
          }
          const buf = Buffer.from(histResult.content, 'utf-8')
          const safeTitle = histResult.title.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40)
          const ext = histResult.format
          await output.sendFile(chatId, buf, `${safeTitle}.${ext}`, `📜 ${histResult.title}`)
        } catch {
          await output.sendText(chatId, '대화내역 생성에 실패했습니다.')
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
    if (chatState.awaitingInput === 'question') {
      chatState.awaitingInput = null
      await state.saveChatState(chatId, chatState)
      await interactiveFlow.handleFreeTextAnswer(chatId, text)
      return
    }
    if (chatState.awaitingInput === 'threshold') {
      chatState.awaitingInput = null
      const num = parseInt(text.trim(), 10)
      if (!Number.isFinite(num) || num < LIMITS.SUMMARY_MIN_TRIGGER || num > 50000) {
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, `Invalid value. Enter a number between ${LIMITS.SUMMARY_MIN_TRIGGER.toLocaleString()} and 50,000, or send /settings to go back.`)
        return
      }
      chatState.settings.summaryThreshold = num
      await state.saveChatState(chatId, chatState)
      await output.sendText(chatId, `✅ Summary threshold set to ${num.toLocaleString()} chars.`)
      return
    }
    if (chatState.awaitingInput === 'histlimit') {
      chatState.awaitingInput = null
      const trimmed = text.trim().toLowerCase()
      if (trimmed === 'all' || trimmed === '0') {
        chatState.settings.historyLimit = null
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, '✅ History export: all messages (full history)')
        return
      }
      const num = parseInt(trimmed, 10)
      if (!Number.isFinite(num) || num < 1 || num > 10000) {
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, 'Invalid value. Enter a number between 1 and 10,000, or type <code>all</code> / <code>0</code>.', 'HTML')
        return
      }
      chatState.settings.historyLimit = num
      await state.saveChatState(chatId, chatState)
      await output.sendText(chatId, `✅ History export: last ${num} messages only`)
      return
    }

    // Fire-and-forget: DO NOT await — Grammy processes updates sequentially,
    // so awaiting a long SSE stream blocks all subsequent updates (callback_query etc.)
    void queue.enqueue(chatId, () => promptFlow.handleUserMessage(chatId, text))
      .catch(err => logger.error('bot', `Prompt job failed: ${err instanceof Error ? err.message : err}`))
  })
}
