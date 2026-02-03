import { describe, it, expect, beforeEach } from 'bun:test'
import { enqueueMessage, dequeueMessage, clearQueue, getQueueLength } from '../../app/queue/messageQueue.js'
import { createDefaultChatState } from '../../domain/models.js'
import type { ChatState, QueuedMessage } from '../../domain/models.js'

describe('messageQueue', () => {
  let state: ChatState

  beforeEach(() => {
    state = createDefaultChatState()
  })

  describe('enqueueMessage', () => {
    it('should add message to empty queue', () => {
      const msg: QueuedMessage = { text: 'hello', timestamp: Date.now() }
      const result = enqueueMessage(state, msg)
      
      expect(result.queued).toBe(true)
      expect(result.position).toBe(1)
      expect(result.dropped).toBe(0)
      expect(state.queuedMessages).toHaveLength(1)
    })

    it('should add message to existing queue', () => {
      state.queuedMessages = [{ text: 'first', timestamp: 1 }]
      const msg: QueuedMessage = { text: 'second', timestamp: 2 }
      const result = enqueueMessage(state, msg)
      
      expect(result.position).toBe(2)
      expect(state.queuedMessages).toHaveLength(2)
    })

    it('should drop oldest when exceeding MAX_QUEUED_MESSAGES', () => {
      for (let i = 0; i < 5; i++) {
        state.queuedMessages.push({ text: `msg${i}`, timestamp: i })
      }
      
      const msg: QueuedMessage = { text: 'new', timestamp: 100 }
      const result = enqueueMessage(state, msg)
      
      expect(result.dropped).toBe(1)
      expect(state.queuedMessages).toHaveLength(5)
      expect(state.queuedMessages[0].text).toBe('msg1')
      expect(state.queuedMessages[4].text).toBe('new')
    })

    it('should drop oldest when exceeding MAX_QUEUED_CHARS', () => {
      state.queuedMessages.push({ text: 'a'.repeat(8000), timestamp: 1 })
      
      const msg: QueuedMessage = { text: 'b'.repeat(3000), timestamp: 2 }
      const result = enqueueMessage(state, msg)
      
      expect(result.dropped).toBe(1)
      expect(state.queuedMessages).toHaveLength(1)
      expect(state.queuedMessages[0].text).toBe('b'.repeat(3000))
    })
  })

  describe('dequeueMessage', () => {
    it('should return null for empty queue', () => {
      const result = dequeueMessage(state)
      expect(result).toBeNull()
    })

    it('should return first message (FIFO)', () => {
      state.queuedMessages = [
        { text: 'first', timestamp: 1 },
        { text: 'second', timestamp: 2 }
      ]
      
      const result = dequeueMessage(state)
      expect(result?.text).toBe('first')
      expect(state.queuedMessages).toHaveLength(1)
    })
  })

  describe('clearQueue', () => {
    it('should return 0 for empty queue', () => {
      const count = clearQueue(state)
      expect(count).toBe(0)
    })

    it('should clear all and return count', () => {
      state.queuedMessages = [
        { text: 'a', timestamp: 1 },
        { text: 'b', timestamp: 2 }
      ]
      
      const count = clearQueue(state)
      expect(count).toBe(2)
      expect(state.queuedMessages).toHaveLength(0)
    })
  })

  describe('getQueueLength', () => {
    it('should return 0 for empty queue', () => {
      expect(getQueueLength(state)).toBe(0)
    })

    it('should return correct length', () => {
      state.queuedMessages = [{ text: 'a', timestamp: 1 }]
      expect(getQueueLength(state)).toBe(1)
    })
  })
})
