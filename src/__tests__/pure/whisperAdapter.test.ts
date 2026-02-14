import { describe, it, expect, mock, afterEach } from 'bun:test'
import { createOpenAIWhisperAdapter } from '../../adapters/whisper/openaiWhisperAdapter.js'

describe('openaiWhisperAdapter', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('can be created with an API key', () => {
    const adapter = createOpenAIWhisperAdapter('test-key')
    expect(adapter).toHaveProperty('transcribe')
    expect(typeof adapter.transcribe).toBe('function')
  })

  it('calls OpenAI Whisper API with correct parameters', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: FormData | null = null

    globalThis.fetch = mock(async (url: any, opts: any) => {
      capturedUrl = String(url)
      capturedHeaders = Object.fromEntries(
        Object.entries(opts.headers || {})
      ) as Record<string, string>
      capturedBody = opts.body as FormData
      return new Response(JSON.stringify({ text: 'hello world' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as any

    const adapter = createOpenAIWhisperAdapter('sk-test-123')
    const audio = new Uint8Array([1, 2, 3, 4])
    const result = await adapter.transcribe(audio, 'ogg')

    expect(capturedUrl).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-test-123')
    expect(capturedBody).toBeInstanceOf(FormData)
    expect(result).toBe('hello world')
  })

  it('throws on API error', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Rate limited', { status: 429 })
    }) as any

    const adapter = createOpenAIWhisperAdapter('sk-test')
    const audio = new Uint8Array([1, 2, 3])

    await expect(adapter.transcribe(audio, 'ogg')).rejects.toThrow('Whisper API error 429')
  })

  it('includes error text in thrown error', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('{"error":"invalid_api_key"}', { status: 401 })
    }) as any

    const adapter = createOpenAIWhisperAdapter('bad-key')
    const audio = new Uint8Array([5, 6])

    await expect(adapter.transcribe(audio, 'mp3')).rejects.toThrow('invalid_api_key')
  })
})
