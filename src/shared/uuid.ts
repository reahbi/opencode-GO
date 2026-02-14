// Use globalThis.crypto.randomUUID() instead of node:crypto to maintain Clean Architecture
// (app/ layer should not import Node.js built-in modules directly)
export function generateUUID(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  // Fallback for environments without WebCrypto
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}
