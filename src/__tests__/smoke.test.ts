import { describe, it, expect } from 'bun:test';

describe('Test Infrastructure', () => {
  it('bun:test runner is working', () => {
    expect(1 + 1).toBe(2);
  });

  it('can import domain types', async () => {
    const models = await import('../domain/models.js');
    expect(models.createDefaultChatState).toBeDefined();
  });

  it('can import shared utilities', async () => {
    const format = await import('../shared/formatResponse.js');
    expect(format.escapeHtml).toBeDefined();
  });
});
