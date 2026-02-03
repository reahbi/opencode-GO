import { describe, it, expect, beforeEach } from 'bun:test'
import { createChatQueue } from '../../app/queue/chatQueue.js'
import type { ChatQueue } from '../../app/queue/chatQueue.js'
import { createDeferredPromise, flushPromises } from '../helpers/index.js'

describe('chatQueue', () => {
  let queue: ChatQueue

  beforeEach(() => {
    queue = createChatQueue()
  })

  describe('sequential execution per chat', () => {
    it('executes tasks sequentially for same chatId', async () => {
      const chatId = 123
      const executionOrder: number[] = []
      
      const deferred1 = createDeferredPromise<string>()
      const deferred2 = createDeferredPromise<string>()

      const task1 = queue.enqueue(chatId, async () => {
        executionOrder.push(1)
        await deferred1.promise
        executionOrder.push(2)
        return 'first'
      })

      const task2 = queue.enqueue(chatId, async () => {
        executionOrder.push(3)
        await deferred2.promise
        executionOrder.push(4)
        return 'second'
      })

      await flushPromises()
      expect(executionOrder).toEqual([1])

      deferred1.resolve('done1')
      await task1
      await flushPromises()
      expect(executionOrder).toEqual([1, 2, 3])

      deferred2.resolve('done2')
      const results = await Promise.all([task1, task2])
      
      expect(results).toEqual(['first', 'second'])
      expect(executionOrder).toEqual([1, 2, 3, 4])
    })

    it('waits for previous task to complete before starting next', async () => {
      const chatId = 123
      let task1Started = false
      let task1Finished = false
      let task2Started = false

      const deferred = createDeferredPromise<void>()

      const task1 = queue.enqueue(chatId, async () => {
        task1Started = true
        await deferred.promise
        task1Finished = true
      })

      const task2 = queue.enqueue(chatId, async () => {
        task2Started = true
        expect(task1Finished).toBe(true)
      })

      await flushPromises()
      expect(task1Started).toBe(true)
      expect(task2Started).toBe(false)

      deferred.resolve()
      await Promise.all([task1, task2])

      expect(task1Finished).toBe(true)
      expect(task2Started).toBe(true)
    })

    it('chains multiple tasks correctly', async () => {
      const chatId = 123
      const results: number[] = []

      const task1 = queue.enqueue(chatId, async () => {
        results.push(1)
        return 1
      })

      const task2 = queue.enqueue(chatId, async () => {
        results.push(2)
        return 2
      })

      const task3 = queue.enqueue(chatId, async () => {
        results.push(3)
        return 3
      })

      const values = await Promise.all([task1, task2, task3])

      expect(values).toEqual([1, 2, 3])
      expect(results).toEqual([1, 2, 3])
    })
  })

  describe('parallel execution across chats', () => {
    it('runs tasks for different chatIds in parallel', async () => {
      const chatId1 = 123
      const chatId2 = 456
      
      const deferred1 = createDeferredPromise<string>()
      const deferred2 = createDeferredPromise<string>()

      let task1Started = false
      let task2Started = false

      const task1 = queue.enqueue(chatId1, async () => {
        task1Started = true
        await deferred1.promise
        return 'chat1'
      })

      const task2 = queue.enqueue(chatId2, async () => {
        task2Started = true
        await deferred2.promise
        return 'chat2'
      })

      await flushPromises()
      
      expect(task1Started).toBe(true)
      expect(task2Started).toBe(true)

      deferred1.resolve('done1')
      deferred2.resolve('done2')

      const results = await Promise.all([task1, task2])
      expect(results).toEqual(['chat1', 'chat2'])
    })

    it('does not block different chats when one is waiting', async () => {
      const chatId1 = 123
      const chatId2 = 456
      
      const deferred1 = createDeferredPromise<void>()
      let chat2Completed = false

      queue.enqueue(chatId1, async () => {
        await deferred1.promise
      })

      const task2 = queue.enqueue(chatId2, async () => {
        chat2Completed = true
      })

      await flushPromises()
      await task2

      expect(chat2Completed).toBe(true)
      
      deferred1.resolve()
    })
  })

  describe('queue behavior', () => {
    it('executes all tasks even when some complete with non-success values', async () => {
      const chatId = 123
      const results: (string | null)[] = []

      const task1 = queue.enqueue(chatId, async () => {
        results.push('task1')
        return 'success1'
      })

      const task2 = queue.enqueue(chatId, async () => {
        results.push(null)
        return null
      })

      const task3 = queue.enqueue(chatId, async () => {
        results.push('task3')
        return 'success3'
      })

      await Promise.all([task1, task2, task3])
      
      expect(results).toEqual(['task1', null, 'task3'])
    })

    it('processes tasks for different chats independently', async () => {
      const chatId1 = 123
      const chatId2 = 456
      const results: string[] = []

      const task1 = queue.enqueue(chatId1, async () => {
        results.push('chat1')
        return 'chat1-result'
      })

      const task2 = queue.enqueue(chatId2, async () => {
        results.push('chat2')
        return 'chat2-result'
      })

      const [result1, result2] = await Promise.all([task1, task2])
      
      expect(result1).toBe('chat1-result')
      expect(result2).toBe('chat2-result')
      expect(results).toContain('chat1')
      expect(results).toContain('chat2')
    })

    it('maintains execution order within same chat', async () => {
      const chatId = 123
      const executionLog: number[] = []

      const task1 = queue.enqueue(chatId, async () => {
        executionLog.push(1)
        await new Promise(resolve => setTimeout(resolve, 5))
        executionLog.push(2)
        return 'first'
      })

      const task2 = queue.enqueue(chatId, async () => {
        executionLog.push(3)
        return 'second'
      })

      await Promise.all([task1, task2])

      expect(executionLog).toEqual([1, 2, 3])
    })
  })

  describe('queue cleanup', () => {
    it('handles multiple sequential tasks correctly', async () => {
      const chatId = 123

      const result1 = await queue.enqueue(chatId, async () => 'first')
      const result2 = await queue.enqueue(chatId, async () => 'second')
      const result3 = await queue.enqueue(chatId, async () => 'third')
      
      expect(result1).toBe('first')
      expect(result2).toBe('second')
      expect(result3).toBe('third')
    })

    it('allows tasks to return various value types', async () => {
      const chatId = 123

      const results = await Promise.all([
        queue.enqueue(chatId, async () => 'string'),
        queue.enqueue(chatId, async () => 42),
        queue.enqueue(chatId, async () => ({ key: 'value' })),
        queue.enqueue(chatId, async () => null),
      ])
      
      expect(results[0]).toBe('string')
      expect(results[1]).toBe(42)
      expect(results[2]).toEqual({ key: 'value' })
      expect(results[3]).toBeNull()
    })
  })
})
