import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { Button, PendingInteraction } from '../../domain/models.js'
import type { PermissionAsked, QuestionAsked } from '../../domain/events.js'
import { LIMITS } from '../policies/limits.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml } from '../../shared/formatResponse.js'

// Use globalThis.crypto.randomUUID() instead of node:crypto to maintain Clean Architecture
// (app/ layer should not import Node.js built-in modules directly)
function generateUUID(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  // Fallback for environments without WebCrypto
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

interface InteractiveFlowDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  botRole?: 'writer' | 'reader' | 'standalone'
}

export function answerLabel(answer: string[] | null): string {
  if (answer === null) return '⏳'
  if (answer.length === 0) return '⏭️ skipped'
  if (answer.length === 1) return `✅ ${escapeHtml(answer[0])}`
  return `✅ ${answer.map(a => escapeHtml(a)).join(', ')}`
}

export function refreshTTL(interaction: PendingInteraction): void {
  interaction.expiresAt = Date.now() + LIMITS.INTERACTION_TTL_MS
}

export function toSubmitAnswers(interaction: PendingInteraction): string[][] {
  const answers = interaction.collectedAnswers ?? []
  return answers.map(a => (a === null ? [] : a))
}

export function createInteractiveFlow(deps: InteractiveFlowDeps) {

  function buildQuestionMessage(interaction: PendingInteraction): { text: string; buttons: Button[] } {
    const questions = interaction.questions ?? []
    const answers = interaction.collectedAnswers ?? []
    const phase = interaction.phase ?? 'answering'
    const currentIdx = interaction.currentQuestionIndex ?? 0
    const total = questions.length

    if (phase === 'confirm') {
      const lines: string[] = [`✅ <b>Review Answers (${total})</b>\n`]
      for (let i = 0; i < total; i++) {
        const q = questions[i]
        const a = answers[i]
        lines.push(`<b>${i + 1}.</b> ${escapeHtml(q.text)}`)
        lines.push(`   → ${answerLabel(a)}\n`)
      }
      const buttons: Button[] = [
        { label: '✅ Submit', callbackData: `q:${interaction.interactionId}:ok` },
        { label: '🔄 Reset', callbackData: `q:${interaction.interactionId}:redo` },
      ]
      return { text: lines.join('\n'), buttons }
    }

    const answeredCount = answers.filter(a => a !== null).length
    const header = total > 1
      ? `❓ <b>Questions (${answeredCount}/${total} answered)</b>`
      : `❓ <b>Question</b>`

    const lines: string[] = [header, '']

    for (let i = 0; i < total; i++) {
      const q = questions[i]
      const a = answers[i]
      const isCurrent = i === currentIdx
      const prefix = isCurrent ? '👉 ' : '   '
      const status = a !== null ? answerLabel(a) : '⏳'
      const qText = escapeHtml(q.text)

      if (isCurrent) {
        lines.push(`${prefix}<b>${i + 1}.</b> ${qText}`)
      } else {
        lines.push(`${prefix}${i + 1}. ${qText}  ${status}`)
      }
    }

    const currentQ = questions[currentIdx]
    const buttons: Button[] = []
    const isMultiple = currentQ?.multiple === true
    const currentAnswers = answers[currentIdx] ?? []

    if (currentQ?.options && currentQ.options.length > 0) {
      for (let i = 0; i < currentQ.options.length; i++) {
        const optionLabel = currentQ.options[i]
        if (isMultiple) {
          const isSelected = currentAnswers.includes(optionLabel)
          const prefix = isSelected ? '✓ ' : '☐ '
          buttons.push({
            label: `${prefix}${optionLabel}`,
            callbackData: `q:${interaction.interactionId}:${currentIdx}:toggle:${i}`,
          })
        } else {
          buttons.push({
            label: optionLabel,
            callbackData: `q:${interaction.interactionId}:${currentIdx}:${i}`,
          })
        }
      }
    }

    if (isMultiple) {
      const selectedCount = currentAnswers.length
      buttons.push({
        label: selectedCount > 0 ? `Next (${selectedCount} selected) →` : 'Next →',
        callbackData: `q:${interaction.interactionId}:${currentIdx}:next`,
      })
    }

    buttons.push({
      label: '✏️ Type answer',
      callbackData: `q:${interaction.interactionId}:${currentIdx}:type`,
    })
    buttons.push({
      label: '⏭️ Skip',
      callbackData: `q:${interaction.interactionId}:${currentIdx}:skip`,
    })
    if (currentIdx > 0) {
      buttons.push({
        label: '← Back',
        callbackData: `q:${interaction.interactionId}:${currentIdx}:back`,
      })
    }

    return { text: lines.join('\n'), buttons }
  }

  async function editOrSendQuestion(chatId: number, interaction: PendingInteraction): Promise<void> {
    const { text, buttons } = buildQuestionMessage(interaction)
    if (interaction.messageHandle) {
      try {
        await deps.output.editInteraction(chatId, interaction.messageHandle, text, buttons)
        return
      } catch {
        logger.warn('interactive', `Failed to edit message ${interaction.messageHandle}, sending new`)
      }
    }
    const handle = await deps.output.sendInteraction(chatId, text, buttons)
    interaction.messageHandle = handle
  }

  async function submitAllAnswers(
    chatId: number,
    interaction: PendingInteraction,
    chatState: Awaited<ReturnType<typeof deps.state.getChatState>>,
  ): Promise<void> {
    const directory = interaction.directory ?? chatState.activeProjectDirectory
    if (!directory) {
      await deps.output.sendText(chatId, '❌ No active project directory')
      return
    }

    const answers = toSubmitAnswers(interaction)
    logger.info('interactive', `Submitting ${answers.length} answers for requestId=${interaction.requestId}: ${JSON.stringify(answers)}`)

    let replyFailed = false
    try {
      await deps.openCode.replyQuestion(interaction.requestId, directory, answers)
      logger.info('interactive', `replyQuestion succeeded for requestId=${interaction.requestId}`)
    } catch (err) {
      logger.info('interactive', `replyQuestion failed (likely already resolved elsewhere): requestId=${interaction.requestId}: ${err instanceof Error ? err.message : String(err)}`)
      replyFailed = true
    }

    chatState.pendingInteractions = chatState.pendingInteractions.filter(
      i => i.interactionId !== interaction.interactionId
    )
    chatState.awaitingInput = null
    chatState.awaitingInteractionId = null
    await deps.state.saveChatState(chatId, chatState)

    if (interaction.messageHandle) {
      let summary: string

      if (replyFailed) {
        summary = '✅ 이미 다른 곳에서 답변되었습니다'
      } else {
        const questions = interaction.questions ?? []
        const total = questions.length

        if (total === 1) {
          const answer = answers[0] ?? []
          const answerText = answer.length === 0
            ? '⏭️ skipped'
            : escapeHtml(answer.join(', '))
          summary = `✅ <b>Answered:</b> ${answerText}`
        } else {
          const lines = [`✅ <b>${total} questions answered</b>\n`]
          for (let i = 0; i < total; i++) {
            const q = questions[i]
            const a = answers[i] ?? []
            lines.push(`<b>${i + 1}.</b> ${escapeHtml(q?.text ?? '?')}`)
            lines.push(`   → ${answerLabel(a)}\n`)
          }
          summary = lines.join('\n')
        }
      }

      try {
        await deps.output.editInteraction(chatId, interaction.messageHandle, summary, [])
      } catch {
        await deps.output.sendText(chatId, summary)
      }
    }
  }

  async function handlePermissionEvent(chatId: number, event: PermissionAsked, actorUserId?: number, directory?: string): Promise<void> {
    try {
      if (deps.botRole === 'reader') {
        const chatState = await deps.state.getChatState(chatId)
        const dir = directory ?? chatState.activeProjectDirectory
        if (!dir) {
          logger.warn('interactive', `Reader bot permission auto-reject skipped (no directory, requestId=${event.requestId})`)
          return
        }
        await deps.openCode.replyPermission(event.requestId, dir, 'reject')
        await deps.output.sendText(chatId, '🔒 Reader bot: Permission auto-rejected (read-only)')
        return
      }

      const interactionId = generateUUID()
      const interaction: PendingInteraction = {
        interactionId,
        sessionId: event.sessionId,
        requestId: event.requestId,
        type: 'permission',
        expiresAt: Date.now() + LIMITS.INTERACTION_TTL_MS,
        creatorUserId: actorUserId,
        directory,
      }

      const chatState = await deps.state.getChatState(chatId)
      chatState.pendingInteractions.push(interaction)
      await deps.state.saveChatState(chatId, chatState)

      const text = `🔐 <b>Permission requested</b>\n${escapeHtml(event.title)}\nPatterns: ${event.patterns.map(escapeHtml).join(', ')}`
      const buttons: Button[] = [
        { label: 'Allow Once', callbackData: `perm:${interactionId}:once` },
        { label: 'Allow Always', callbackData: `perm:${interactionId}:always` },
        { label: 'Deny', callbackData: `perm:${interactionId}:reject` },
      ]

      await deps.output.sendInteraction(chatId, text, buttons)
    } catch (error) {
      logger.error('interactive', 'Failed to handle permission event', { chatId, error })
      await deps.output.sendText(chatId, '❌ Failed to process permission request')
    }
  }

  async function handleQuestionEvent(chatId: number, event: QuestionAsked, actorUserId?: number, directory?: string): Promise<void> {
    try {
      const interactionId = generateUUID()
      const questions = event.questions.map(q => ({
        text: q.text,
        options: q.options ?? [],
        multiple: q.multiple,
      }))

      if (questions.length === 0) {
        logger.warn('interactive', `Received question event with 0 questions (requestId=${event.requestId})`)
        return
      }

      const collectedAnswers: (string[] | null)[] = new Array(questions.length).fill(null)

      const interaction: PendingInteraction = {
        interactionId,
        sessionId: event.sessionId,
        requestId: event.requestId,
        type: 'question',
        expiresAt: Date.now() + LIMITS.INTERACTION_TTL_MS,
        questions,
        collectedAnswers,
        currentQuestionIndex: 0,
        phase: 'answering',
        creatorUserId: actorUserId,
        directory,
      }

      const chatState = await deps.state.getChatState(chatId)
      chatState.pendingInteractions.push(interaction)
      await deps.state.saveChatState(chatId, chatState)
      logger.info('interactive', `Stored ${questions.length} question(s) as interaction ${interactionId} (requestId=${event.requestId})`)

      const { text, buttons } = buildQuestionMessage(interaction)
      const handle = await deps.output.sendInteraction(chatId, text, buttons)
      interaction.messageHandle = handle
      await deps.state.saveChatState(chatId, chatState)
    } catch (error) {
      logger.error('interactive', 'Failed to handle question event', { chatId, error })
      await deps.output.sendText(chatId, '❌ Failed to process question')
    }
  }

  async function handlePermissionCallback(
    chatId: number,
    interactionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = chatState.pendingInteractions.find(i => i.interactionId === interactionId)

        if (!interaction || now > interaction.expiresAt) {
          await deps.state.saveChatState(chatId, chatState)
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        const directory = interaction.directory ?? chatState.activeProjectDirectory
        if (!directory) {
          await deps.state.saveChatState(chatId, chatState)
          await deps.output.sendText(chatId, '❌ No active project directory')
          return
        }

        let replyFailed = false
        try {
          await deps.openCode.replyPermission(interaction.requestId, directory, response)
        } catch (err) {
          logger.info('interactive', `replyPermission failed (likely already resolved elsewhere): requestId=${interaction.requestId}: ${err instanceof Error ? err.message : String(err)}`)
          replyFailed = true
        }

        chatState.pendingInteractions = chatState.pendingInteractions.filter(
          i => i.interactionId !== interactionId
        )
        await deps.state.saveChatState(chatId, chatState)

        const msg = replyFailed
          ? '✅ 이미 다른 곳에서 답변되었습니다'
          : `✅ Permission: ${response}`
        await deps.output.sendText(chatId, msg)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle permission callback', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process permission response')
    }
  }

  function findInteraction(chatState: Awaited<ReturnType<typeof deps.state.getChatState>>, interactionId: string): PendingInteraction | null {
    const interaction = chatState.pendingInteractions.find(i => i.interactionId === interactionId)
    if (!interaction) return null
    if (Date.now() > interaction.expiresAt) return null
    return interaction
  }

  async function handleQuestionAnswer(
    chatId: number,
    interactionId: string,
    questionIndex: number,
    answerIndex: number,
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        const questions = interaction.questions ?? []
        const answers = interaction.collectedAnswers ?? new Array(questions.length).fill(null)
        const currentQ = questions[questionIndex]
        if (!currentQ) return

        const label = currentQ.options?.[answerIndex] ?? String(answerIndex)
        answers[questionIndex] = [label]
        interaction.collectedAnswers = answers

        logger.info('interactive', `Q${questionIndex + 1}/${questions.length} answered: "${label}"`)

        await advanceToNext(chatId, interaction, chatState)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question answer', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process answer')
    }
  }

  async function handleQuestionToggle(
    chatId: number,
    interactionId: string,
    questionIndex: number,
    answerIndex: number,
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        const questions = interaction.questions ?? []
        const answers = interaction.collectedAnswers ?? new Array(questions.length).fill(null)
        const currentQ = questions[questionIndex]
        if (!currentQ) return

        const label = currentQ.options?.[answerIndex] ?? String(answerIndex)
        const currentAnswers: string[] = answers[questionIndex] ?? []
        
        if (currentAnswers.includes(label)) {
          answers[questionIndex] = currentAnswers.filter((a: string) => a !== label)
        } else {
          answers[questionIndex] = [...currentAnswers, label]
        }
        interaction.collectedAnswers = answers

        logger.info('interactive', `Q${questionIndex + 1}/${questions.length} toggled: "${label}" (now ${answers[questionIndex]?.length ?? 0} selected)`)

        await deps.state.saveChatState(chatId, chatState)
        await editOrSendQuestion(chatId, interaction)
        await deps.state.saveChatState(chatId, chatState)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question toggle', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process selection')
    }
  }

  async function handleQuestionNext(
    chatId: number,
    interactionId: string,
    questionIndex: number,
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        const questions = interaction.questions ?? []
        const answers = interaction.collectedAnswers ?? new Array(questions.length).fill(null)
        
        if (answers[questionIndex] === null) {
          answers[questionIndex] = []
        }
        interaction.collectedAnswers = answers

        logger.info('interactive', `Q${questionIndex + 1}/${questions.length} confirmed with ${answers[questionIndex]?.length ?? 0} selections`)

        await advanceToNext(chatId, interaction, chatState)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question next', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to proceed')
    }
  }

  async function handleQuestionSkip(
    chatId: number,
    interactionId: string,
    questionIndex: number,
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        const questions = interaction.questions ?? []
        const answers = interaction.collectedAnswers ?? new Array(questions.length).fill(null)
        answers[questionIndex] = []
        interaction.collectedAnswers = answers

        logger.info('interactive', `Q${questionIndex + 1}/${questions.length} skipped`)

        await advanceToNext(chatId, interaction, chatState)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question skip', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process skip')
    }
  }

  async function handleQuestionBack(
    chatId: number,
    interactionId: string,
    questionIndex: number,
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        const prevIdx = Math.max(0, questionIndex - 1)
        interaction.currentQuestionIndex = prevIdx
        interaction.phase = 'answering'

        await deps.state.saveChatState(chatId, chatState)
        await editOrSendQuestion(chatId, interaction)
        await deps.state.saveChatState(chatId, chatState)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question back', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to go back')
    }
  }

  async function handleQuestionType(
    chatId: number,
    interactionId: string,
    questionIndex: number,
  ): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        interaction.currentQuestionIndex = questionIndex
        chatState.awaitingInput = 'question'
        chatState.awaitingInteractionId = interactionId
        await deps.state.saveChatState(chatId, chatState)
        await deps.output.sendText(chatId, '✏️ Type your answer and send it as a message:')
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question type', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to process type request')
    }
  }

  async function handleQuestionConfirm(chatId: number, interactionId: string): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        await submitAllAnswers(chatId, interaction, chatState)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question confirm', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to submit answers')
    }
  }

  async function handleQuestionReset(chatId: number, interactionId: string): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
        
        const interaction = findInteraction(chatState, interactionId)

        if (!interaction) {
          await deps.output.sendText(chatId, 'This interaction has expired.')
          return
        }

        refreshTTL(interaction)
        const questions = interaction.questions ?? []
        interaction.collectedAnswers = new Array(questions.length).fill(null)
        interaction.currentQuestionIndex = 0
        interaction.phase = 'answering'

        await deps.state.saveChatState(chatId, chatState)
        await editOrSendQuestion(chatId, interaction)
        await deps.state.saveChatState(chatId, chatState)

        logger.info('interactive', `Reset all answers for interaction ${interactionId}`)
      })
    } catch (error) {
      logger.error('interactive', 'Failed to handle question reset', { chatId, interactionId, error })
      await deps.output.sendText(chatId, '❌ Failed to reset answers')
    }
  }

  async function advanceToNext(
    chatId: number,
    interaction: PendingInteraction,
    chatState: Awaited<ReturnType<typeof deps.state.getChatState>>,
  ): Promise<void> {
    const questions = interaction.questions ?? []
    const answers = interaction.collectedAnswers ?? []

    if (questions.length === 1) {
      await submitAllAnswers(chatId, interaction, chatState)
      return
    }

    const nextUnanswered = answers.findIndex(a => a === null)

    if (nextUnanswered === -1) {
      interaction.phase = 'confirm'
      await deps.state.saveChatState(chatId, chatState)
      await editOrSendQuestion(chatId, interaction)
      await deps.state.saveChatState(chatId, chatState)
    } else {
      interaction.currentQuestionIndex = nextUnanswered
      interaction.phase = 'answering'
      await deps.state.saveChatState(chatId, chatState)
      await editOrSendQuestion(chatId, interaction)
      await deps.state.saveChatState(chatId, chatState)
    }
  }

  async function handleFreeTextAnswer(chatId: number, text: string): Promise<boolean> {
    let handled = false
    await deps.state.withChatLock(chatId, async () => {
      const chatState = await deps.state.getChatState(chatId)
      const interactionId = chatState.awaitingInteractionId

      chatState.awaitingInput = null
      chatState.awaitingInteractionId = null

      if (!interactionId) {
        await deps.state.saveChatState(chatId, chatState)
        return
      }

      const now = Date.now()
      chatState.pendingInteractions = chatState.pendingInteractions.filter(i => now <= i.expiresAt)
      
      const interaction = chatState.pendingInteractions.find(i => i.interactionId === interactionId)
      if (!interaction || now > interaction.expiresAt) {
        await deps.state.saveChatState(chatId, chatState)
        return
      }

      handled = true
      refreshTTL(interaction)
      const questions = interaction.questions ?? []
      const currentIdx = interaction.currentQuestionIndex ?? 0
      const answers = interaction.collectedAnswers ?? new Array(questions.length).fill(null)

      answers[currentIdx] = [text]
      interaction.collectedAnswers = answers
      logger.info('interactive', `Q${currentIdx + 1}/${questions.length} free-text: "${text}"`)

      await advanceToNext(chatId, interaction, chatState)
    })
    return handled
  }

  async function cleanupExpired(chatId: number): Promise<void> {
    try {
      await deps.state.withChatLock(chatId, async () => {
        const chatState = await deps.state.getChatState(chatId)
        const now = Date.now()
        const originalCount = chatState.pendingInteractions.length

        chatState.pendingInteractions = chatState.pendingInteractions.filter(
          i => now <= i.expiresAt
        )

        if (chatState.pendingInteractions.length < originalCount) {
          logger.info('interactive', `cleanupExpired removed ${originalCount - chatState.pendingInteractions.length} for chat ${chatId}`)
          await deps.state.saveChatState(chatId, chatState)
        }
      })
    } catch (error) {
      logger.error('interactive', 'Failed to cleanup expired interactions', { chatId, error })
    }
  }

  return {
    handlePermissionEvent,
    handleQuestionEvent,
    handlePermissionCallback,
    handleQuestionAnswer,
    handleQuestionToggle,
    handleQuestionNext,
    handleQuestionSkip,
    handleQuestionBack,
    handleQuestionType,
    handleQuestionConfirm,
    handleQuestionReset,
    handleFreeTextAnswer,
    cleanupExpired,
  }
}
