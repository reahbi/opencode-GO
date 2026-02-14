import type { ClaudeAgentPort } from '../../domain/ports/ClaudeAgentPort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { CoordinationPort, CoordinationEvent } from '../../domain/ports/CoordinationPort.js'
import type { BotRegistryPort } from '../../domain/ports/BotRegistryPort.js'
import type { GroupSettingsPort } from '../../domain/ports/GroupSettingsPort.js'
import { escapeHtml } from '../../shared/formatResponse.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../policies/limits.js'

interface DebateFlowDeps {
  claude: ClaudeAgentPort
  state: StateStore
  output: ChatOutputPort
  coordination: CoordinationPort
  registry: BotRegistryPort
  groupSettings: GroupSettingsPort
  botRole: 'writer' | 'reader' | 'standalone'
  instanceName: string
  projectDir: string
}

type DebateMode = 'debate' | 'review'

interface DebateMessage {
  from: 'self' | 'opponent'
  round: number
  text: string
}

interface DebateSession {
  chatId: number
  sessionId: string
  directory: string
  topic: string
  round: number
  maxRounds: number
  mode: DebateMode
  target?: string
  timeoutId?: ReturnType<typeof setTimeout>
  debateId: string
  messages: DebateMessage[]
}

interface PendingAcceptance {
  chatId: number
  debateId: string
  topic: string
  messages: DebateMessage[]
  sessionId: string
  directory: string
  createdAt: number
}

interface ChatContext {
  sessionId: string
  directory: string
  agent: string | null
}

const DEBATE_MSG_MAX_LENGTH = 3500

function truncateForTelegram(text: string): string {
  if (text.length <= DEBATE_MSG_MAX_LENGTH) return text
  return text.slice(0, DEBATE_MSG_MAX_LENGTH) + '\n\n... (truncated)'
}

