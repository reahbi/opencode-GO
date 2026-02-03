import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
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
import {
  settingsCommand, resolveReviewMode,
  settingsMainText, settingsMainKeyboard,
  agentSubText, agentSubKeyboard,
  summarySubText, summarySubKeyboard,
  outputSubText, outputSubKeyboard,
  historySubText, historySubKeyboard,
} from './settings.js'
import {
  groupSettingsCommand,
  groupSettingsMainText, groupSettingsMainKeyboard,
  debateSubText, debateSubKeyboard,
  botsSubText, botsSubKeyboard,
  filterBotsInChat,
} from './groupsettings.js'
import { debateCommand } from './debate.js'
import { reviewCommand } from './review.js'
import { botsCommand } from './bots.js'
import { addbotCommand, handleAddbotToken, handleAddbotRoleCallback, handleAddbotProjectCallback, handleAddbotProjectText, handleAddbotStartCallback, cancelAddbotWizard } from './addbot.js'
import { createSessionCommands } from '../../../app/usecases/sessionCommands.js'
import { createPromptFlow } from '../../../app/usecases/promptFlow.js'
import { createInteractiveFlow } from '../../../app/usecases/interactiveFlow.js'
import { createDebateFlow } from '../../../app/usecases/debateFlow.js'
import { createSessionWatcher } from '../../../app/usecases/sessionWatcher.js'
import { createSummaryService } from '../../opencode/summaryService.js'
import { parseCallback } from '../ui/callbacks.js'
import type { ModelInfo } from '../../../domain/ports/OpenCodePort.js'
import { escapeHtml } from '../../../shared/formatResponse.js'
import { logger } from '../../../shared/logger.js'
import { LIMITS } from '../../../app/policies/limits.js'

function stripBotMention(text: string, botUsername: string): string {
  if (!botUsername) return text
  const pattern = new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'gi')
  return text.replace(pattern, '').trim()
}

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
  botUsername?: string
  coordination?: import('../../../domain/ports/CoordinationPort.js').CoordinationPort
  botRole?: 'writer' | 'reader' | 'standalone'
  registry?: import('../../../domain/ports/BotRegistryPort.js').BotRegistryPort
  groupSettings?: import('../../../domain/ports/GroupSettingsPort.js').GroupSettingsPort
  serverUrl?: string
  serverUsername?: string
  serverPassword?: string
  debateFlow?: ReturnType<typeof createDebateFlow>
}

