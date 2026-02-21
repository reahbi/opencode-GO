import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { BotInstance } from '../bot.js'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { ClaudeAgentPort } from '../../../domain/ports/ClaudeAgentPort.js'
import type { SessionStorePort } from '../../../domain/ports/SessionStorePort.js'
import type { SummaryPort } from '../../../domain/ports/SummaryPort.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { ChatQueue } from '../../../app/queue/chatQueue.js'
import { newCommand } from './new.js'
import { listCommand, buildSessionListText, buildSessionListKeyboard } from './list.js'
import { resumeCommand } from './resume.js'
import { abortCommand } from './abort.js'
import { historyCommand } from './history.js'
import { helpCommand } from './help.js'
import { startCommand } from './start.js'
import { planCommand, askCommand, bypassCommand } from './permissionMode.js'
import { statusCommand } from './status.js'
import { agentsCommand } from './agents.js'
import {
  settingsCommand, resolveReviewMode,
  settingsMainText, settingsMainKeyboard,
  agentSubText, agentSubKeyboard, parseSettingsPermissionMode,
  customAgentSubText, customAgentSubKeyboard,
  summarySubText, summarySubKeyboard,
  modelSelectText, modelSelectKeyboard,
  outputSubText, outputSubKeyboard,
  historySubText, historySubKeyboard,
  sessionFilterSubText, sessionFilterSubKeyboard,
  projectSubText, projectSubKeyboard,
  voiceSubText, voiceSubKeyboard,
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
import { addbotCommand, handleAddbotToken, handleAddbotRoleCallback, handleAddbotProjectCallback, handleAddbotProjectText, handleAddbotStartCallback, cancelAddbotWizard, handleAddbotAgentCallback, handleAddbotRemoveCallback, startAddbotWizard, getClaudeCodeProjects } from './addbot.js'
import {
  addhookbotCommand,
  startAddhookbotWizard,
  startAddhookbotReconfigure,
  handleAddhookbotToken,
  handleAddhookbotAllCallback,
  handleAddhookbotProjectCallback as handleAddhookbotProjectCb,
  handleAddhookbotDoneCallback,
  handleAddhookbotChatId,
  handleAddhookbotStartCallback,
  cancelAddhookbotWizard,
  handleAddhookbotRemoveCallback,
} from './addhookbot.js'
import {
  makeagentCommand,
  handleMakeagentDescribe,
  handleMakeagentName,
  handleMakeagentEdit,
  cancelMakeagentWizard,
  startMakeagentSave,
  regenerateMakeagentDraft,
  startMakeagentEdit,
} from './makeagent.js'
import { queueCommand, clearQueueCommand, showQueueCommand } from './queue.js'
import { undoCommand, redoCommand } from './undo.js'
import { tunnelCommand, startTunnelWithFeedback, handleTunnelPortInput } from './tunnel.js'
import { gitCommand, handleGitCallback } from './git.js'
import { restartCommand, handleRestartCallback } from './restart.js'
import { createSessionCommands } from '../../../app/usecases/sessionCommands.js'
import { createPromptFlow } from '../../../app/usecases/promptFlow.js'
import { createInteractiveFlow } from '../../../app/usecases/interactiveFlow.js'
import { createDebateFlow } from '../../../app/usecases/debateFlow.js'
import { createSessionWatcher } from '../../../app/usecases/sessionWatcher.js'
import type { VoiceFlow } from '../../../app/usecases/voiceFlow.js'
import { parseCallback } from '../ui/callbacks.js'
import { escapeHtml } from '../../../shared/formatResponse.js'
import { logger } from '../../../shared/logger.js'
import { LIMITS } from '../../../app/policies/limits.js'

function sanitizeError(msg: string, token: string): string {
  return msg.replaceAll(token, '[BOT_TOKEN]')
}

function stripBotMention(text: string, botUsername: string): string {
  if (!botUsername) return text
  const pattern = new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'gi')
  return text.replace(pattern, '').trim()
}

function getThreadIdFromContext(ctx: Context): number | undefined {
  const chatType = ctx.chat?.type ?? ctx.callbackQuery?.message?.chat.type
  const isGroup = chatType === 'group' || chatType === 'supergroup'
  if (!isGroup) return undefined
  const callbackMsg = ctx.callbackQuery?.message
  if (callbackMsg && 'message_thread_id' in callbackMsg && typeof callbackMsg.message_thread_id === 'number') {
    return callbackMsg.message_thread_id
  }
  return ctx.message?.message_thread_id
}

function getQueueScopeKey(chatId: number, threadId?: number): string {
  return threadId ? `${chatId}:${threadId}` : String(chatId)
}

interface RegisterCommandsDeps {
  bot: BotInstance
  claude: ClaudeAgentPort
  sessionStore: SessionStorePort
  summary: SummaryPort
  state: StateStore
  output: ChatOutputPort
  queue: ChatQueue
  instanceName?: string
  botUsername?: string
  coordination?: import('../../../domain/ports/CoordinationPort.js').CoordinationPort
  botRole?: 'writer' | 'reader' | 'standalone'
  registry?: import('../../../domain/ports/BotRegistryPort.js').BotRegistryPort
  customAgents?: import('../../../domain/ports/CustomAgentPort.js').CustomAgentPort
  groupSettings?: import('../../../domain/ports/GroupSettingsPort.js').GroupSettingsPort
  config: {
    maxThinkingTokens: number
    maxBudgetUsd: number | null
  }
  debateFlow?: ReturnType<typeof createDebateFlow>
  tunnel?: import('../../../app/usecases/tunnelManager.js').TunnelManager
  voiceFlow?: VoiceFlow
  transcription?: import('../../../domain/ports/TranscriptionPort.js').TranscriptionPort
  hookNotify?: (turn: { sessionId: string; directory: string; userPrompt: string; assistantResponse: string; costUsd?: number }) => void
}

