/**
 * Polls an assertion function until it passes or times out.
 */
export async function waitFor(
  fn: () => void | Promise<void>,
  timeout = 2000,
  interval = 50,
): Promise<void> {
  const start = Date.now()
  let lastError: unknown = null

  while (Date.now() - start < timeout) {
    try {
      await fn()
      return
    } catch (error) {
      lastError = error
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, interval)
    })
  }

  if (lastError instanceof Error) {
    throw lastError
  }

  throw new Error(`waitFor timed out after ${timeout}ms`)
}

/**
 * Drains the microtask queue.
 */
export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })
}

/**
 * Creates a promise that can be manually resolved/rejected.
 */
export function createDeferredPromise<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolveFn: (value: T) => void = () => undefined
  let rejectFn: (reason?: unknown) => void = () => undefined

  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })

  return {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
  }
}
