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
  intro('OpenCaddy Doctor');

  const results: CheckResult[] = [];
  const envPath = resolve(process.cwd(), '.env');
  let env: Record<string, string> = {};
  let envLoaded = false;

  // Check 1: .env 파일 존재
  const s1 = spinner();
  s1.start('.env 파일 확인 중...');
  try {
    const content = await readFile(envPath, 'utf-8');
    env = parseEnvFile(content);
    envLoaded = true;
    s1.stop('.env 파일: 존재함');
    results.push({ name: '.env 파일', passed: true, message: '존재함' });
  } catch {
    s1.stop('.env 파일: 찾을 수 없음');
    results.push({
      name: '.env 파일',
      passed: false,
      message: '찾을 수 없음',
      fix: 'cp .env.example .env',
    });
  }

  if (!envLoaded) {
    // .env 없으면 나머지 체크 스킵
    note(
      '나머지 검사를 진행하려면 .env 파일이 필요합니다.\n\n' +
      '다음 명령어로 .env 파일을 생성하세요:\n' +
      'cp .env.example .env\n\n' +
      '또는 bun run setup 을 실행하세요.',
      '.env 파일 필요'
    );
  } else {
    // Check 2: BOT_TOKEN 형식
    const s2 = spinner();
    s2.start('BOT_TOKEN 확인 중...');
    const token = env.BOT_TOKEN || '';
    if (!token || token === 'your-bot-token-here') {
      s2.stop('BOT_TOKEN: 설정되지 않음');
      results.push({
        name: 'BOT_TOKEN',
        passed: false,
        message: '설정되지 않음',
        fix: '.env 파일에서 BOT_TOKEN을 @BotFather에서 받은 토큰으로 설정하세요',
      });
    } else if (/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      s2.stop('BOT_TOKEN: 유효한 형식');
      results.push({ name: 'BOT_TOKEN', passed: true, message: '유효한 형식' });
    } else {
      s2.stop('BOT_TOKEN: 형식이 올바르지 않음');
      results.push({
        name: 'BOT_TOKEN',
        passed: false,
        message: '형식이 올바르지 않음 (숫자:영문숫자 형식이어야 합니다)',
        fix: '@BotFather에서 올바른 토큰을 복사하세요',
      });
    }

    // Check 3: ALLOWED_USER_IDS
    const s3 = spinner();
    s3.start('ALLOWED_USER_IDS 확인 중...');
    const userIdsRaw = env.ALLOWED_USER_IDS || '';
    const userIds = userIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (userIds.length === 0) {
      s3.stop('ALLOWED_USER_IDS: 설정되지 않음');
      results.push({
        name: 'ALLOWED_USER_IDS',
        passed: false,
        message: '설정되지 않음',
        fix: '@userinfobot 에게 메시지를 보내 Telegram ID를 확인한 후 .env에 설정하세요',
      });
    } else {
      const allNumeric = userIds.every(id => /^\d+$/.test(id));
      if (allNumeric) {
        s3.stop(`ALLOWED_USER_IDS: ${userIds.length}명 설정됨`);
        results.push({ name: 'ALLOWED_USER_IDS', passed: true, message: `${userIds.length}명 설정됨` });
      } else {
        s3.stop('ALLOWED_USER_IDS: 숫자가 아닌 값이 포함됨');
        results.push({
          name: 'ALLOWED_USER_IDS',
          passed: false,
          message: '숫자가 아닌 값이 포함됨',
          fix: 'User ID는 숫자만 가능합니다 (예: 123456789,987654321)',
        });
      }
    }

    // Check 4: DEFAULT_PROJECT 디렉토리
    const s4 = spinner();
    s4.start('프로젝트 디렉토리 확인 중...');
    const projectDir = env.DEFAULT_PROJECT || '';
    if (!projectDir) {
      s4.stop('DEFAULT_PROJECT: 설정되지 않음');
      results.push({
        name: 'DEFAULT_PROJECT',
        passed: false,
        message: '설정되지 않음',
        fix: '.env 파일에서 DEFAULT_PROJECT를 절대 경로로 설정하세요',
      });
    } else {
      try {
        await access(projectDir);
        s4.stop(`프로젝트 디렉토리: ${projectDir}`);
        results.push({ name: 'DEFAULT_PROJECT', passed: true, message: projectDir });
      } catch {
        s4.stop(`프로젝트 디렉토리: ${projectDir} (찾을 수 없음)`);
        results.push({
          name: 'DEFAULT_PROJECT',
          passed: false,
          message: `${projectDir} 찾을 수 없음`,
          fix: `mkdir -p ${projectDir}`,
        });
      }
    }

    // Check 5: OpenCode 서버 연결
    const s5 = spinner();
    const serverUrl = env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096';
    s5.start(`OpenCode 서버 연결 확인 중 (${serverUrl})...`);
    try {
      const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        s5.stop(`OpenCode 서버: 연결됨 (${serverUrl})`);
        results.push({ name: 'OpenCode 서버', passed: true, message: `연결됨 (${serverUrl})` });
      } else {
        s5.stop(`OpenCode 서버: 응답 오류 (${res.status})`);
        results.push({
          name: 'OpenCode 서버',
          passed: false,
          message: `응답 오류 (${res.status})`,
          fix: 'opencode serve 가 실행 중인지 확인하세요',
        });
      }
    } catch {
      s5.stop('OpenCode 서버: 연결할 수 없음');
      results.push({
        name: 'OpenCode 서버',
        passed: false,
        message: '연결할 수 없음',
        fix: `opencode serve 를 실행하세요 (URL: ${serverUrl})`,
      });
    }

    // Check 6: Telegram Bot API
    const s6 = spinner();
    s6.start('Telegram Bot API 확인 중...');
    const botToken = env.BOT_TOKEN || '';
    if (!botToken || botToken === 'your-bot-token-here') {
      s6.stop('Telegram Bot API: 토큰이 없어 확인 불가');
      results.push({
        name: 'Telegram Bot API',
        passed: false,
        message: '토큰이 없어 확인 불가',
        fix: 'BOT_TOKEN을 먼저 설정하세요',
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
          s6.stop('Telegram Bot API: 토큰이 유효하지 않음');
          results.push({
            name: 'Telegram Bot API',
            passed: false,
            message: '토큰이 유효하지 않음',
            fix: '@BotFather에서 새 토큰을 발급받으세요',
          });
        }
      } catch {
        s6.stop('Telegram Bot API: 연결할 수 없음');
        results.push({
          name: 'Telegram Bot API',
          passed: false,
          message: '연결할 수 없음',
          fix: '인터넷 연결을 확인하세요',
        });
      }
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const failed = results.filter(r => !r.passed);

  let summaryText = `결과: ${passed}/${total} 통과`;
  if (failed.length > 0) {
    summaryText += `, ${failed.length}개 문제 발견\n\n`;
    summaryText += '문제 해결 방법:\n';
    for (const f of failed) {
      summaryText += `\n${f.name}: ${f.message}`;
      if (f.fix) {
        summaryText += `\n  -> ${f.fix}`;
      }
    }
  }

  note(summaryText, '진단 결과');

  if (failed.length > 0) {
    outro('자세한 해결 방법: docs/troubleshooting.md');
    process.exit(1);
  } else {
    outro('모든 검사를 통과했습니다!');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