export function registerCommands(deps: RegisterCommandsDeps): void {
  const { bot, claude, sessionStore, summary, state, output, queue } = deps

  async function getCustomAgentName(customAgentId: string | null | undefined): Promise<string | null> {
    if (!customAgentId || !deps.customAgents) return null
    const agent = await deps.customAgents.get(customAgentId)
    return agent?.name ?? null
  }

  async function renderSettingsMain(
    chatState: Awaited<ReturnType<StateStore['getChatState']>>,
    healthy: boolean,
    instanceNameOverride?: string,
  ): Promise<{ text: string; keyboard: ReturnType<typeof settingsMainKeyboard> }> {
    const customAgentName = await getCustomAgentName(chatState.customAgentId)
    return {
      text: settingsMainText(chatState.settings, {
        healthy,
        hasSession: !!chatState.activeSessionId,
        activeAgent: chatState.activeAgent,
        customAgentName,
        instanceName: instanceNameOverride,
        botRole: deps.botRole,
        activeProject: chatState.activeProjectDirectory,
      }),
      keyboard: settingsMainKeyboard(),
    }
  }

  // Helper to update agent in registry when agent changes
  async function updateRegistryAgent(agentName: string | null): Promise<void> {
    if (!deps.registry || !deps.instanceName) return
    try {
      const bots = await deps.registry.list()
      const current = bots.find(b => b.instanceName === deps.instanceName)
      if (current) {
        await deps.registry.register({
          ...current,
          currentAgent: agentName ?? undefined,
          lastSeen: Date.now(),
        })
      }
    } catch (err) {
      logger.warn('registry', `Failed to update agent in registry: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  let watcher: ReturnType<typeof createSessionWatcher> | null = null

  const sessionCommands = createSessionCommands({
    sessionStore,
    state,
    output,
    getActiveQueryHandle: (chatId, threadId) => watcher?.getActiveQueryHandle(chatId, threadId) ?? null,
  })

  let interactiveFlow: ReturnType<typeof createInteractiveFlow>
  let promptFlow: ReturnType<typeof createPromptFlow>

  watcher = createSessionWatcher({
    state, output, summary,
    onQuestionAsked: (cid, e, uid, threadId) => interactiveFlow.handleQuestionEvent(cid, e, uid, undefined, threadId),
    onPlanApprovalRequested: (cid, e, uid, directory, threadId) => interactiveFlow.handlePlanApprovalEvent(cid, e, uid, directory, threadId),
    isDebateActive: deps.debateFlow ? (chatId) => deps.debateFlow!.isActive(chatId) : undefined,
    onQueueDrain: async (chatId, messages, threadId) => {
      const scopeKey = getQueueScopeKey(chatId, threadId)
      for (const msg of messages) {
        await queue.enqueue(scopeKey, () =>
          promptFlow.handleUserMessage(chatId, msg.text, { actorUserId: msg.actorUserId, threadId, fromQueueDrain: true })
        )
      }
    },
    tunnel: deps.tunnel,
    voiceFlow: deps.voiceFlow,
    sessionStore,
    hookNotify: deps.hookNotify,
  })

  promptFlow = createPromptFlow({
    claude, state, output, watcher,
    sessionStore,
    botRole: deps.botRole,
    customAgents: deps.customAgents,
    config: deps.config,
  })

  interactiveFlow = createInteractiveFlow({
    state,
    output,
    botRole: deps.botRole,
    onAnswersSubmitted: async (chatId, formattedAnswers, _context, threadId) => {
      const scopeKey = getQueueScopeKey(chatId, threadId)
      await queue.enqueue(scopeKey, () =>
        promptFlow.handleUserMessage(chatId, formattedAnswers, { threadId, fromQueueDrain: false })
      )
    },
    onPlanApproved: async (chatId, options, threadId) => {
      // Plan approved: bypass mode already set by interactiveFlow
      if (options.clearContext) {
        // Clear context = create new session (matches UI message and local Claude CLI behavior)
        try {
          await sessionCommands.abortSession(chatId, threadId)
          watcher?.stop(chatId, threadId)

          // Create new session for plan implementation
          await sessionCommands.createSession(chatId, 'Plan Implementation', threadId)

          await output.sendText(chatId, '🔄 New session created for plan implementation.')
        } catch (err) {
          logger.warn('bot', `Failed to create new session after plan approval: ${err instanceof Error ? err.message : 'unknown'}`)
        }
      }

      // Auto-send approval response to Claude (as if user typed "approved")
      const scopeKey = getQueueScopeKey(chatId, threadId)
      await queue.enqueue(scopeKey, () =>
        promptFlow.handleUserMessage(chatId, 'Approved. Please implement the plan.', { threadId, fromQueueDrain: false })
      )
    },
    onPlanRejected: async (chatId, threadId) => {
      // Plan rejected: stay in plan mode, send rejection response to SDK
      await output.sendText(chatId, '💬 You can continue refining the plan or provide new instructions.')

      // Send rejection message to SDK so it knows the plan was rejected
      const scopeKey = getQueueScopeKey(chatId, threadId)
      await queue.enqueue(scopeKey, () =>
        promptFlow.handleUserMessage(chatId, 'I reviewed the plan and want you to revise it. Please improve the plan based on my feedback.', { threadId, fromQueueDrain: false })
      )
    }
  })

  const mentionCommandMap = new Map<string, (ctx: Context) => Promise<void>>()

  function reg(name: string, handler: (ctx: Context) => Promise<void>) {
    bot.command(name, handler)
    mentionCommandMap.set(name, handler)
  }

  reg('new', async (ctx) => {
    const chatId = ctx.chat?.id
    const threadId = getThreadIdFromContext(ctx)
    if (chatId) {
      cancelAddbotWizard(chatId)
      cancelAddhookbotWizard(chatId)
      cancelMakeagentWizard(chatId)
      await deps.tunnel?.stop(chatId)
    }
    await newCommand(sessionCommands)(ctx)
    if (chatId) await watcher?.watch(chatId, threadId)
  })
  reg('list', listCommand(sessionCommands))
  reg('resume', async (ctx) => {
    const chatId = ctx.chat?.id
    const threadId = getThreadIdFromContext(ctx)
    if (chatId) {
      cancelAddbotWizard(chatId)
      cancelAddhookbotWizard(chatId)
      cancelMakeagentWizard(chatId)
    }
    await resumeCommand(sessionCommands)(ctx)
    if (chatId) await watcher?.watch(chatId, threadId)
  })
  reg('abort', async (ctx) => {
    const chatId = ctx.chat?.id
    await abortCommand(sessionCommands)(ctx)
    if (chatId) watcher?.stop(chatId, getThreadIdFromContext(ctx))
  })
  reg('history', historyCommand(sessionCommands, output))
  reg('queue', queueCommand(state, {
    sendPrompt: (chatId, text, userId, threadId) => promptFlow.handleUserMessage(chatId, text, { actorUserId: userId, threadId })
  }))
  reg('clearqueue', clearQueueCommand(state))
  reg('showqueue', showQueueCommand(state))
  reg('undo', undoCommand(sessionCommands))
  reg('redo', redoCommand(sessionCommands))
  reg('help', helpCommand(deps.instanceName))
  reg('start', startCommand(state, deps.instanceName))
  reg('plan', planCommand(state))
  reg('ask', askCommand(state))
  reg('bypass', bypassCommand(state))
  reg('status', statusCommand(state, deps.instanceName, deps.tunnel))
  reg('git', gitCommand(state))
  reg('agents', agentsCommand(state, claude))
  if (deps.customAgents) {
    reg('makeagent', makeagentCommand(state, output))
  }
  reg('settings', async (ctx) => {
    const chatId = ctx.chat?.id
    if (chatId) {
      cancelAddbotWizard(chatId)
      cancelAddhookbotWizard(chatId)
      cancelMakeagentWizard(chatId)
    }
    await settingsCommand(state, {
      instanceName: deps.instanceName,
      botRole: deps.botRole,
      customAgents: deps.customAgents,
    })(ctx)
  })

  if (deps.debateFlow) {
    reg('debate', debateCommand(deps.debateFlow, deps.botRole || 'standalone'))
    reg('review', reviewCommand(deps.debateFlow, deps.botRole || 'standalone'))
  }

  if (deps.registry) {
    reg('bots', botsCommand(deps.registry))
    reg('addbot', addbotCommand(state, deps.registry))
    reg('addhookbot', addhookbotCommand(state))
  }

  if (deps.groupSettings && deps.registry && deps.instanceName) {
    reg('groupsettings', groupSettingsCommand(deps.groupSettings, deps.registry, deps.instanceName))
  }

  if (deps.tunnel) {
    reg('tunnel', tunnelCommand(deps.tunnel))
  }

  reg('restart', restartCommand())

  reg('cancel', async (ctx) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const threadId = getThreadIdFromContext(ctx)
    cancelAddbotWizard(chatId)
    cancelAddhookbotWizard(chatId)
    cancelMakeagentWizard(chatId)
    const chatState = await state.getChatState(chatId, threadId)
    if (chatState.awaitingInput) {
      chatState.awaitingInput = null
      chatState.awaitingInputStartedAt = undefined
      chatState.awaitingInteractionId = null
      await state.saveChatState(chatId, chatState, threadId)
      await ctx.reply('❌ Cancelled.')
    } else {
      await ctx.reply('Nothing to cancel.')
    }
  })

  // Handle callback queries (question buttons)
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
    const threadId = getThreadIdFromContext(ctx)

    logger.info('bot', `Callback received: ${data}`)
    const parsed = parseCallback(data)

    if (isGroupCb && 'interactionId' in parsed) {
      const chatState = await state.getChatState(chatId, threadId)
      const interaction = chatState.pendingInteractions.find(i => i.interactionId === parsed.interactionId)
      if (interaction?.creatorUserId && interaction.creatorUserId !== ctx.callbackQuery.from.id) {
        await ctx.answerCallbackQuery({ text: 'You are not the target of this request.', show_alert: true }).catch(() => {})
        return
      }
    }

    switch (parsed.type) {
      case 'question_answer':
        await interactiveFlow.handleQuestionAnswer(chatId, parsed.interactionId, parsed.questionIndex, parsed.answerIndex, threadId)
        break
      case 'question_toggle':
        await interactiveFlow.handleQuestionToggle(chatId, parsed.interactionId, parsed.questionIndex, parsed.answerIndex, threadId)
        break
      case 'question_next':
        await interactiveFlow.handleQuestionNext(chatId, parsed.interactionId, parsed.questionIndex, threadId)
        break
      case 'question_skip':
        await interactiveFlow.handleQuestionSkip(chatId, parsed.interactionId, parsed.questionIndex, threadId)
        break
      case 'question_type':
        await interactiveFlow.handleQuestionType(chatId, parsed.interactionId, parsed.questionIndex, threadId)
        break
      case 'question_back':
        await interactiveFlow.handleQuestionBack(chatId, parsed.interactionId, parsed.questionIndex, threadId)
        break
      case 'question_confirm':
        await interactiveFlow.handleQuestionConfirm(chatId, parsed.interactionId, threadId)
        break
      case 'question_reset':
        await interactiveFlow.handleQuestionReset(chatId, parsed.interactionId, threadId)
        break
      case 'plan_approve':
        await interactiveFlow.handlePlanApprove(chatId, parsed.interactionId, parsed.clearContext, threadId)
        break
      case 'plan_reject':
        await interactiveFlow.handlePlanReject(chatId, parsed.interactionId, threadId)
        break
      case 'agent': {
        let models: Awaited<ReturnType<ClaudeAgentPort['getSupportedModels']>>
        try {
          models = await claude.getSupportedModels()
        } catch {
          await ctx.answerCallbackQuery({ text: 'Failed to validate model selection.', show_alert: true }).catch(() => {})
          break
        }
        const isSupported = models.some(model => model.id === parsed.agentName)
        if (!isSupported) {
          await ctx.answerCallbackQuery({ text: 'Model unavailable. Open model list and reselect.', show_alert: true }).catch(() => {})
          break
        }
        const chatState = await state.getChatState(chatId, threadId)
        chatState.activeAgent = parsed.agentName
        await state.saveChatState(chatId, chatState, threadId)
        await updateRegistryAgent(parsed.agentName)
        await ctx.editMessageText(`Agent switched to <b>${escapeHtml(parsed.agentName)}</b>`, { parse_mode: 'HTML' })
        break
      }
      case 'settings_agent': {
        let models: Awaited<ReturnType<ClaudeAgentPort['getSupportedModels']>>
        try {
          models = await claude.getSupportedModels()
        } catch {
          await ctx.answerCallbackQuery({ text: 'Failed to refresh model list.', show_alert: true }).catch(() => {})
          break
        }
        const isSupported = models.some(model => model.id === parsed.agentName)
        if (!isSupported) {
          await ctx.answerCallbackQuery({ text: 'Model unavailable. Refresh models first.', show_alert: true }).catch(() => {})
          break
        }

        const chatState = await state.getChatState(chatId, threadId)
        chatState.activeAgent = parsed.agentName
        await state.saveChatState(chatId, chatState, threadId)
        await updateRegistryAgent(parsed.agentName)
        try {
          const agents = models.map(m => ({ name: m.id, description: m.name }))
              await ctx.editMessageText(
                agentSubText(agents, parsed.agentName, chatState.settings, deps.botRole),
                { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, parsed.agentName, chatState.settings) },
              )
            } catch {
              await ctx.editMessageText(`Agent switched to <b>${escapeHtml(parsed.agentName)}</b>`, { parse_mode: 'HTML' })
        }
        break
      }
      case 'settings_custom_agent': {
        if (!deps.customAgents) break
        const chatState = await state.getChatState(chatId, threadId)
        const selected = await deps.customAgents.get(parsed.agentId)
        if (!selected) {
          await output.sendText(chatId, '❌ Custom agent not found.')
          break
        }
        chatState.customAgentId = selected.id
        await state.saveChatState(chatId, chatState, threadId)

        const agents = await deps.customAgents.list()
        await ctx.editMessageText(
          customAgentSubText(agents, selected),
          { parse_mode: 'HTML', reply_markup: customAgentSubKeyboard(agents, selected.id) },
        )
        break
      }
      case 'settings_remove_agent': {
        if (!deps.customAgents) break
        const chatState = await state.getChatState(chatId, threadId)
        chatState.customAgentId = null
        await state.saveChatState(chatId, chatState, threadId)

        const agents = await deps.customAgents.list()
        await ctx.editMessageText(
          customAgentSubText(agents, null),
          { parse_mode: 'HTML', reply_markup: customAgentSubKeyboard(agents, null) },
        )
        break
      }
      case 'settings': {
        const chatState = await state.getChatState(chatId, threadId)
        switch (parsed.action) {
          case 'sub_agent': {
            try {
              const models = await claude.getSupportedModels()
              const agents = models.map(m => ({ name: m.id, description: m.name }))
              await ctx.editMessageText(
                agentSubText(agents, chatState.activeAgent, chatState.settings, deps.botRole),
                { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, chatState.activeAgent, chatState.settings) },
              )
            } catch {
              await ctx.editMessageText('Failed to load agents.', { parse_mode: 'HTML' })
            }
            break
          }
          case 'sub_summary':
            await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard(chatState.settings) })
            break
          case 'sub_custom_agent': {
            if (!deps.customAgents) {
              await ctx.editMessageText('Custom agent storage is not configured.', { parse_mode: 'HTML' })
              break
            }
            const agents = await deps.customAgents.list()
            const current = chatState.customAgentId
              ? await deps.customAgents.get(chatState.customAgentId)
              : null
            await ctx.editMessageText(
              customAgentSubText(agents, current),
              { parse_mode: 'HTML', reply_markup: customAgentSubKeyboard(agents, current?.id ?? null) },
            )
            break
          }
          case 'sub_output':
            await ctx.editMessageText(outputSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: outputSubKeyboard() })
            break
          case 'sub_history':
            await ctx.editMessageText(historySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: historySubKeyboard() })
            break
          case 'sub_session_filter':
            await ctx.editMessageText(sessionFilterSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: sessionFilterSubKeyboard(chatState.settings) })
            break
          case 'sub_project': {
            const projects = await getClaudeCodeProjects()
            await ctx.editMessageText(
              projectSubText(projects, chatState.activeProjectDirectory),
              { parse_mode: 'HTML', reply_markup: projectSubKeyboard(projects, chatState.activeProjectDirectory) },
            )
            break
          }
          case 'project': {
            const projects = await getClaudeCodeProjects()
            const idx = parseInt(parsed.value ?? '', 10)
            if (Number.isFinite(idx) && idx >= 0 && idx < projects.length) {
              chatState.activeProjectDirectory = projects[idx]
              chatState.activeSessionId = null
              chatState.pendingInteractions = []
              chatState.awaitingInput = null
              chatState.awaitingInteractionId = null
              await state.saveChatState(chatId, chatState, threadId)
            }
            await ctx.editMessageText(
              projectSubText(projects, chatState.activeProjectDirectory),
              { parse_mode: 'HTML', reply_markup: projectSubKeyboard(projects, chatState.activeProjectDirectory) },
            )
            break
          }
          case 'sessionfilter': {
            const filter = parsed.value as 'all' | 'bot' | 'local'
            if (filter === 'all' || filter === 'bot' || filter === 'local') {
              chatState.settings.sessionListFilter = filter
              await state.saveChatState(chatId, chatState, threadId)
            }
            await ctx.editMessageText(sessionFilterSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: sessionFilterSubKeyboard(chatState.settings) })
            break
          }
          case 'review': {
            const current = resolveReviewMode(chatState.settings, deps.botRole)
            chatState.settings.reviewMode = !current
            await state.saveChatState(chatId, chatState, threadId)
            try {
              const models = await claude.getSupportedModels()
              const agents = models.map(m => ({ name: m.id, description: m.name }))
              await ctx.editMessageText(
                agentSubText(agents, chatState.activeAgent, chatState.settings, deps.botRole),
                { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, chatState.activeAgent, chatState.settings) },
              )
            } catch {
              await ctx.editMessageText(`Review Mode: ${!current ? 'ON 🔒' : 'OFF'}`, { parse_mode: 'HTML' })
            }
            break
          }
          case 'permmode': {
            const mode = parseSettingsPermissionMode(parsed.value)
            if (!mode) {
              await ctx.answerCallbackQuery({ text: 'Invalid permission mode.', show_alert: true }).catch(() => {})
              break
            }
            chatState.settings.permissionMode = mode
            await state.saveChatState(chatId, chatState, threadId)
            try {
              const models = await claude.getSupportedModels()
              const agents = models.map(m => ({ name: m.id, description: m.name }))
              await ctx.editMessageText(
                agentSubText(agents, chatState.activeAgent, chatState.settings, deps.botRole),
                { parse_mode: 'HTML', reply_markup: agentSubKeyboard(agents, chatState.activeAgent, chatState.settings) },
              )
            } catch {
              await ctx.editMessageText(`Permission mode set to <code>${mode}</code>.`, { parse_mode: 'HTML' })
            }
            break
          }
          case 'format':
            chatState.settings.outputMode = chatState.settings.outputMode === 'formatted' ? 'raw' : 'formatted'
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText(outputSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: outputSubKeyboard() })
            break
          case 'summary':
            chatState.settings.summaryMode = !chatState.settings.summaryMode
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard(chatState.settings) })
            break
          case 'threshold':
            chatState.awaitingInput = 'threshold'
            chatState.awaitingInputStartedAt = Date.now()
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText(
              `📏 Enter summary trigger threshold in characters.\nResponses longer than this will be summarized.\n(Summary output is always compact ~${LIMITS.SUMMARY_OUTPUT_TARGET} chars)\n\nCurrent: ${chatState.settings.summaryThreshold.toLocaleString()} chars\nExamples: 3000, 6000, 10000`,
              { parse_mode: 'HTML' }
            )
            break
          case 'expertise': {
            const level = parsed.value as 'vibe' | 'developer' | 'beginner'
            if (level === 'vibe' || level === 'developer' || level === 'beginner') {
              chatState.settings.userExpertise = level
              await state.saveChatState(chatId, chatState, threadId)
            }
            try {
              const msg = ctx.callbackQuery?.message
              const text = msg && 'text' in msg ? msg.text : ''
              if (text?.includes('Voice')) {
                await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
              } else {
                await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard(chatState.settings) })
              }
            } catch {
              await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard(chatState.settings) })
            }
            break
          }

          case 'model': {
            await ctx.editMessageText(
              modelSelectText(chatState.settings),
              { parse_mode: 'HTML', reply_markup: modelSelectKeyboard(chatState.settings) },
            )
            break
          }

          case 'histformat':
            chatState.settings.historyFormat = chatState.settings.historyFormat === 'html' ? 'md' : 'html'
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText(historySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: historySubKeyboard() })
            break
          case 'histlimit':
            chatState.awaitingInput = 'histlimit'
            chatState.awaitingInputStartedAt = Date.now()
            await state.saveChatState(chatId, chatState, threadId)
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
          case 'sub_voice':
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          case 'voice_toggle':
            chatState.settings.voiceMode = !chatState.settings.voiceMode
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          case 'voice_auto':
            chatState.settings.voiceAutoMode = !chatState.settings.voiceAutoMode
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          case 'voice_lang': {
            const lang = parsed.value as 'ko' | 'en'
            if (lang === 'ko' || lang === 'en') {
              chatState.settings.voiceLanguage = lang
              await state.saveChatState(chatId, chatState, threadId)
            }
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          }
          case 'voice_len': {
            const len = parseInt(parsed.value ?? '', 10)
            if ([500, 800, 1200, 2000].includes(len)) {
              chatState.settings.voiceSummaryLength = len
              await state.saveChatState(chatId, chatState, threadId)
            }
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          }
          case 'voice_spd': {
            const spd = parseFloat(parsed.value ?? '')
            if ([1.0, 1.25, 1.5, 2.0].includes(spd)) {
              chatState.settings.voiceSpeed = spd
              await state.saveChatState(chatId, chatState, threadId)
            }
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          }
          case 'voice_gender': {
            const gender = parsed.value as 'female' | 'male'
            if (gender === 'female' || gender === 'male') {
              chatState.settings.voiceGender = gender
              await state.saveChatState(chatId, chatState, threadId)
            }
            await ctx.editMessageText(voiceSubText(chatState.settings), { parse_mode: 'HTML', reply_markup: voiceSubKeyboard(chatState.settings) })
            break
          }
          case 'back': {
            let healthy = false
            try {
              const { execFileSync } = await import('node:child_process')
              execFileSync('claude', ['--version'], { timeout: 3000, stdio: 'ignore' })
              healthy = true
            } catch { /* Claude Code CLI not available */ }
            const rendered = await renderSettingsMain(chatState, healthy, groupInstanceName)
            await ctx.editMessageText(
              rendered.text,
              { parse_mode: 'HTML', reply_markup: rendered.keyboard },
            )
            break
          }
        }
        break
      }
      case 'listpage': {
        try {
          const pageData = await sessionCommands.getSessionPage(chatId, parsed.page, threadId)
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
          const title = await sessionCommands.resumeSessionById(chatId, parsed.sessionId, threadId)
          if (title) {
            const histKb = new InlineKeyboard().text('📜 Get History', `hist:${parsed.sessionId}`)
            await ctx.editMessageText(`✅ Resumed: <b>${escapeHtml(title)}</b>`, {
              parse_mode: 'HTML',
              reply_markup: histKb,
            })
            await watcher?.watch(chatId, threadId)
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
          await ctx.editMessageText('📝 Generating history...')
          const histResult = await sessionCommands.exportSessionHistory(chatId, parsed.sessionId, threadId)
          if (!histResult) {
            await output.sendText(chatId, 'No history or session not found.')
            break
          }
          const buf = Buffer.from(histResult.content, 'utf-8')
          const safeTitle = histResult.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
          const ext = histResult.format
          await output.sendFile(chatId, buf, `${safeTitle}.${ext}`, `📜 ${histResult.title}`)
        } catch {
          await output.sendText(chatId, 'Failed to generate history.')
        }
        break
      }
      case 'addbot_role': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        if (deps.registry) {
          await handleAddbotRoleCallback(
            chatId, parsed.role, state, output,
            deps.registry,
          )
        }
        break
      }
      case 'addbot_project': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        if (deps.registry) {
          await handleAddbotProjectCallback(
            chatId, parsed.projectDir, state, output,
            deps.registry,
            deps.customAgents,
          )
        }
        break
      }
      case 'addbot_agent': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        if (deps.registry) {
          await handleAddbotAgentCallback(
            chatId,
            parsed.agentId,
            state,
            output,
            deps.registry,
          )
        }
        break
      }
      case 'addbot_start': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await handleAddbotStartCallback(chatId, parsed.instanceName, output)
        break
      }
      case 'addbot_remove': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        if (deps.registry) {
          await handleAddbotRemoveCallback(chatId, parsed.instanceName, output, deps.registry)
        }
        break
      }
      case 'addbot_new': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await startAddbotWizard(chatId, state, output)
        break
      }
      case 'addbot_cancel': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        cancelAddbotWizard(chatId)
        const chatState = await state.getChatState(chatId, threadId)
        if (chatState.awaitingInput === 'addbot_token' || chatState.awaitingInput === 'addbot_project') {
          chatState.awaitingInput = null
          chatState.awaitingInputStartedAt = undefined
          await state.saveChatState(chatId, chatState, threadId)
        }
        await ctx.editMessageText('❌ Bot wizard cancelled.')
        break
      }
      case 'addhookbot_all': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await handleAddhookbotAllCallback(chatId, state, output)
        break
      }
      case 'addhookbot_project': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await handleAddhookbotProjectCb(
          chatId, parsed.projectDir, parsed.action, state, output,
          '', '', '',
          deps.registry,
        )
        break
      }
      case 'addhookbot_done': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await handleAddhookbotDoneCallback(chatId, state, output)
        break
      }
      case 'addhookbot_start': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await handleAddhookbotStartCallback(chatId, parsed.action, output)
        break
      }
      case 'addhookbot_remove': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await handleAddhookbotRemoveCallback(chatId, output)
        break
      }
      case 'addhookbot_reconfigure': {
        if (cbChatType !== 'private') {
          await ctx.answerCallbackQuery({ text: 'This action is only available in DM.', show_alert: true }).catch(() => {})
          break
        }
        await startAddhookbotReconfigure(
          chatId,
          output,
          '', '', '',
          deps.registry,
        )
        break
      }
      case 'makeagent_save': {
        await startMakeagentSave(chatId, state, output)
        break
      }
      case 'makeagent_regen': {
        if (deps.customAgents) {
          await regenerateMakeagentDraft(chatId, state, output, claude)
        }
        break
      }
      case 'makeagent_edit': {
        await startMakeagentEdit(chatId, state, output)
        break
      }
      case 'makeagent_cancel': {
        cancelMakeagentWizard(chatId)
        const chatState = await state.getChatState(chatId, threadId)
        if (chatState.awaitingInput === 'makeagent_describe' || chatState.awaitingInput === 'makeagent_name' || chatState.awaitingInput === 'makeagent_edit') {
          chatState.awaitingInput = null
          chatState.awaitingInputStartedAt = undefined
          await state.saveChatState(chatId, chatState, threadId)
        }
        await output.sendText(chatId, '❌ Custom agent wizard cancelled.')
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
            const gsChatState = await state.getChatState(chatId, threadId)
            gsChatState.awaitingInput = 'debaterounds'
            gsChatState.awaitingInputStartedAt = Date.now()
            await state.saveChatState(chatId, gsChatState, threadId)
            await ctx.editMessageText(
              `🎭 Enter number of debate rounds.\n\n0 = Unlimited\n\nCurrent: ${gs.debateRounds === 0 ? '♾️ Unlimited' : `${gs.debateRounds} rounds`}`,
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
        const chatState = await state.getChatState(chatId, threadId)
        const slashIdx = parsed.value.indexOf('/')
        if (slashIdx > 0) {
          chatState.settings.summaryModel = {
            providerID: parsed.value.slice(0, slashIdx),
            modelID: parsed.value.slice(slashIdx + 1),
          }
          await state.saveChatState(chatId, chatState, threadId)
        }
        await ctx.editMessageText(summarySubText(chatState.settings), { parse_mode: 'HTML', reply_markup: summarySubKeyboard(chatState.settings) })
        break
      }
      case 'tunnel': {
        if (!deps.tunnel) break
        switch (parsed.action) {
          case 'stop': {
            await deps.tunnel.stop(chatId)
            await ctx.editMessageText('Tunnel stopped.')
            break
          }
          case 'start': {
            if (parsed.port) {
              await ctx.editMessageText(`Starting tunnel on port ${parsed.port}...`)
              await startTunnelWithFeedback(ctx, chatId, parsed.port, deps.tunnel)
            }
            break
          }
          case 'custom': {
            const chatState = await state.getChatState(chatId, threadId)
            chatState.awaitingInput = 'tunnel_port'
            chatState.awaitingInputStartedAt = Date.now()
            await state.saveChatState(chatId, chatState, threadId)
            await ctx.editMessageText('Enter port number (1-65535):')
            break
          }
        }
        break
      }
      case 'git': {
        await handleGitCallback(ctx, parsed.action, state)
        break
      }
      case 'restart': {
        await handleRestartCallback(ctx, parsed.action)
        break
      }
      case 'voice': {
        if (deps.voiceFlow && parsed.action === 'listen') {
          await deps.voiceFlow.sendVoiceResponse(chatId, parsed.responseId)
        }
        break
      }
      default:
        break
    }
  })

  // Handle text messages (prompts to Claude)
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id
    const text = ctx.message.text
    if (text.startsWith('/')) return

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    const threadId = isGroup && ctx.message.message_thread_id ? ctx.message.message_thread_id : undefined

    const chatState = await state.getChatState(chatId, threadId)

    // Check for wizard timeout
    if (chatState.awaitingInput && chatState.awaitingInput !== 'question' && chatState.awaitingInputStartedAt) {
      const elapsed = Date.now() - chatState.awaitingInputStartedAt
      if (elapsed > LIMITS.WIZARD_TIMEOUT_MS) {
        const wizardType = chatState.awaitingInput.startsWith('addbot') ? 'addbot' :
                          chatState.awaitingInput.startsWith('makeagent') ? 'makeagent' :
                          chatState.awaitingInput.startsWith('addhookbot') ? 'addhookbot' : 'wizard'

        if (wizardType === 'addbot') cancelAddbotWizard(chatId)
        if (wizardType === 'makeagent') cancelMakeagentWizard(chatId)
        if (wizardType === 'addhookbot') cancelAddhookbotWizard(chatId)

        chatState.awaitingInput = null
        chatState.awaitingInputStartedAt = undefined
        chatState.awaitingInteractionId = null
        await state.saveChatState(chatId, chatState, threadId)

        await output.sendText(chatId, '⏱ Wizard session timed out after 5 minutes of inactivity. Use the command again to restart.')

        // Don't process this message further
        return
      }
    }

    // Check if user is sending unrelated messages during a wizard session
    if (chatState.awaitingInput && chatState.awaitingInput !== 'question') {
      const wizardMessages: Record<string, string> = {
        'addbot_token': '🤖 <b>봇 추가 진행 중</b>\n\n봇 토큰을 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'addbot_project': '🤖 <b>봇 추가 진행 중</b>\n\n프로젝트 경로를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'makeagent_describe': '🎭 <b>커스텀 에이전트 생성 중</b>\n\n에이전트 설명을 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'makeagent_name': '🎭 <b>커스텀 에이전트 생성 중</b>\n\n에이전트 이름을 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'makeagent_edit': '🎭 <b>커스텀 에이전트 수정 중</b>\n\n시스템 프롬프트를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'addhookbot_token': '🪝 <b>훅 봇 추가 진행 중</b>\n\n봇 토큰을 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'addhookbot_chatid': '🪝 <b>훅 봇 설정 중</b>\n\n채팅 ID를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'threshold': '📏 <b>요약 임계값 설정 중</b>\n\n문자 수를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'histlimit': '📜 <b>히스토리 제한 설정 중</b>\n\n메시지 수를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'debaterounds': '🎭 <b>토론 라운드 설정 중</b>\n\n라운드 수를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
        'tunnel_port': '🌐 <b>터널 포트 설정 중</b>\n\n포트 번호를 입력해주세요.\n\n• 취소하려면 /cancel을 입력하세요',
      }

      // Check if this is a valid input for the current wizard step
      const isValidInput = (
        (chatState.awaitingInput === 'addbot_token' && text.includes(':')) ||
        (chatState.awaitingInput === 'addhookbot_token' && text.includes(':')) ||
        (chatState.awaitingInput === 'addbot_project' && text.startsWith('/')) ||
        (chatState.awaitingInput === 'addhookbot_chatid' && (text.trim().toLowerCase() === 'default' || !isNaN(Number(text.trim())))) ||
        (chatState.awaitingInput === 'threshold' && !isNaN(Number(text.trim()))) ||
        (chatState.awaitingInput === 'histlimit' && (!isNaN(Number(text.trim())) || text.trim().toLowerCase() === 'all')) ||
        (chatState.awaitingInput === 'debaterounds' && !isNaN(Number(text.trim()))) ||
        (chatState.awaitingInput === 'tunnel_port' && !isNaN(Number(text.trim())))
      )

      // If the message doesn't look like valid input for the current step, show reminder
      if (!isValidInput && wizardMessages[chatState.awaitingInput]) {
        await output.sendText(chatId, wizardMessages[chatState.awaitingInput], 'HTML')
        return
      }
    }

    if (chatState.awaitingInput === 'question') {
      const handled = await interactiveFlow.handleFreeTextAnswer(chatId, text, threadId)
      if (handled) return
    }
    if (chatState.awaitingInput === 'threshold') {
      chatState.awaitingInput = null
      chatState.awaitingInputStartedAt = undefined
      const num = parseInt(text.trim(), 10)
      if (!Number.isFinite(num) || num < LIMITS.SUMMARY_MIN_TRIGGER || num > 50000) {
        await state.saveChatState(chatId, chatState, threadId)
        await output.sendText(chatId, `Invalid value. Enter a number between ${LIMITS.SUMMARY_MIN_TRIGGER.toLocaleString()} and 50,000, or send /settings to go back.`)
        return
      }
      chatState.settings.summaryThreshold = num
      await state.saveChatState(chatId, chatState, threadId)
      await output.sendText(chatId, `✅ Summary threshold set to ${num.toLocaleString()} chars.`)
      return
    }
    if (chatState.awaitingInput === 'addbot_token') {
      const handled = await handleAddbotToken(chatId, text, state, output)
      if (handled) return
    }
    if (chatState.awaitingInput === 'addhookbot_token') {
      const handled = await handleAddhookbotToken(
        chatId, text, state, output,
        '', '', '',
        deps.registry,
      )
      if (handled) return
    }
    if (chatState.awaitingInput === 'addbot_project') {
      if (deps.registry) {
        const handled = await handleAddbotProjectText(chatId, text, state, output, deps.registry, deps.customAgents)
        if (handled) return
      }
    }
    if (chatState.awaitingInput === 'addhookbot_chatid') {
      const handled = await handleAddhookbotChatId(chatId, text, state, output)
      if (handled) return
    }
    if (chatState.awaitingInput === 'makeagent_describe') {
      if (deps.customAgents) {
        const handled = await handleMakeagentDescribe(chatId, text, state, output, claude, deps.customAgents)
        if (handled) return
      }
    }
    if (chatState.awaitingInput === 'makeagent_name') {
      if (deps.customAgents) {
        const handled = await handleMakeagentName(chatId, text, state, output, deps.customAgents)
        if (handled) return
      }
    }
    if (chatState.awaitingInput === 'makeagent_edit') {
      if (deps.customAgents) {
        const handled = await handleMakeagentEdit(chatId, text, state, output, deps.customAgents)
        if (handled) return
      }
    }
    if (chatState.awaitingInput === 'debaterounds') {
      chatState.awaitingInput = null
      chatState.awaitingInputStartedAt = undefined
      const num = parseInt(text.trim(), 10)
      if (!Number.isFinite(num) || num < 0 || num > 999) {
        await state.saveChatState(chatId, chatState, threadId)
        await output.sendText(chatId, 'Enter a number between 0-999. (0 = unlimited)')
        return
      }
      await state.saveChatState(chatId, chatState, threadId)
      if (deps.groupSettings) {
        const gs = await deps.groupSettings.getGroupSettings()
        gs.debateRounds = num
        await deps.groupSettings.saveGroupSettings(gs)
      }
      await output.sendText(chatId, `✅ Debate rounds: ${num === 0 ? '♾️ Unlimited' : `${num} rounds`}`)
      return
    }
    if (chatState.awaitingInput === 'histlimit') {
      chatState.awaitingInput = null
      chatState.awaitingInputStartedAt = undefined
      const trimmed = text.trim().toLowerCase()
      if (trimmed === 'all' || trimmed === '0') {
        chatState.settings.historyLimit = null
        await state.saveChatState(chatId, chatState, threadId)
        await output.sendText(chatId, '✅ History export: all messages (full history)')
        return
      }
      const num = parseInt(trimmed, 10)
      if (!Number.isFinite(num) || num < 1 || num > 10000) {
        await state.saveChatState(chatId, chatState, threadId)
        await output.sendText(chatId, 'Invalid value. Enter a number between 1 and 10,000, or type <code>all</code> / <code>0</code>.', 'HTML')
        return
      }
      chatState.settings.historyLimit = num
      await state.saveChatState(chatId, chatState, threadId)
      await output.sendText(chatId, `✅ History export: last ${num} messages only`)
      return
    }
    if (chatState.awaitingInput === 'tunnel_port' && deps.tunnel) {
      const handled = await handleTunnelPortInput(ctx, text, state, deps.tunnel)
      if (handled) return
    }

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

    const scopeKey = getQueueScopeKey(chatId, threadId)
    void queue.enqueue(scopeKey, () => promptFlow.handleUserMessage(chatId, cleanedText, { actorUserId, isGroup, threadId }))
      .catch(err => logger.error('bot', `Prompt job failed: ${err instanceof Error ? err.message : err}`))
  })

  bot.on('message:photo', async (ctx) => {
    const chatId = ctx.chat.id
    const caption = ctx.message.caption ?? ''
    const photos = ctx.message.photo

    if (!photos || photos.length === 0) {
      await output.sendText(chatId, 'No photo found in message.')
      return
    }

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    const threadId = isGroup && ctx.message.message_thread_id ? ctx.message.message_thread_id : undefined

    const chatState = await state.getChatState(chatId, threadId)
    if (!chatState.activeSessionId) {
      await output.sendText(chatId, 'No active session. Use /new to start one.')
      return
    }

    const actorUserId = ctx.from?.id

    const largestPhoto = photos[photos.length - 1]

    try {
      const file = await ctx.api.getFile(largestPhoto.file_id)
      if (!file.file_path) {
        await output.sendText(chatId, 'Failed to get file path from Telegram.')
        return
      }

      const botToken = bot.token
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`

      const response = await fetch(fileUrl)
      if (!response.ok) {
        await output.sendText(chatId, `Failed to download image: ${response.status}`)
        return
      }

      const arrayBuffer = await response.arrayBuffer()
      const base64Data = Buffer.from(arrayBuffer).toString('base64')

      const ext = file.file_path.split('.').pop()?.toLowerCase() ?? 'jpg'
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      }
      const mime = mimeMap[ext] ?? 'image/jpeg'

      const text = caption.trim() || 'Analyze this image.'

      const scopeKey = getQueueScopeKey(chatId, threadId)
      void queue.enqueue(scopeKey, () =>
        promptFlow.handleUserMessage(chatId, text, {
          actorUserId,
          isGroup,
          threadId,
          images: [{ mime, data: base64Data, filename: file.file_path }],
        })
      ).catch(err => logger.error('bot', `Photo prompt failed: ${err instanceof Error ? err.message : err}`))

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('bot', `Photo handling failed: ${sanitizeError(msg, bot.token)}`)
      await output.sendText(chatId, `❌ Failed to process image: ${escapeHtml(sanitizeError(msg, bot.token))}`)
    }
  })

  bot.on('message:document', async (ctx) => {
    const chatId = ctx.chat.id
    const caption = ctx.message.caption ?? ''
    const document = ctx.message.document

    if (!document) {
      await output.sendText(chatId, 'No document found in message.')
      return
    }

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    const threadId = isGroup && ctx.message.message_thread_id ? ctx.message.message_thread_id : undefined

    const chatState = await state.getChatState(chatId, threadId)
    if (!chatState.activeSessionId) {
      await output.sendText(chatId, 'No active session. Use /new to start one.')
      return
    }

    const actorUserId = ctx.from?.id

    try {
      const file = await ctx.api.getFile(document.file_id)
      if (!file.file_path) {
        await output.sendText(chatId, 'Failed to get file path from Telegram.')
        return
      }

      const botToken = bot.token
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`

      const response = await fetch(fileUrl)
      if (!response.ok) {
        await output.sendText(chatId, `Failed to download file: ${response.status}`)
        return
      }

      const arrayBuffer = await response.arrayBuffer()
      const base64Data = Buffer.from(arrayBuffer).toString('base64')

      const mime = document.mime_type ?? 'application/octet-stream'
      const filename = document.file_name ?? file.file_path.split('/').pop() ?? 'file'

      const text = caption.trim() || `Analyze this file: ${filename}`

      const scopeKey = getQueueScopeKey(chatId, threadId)
      void queue.enqueue(scopeKey, () =>
        promptFlow.handleUserMessage(chatId, text, {
          actorUserId,
          isGroup,
          threadId,
          images: [{ mime, data: base64Data, filename }],
        })
      ).catch(err => logger.error('bot', `Document prompt failed: ${err instanceof Error ? err.message : err}`))

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('bot', `Document handling failed: ${sanitizeError(msg, bot.token)}`)
      await output.sendText(chatId, `❌ Failed to process file: ${escapeHtml(sanitizeError(msg, bot.token))}`)
    }
  })

  bot.on('message:voice', async (ctx) => {
    const chatId = ctx.chat.id
    if (!deps.transcription) {
      await output.sendText(chatId, '🎙 Voice-to-text is not configured. Set OPENAI_API_KEY in .env.')
      return
    }

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    const threadId = isGroup ? ctx.message.message_thread_id : undefined
    const chatState = await state.getChatState(chatId, threadId)
    if (!chatState.activeSessionId) {
      await output.sendText(chatId, 'No active session. Use /new to start one.')
      return
    }

    try {
      const voiceFile = await ctx.api.getFile(ctx.message.voice.file_id)
      if (!voiceFile.file_path) {
        await output.sendText(chatId, 'Failed to get voice file.')
        return
      }

      const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${voiceFile.file_path}`
      const response = await fetch(fileUrl)
      if (!response.ok) {
        await output.sendText(chatId, `Failed to download voice: ${response.status}`)
        return
      }

      const audioData = new Uint8Array(await response.arrayBuffer())
      const format = voiceFile.file_path.split('.').pop() ?? 'ogg'

      await output.sendText(chatId, '🎙 Transcribing...')
      const transcription = await deps.transcription.transcribe(audioData, format)

      if (!transcription.trim()) {
        await output.sendText(chatId, '🎙 No speech detected.')
        return
      }

      await output.sendText(chatId, `🎙 <i>${escapeHtml(transcription)}</i>`, 'HTML')

      const actorUserId = ctx.from?.id
      const scopeKey = getQueueScopeKey(chatId, threadId)

      void queue.enqueue(scopeKey, () =>
        promptFlow.handleUserMessage(chatId, transcription, { actorUserId, isGroup, threadId })
      ).catch(err => logger.error('bot', `Voice prompt failed: ${err instanceof Error ? err.message : err}`))
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('bot', `Voice handling failed: ${sanitizeError(msg, bot.token)}`)
      await output.sendText(chatId, `❌ Voice transcription failed: ${escapeHtml(sanitizeError(msg, bot.token))}`)
    }
  })
}
