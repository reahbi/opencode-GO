#!/usr/bin/env bun

import { intro, outro, spinner, note } from '@clack/prompts';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

async function main(): Promise<void> {
  intro('Claude-Go Doctor');

  const results: CheckResult[] = [];
  const envPath = resolve(process.cwd(), '.env');
  let env: Record<string, string> = {};
  let envLoaded = false;

  // Check 1: .env file exists
  const s1 = spinner();
  s1.start('Checking .env file...');
  try {
    const content = await readFile(envPath, 'utf-8');
    env = parseEnvFile(content);
    envLoaded = true;
    s1.stop('.env file: exists');
    results.push({ name: '.env file', passed: true, message: 'exists' });
  } catch {
    s1.stop('.env file: not found');
    results.push({
      name: '.env file',
      passed: false,
      message: 'not found',
      fix: 'cp .env.example .env',
    });
  }

  if (!envLoaded) {
    // Skip remaining checks if .env doesn't exist
    note(
      '.env file is required to proceed with remaining checks.\n\n' +
      'Create .env file with:\n' +
      'cp .env.example .env\n\n' +
      'Or run bun run setup.',
      '.env file required'
    );
  } else {
    // Check 2: BOT_TOKEN format
    const s2 = spinner();
    s2.start('Checking BOT_TOKEN...');
    const token = env.BOT_TOKEN || '';
    if (!token || token === 'your-bot-token-here') {
      s2.stop('BOT_TOKEN: not set');
      results.push({
        name: 'BOT_TOKEN',
        passed: false,
        message: 'not set',
        fix: 'Set BOT_TOKEN in .env file with the token from @BotFather',
      });
    } else if (/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      s2.stop('BOT_TOKEN: valid format');
      results.push({ name: 'BOT_TOKEN', passed: true, message: 'valid format' });
    } else {
      s2.stop('BOT_TOKEN: invalid format');
      results.push({
        name: 'BOT_TOKEN',
        passed: false,
        message: 'invalid format (must be number:alphanumeric)',
        fix: 'Copy the correct token from @BotFather',
      });
    }

    // Check 3: ALLOWED_USER_IDS
    const s3 = spinner();
    s3.start('Checking ALLOWED_USER_IDS...');
    const userIdsRaw = env.ALLOWED_USER_IDS || '';
    const userIds = userIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (userIds.length === 0) {
      s3.stop('ALLOWED_USER_IDS: not set');
      results.push({
        name: 'ALLOWED_USER_IDS',
        passed: false,
        message: 'not set',
        fix: 'Send a message to @userinfobot to get your Telegram ID and add it to .env',
      });
    } else {
      const allNumeric = userIds.every(id => /^\d+$/.test(id));
      if (allNumeric) {
        s3.stop(`ALLOWED_USER_IDS: ${userIds.length} user(s) configured`);
        results.push({ name: 'ALLOWED_USER_IDS', passed: true, message: `${userIds.length} user(s) configured` });
      } else {
        s3.stop('ALLOWED_USER_IDS: contains non-numeric value');
        results.push({
          name: 'ALLOWED_USER_IDS',
          passed: false,
          message: 'contains non-numeric value',
          fix: 'User IDs must be numbers only (e.g., 123456789,987654321)',
        });
      }
    }

    // Check 4: DEFAULT_PROJECT directory
    const s4 = spinner();
    s4.start('Checking project directory...');
    const projectDir = env.DEFAULT_PROJECT || '';
    if (!projectDir) {
      s4.stop('DEFAULT_PROJECT: not set');
      results.push({
        name: 'DEFAULT_PROJECT',
        passed: false,
        message: 'not set',
        fix: 'Set DEFAULT_PROJECT in .env file with an absolute path',
      });
    } else {
      try {
        await access(projectDir);
        s4.stop(`Project directory: ${projectDir}`);
        results.push({ name: 'DEFAULT_PROJECT', passed: true, message: projectDir });
      } catch {
        s4.stop(`Project directory: ${projectDir} (not found)`);
        results.push({
          name: 'DEFAULT_PROJECT',
          passed: false,
          message: `${projectDir} not found`,
          fix: `mkdir -p ${projectDir}`,
        });
      }
    }

    // Check 5: Server connection
    const s5 = spinner();
    const serverUrl = env.CLAUDE_SERVER_URL || 'http://127.0.0.1:4096';
    s5.start(`Checking server connection (${serverUrl})...`);
    try {
      const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        s5.stop(`Server: connected (${serverUrl})`);
        results.push({ name: 'Server', passed: true, message: `connected (${serverUrl})` });
      } else {
        s5.stop(`Server: response error (${res.status})`);
        results.push({
          name: 'Server',
          passed: false,
          message: `response error (${res.status})`,
          fix: 'Check if server is running',
        });
      }
    } catch {
      s5.stop('Server: cannot connect');
      results.push({
        name: 'Server',
        passed: false,
        message: 'cannot connect',
        fix: `Check server status (URL: ${serverUrl})`,
      });
    }

    // Check 6: Telegram Bot API
    const s6 = spinner();
    s6.start('Checking Telegram Bot API...');
    const botToken = env.BOT_TOKEN || '';
    if (!botToken || botToken === 'your-bot-token-here') {
      s6.stop('Telegram Bot API: cannot check without token');
      results.push({
        name: 'Telegram Bot API',
        passed: false,
        message: 'cannot check without token',
        fix: 'Set BOT_TOKEN first',
      });
    } else {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json() as { ok: boolean; result?: { username?: string } };
        if (data.ok && data.result?.username) {
          s6.stop(`Telegram Bot API: @${data.result.username}`);
          results.push({ name: 'Telegram Bot API', passed: true, message: `@${data.result.username}` });
        } else {
          s6.stop('Telegram Bot API: invalid token');
          results.push({
            name: 'Telegram Bot API',
            passed: false,
            message: 'invalid token',
            fix: 'Get a new token from @BotFather',
          });
        }
      } catch {
        s6.stop('Telegram Bot API: cannot connect');
        results.push({
          name: 'Telegram Bot API',
          passed: false,
          message: 'cannot connect',
          fix: 'Check your internet connection',
        });
      }
    }

    // Check 7: edge-tts for voice synthesis
    const s7 = spinner();
    const edgeTtsPath = process.env.EDGE_TTS_PATH || `${process.env.HOME}/.local/edge-tts-env/bin/edge-tts`;
    s7.start('Checking edge-tts (voice synthesis)...');
    try {
      await access(edgeTtsPath);
      s7.stop(`edge-tts: installed (${edgeTtsPath})`);
      results.push({ name: 'edge-tts', passed: true, message: `installed` });
    } catch {
      s7.stop('edge-tts: not installed');
      results.push({
        name: 'edge-tts',
        passed: false,
        message: 'not installed (voice feature will not work)',
        fix: `python3 -m venv ~/.local/edge-tts-env && ~/.local/edge-tts-env/bin/pip install edge-tts`,
      });
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const failed = results.filter(r => !r.passed);

  let summaryText = `Result: ${passed}/${total} passed`;
  if (failed.length > 0) {
    summaryText += `, ${failed.length} issue(s) found\n\n`;
    summaryText += 'How to fix:\n';
    for (const f of failed) {
      summaryText += `\n${f.name}: ${f.message}`;
      if (f.fix) {
        summaryText += `\n  -> ${f.fix}`;
      }
    }
  }

  note(summaryText, 'Diagnostic Result');

  if (failed.length > 0) {
    outro('For detailed solutions: docs/troubleshooting.md');
    process.exit(1);
  } else {
    outro('All checks passed!');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
