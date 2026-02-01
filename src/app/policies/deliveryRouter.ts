import { formatMarkdownV2 } from '../../shared/formatResponse.js'

const TELEGRAM_SAFE_LIMIT = 3800
const BLOCK_SEP = '\n\n'

export type DeliveryStrategy = 'inline' | 'chunk' | 'file'

export interface DeliveryPlan {
  strategy: DeliveryStrategy
  messages?: string[]
  fileContent?: string
}

type BlockType = 'code' | 'text'

interface RawBlock {
  type: BlockType
  content: string
}

export function tokenizeBlocks(raw: string): RawBlock[] {
  const lines = raw.split('\n')
  const blocks: RawBlock[] = []
  let insideCode = false
  let currentLines: string[] = []

  const flushText = () => {
    if (currentLines.length === 0) return
    const joined = currentLines.join('\n')
    const paragraphs = joined.split(/\n{2,}/)
    for (const p of paragraphs) {
      const trimmed = p.trim()
      if (trimmed.length > 0) {
        blocks.push({ type: 'text', content: trimmed })
      }
    }
    currentLines = []
  }

  const flushCode = () => {
    if (currentLines.length === 0) return
    blocks.push({ type: 'code', content: currentLines.join('\n') })
    currentLines = []
  }

  for (const line of lines) {
    const isFence = line.trimStart().startsWith('```')

    if (isFence && !insideCode) {
      flushText()
      insideCode = true
      currentLines.push(line)
    } else if (isFence && insideCode) {
      currentLines.push(line)
      flushCode()
      insideCode = false
    } else {
      currentLines.push(line)
    }
  }

  if (insideCode) {
    flushCode()
  } else {
    flushText()
  }

  return blocks
}

interface FormattedBlock {
  type: BlockType
  raw: string
  formatted: string
  formattedLen: number
  oversize: boolean
}

function formatBlocks(blocks: RawBlock[]): FormattedBlock[] {
  return blocks.map((block) => {
    const formatted = formatMarkdownV2(block.content)
    return {
      type: block.type,
      raw: block.content,
      formatted,
      formattedLen: formatted.length,
      oversize: formatted.length > TELEGRAM_SAFE_LIMIT,
    }
  })
}

function packMessages(blocks: FormattedBlock[]): string[] | null {
  if (blocks.some((b) => b.oversize)) {
    return null
  }

  const messages: string[] = []
  let current = ''

  for (const block of blocks) {
    const sep = current.length > 0 ? BLOCK_SEP : ''
    const candidate = current + sep + block.formatted

    if (candidate.length <= TELEGRAM_SAFE_LIMIT) {
      current = candidate
    } else {
      if (current.length > 0) {
        messages.push(current)
      }
      current = block.formatted
    }
  }

  if (current.length > 0) {
    messages.push(current)
  }

  return messages
}

export function routeDelivery(content: string): DeliveryPlan {
  const blocks = tokenizeBlocks(content)
  const formatted = formatBlocks(blocks)
  const messages = packMessages(formatted)

  if (messages === null) {
    return {
      strategy: 'file',
      fileContent: content,
    }
  }

  if (messages.length === 0) {
    return {
      strategy: 'inline',
      messages: [formatMarkdownV2(content || '(empty)')],
    }
  }

  if (messages.length === 1) {
    return {
      strategy: 'inline',
      messages,
    }
  }

  return {
    strategy: 'chunk',
    messages,
  }
}
