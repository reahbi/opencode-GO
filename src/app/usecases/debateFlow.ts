import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { CoordinationPort, CoordinationEvent } from '../../domain/ports/CoordinationPort.js'
import type { AgentOutput } from '../../domain/events.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../policies/limits.js'

interface DebateFlowDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  coordination: CoordinationPort
  botRole: 'writer' | 'reader' | 'standalone'
  instanceName: string
}

type DebateMode = 'debate' | 'review'

interface DebateSession {
  chatId: number
  sessionId: string
  directory: string
  topic: string
  round: number
  mode: DebateMode
  target?: string
  timeoutId?: ReturnType<typeof setTimeout>
}

interface ChatContext {
  sessionId: string
  directory: string
  agent: string | null
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function extractText(output: AgentOutput): string {
  const textParts = output.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
  return textParts.join('\n').trim()
}

export function createDebateFlow(deps: DebateFlowDeps) {
  const sessions = new Map<number, DebateSession>()
  let pollInterval: ReturnType<typeof setInterval> | null = null
  let pollOffset = 0
  let pollChatId: number | null = null

  function getTargetBot(): string | null {
    if (deps.botRole === 'standalone') return null
    return deps.botRole === 'writer' ? 'reader' : 'writer'
  }

  async function loadChatContext(chatId: number): Promise<ChatContext | null> {
    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory) {
      await deps.output.sendText(
        chatId,
        escapeHtml('활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.'),
        'HTML',
      )
      return null
    }
    if (!state.activeSessionId) {
      await deps.output.sendText(
        chatId,
        escapeHtml('활성 세션이 없습니다. /new 로 새 세션을 시작하세요.'),
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
    await endDebate(session.chatId, session, '응답 시간이 초과되었습니다.')
  }

  async function publishEvent(
    type: CoordinationEvent['type'],
    toBot: string,
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await deps.coordination.publish({
      type,
      fromBot: deps.instanceName,
      toBot,
      sessionId,
      payload,
    })
  }

  async function endDebate(chatId: number, session: DebateSession, reason: string): Promise<void> {
    clearTimeoutFor(session)
    sessions.delete(chatId)
    stopPolling()

    const targetBot = getTargetBot()
    if (session.mode === 'debate' && targetBot) {
      await publishEvent(
        'debate.end',
        targetBot,
        session.sessionId,
        { topic: session.topic, round: session.round, reason },
      )
    }

    const endMessage = session.mode === 'review'
      ? `✅ Review finished: ${reason}`
      : `🏁 Debate finished: ${reason}`
    await deps.output.sendText(chatId, escapeHtml(endMessage), 'HTML')
  }

  async function startDebate(chatId: number, topic: string): Promise<void> {
    const context = await loadChatContext(chatId)
    if (!context) return

    const targetBot = getTargetBot()
    if (!targetBot) {
      await deps.output.sendText(
        chatId,
        escapeHtml('단독 모드에서는 /debate 를 사용할 수 없습니다.'),
        'HTML',
      )
      return
    }

    const cleanTopic = topic.trim()
    const session: DebateSession = {
      chatId,
      sessionId: context.sessionId,
      directory: context.directory,
      topic: cleanTopic,
      round: 1,
      mode: 'debate',
    }

    sessions.set(chatId, session)

    await deps.output.sendText(
      chatId,
      escapeHtml(`🎭 Starting debate: ${cleanTopic}`),
      'HTML',
    )

    await publishEvent(
      'debate.request',
      targetBot,
      context.sessionId,
      { topic: cleanTopic, round: 1 },
    )

    startPolling(chatId)
    scheduleResponseTimeout(session)
  }

  async function startReview(chatId: number, target?: string): Promise<void> {
    const context = await loadChatContext(chatId)
    if (!context) return

    const targetBot = getTargetBot()
    if (!targetBot) {
      await deps.output.sendText(
        chatId,
        escapeHtml('단독 모드에서는 /review 를 사용할 수 없습니다.'),
        'HTML',
      )
      return
    }

    const reviewTarget = target?.trim() || 'latest changes'
    const session: DebateSession = {
      chatId,
      sessionId: context.sessionId,
      directory: context.directory,
      topic: reviewTarget,
      round: 1,
      mode: 'review',
      target: reviewTarget,
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
      context.sessionId,
      { target: reviewTarget, description: 'Code review request' },
    )

    startPolling(chatId)
    scheduleResponseTimeout(session)
  }

  async function handleDebateRequest(chatId: number, event: CoordinationEvent): Promise<void> {
    if (deps.botRole === 'standalone') return

    const context = await loadChatContext(chatId)
    if (!context) return

    if (event.sessionId !== context.sessionId) return

    const topic = typeof event.payload.topic === 'string' ? event.payload.topic : 'Debate'
    const round = typeof event.payload.round === 'number' ? event.payload.round : 1

    const session: DebateSession = {
      chatId,
      sessionId: context.sessionId,
      directory: context.directory,
      topic,
      round,
      mode: 'debate',
    }
    sessions.set(chatId, session)

    const prompt = `You are in a structured debate.\nTopic: ${topic}\nRound ${round}.\nProvide your opening argument.`
    const output = await deps.openCode.sendPrompt(
      context.sessionId,
      context.directory,
      prompt,
      context.agent ?? undefined,
    )

    const responseText = extractText(output) || 'No response generated.'
    const targetBot = getTargetBot()
    if (!targetBot) return

    session.round = round + 1
    await publishEvent(
      'debate.response',
      targetBot,
      context.sessionId,
      { topic, round: session.round, message: responseText },
    )

    scheduleResponseTimeout(session)
  }

  async function handleDebateResponse(chatId: number, event: CoordinationEvent): Promise<void> {
    const session = sessions.get(chatId)
    if (!session || session.mode !== 'debate') return
    if (event.sessionId !== session.sessionId) return

    const round = typeof event.payload.round === 'number' ? event.payload.round : session.round
    const opponentMessage = typeof event.payload.message === 'string'
      ? event.payload.message
      : ''

    if (round >= LIMITS.MAX_DEBATE_ROUNDS) {
      await endDebate(chatId, session, '최대 라운드에 도달했습니다.')
      return
    }

    const prompt = `You are debating the topic: ${session.topic}.\nRound ${round}.\nOpponent says:\n${opponentMessage}\n\nRespond with your argument.`
    const output = await deps.openCode.sendPrompt(
      session.sessionId,
      session.directory,
      prompt,
      undefined,
    )
    const responseText = extractText(output) || 'No response generated.'

    session.round = round + 1
    const targetBot = getTargetBot()
    if (!targetBot) return

    await publishEvent(
      'debate.response',
      targetBot,
      session.sessionId,
      { topic: session.topic, round: session.round, message: responseText },
    )

    scheduleResponseTimeout(session)
  }

  async function handleReviewRequest(chatId: number, event: CoordinationEvent): Promise<void> {
    if (deps.botRole !== 'reader') return

    const context = await loadChatContext(chatId)
    if (!context) return
    if (event.sessionId !== context.sessionId) return

    const target = typeof event.payload.target === 'string' ? event.payload.target : 'latest changes'
    const description = typeof event.payload.description === 'string'
      ? event.payload.description
      : 'Code review request'

    const prompt = `Provide a concise code review.\nTarget: ${target}\n${description}\nFocus on risks, correctness, and improvements.`
    const output = await deps.openCode.sendPrompt(
      context.sessionId,
      context.directory,
      prompt,
      context.agent ?? undefined,
    )
    const responseText = extractText(output) || 'No review generated.'

    const targetBot = getTargetBot()
    if (!targetBot) return

    await publishEvent(
      'review.response',
      targetBot,
      context.sessionId,
      { target, message: responseText },
    )
  }

  async function handleReviewResponse(chatId: number, event: CoordinationEvent): Promise<void> {
    const session = sessions.get(chatId)
    if (!session || session.mode !== 'review') return
    if (event.sessionId !== session.sessionId) return

    const reviewMessage = typeof event.payload.message === 'string'
      ? event.payload.message
      : ''

    clearTimeoutFor(session)
    sessions.delete(chatId)
    stopPolling()

    const header = session.target
      ? `🔎 Review: ${session.target}\n\n`
      : '🔎 Review Result\n\n'
    await deps.output.sendText(chatId, escapeHtml(`${header}${reviewMessage}`), 'HTML')
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
        const reason = typeof event.payload.reason === 'string'
          ? event.payload.reason
          : '상대 봇이 종료했습니다.'
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
    if (pollChatId === null) return
    try {
      const { events, newOffset } = await deps.coordination.poll(pollOffset)
      pollOffset = newOffset

      const now = Date.now()
      for (const event of events) {
        if (event.toBot !== deps.instanceName) continue
        if (now - event.timestamp > LIMITS.COORDINATION_EVENT_TTL_MS) continue
        await handleCoordinationEvent(pollChatId, event)
      }
    } catch (error) {
      logger.warn('debate', `Coordination polling error: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  function startPolling(chatId: number): void {
    pollChatId = chatId
    if (pollInterval) return
    void deps.coordination.currentOffset().then((offset) => {
      pollOffset = offset
    }).catch((error) => {
      logger.warn('debate', `Failed to read coordination offset: ${error instanceof Error ? error.message : 'unknown'}`)
    })

    pollInterval = setInterval(() => {
      void pollOnce()
    }, LIMITS.COORDINATION_POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    if (!pollInterval) return
    clearInterval(pollInterval)
    pollInterval = null
    pollChatId = null
  }

  return {
    startDebate,
    startReview,
    handleCoordinationEvent,
    startPolling,
    stopPolling,
  }
}
