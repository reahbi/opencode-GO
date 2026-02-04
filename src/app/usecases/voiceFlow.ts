import type { SummaryPort } from '../../domain/ports/SummaryPort.js'
import type { TtsPort } from '../../domain/ports/TtsPort.js'
import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { StateStore } from '../../domain/ports/StateStore.js'
import type { UserSettings } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'

interface VoiceFlowDeps {
  summary: SummaryPort
  tts: TtsPort
  output: ChatOutputPort
  state: StateStore
}

const inFlightRequests = new Map<string, Promise<void>>()

function makeRequestKey(chatId: number, sessionId: string, timestamp: number): string {
  return `${chatId}:${sessionId}:${timestamp}`
}

export interface VoiceFlow {
  sendVoiceResponse(chatId: number): Promise<void>
}

export function createVoiceFlow(deps: VoiceFlowDeps): VoiceFlow {

  async function sendVoiceResponse(chatId: number): Promise<void> {
    const chatState = await deps.state.getChatState(chatId)
    const { settings, lastAssistantResponse, activeProjectDirectory } = chatState

    if (!lastAssistantResponse) {
      await deps.output.sendText(chatId, '❌ 음성으로 변환할 응답이 없습니다.')
      return
    }

    if (!activeProjectDirectory) {
      await deps.output.sendText(chatId, '❌ 활성 프로젝트가 없습니다.')
      return
    }

    if (!settings.summaryModel) {
      await deps.output.sendText(chatId, '❌ 요약 모델이 설정되지 않았습니다. /settings에서 Summary 모델을 선택해주세요.')
      return
    }

    const requestKey = makeRequestKey(chatId, lastAssistantResponse.sessionId, lastAssistantResponse.timestamp)
    const existing = inFlightRequests.get(requestKey)
    if (existing) {
      logger.debug('voice', `Deduping voice request for ${requestKey}`)
      return existing
    }

    const promise = doSendVoiceResponse(chatId, lastAssistantResponse.content, settings, activeProjectDirectory)
    inFlightRequests.set(requestKey, promise)

    try {
      await promise
    } finally {
      inFlightRequests.delete(requestKey)
    }
  }

  async function doSendVoiceResponse(
    chatId: number,
    content: string,
    settings: UserSettings,
    directory: string,
  ): Promise<void> {
    const statusHandle = await deps.output.sendText(chatId, '🎧 음성 생성 중...')

    try {
      const voiceSummary = await deps.summary.summarizeForVoice(
        directory,
        content,
        settings.summaryModel!,
        settings.voiceSummaryLength,
      )

      logger.debug('voice', `Voice summary generated: ${voiceSummary.length} chars`)

      const audioData = await deps.tts.synthesize(voiceSummary, {
        gender: settings.voiceGender,
        speed: settings.voiceSpeed,
      })

      logger.debug('voice', `Audio synthesized: ${audioData.length} bytes`)

      await deps.output.sendAudio(chatId, audioData, 'voice-summary.mp3')
      await deps.output.editText(chatId, statusHandle, '✅ 음성 전송 완료')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      logger.error('voice', `Voice generation failed: ${message}`)

      try {
        const fallbackSummary = content.slice(0, settings.voiceSummaryLength)
        await deps.output.editText(
          chatId,
          statusHandle,
          `❌ 음성 생성 실패\n\n<b>텍스트 요약:</b>\n${fallbackSummary}${content.length > settings.voiceSummaryLength ? '...' : ''}`,
        )
      } catch {
        await deps.output.editText(chatId, statusHandle, `❌ 음성 생성 실패: ${message}`)
      }
    }
  }

  return { sendVoiceResponse }
}
