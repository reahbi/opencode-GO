import type { TranscriptionPort } from '../../domain/ports/TranscriptionPort.js'
import { logger } from '../../shared/logger.js'

export function createOpenAIWhisperAdapter(apiKey: string): TranscriptionPort {
  return {
    async transcribe(audio: Uint8Array, format: string): Promise<string> {
      const formData = new FormData()
      const buffer = Buffer.from(audio)
      const blob = new Blob([buffer], { type: `audio/${format}` })
      formData.append('file', blob, `audio.${format}`)
      formData.append('model', 'whisper-1')

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error')
        throw new Error(`Whisper API error ${response.status}: ${errorText}`)
      }

      const result = await response.json() as { text: string }
      logger.info('bot', `🎙 Transcribed ${audio.length} bytes → ${result.text.length} chars`)
      return result.text
    },
  }
}