async function sendWithRetry(
  fn: () => Promise<unknown>,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn()
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const retryMatch = msg.match(/retry after (\d+)/i)
      if (retryMatch && attempt < maxRetries) {
        const waitSec = Math.min(parseInt(retryMatch[1], 10) + 1, 60)
        logger.warn('debate', `Rate limited, waiting ${waitSec}s before retry (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(r => setTimeout(r, waitSec * 1000))
        continue
      }
      throw err
    }
  }
}

async function sendPromptAndWaitForResponse(
  claude: ClaudeAgentPort,
  sessionId: string,
  directory: string,
  prompt: string,
): Promise<string> {
  logger.info('debate', `[sendPromptAndWaitForResponse] session=${sessionId} dir=${directory}`)

  const handle = claude.runQuery({
    prompt,
    sessionId,
    cwd: directory,
  })

  const textParts: string[] = []

  try {
    for await (const event of handle.messages) {
      if (event.type === 'text.done') {
        textParts.push(event.content)
      }
    }
  } catch (error) {
    logger.error('debate', `Query stream error: ${error instanceof Error ? error.message : String(error)}`)
  }

  const result = textParts.join('\n').trim()
  logger.info('debate', `[sendPromptAndWaitForResponse] got ${textParts.length} text parts, ${result.length} chars total`)
  return result
}

const ACCEPTANCE_TTL_MS = 30 * 60 * 1000

export function createDebateFlow(deps: DebateFlowDeps) {
  const sessions = new Map<number, DebateSession>()
  const pendingAcceptances = new Map<string, PendingAcceptance>()
  let pollInterval: ReturnType<typeof setInterval> | null = null
  let pollOffset = 0

  async function getTargetBot(): Promise<string | null> {
    if (deps.botRole === 'standalone') return null
    const targetRole = deps.botRole === 'writer' ? 'reader' : 'writer'
    const peers = await deps.registry.findByRole(targetRole)
    
    // NEW: Filter by matching projectDir
    const sameProjPeers = peers.filter(p => p.projectDir === deps.projectDir)
    
    const now = Date.now()
    const activePeer = sameProjPeers.find(p => (now - p.lastSeen) < LIMITS.REGISTRY_STALE_THRESHOLD_MS)
    if (activePeer) return activePeer.instanceName
    if (sameProjPeers.length > 0) return sameProjPeers[0].instanceName
    return null
  }

  async function loadChatContext(chatId: number): Promise<ChatContext | null> {
    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory) {
      await deps.output.sendText(
        chatId,
        escapeHtml('No active project. Set DEFAULT_PROJECT in .env.'),
        'HTML',
      )
      return null
    }
    if (!state.activeSessionId) {
      await deps.output.sendText(
        chatId,
        escapeHtml('No active session. Use /new to start one.'),
        'HTML',
      )
      return null
    }

    return {
      sessionId: state.activeSessionId,
      directory: state.activeProjectDirectory,
      agent: state.activeAgent,
    }
  }

  function clearTimeoutFor(session: DebateSession) {
    if (session.timeoutId) {
      clearTimeout(session.timeoutId)
      session.timeoutId = undefined
    }
  }

  function scheduleResponseTimeout(session: DebateSession) {
    clearTimeoutFor(session)
    session.timeoutId = setTimeout(() => {
      void handleResponseTimeout(session)
    }, LIMITS.DEBATE_RESPONSE_TIMEOUT_MS)
  }

  async function handleResponseTimeout(session: DebateSession): Promise<void> {
    if (sessions.get(session.chatId) !== session) return
    logger.warn('debate', `Response timeout for chat ${session.chatId}`)
    await endDebate(session.chatId, session, 'Response timeout.')
  }

  async function publishEvent(
    type: CoordinationEvent['type'],
    toBot: string,
    debateId: string,      // NEW: Debate identifier
    chatId: number,        // NEW: Target chat ID for receiver
    payload: Record<string, unknown>,
  ): Promise<void> {
    await deps.coordination.publish({
      type,
      fromBot: deps.instanceName,
      toBot,
      sessionId: '',  // Deprecated, empty string for backward compat
      debateId,       // NEW
      chatId,         // NEW
      payload,
    })
  }

  async function endDebate(chatId: number, session: DebateSession, reason: string): Promise<void> {
    clearTimeoutFor(session)
    sessions.delete(chatId)
    stopPolling()

    const targetBot = await getTargetBot()
    if (session.mode === 'debate' && targetBot) {
      await publishEvent(
        'debate.end',
        targetBot,
        session.debateId,
        session.chatId,
        { topic: session.topic, round: session.round, reason },
      )
    }

    if (session.mode === 'debate' && deps.botRole === 'writer' && session.messages.length > 0) {
      pendingAcceptances.set(session.debateId, {
        chatId,
        debateId: session.debateId,
        topic: session.topic,
        messages: session.messages,
        sessionId: session.sessionId,
        directory: session.directory,
        createdAt: Date.now(),
      })

      await sendWithRetry(() => deps.output.sendInteraction(
        chatId,
        `🏁 Debate ended: ${escapeHtml(reason)}\n\n<b>${escapeHtml(session.topic)}</b>\n\nApply results to code?`,
        [
          { label: '✅ Apply', callbackData: `dba:${session.debateId}` },
          { label: '❌ Ignore', callbackData: `dbr:${session.debateId}` },
        ],
      ))
      return
    }

    const endMessage = session.mode === 'review'
      ? `✅ Review finished: ${reason}`
      : `🏁 Debate finished: ${reason}`
    await deps.output.sendText(chatId, escapeHtml(endMessage), 'HTML')
  }

  async function startDebate(chatId: number, topic: string, overrideRounds?: number): Promise<void> {
    const context = await loadChatContext(chatId)
    if (!context) return

    const targetBot = await getTargetBot()
    if (!targetBot) {
      await deps.output.sendText(
        chatId,
        escapeHtml('/debate is not available in standalone mode.'),
        'HTML',
      )
      return
    }

    const gs = await deps.groupSettings.getGroupSettings()
    const maxRounds = overrideRounds ?? gs.debateRounds

    const cleanTopic = topic.trim()
    const debateId = crypto.randomUUID()
    const session: DebateSession = {
      chatId,
      sessionId: context.sessionId,
      directory: context.directory,
      topic: cleanTopic,
      round: 1,
      maxRounds,
      mode: 'debate',
      debateId,
      messages: [],
    }

    sessions.set(chatId, session)

    const roundsLabel = maxRounds === 0 ? '♾️' : `${maxRounds}`
    await deps.output.sendText(
      chatId,
      escapeHtml(`🎭 Starting debate (${roundsLabel} rounds): ${cleanTopic}`),
      'HTML',
    )

    await publishEvent(
      'debate.request',
      targetBot,
      debateId,
      chatId,
      { topic: cleanTopic, round: 1, maxRounds },
    )

    startPolling()
    scheduleResponseTimeout(session)
  }

  async function startReview(chatId: number, target?: string): Promise<void> {
    const context = await loadChatContext(chatId)
    if (!context) return

    const targetBot = await getTargetBot()
    if (!targetBot) {
      await deps.output.sendText(
        chatId,
        escapeHtml('/review is not available in standalone mode.'),
        'HTML',
      )
      return
    }

    const reviewTarget = target?.trim() || 'latest changes'
    const debateId = crypto.randomUUID()
    const session: DebateSession = {
      chatId,
      sessionId: context.sessionId,
      directory: context.directory,
      topic: reviewTarget,
      round: 1,
      maxRounds: 0,
      mode: 'review',
      target: reviewTarget,
      debateId,
      messages: [],
    }

    sessions.set(chatId, session)

    await deps.output.sendText(
      chatId,
      escapeHtml(`🔍 Starting review: ${reviewTarget}`),
      'HTML',
    )

    await publishEvent(
      'review.request',
      targetBot,
      debateId,
      chatId,
      { target: reviewTarget, description: 'Code review request' },
    )

    startPolling()
    scheduleResponseTimeout(session)
  }

  async function handleDebateRequest(chatId: number, event: CoordinationEvent): Promise<void> {
    if (deps.botRole === 'standalone') return

    const context = await loadChatContext(chatId)
    if (!context) {
      logger.warn('debate', `[handleDebateRequest] no context for chat ${chatId}`)
      return
    }

    const topic = typeof event.payload.topic === 'string' ? event.payload.topic : 'Debate'
    const round = typeof event.payload.round === 'number' ? event.payload.round : 1
    const maxRounds = typeof event.payload.maxRounds === 'number' ? event.payload.maxRounds : LIMITS.MAX_DEBATE_ROUNDS
    const debateId = event.debateId || event.id

    logger.info('debate', `[handleDebateRequest] chat=${chatId} session=${context.sessionId} dir=${context.directory} topic="${topic}" round=${round} maxRounds=${maxRounds} debateId=${debateId}`)

    const session: DebateSession = {
      chatId,
      sessionId: context.sessionId,
      directory: context.directory,
      topic,
      round,
      maxRounds,
      mode: 'debate',
      debateId,
      messages: [],
    }
    sessions.set(chatId, session)

    try {
      const prompt = `You are in a structured debate.\nTopic: ${topic}\nRound ${round}.\nProvide your opening argument.`
      logger.info('debate', `[handleDebateRequest] sending prompt to session ${context.sessionId}`)

      const responseText = await sendPromptAndWaitForResponse(deps.claude, context.sessionId, context.directory, prompt)
      logger.info('debate', `[handleDebateRequest] got response (${responseText.length} chars): "${responseText.slice(0, 80)}..."`)

      session.messages.push({ from: 'self', round, text: responseText || '(empty response)' })

      await sendWithRetry(() => deps.output.sendText(
        chatId,
        escapeHtml(truncateForTelegram(`💬 Debate: ${topic}\n\n${responseText || '(empty response)'}`)),
        'HTML',
      ))

      const targetBot = await getTargetBot()
      if (!targetBot) return

      session.round = round + 1
      logger.info('debate', `[handleDebateRequest] publishing debate.response to ${targetBot}, round=${session.round}`)
      await publishEvent(
        'debate.response',
        targetBot,
        debateId,
        chatId,
        { topic, round: session.round, maxRounds, message: responseText || '(empty response)' },
      )

      scheduleResponseTimeout(session)
    } catch (error) {
      logger.error('debate', `Failed to generate debate response: ${error instanceof Error ? error.message : String(error)}`)
      await deps.output.sendText(
        chatId,
        escapeHtml(`❌ Failed to generate debate response: ${error instanceof Error ? error.message : String(error)}`),
        'HTML',
      )
      const targetBot = await getTargetBot()
      if (targetBot) {
        await publishEvent('debate.end', targetBot, debateId, chatId, { reason: 'AI prompt failed' })
      }
      sessions.delete(chatId)
    }
  }

  async function handleDebateResponse(chatId: number, event: CoordinationEvent): Promise<void> {
    const session = sessions.get(chatId)
    if (!session || session.mode !== 'debate') return
    
    if (event.debateId && event.debateId !== session.debateId) {
      logger.warn('debate', `debateId mismatch: event=${event.debateId}, session=${session.debateId}`)
      return
    }

    clearTimeoutFor(session)

    const round = typeof event.payload.round === 'number' ? event.payload.round : session.round
    if (typeof event.payload.maxRounds === 'number') session.maxRounds = event.payload.maxRounds
    const opponentMessage = typeof event.payload.message === 'string'
      ? event.payload.message
      : ''
    logger.info('debate', `[handleDebateResponse] chat=${chatId} round=${round} maxRounds=${session.maxRounds} opponentMsg=${opponentMessage.length} chars`)

    session.messages.push({ from: 'opponent', round, text: opponentMessage })

    await sendWithRetry(() => deps.output.sendText(
      chatId,
        escapeHtml(truncateForTelegram(`💬 Opponent:\n\n${opponentMessage}`)),
      'HTML',
    ))

    if (session.maxRounds > 0 && round >= session.maxRounds) {
      await endDebate(chatId, session, 'Max rounds reached.')
      return
    }

    try {
      const prompt = `You are debating the topic: ${session.topic}.\nRound ${round}.\nOpponent says:\n${opponentMessage}\n\nRespond with your argument.`
      const responseText = await sendPromptAndWaitForResponse(deps.claude, session.sessionId, session.directory, prompt)

      session.messages.push({ from: 'self', round: round + 1, text: responseText || '(empty response)' })

      await sendWithRetry(() => deps.output.sendText(
        chatId,
        escapeHtml(truncateForTelegram(`💬 My response:\n\n${responseText || '(empty response)'}`)),
        'HTML',
      ))

      session.round = round + 1
      const targetBot = await getTargetBot()
      if (!targetBot) return

      await publishEvent(
        'debate.response',
        targetBot,
        session.debateId,
        chatId,
        { topic: session.topic, round: session.round, maxRounds: session.maxRounds, message: responseText || '(empty response)' },
      )

      scheduleResponseTimeout(session)
    } catch (error) {
      logger.error('debate', `Failed to generate debate response: ${error instanceof Error ? error.message : String(error)}`)
      await deps.output.sendText(
        chatId,
        escapeHtml(`❌ Failed to generate debate response: ${error instanceof Error ? error.message : String(error)}`),
        'HTML',
      )
      const targetBot = await getTargetBot()
      if (targetBot) {
        await publishEvent('debate.end', targetBot, session.debateId, chatId, { reason: 'AI prompt failed' })
      }
      sessions.delete(chatId)
    }
  }

  async function handleReviewRequest(chatId: number, event: CoordinationEvent): Promise<void> {
    if (deps.botRole !== 'reader') return

    const context = await loadChatContext(chatId)
    if (!context) return

    const target = typeof event.payload.target === 'string' ? event.payload.target : 'latest changes'
    const description = typeof event.payload.description === 'string'
      ? event.payload.description
      : 'Code review request'
    const debateId = event.debateId || event.id

    try {
      const prompt = `Provide a concise code review.\nTarget: ${target}\n${description}\nFocus on risks, correctness, and improvements.`
      const responseText = await sendPromptAndWaitForResponse(deps.claude, context.sessionId, context.directory, prompt) || '(empty response)'

      await deps.output.sendText(
        chatId,
        escapeHtml(truncateForTelegram(`🔍 Review: ${target}\n\n${responseText}`)),
        'HTML',
      )

      const targetBot = await getTargetBot()
      if (!targetBot) return

      await publishEvent(
        'review.response',
        targetBot,
        debateId,
        chatId,
        { target, message: responseText },
      )
    } catch (error) {
      logger.error('debate', `Failed to generate review: ${error instanceof Error ? error.message : String(error)}`)
      await deps.output.sendText(
        chatId,
        escapeHtml(`❌ Failed to generate review: ${error instanceof Error ? error.message : String(error)}`),
        'HTML',
      )
    }
  }

  async function handleReviewResponse(chatId: number, event: CoordinationEvent): Promise<void> {
    const session = sessions.get(chatId)
    if (!session || session.mode !== 'review') return
    
    if (event.debateId && event.debateId !== session.debateId) {
      logger.warn('debate', `debateId mismatch: event=${event.debateId}, session=${session.debateId}`)
      return
    }

    clearTimeoutFor(session)
    sessions.delete(chatId)
    stopPolling()

    const reviewMessage = typeof event.payload.message === 'string'
      ? event.payload.message
      : ''

    const header = session.target
      ? `🔎 Review: ${session.target}\n\n`
      : '🔎 Review Result\n\n'
    await deps.output.sendText(chatId, escapeHtml(truncateForTelegram(`${header}${reviewMessage}`)), 'HTML')
  }

  async function handleCoordinationEvent(chatId: number, event: CoordinationEvent): Promise<void> {
    if (event.toBot !== deps.instanceName) return

    switch (event.type) {
      case 'debate.request':
        await handleDebateRequest(chatId, event)
        break
      case 'debate.response':
        await handleDebateResponse(chatId, event)
        break
      case 'debate.end': {
        const session = sessions.get(chatId)
        if (!session || session.mode !== 'debate') return
        if (event.debateId && event.debateId !== session.debateId) return
        const reason = typeof event.payload.reason === 'string'
          ? event.payload.reason
          : 'Opponent ended the debate.'
        await endDebate(chatId, session, reason)
        break
      }
      case 'review.request':
        await handleReviewRequest(chatId, event)
        break
      case 'review.response':
        await handleReviewResponse(chatId, event)
        break
      default:
        break
    }
  }

  async function pollOnce(): Promise<void> {
    try {
      const { events, newOffset } = await deps.coordination.poll(pollOffset)
      pollOffset = newOffset

      const now = Date.now()
      for (const event of events) {
        if (event.toBot !== deps.instanceName) continue
        if (now - event.timestamp > LIMITS.COORDINATION_EVENT_TTL_MS) continue
        
        // Extract chatId from event
        const chatId = event.chatId
        if (!chatId) {
          logger.warn('debate', `Event missing chatId: ${event.id}`)
          continue
        }
        
        await handleCoordinationEvent(chatId, event)
      }
    } catch (error) {
      logger.warn('debate', `Coordination polling error: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  function startPolling(): void {
    if (pollInterval) return
    
    pollOffset = 0
    pollInterval = setInterval(() => {
      void pollOnce().catch(err => logger.error('debate', `Polling error: ${err}`))
    }, LIMITS.COORDINATION_POLL_INTERVAL_MS)
    
    logger.info('debate', 'Coordination polling started')
  }

  function stopPolling(): void {
    if (!pollInterval) return
    clearInterval(pollInterval)
    pollInterval = null
  }

  function isActive(chatId: number): boolean {
    return sessions.has(chatId)
  }

  function cleanupStaleAcceptances(): void {
    const now = Date.now()
    for (const [id, acc] of pendingAcceptances) {
      if (now - acc.createdAt > ACCEPTANCE_TTL_MS) pendingAcceptances.delete(id)
    }
  }

  async function handleAcceptance(chatId: number, debateId: string): Promise<void> {
    cleanupStaleAcceptances()
    const acceptance = pendingAcceptances.get(debateId)
    if (!acceptance) {
      await deps.output.sendText(chatId, escapeHtml('Debate data has expired.'), 'HTML')
      return
    }
    pendingAcceptances.delete(debateId)

    const history = acceptance.messages.map(m => {
      const label = m.from === 'self' ? 'Me' : 'Opponent'
      return `[${label} - Round ${m.round}]\n${m.text}`
    }).join('\n\n')

    const prompt = [
      `The following is the debate result for "${acceptance.topic}":`,
      '',
      history,
      '',
      'Apply the improvements and agreements from this debate to the codebase.',
      'Implement specific changes only as agreed in the debate.',
    ].join('\n')

    await sendWithRetry(() => deps.output.sendText(
      chatId,
      escapeHtml(`⚡ Applying debate results: ${acceptance.topic}`),
      'HTML',
    ))

    try {
      const handle = deps.claude.runQuery({
        prompt,
        sessionId: acceptance.sessionId,
        cwd: acceptance.directory,
      })
      // Fire and forget - we don't wait for the response
      void (async () => {
        for await (const _event of handle.messages) {
          // Consume the stream
        }
      })()
    } catch (error) {
      logger.error('debate', `Acceptance prompt failed: ${error instanceof Error ? error.message : String(error)}`)
      await deps.output.sendText(chatId, escapeHtml('❌ Failed to send acceptance prompt'), 'HTML')
    }
  }

  async function handleRejection(chatId: number, debateId: string): Promise<void> {
    pendingAcceptances.delete(debateId)
    await deps.output.sendText(chatId, escapeHtml('🗑️ Ignoring debate results.'), 'HTML')
  }

  return {
    startDebate,
    startReview,
    handleCoordinationEvent,
    startPolling,
    stopPolling,
    isActive,
    handleAcceptance,
    handleRejection,
  }
}
