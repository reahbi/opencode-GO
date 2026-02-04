import { spawn } from 'child_process'
import { readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { TtsPort, TtsOptions } from '../../domain/ports/TtsPort.js'

const VOICE_MAP = {
  female: 'ko-KR-SunHiNeural',
  male: 'ko-KR-InJoonNeural',
} as const

const EDGE_TTS_PATH = '/tmp/edge-tts-env/bin/edge-tts'

function speedToRate(speed: number): string {
  const percent = Math.round((speed - 1) * 100)
  return percent >= 0 ? `+${percent}%` : `${percent}%`
}

export function createEdgeTtsAdapter(): TtsPort {
  return {
    async synthesize(text: string, options: TtsOptions): Promise<Uint8Array> {
      const voice = VOICE_MAP[options.gender]
      const rate = speedToRate(options.speed)
      
      const id = randomUUID()
      const textFile = join(tmpdir(), `tts-input-${id}.txt`)
      const audioFile = join(tmpdir(), `tts-output-${id}.mp3`)
      
      try {
        await writeFile(textFile, text, 'utf-8')
        
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(EDGE_TTS_PATH, [
            '--file', textFile,
            '--voice', voice,
            '--rate', rate,
            '--write-media', audioFile,
          ])
          
          let stderr = ''
          proc.stderr.on('data', (data) => { stderr += data.toString() })
          
          proc.on('close', (code) => {
            if (code === 0) {
              resolve()
            } else {
              reject(new Error(`edge-tts failed with code ${code}: ${stderr}`))
            }
          })
          
          proc.on('error', (err) => {
            reject(new Error(`Failed to spawn edge-tts: ${err.message}`))
          })
        })
        
        const audioBuffer = await readFile(audioFile)
        return new Uint8Array(audioBuffer)
      } finally {
        await Promise.all([
          unlink(textFile).catch(() => {}),
          unlink(audioFile).catch(() => {}),
        ])
      }
    },
  }
}
