import { StateStore } from '../../domain/ports/StateStore.js';
import { ChatState, PendingInteraction, createDefaultChatState, createDefaultUserSettings } from '../../domain/models.js';
import { logger } from '../../shared/logger.js';
import { LIMITS } from '../../app/policies/limits.js';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export function createJsonStateStore(dataDir?: string): StateStore {
  const dir = dataDir || resolve(process.cwd(), 'data');
  const filepath = resolve(dir, 'state.json');
  const locks = new Map<number, Promise<void>>();
  
  // Global file lock to prevent cross-chat race conditions on read-modify-write
  let fileLock: Promise<void> = Promise.resolve();
  
  async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = fileLock;
    let resolveLock: () => void;
    fileLock = new Promise(resolve => { resolveLock = resolve; });
    
    await previous;
    try {
      return await fn();
    } finally {
      resolveLock!();
    }
  }

  async function ensureFile(): Promise<void> {
    try {
      await fs.access(filepath);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      await atomicWrite({});
    }
  }

  async function atomicWrite(data: Record<string, ChatState>): Promise<void> {
    const random = Math.random().toString(36).substring(7);
    const tmpPath = `${filepath}.tmp.${random}`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filepath);
  }

  async function readState(): Promise<Record<string, ChatState>> {
    await ensureFile();
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('state', `Failed to parse state file: ${error}`);
      const timestamp = Date.now();
      const corruptPath = `${filepath}.corrupt.${timestamp}`;
      try {
        await fs.rename(filepath, corruptPath);
        logger.warn('state', `Corrupt state file backed up to ${corruptPath}`);
      } catch (backupError) {
        logger.error('state', `Failed to backup corrupt state file: ${backupError}`);
      }
      await atomicWrite({});
      return {};
    }
  }

  function migratePendingInteraction(raw: Record<string, unknown>): PendingInteraction {
    const pi = raw as Partial<PendingInteraction>
    return {
      interactionId: pi.interactionId ?? '',
      sessionId: pi.sessionId ?? '',
      requestId: pi.requestId ?? '',
      type: pi.type ?? 'question',
      expiresAt: pi.expiresAt ?? 0,
      messageHandle: pi.messageHandle,
      questions: pi.questions,
      collectedAnswers: pi.collectedAnswers,
      currentQuestionIndex: pi.currentQuestionIndex,
      phase: pi.phase,
      creatorUserId: pi.creatorUserId,
      directory: pi.directory,
    }
  }

  function migrateState(raw: Partial<ChatState>): ChatState {
    const defaults = createDefaultChatState()
    const state: ChatState = {
      ...defaults,
      ...raw,
      settings: raw.settings ? { ...createDefaultUserSettings(), ...raw.settings } : defaults.settings,
      awaitingInput: raw.awaitingInput ?? null,
      awaitingInteractionId: raw.awaitingInteractionId ?? null,
    }
    if (state.settings.summaryThreshold < LIMITS.SUMMARY_MIN_TRIGGER) {
      state.settings.summaryThreshold = LIMITS.SUMMARY_MIN_TRIGGER
    }
    if (state.pendingInteractions) {
      state.pendingInteractions = state.pendingInteractions.map(
        pi => migratePendingInteraction(pi as unknown as Record<string, unknown>)
      )
    }
    if (!state.voiceResponses) {
      state.voiceResponses = []
    } else {
      state.voiceResponses = state.voiceResponses
        .map(r => ({
          ...r,
          directory: r.directory ?? state.activeProjectDirectory ?? '',
        }))
        .filter(r => r.directory !== '')
    }
    return state
  }

  function getStateKey(chatId: number, threadId?: number): string {
    return threadId ? `${chatId}:${threadId}` : String(chatId);
  }

  async function getChatState(chatId: number, threadId?: number): Promise<ChatState> {
    const state = await readState();
    const key = getStateKey(chatId, threadId);
    const raw = state[key];
    return raw ? migrateState(raw) : createDefaultChatState();
  }

  async function saveChatState(chatId: number, chatState: ChatState, threadId?: number): Promise<void> {
    await withFileLock(async () => {
      const state = await readState();
      const key = getStateKey(chatId, threadId);
      state[key] = chatState;
      await atomicWrite(state);
      logger.debug('state', `Saved state for chat ${chatId}${threadId ? `:${threadId}` : ''}`);
    });
  }

  async function withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(chatId) || Promise.resolve();

    const current = (async () => {
      await previous;
      return await fn();
    })();

    locks.set(chatId, current.then(() => undefined, () => undefined));

    return current;
  }

  return {
    getChatState,
    saveChatState,
    withChatLock,
  };
}
