import { logger } from '../../shared/logger.js';

export interface ChatQueue {
  enqueue<T>(scopeId: number | string, fn: () => Promise<T>): Promise<T>;
}

export function createChatQueue(): ChatQueue {
  const queue = new Map<string, Promise<unknown>>();

  return {
    enqueue<T>(scopeId: number | string, fn: () => Promise<T>): Promise<T> {
      const key = String(scopeId);
      const prev = queue.get(key) ?? Promise.resolve();
      const next = prev.then(() => fn(), () => fn());
      
      const chainPromise = next.catch(() => {});
      queue.set(key, chainPromise);
      
      next.finally(() => {
        if (queue.get(key) === chainPromise) {
          queue.delete(key);
          logger.debug('queue', `Cleaned up queue for scope ${key}`);
        }
      });
      
      return next;
    }
  };
}
