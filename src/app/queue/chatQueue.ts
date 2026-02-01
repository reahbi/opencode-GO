import { logger } from '../../shared/logger.js';

export interface ChatQueue {
  enqueue<T>(chatId: number, fn: () => Promise<T>): Promise<T>;
}

export function createChatQueue(): ChatQueue {
  const queue = new Map<number, Promise<unknown>>();

  return {
    enqueue<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
      const prev = queue.get(chatId) ?? Promise.resolve();
      const next = prev.then(() => fn(), () => fn());
      
      const chainPromise = next.catch(() => {});
      queue.set(chatId, chainPromise);
      
      next.finally(() => {
        if (queue.get(chatId) === chainPromise) {
          queue.delete(chatId);
          logger.debug('queue', `Cleaned up queue for chat ${chatId}`);
        }
      });
      
      return next;
    }
  };
}
