import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { OutputHandle, UserSettings } from '../../domain/models.js'
import type { OpenCodeEvent, PermissionAsked, QuestionAsked } from '../../domain/events.js'
import type { SummaryService } from '../../adapters/opencode/summaryService.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml, sanitizeTelegramHtml, stripHtml } from '../../shared/formatResponse.js'
import { routeDelivery } from '../policies/deliveryRouter.js'
import { structuralExtract } from '../../shared/structuralExtract.js'

interface PromptFlowDeps {
  openCode: OpenCodePort
  state: StateStore
  output: ChatOutputPort
  summary: SummaryService
  onPermissionAsked?: (chatId: number, event: PermissionAsked) => Promise<void>
  onQuestionAsked?: (chatId: number, event: QuestionAsked) => Promise<void>
}

const SSE_TIMEOUT_MS = 24 * 60 * 60 * 1000
const STREAM_DISPLAY_LIMIT = 3500
const EDIT_THROTTLE_MS = 1000

const MDV2 = 'MarkdownV2'

function hasErrorCode(err: unknown, code: string): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes(code)
}

export function createPromptFlow(deps: PromptFlowDeps) {

  async function deliverFormatted(
    chatId: number,
    handle: OutputHandle,
    content: string,
  ): Promise<void> {
    const plan = routeDelivery(content)

    switch (plan.strategy) {
      case 'inline': {
        await deps.output.editText(chatId, handle, plan.messages![0], MDV2)
        break
      }
      case 'chunk': {
        const msgs = plan.messages!
        await deps.output.editText(chatId, handle, msgs[0], MDV2)
        for (let i = 1; i < msgs.length; i++) {
          await deps.output.sendText(chatId, msgs[i], MDV2)
        }
        break
      }
      case 'file': {
        const preview = structuralExtract(content).slice(0, 2000)
        await deps.output.editText(
          chatId, handle,
          preview + '\n\n<i>... (full response attached)</i>',
          'HTML',
        )
        const buffer = Buffer.from(plan.fileContent!, 'utf-8')
        await deps.output.sendFile(chatId, buffer, 'response.md', 'Full response attached.')
        break
      }
    }
  }

  async function deliverSafe(
    chatId: number,
    handle: OutputHandle,
    content: string,
  ): Promise<void> {
    try {
      await deliverFormatted(chatId, handle, content)
      return
    } catch (err) {
      if (!hasErrorCode(err, "can't parse entities") && !hasErrorCode(err, 'MESSAGE_TOO_LONG')) {
        throw err
      }
      logger.warn('session', `Delivery failed (${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}), forcing file delivery`)
    }

    const preview = structuralExtract(content).slice(0, 2000)
    await deps.output.editText(chatId, handle, preview + '\n\n<i>... (full response attached)</i>', 'HTML')
    await deps.output.sendFile(chatId, Buffer.from(content, 'utf-8'), 'response.md', 'Full response attached.')
  }

  async function sendFinalResponse(
    chatId: number,
    handle: OutputHandle,
    content: string,
    settings: UserSettings,
    directory: string,
  ): Promise<void> {
    if (settings.outputMode === 'raw') {
      const escaped = escapeHtml(content)
      if (escaped.length <= 3500) {
        await deps.output.editText(chatId, handle, escaped, 'HTML')
      } else {
        const preview = escaped.slice(0, 2000) + '\n\n<i>... (full response attached)</i>'
        await deps.output.editText(chatId, handle, preview, 'HTML')
        await deps.output.sendFile(chatId, Buffer.from(content, 'utf-8'), 'response.md', 'Full response attached.')
      }
      return
    }

    if (settings.summaryMode && settings.summaryModel && content.length > settings.summaryThreshold) {
      try {
        const rawSummary = await deps.summary.summarize(
          directory,
          content,
          settings.summaryModel,
        )
        const safeSummary = sanitizeTelegramHtml(rawSummary)
        try {
          await deps.output.editText(chatId, handle, safeSummary, 'HTML')
        } catch (htmlErr) {
          if (!hasErrorCode(htmlErr, "can't parse entities")) throw htmlErr
          logger.warn('session', 'Sanitized HTML still rejected, stripping tags')
          await deps.output.editText(chatId, handle, stripHtml(safeSummary))
        }
        await deps.output.sendFile(chatId, Buffer.from(content, 'utf-8'), 'response.md', '📄 Full response')
        return
      } catch (err) {
        logger.warn('session', `Summary failed, falling back to normal delivery: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    await deliverSafe(chatId, handle, content)
  }

  function truncateForDisplay(content: string): string {
    if (content.length <= STREAM_DISPLAY_LIMIT) return escapeHtml(content)
    const truncated = content.slice(0, STREAM_DISPLAY_LIMIT)
    return escapeHtml(truncated) + '\n\n<i>... streaming (will send full response when done)</i>'
  }

  async function handleUserMessage(chatId: number, text: string): Promise<void> {
    const state = await deps.state.getChatState(chatId)
    if (!state.activeProjectDirectory) {
      await deps.output.sendText(chatId, '활성 프로젝트가 없습니다. .env 에서 DEFAULT_PROJECT 를 설정하세요.')
      return
    }
    if (!state.activeSessionId) {
      await deps.output.sendText(chatId, '활성 세션이 없습니다. /new 로 새 세션을 시작하세요.')
      return
    }

    const directory = state.activeProjectDirectory
    const sessionId = state.activeSessionId

    state.lastPrompt = text
    await deps.state.saveChatState(chatId, state)

    const handle = await deps.output.sendText(chatId, '⏳ Processing...')

    const typingInterval = setInterval(() => {
      deps.output.sendTypingAction(chatId).catch(() => {})
    }, 5000)

    const abortController = new AbortController()
    let lastContent = ''
    let lastEditTime = 0
    let pendingEditTimer: ReturnType<typeof setTimeout> | null = null

    const throttledEdit = (content: string) => {
      if (pendingEditTimer) {
        clearTimeout(pendingEditTimer)
        pendingEditTimer = null
      }
      const now = Date.now()
      const elapsed = now - lastEditTime
      if (elapsed >= EDIT_THROTTLE_MS) {
        lastEditTime = now
        deps.output.editText(chatId, handle, truncateForDisplay(content)).catch(() => {})
      } else {
        pendingEditTimer = setTimeout(() => {
          lastEditTime = Date.now()
          pendingEditTimer = null
          deps.output.editText(chatId, handle, truncateForDisplay(content)).catch(() => {})
        }, EDIT_THROTTLE_MS - elapsed)
      }
    }

    const assistantMessageIds = new Set<string>()

    const eventHandler = async (event: OpenCodeEvent) => {
      switch (event.type) {
        case 'message.updated': {
          if (event.data.sessionId !== sessionId) return
          if (event.data.role === 'assistant') {
            assistantMessageIds.add(event.data.messageId)
          }
          break
        }
        case 'message.part.updated': {
          const { sessionId: evtSessionId, messageId, content } = event.data
          if (evtSessionId !== sessionId) return
          if (messageId && !assistantMessageIds.has(messageId)) return
          lastContent = content
          if (content.length > 0) {
            throttledEdit(content)
          }
          break
        }
        case 'session.idle': {
          if (event.data.sessionId !== sessionId) return
          logger.debug('session', `Received session.idle for ${sessionId}`)
          abortController.abort()
          break
        }
        case 'session.error': {
          if (event.data.sessionId !== sessionId) return
          logger.debug('session', `Received session.error for ${sessionId}: ${event.data.error}`)
          lastContent = `Error: ${event.data.error}`
          abortController.abort()
          break
        }
        case 'permission.asked': {
          if (event.data.sessionId !== sessionId) return
          try {
            await deps.onPermissionAsked?.(chatId, event.data)
          } catch (e) {
            logger.error('session', `Permission handler error: ${e}`)
          }
          break
        }
        case 'question.asked': {
          if (event.data.sessionId !== sessionId) return
          try {
            await deps.onQuestionAsked?.(chatId, event.data)
          } catch (e) {
            logger.error('session', `Question handler error: ${e}`)
          }
          break
        }
        default:
          break
      }
    }

    try {
      const ssePromise = deps.openCode
        .streamEvents(directory, eventHandler, abortController.signal)
        .catch((err) => {
          if (abortController.signal.aborted) return
          logger.error('session', `SSE stream error: ${err instanceof Error ? err.message : 'unknown'}`)
        })

      await deps.openCode.sendPrompt(sessionId, directory, text, state.activeAgent ?? undefined)
      logger.debug('session', `Prompt sent for session ${sessionId}, waiting for SSE completion...`)

      await Promise.race([
        ssePromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            logger.warn('session', `SSE timeout after ${SSE_TIMEOUT_MS / 1000}s for session ${sessionId}`)
            resolve()
          }, SSE_TIMEOUT_MS)
        }),
      ])

      if (pendingEditTimer) {
        clearTimeout(pendingEditTimer)
        pendingEditTimer = null
      }
      if (!abortController.signal.aborted) {
        abortController.abort()
      }

      const finalContent = lastContent || 'Done (no text output).'
      logger.debug('session', `Sending final response (${finalContent.length} chars)`)
      await sendFinalResponse(chatId, handle, finalContent, state.settings, directory)

    } catch (error) {
      if (pendingEditTimer) {
        clearTimeout(pendingEditTimer)
        pendingEditTimer = null
      }
      if (!abortController.signal.aborted) {
        abortController.abort()
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('session', `Prompt failed: ${message}`)
      try {
        await deps.output.editText(chatId, handle, `❌ Error: ${escapeHtml(message)}`)
      } catch {
        try { await deps.output.sendText(chatId, `❌ Error: ${escapeHtml(message)}`) } catch { /* give up */ }
      }
    } finally {
      clearInterval(typingInterval)
    }
  }

  return {
    handleUserMessage,
  }
}