export function registerCommands(deps: RegisterCommandsDeps): void {
  const { bot, openCode, state, output, queue } = deps

  const summary = createSummaryService(openCode)
  const sessionCommands = createSessionCommands({ openCode, state, output })
  const interactiveFlow = createInteractiveFlow({ openCode, state, output, botRole: deps.botRole })
  const watcher = createSessionWatcher({
    openCode, state, output, summary,
    onPermissionAsked: (cid, e, uid) => interactiveFlow.handlePermissionEvent(cid, e, uid),
    onQuestionAsked: (cid, e, uid) => interactiveFlow.handleQuestionEvent(cid, e, uid),
    isDebateActive: deps.debateFlow ? (chatId) => deps.debateFlow!.isActive(chatId) : undefined,
  })
  const promptFlow = createPromptFlow({
    openCode, state, output, watcher,
    botRole: deps.botRole,
  })

  const mentionCommandMap = new Map<string, (ctx: Context) => Promise<void>>()

  function reg(name: string, handler: (ctx: Context) => Promise<void>) {
    bot.command(name, handler)
    mentionCommandMap.set(name, handler)
  }

  reg('new', async (ctx) => {
    await newCommand(sessionCommands)(ctx)
    const chatId = ctx.chat?.id
    if (chatId) await watcher.watch(chatId)
  })
  reg('list', listCommand(sessionCommands))
  reg('resume', async (ctx) => {
    await resumeCommand(sessionCommands)(ctx)
    const chatId = ctx.chat?.id
    if (chatId) await watcher.watch(chatId)
  })
  reg('abort', async (ctx) => {
    const chatId = ctx.chat?.id
    if (chatId) watcher.stop(chatId)
    await abortCommand(sessionCommands)(ctx)
  })
  reg('history', historyCommand(sessionCommands, output))
  reg('help', helpCommand(deps.instanceName))
  reg('start', startCommand(state, openCode, deps.instanceName))
  reg('status', statusCommand(state, openCode, deps.instanceName))
  reg('agents', agentsCommand(state, openCode))
  reg('settings', settingsCommand(state, openCode, deps.instanceName, deps.botRole))

  if (deps.debateFlow) {
    reg('debate', debateCommand(deps.debateFlow, deps.botRole || 'standalone'))
    reg('review', reviewCommand(deps.debateFlow, deps.botRole || 'standalone'))
  }

  if (deps.registry) {
    reg('bots', botsCommand(deps.registry))
    reg('addbot', addbotCommand(state))
  }

  if (deps.groupSettings && deps.registry && deps.instanceName) {
    reg('groupsettings', groupSettingsCommand(deps.groupSettings, deps.registry, deps.instanceName))
  }

  reg('cancel', async (ctx) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    cancelAddbotWizard(chatId)
    const chatState = await state.getChatState(chatId)
    if (chatState.awaitingInput === 'addbot_token' || chatState.awaitingInput === 'addbot_project') {
      chatState.awaitingInput = null
      await state.saveChatState(chatId, chatState)
      await ctx.reply('❌ 취소되었습니다.')
    }
  })

  // Handle callback queries (permission/question buttons)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id
    await ctx.answerCallbackQuery().catch(() => {})

    if (!chatId) {
      logger.warn('bot', `Callback without chat: ${data}`)
      return
    }

    const cbChatType = ctx.chat?.type ?? ctx.callbackQuery.message?.chat.type
    const isGroupCb = cbChatType === 'group' || cbChatType === 'supergroup'
    const groupInstanceName = isGroupCb ? deps.instanceName : undefined

    logger.info('bot', `Callback received: ${data}`)
    const parsed = parseCallback(data)

    if (isGroupCb && 'interactionId' in parsed) {
      const chatState = await state.getChatState(chatId)
      const interaction = chatState.pendingInteractions.find(i => i.interactionId === parsed.interactionId)
      if (interaction?.creatorUserId && interaction.creatorUserId !== ctx.callbackQuery.from.id) {
        await ctx.answerCallbackQuery({ text: '이 요청의 대상자가 아닙니다.', show_alert: true }).catch(() => {})
        return
      }
    }

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
        await ctx.editMessageText(`Agent switched to <b>${escapeHtml(parsed.agentName)}</b>`, { parse_mode: 'HTML' })
        break
      }
      case 'settings_agent': {
        const chatState = await state.getChatState(chatId)
        chatState.activeAgent = parsed.agentName
        await state.saveChatState(chatId, chatState)
        try {
          const agents = await openCode.listAgents(chatState.activeProjectDirectory || '')
          await ctx.editMessageText(
            agentSubText(agents, parsed.agentName, chatState.settings, deps.botRole),
            { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, parsed.agentName) },
          )
        } catch {
          await ctx.editMessageText(`Agent switched to <b>${escapeHtml(parsed.agentName)}</b>`, { parse_mode: 'HTML' })
        }
        break
      }
      case 'settings': {
        const chatState = await state.getChatState(chatId)
        switch (parsed.action) {
          case 'sub_agent': {
            try {
              const agents = await openCode.listAgents(chatState.activeProjectDirectory || '')
              await ctx.editMessageText(
                agentSubText(agents, chatState.activeAgent, chatState.settings, deps.botRole),
                { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, chatState.activeAgent) },
              )
            } catch {
              await ctx.editMessageText('에이전트 목록 조회 실패.', { parse_mode: 'HTML' })
            }
            break
          }
          case 'sub_summary':
            await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard() })
            break
          case 'sub_output':
            await ctx.editMessageText(outputSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: outputSubKeyboard() })
            break
          case 'sub_history':
            await ctx.editMessageText(historySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: historySubKeyboard() })
            break
          case 'review': {
            const current = resolveReviewMode(chatState.settings, deps.botRole)
            chatState.settings.reviewMode = !current
            await state.saveChatState(chatId, chatState)
            try {
              const agents = await openCode.listAgents(chatState.activeProjectDirectory || '')
              await ctx.editMessageText(
                agentSubText(agents, chatState.activeAgent, chatState.settings, deps.botRole),
                { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, chatState.activeAgent) },
              )
            } catch {
              await ctx.editMessageText(`Review Mode: ${!current ? 'ON 🔒' : 'OFF'}`, { parse_mode: 'HTML' })
            }
            break
          }
          case 'format':
            chatState.settings.outputMode = chatState.settings.outputMode === 'formatted' ? 'raw' : 'formatted'
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(outputSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: outputSubKeyboard() })
            break
          case 'summary':
            chatState.settings.summaryMode = !chatState.settings.summaryMode
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard() })
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
              kb.text('◀️ Back', 'settings:sub_summary')
              await ctx.editMessageText('🤖 Select summary model:', { parse_mode: 'HTML', reply_markup: kb })
            } catch {
              await ctx.editMessageText('Failed to load models.', { parse_mode: 'HTML', reply_markup: summarySubKeyboard() })
            }
            break
          }

          case 'histformat':
            chatState.settings.historyFormat = chatState.settings.historyFormat === 'html' ? 'md' : 'html'
            await state.saveChatState(chatId, chatState)
            await ctx.editMessageText(historySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: historySubKeyboard() })
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
          case 'back': {
            let healthy = false
            try { healthy = await openCode.healthCheck() } catch { /* offline */ }
            await ctx.editMessageText(
              settingsMainText(chatState.settings, {
                healthy,
                hasSession: !!chatState.activeSessionId,
                activeAgent: chatState.activeAgent,
                instanceName: groupInstanceName,
                botRole: deps.botRole,
              }),
              { parse_mode: 'HTML', reply_markup: settingsMainKeyboard() },
            )
            break
          }
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
            await watcher.watch(chatId)
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
      case 'addbot_role': {
        if (deps.registry) {
          await handleAddbotRoleCallback(
            chatId, parsed.role, state, output,
            deps.serverUrl ?? '',
            deps.serverUsername ?? 'opencode',
            deps.serverPassword ?? '',
          )
        }
        break
      }
      case 'addbot_project': {
        if (deps.registry) {
          await handleAddbotProjectCallback(
            chatId, parsed.projectDir, state, output,
            deps.registry,
            deps.serverUrl ?? '',
          )
        }
        break
      }
      case 'addbot_start': {
        await handleAddbotStartCallback(chatId, parsed.instanceName, output)
        break
      }
      case 'debate_accept': {
        if (deps.debateFlow) await deps.debateFlow.handleAcceptance(chatId, parsed.debateId)
        break
      }
      case 'debate_reject': {
        if (deps.debateFlow) await deps.debateFlow.handleRejection(chatId, parsed.debateId)
        break
      }
      case 'groupsettings': {
        if (!deps.groupSettings || !deps.registry) break
        const gs = await deps.groupSettings.getGroupSettings()
        switch (parsed.action) {
          case 'sub_debate':
            await ctx.editMessageText(debateSubText(gs), { parse_mode: 'HTML', reply_markup: debateSubKeyboard() })
            break
          case 'dr': {
            const rounds = parseInt(parsed.value ?? '', 10)
            if (Number.isFinite(rounds) && rounds >= 0) {
              gs.debateRounds = rounds
              await deps.groupSettings.saveGroupSettings(gs)
            }
            const updated = await deps.groupSettings.getGroupSettings()
            await ctx.editMessageText(debateSubText(updated), { parse_mode: 'HTML', reply_markup: debateSubKeyboard() })
            break
          }
          case 'debaterounds': {
            const gsChatState = await state.getChatState(chatId)
            gsChatState.awaitingInput = 'debaterounds'
            await state.saveChatState(chatId, gsChatState)
            await ctx.editMessageText(
              `🎭 토론 라운드 수를 입력하세요.\n\n0 = 무제한\n\n현재: ${gs.debateRounds === 0 ? '♾️ Unlimited' : `${gs.debateRounds} rounds`}`,
              { parse_mode: 'HTML' },
            )
            break
          }
          case 'sub_bots': {
            const allBots = await deps.registry.list()
            const bots = await filterBotsInChat(ctx, chatId, allBots)
            await ctx.editMessageText(botsSubText(bots), { parse_mode: 'HTML', reply_markup: botsSubKeyboard() })
            break
          }
          case 'back': {
            const allBots = await deps.registry.list()
            const bots = await filterBotsInChat(ctx, chatId, allBots)
            await ctx.editMessageText(
              groupSettingsMainText(gs, bots),
              { parse_mode: 'HTML', reply_markup: groupSettingsMainKeyboard() },
            )
            break
          }
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
        await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard() })
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
    if (chatState.awaitingInput === 'addbot_token') {
      const handled = await handleAddbotToken(chatId, text, state, output)
      if (handled) return
    }
    if (chatState.awaitingInput === 'addbot_project') {
      if (deps.registry) {
        const handled = await handleAddbotProjectText(chatId, text, state, output, deps.registry, deps.serverUrl ?? '')
        if (handled) return
      }
    }
    if (chatState.awaitingInput === 'debaterounds') {
      chatState.awaitingInput = null
      const num = parseInt(text.trim(), 10)
      if (!Number.isFinite(num) || num < 0 || num > 999) {
        await state.saveChatState(chatId, chatState)
        await output.sendText(chatId, '0~999 사이의 숫자를 입력하세요. (0 = 무제한)')
        return
      }
      await state.saveChatState(chatId, chatState)
      if (deps.groupSettings) {
        const gs = await deps.groupSettings.getGroupSettings()
        gs.debateRounds = num
        await deps.groupSettings.saveGroupSettings(gs)
      }
      await output.sendText(chatId, `✅ 토론 라운드: ${num === 0 ? '♾️ Unlimited' : `${num} rounds`}`)
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

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    const cleanedText = isGroup ? stripBotMention(text, deps.botUsername ?? '') : text

    if (isGroup && cleanedText.startsWith('/')) {
      const spaceIdx = cleanedText.indexOf(' ')
      const cmdName = spaceIdx > 0 ? cleanedText.slice(1, spaceIdx) : cleanedText.slice(1)
      const cmdArgs = spaceIdx > 0 ? cleanedText.slice(spaceIdx + 1).trim() : ''
      const handler = mentionCommandMap.get(cmdName)
      if (handler) {
        ;(ctx as Record<string, unknown>).match = cmdArgs
        await handler(ctx)
        return
      }
    }

    const actorUserId = ctx.from?.id

    void queue.enqueue(chatId, () => promptFlow.handleUserMessage(chatId, cleanedText, { actorUserId, isGroup }))
      .catch(err => logger.error('bot', `Prompt job failed: ${err instanceof Error ? err.message : err}`))
  })
}
