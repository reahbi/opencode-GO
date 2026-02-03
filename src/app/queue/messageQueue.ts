import type { ChatState, QueuedMessage } from '../../domain/models.js'
import { LIMITS } from '../policies/limits.js'

export interface EnqueueResult {
  queued: boolean
  position: number
  dropped?: number
}

export function enqueueMessage(
  state: ChatState,
  msg: QueuedMessage,
): EnqueueResult {
  const queue = state.queuedMessages
  let dropped = 0

  // Check character limit
  const totalChars = queue.reduce((sum, m) => sum + m.text.length, 0) + msg.text.length
  if (totalChars > LIMITS.MAX_QUEUED_CHARS) {
    // Drop oldest until under limit
    while (queue.length > 0 && 
           queue.reduce((s, m) => s + m.text.length, 0) + msg.text.length > LIMITS.MAX_QUEUED_CHARS) {
      queue.shift()
      dropped++
    }
  }

  // Check message count limit
  while (queue.length >= LIMITS.MAX_QUEUED_MESSAGES) {
    queue.shift()
    dropped++
  }

  queue.push(msg)
  return { queued: true, position: queue.length, dropped }
}

export function dequeueMessage(state: ChatState): QueuedMessage | null {
  return state.queuedMessages.shift() ?? null
}

export function clearQueue(state: ChatState): number {
  const count = state.queuedMessages.length
  state.queuedMessages = []
  return count
}

export function getQueueLength(state: ChatState): number {
  return state.queuedMessages.length
}
