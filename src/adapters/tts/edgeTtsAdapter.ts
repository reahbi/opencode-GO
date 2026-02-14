import { spawn } from 'child_process'
import { readFile, unlink, writeFile, access } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import type { TtsPort, TtsOptions } from '../../domain/ports/TtsPort.js'

const VOICE_MAP = {
  ko: {
    female: 'ko-KR-SunHiNeural',
    male: 'ko-KR-InJoonNeural',
  },
  en: {
    female: 'en-US-JennyNeural',
    male: 'en-US-GuyNeural',
  },
} as const

function resolveEdgeTtsPath(): string {
  if (process.env.EDGE_TTS_PATH) {
    return process.env.EDGE_TTS_PATH
  }
  
  const home = homedir()
  const candidates = [
    join(home, '.local', 'edge-tts-env', 'bin', 'edge-tts'),
    join(tmpdir(), 'edge-tts-env', 'bin', 'edge-tts'),
    join(home, '.local', 'bin', 'edge-tts'),
    '/usr/local/bin/edge-tts',
    '/usr/bin/edge-tts',
  ]
  
  for (const path of candidates) {
    if (existsSync(path)) {
      return path
    }
  }
  
  return candidates[0]
}

const EDGE_TTS_PATH = resolveEdgeTtsPath()

function speedToRate(speed: number): string {
  const percent = Math.round((speed - 1) * 100)
  return percent >= 0 ? `+${percent}%` : `${percent}%`
}

export function createEdgeTtsAdapter(): TtsPort {
  return {
    async synthesize(text: string, options: TtsOptions): Promise<Uint8Array> {
      const lang = options.language || 'ko'
      const voice = VOICE_MAP[lang][options.gender]
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
