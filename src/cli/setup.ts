#!/usr/bin/env bun

import {
  intro,
  outro,
  text,
  confirm,
  spinner,
  isCancel,
  cancel,
  note,
  select,
} from '@clack/prompts';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// ============================================================================
// Types
// ============================================================================

interface OpenCodeProject {
  id: string;
  worktree: string;
  vcs?: string;
  name?: string;
  time: { created: number; updated: number; initialized?: number };
  sandboxes: string[];
}

interface InstanceConfig {
  name: string;
  projectDir: string;
  botToken: string;
  userIds: string;
  serverUrl: string;
  username: string;
  password: string;
}

interface PM2AppConfig {
  name: string;
  script: string;
  interpreter: string;
  cwd: string;
  env: Record<string, string>;
  autorestart: boolean;
  max_memory_restart: string;
}

interface EcosystemConfig {
  apps: PM2AppConfig[];
}

// ============================================================================
// Validation Helpers
// ============================================================================

function validateInstanceName(input: string | undefined): string | undefined {
  if (!input || input.trim().length === 0) {
    return 'Instance name cannot be empty';
  }
  if (!/^[a-z0-9-]+$/.test(input.trim())) {
    return 'Instance name must contain only lowercase letters, numbers, and hyphens';
  }
  return undefined;
}

function validateProjectDir(input: string | undefined): string | undefined {
  if (!input || input.trim().length === 0) {
    return 'Project directory cannot be empty';
  }
  if (!input.trim().startsWith('/')) {
    return 'Project directory must be an absolute path (starting with /)';
  }
  return undefined;
}

function validateBotToken(input: string | undefined): string | undefined {
  if (!input || input.trim().length === 0) {
    return 'Bot token cannot be empty';
  }
  return undefined;
}

function validateUserIds(input: string | undefined): string | undefined {
  if (!input || input.trim().length === 0) {
    return 'At least one user ID is required';
  }
  const ids = input.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return 'At least one valid user ID is required';
  }
  const allValid = ids.every((id) => /^\d+$/.test(id));
  if (!allValid) {
    return 'User IDs must be comma-separated numbers';
  }
  return undefined;
}

// ============================================================================
// Project Selection from OpenCode Server
// ============================================================================

async function fetchProjects(serverUrl: string, username: string, password: string): Promise<OpenCodeProject[]> {
  const headers: Record<string, string> = {};
  if (password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  const res = await fetch(`${serverUrl}/project`, {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as OpenCodeProject[];
}

async function selectProjectDir(serverUrl: string, username: string, password: string): Promise<string> {
  const s = spinner();
  s.start('OpenCode 서버에서 프로젝트 목록을 가져오는 중...');

  let projects: OpenCodeProject[] = [];
  try {
    projects = await fetchProjects(serverUrl, username, password);
    // Filter out global root "/" and sort by most recently updated
    projects = projects
      .filter(p => p.worktree !== '/')
      .sort((a, b) => b.time.updated - a.time.updated);
  } catch {
    // Server unreachable or error — fall through to text input
  }

  if (projects.length > 0) {
    s.stop(`${projects.length}개의 프로젝트를 찾았습니다`);

    const options = projects.map(p => ({
      value: p.worktree,
      label: p.worktree,
      hint: p.name || undefined,
    }));
    options.push({ value: '__manual__', label: '직접 입력', hint: '경로를 직접 타이핑합니다' });

    const selected = await select({
      message: '프로젝트 디렉토리를 선택하세요',
      options,
    });
    if (isCancel(selected)) { cancel('Setup cancelled.'); process.exit(0); }

    if (selected !== '__manual__') {
      return selected as string;
    }
  } else {
    s.stop('서버에서 프로젝트 목록을 가져올 수 없습니다 — 직접 입력합니다');
  }

  // Fallback: manual text input
  const projectDir = await text({
    message: '프로젝트 디렉토리 (절대 경로)',
    placeholder: '/home/user/my-project',
    validate: validateProjectDir,
  });
  if (isCancel(projectDir)) { cancel('Setup cancelled.'); process.exit(0); }
  return (projectDir as string).trim();
}

// ============================================================================
// Preflight Checks
// ============================================================================

async function runPreflightChecks(token: string, serverUrl: string, projectDir: string): Promise<void> {
  const s = spinner();

  // Check 1: Telegram Bot API
  s.start('Telegram 봇 토큰 확인 중...');
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username?: string } };
    if (data.ok && data.result?.username) {
      s.stop(`Telegram 봇 확인됨: @${data.result.username}`);
    } else {
      s.stop('Telegram 봇 토큰이 유효하지 않습니다 (계속 진행 가능)');
    }
  } catch {
    s.stop('Telegram API에 연결할 수 없습니다 (계속 진행 가능)');
  }

  // Check 2: OpenCode Server
  s.start('OpenCode 서버 연결 확인 중...');
  try {
    const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      s.stop(`OpenCode 서버 연결됨: ${serverUrl}`);
    } else {
      s.stop(`OpenCode 서버 응답 오류 (${res.status}) — 나중에 시작해도 됩니다`);
    }
  } catch {
    s.stop('OpenCode 서버에 연결할 수 없습니다 — 나중에 시작해도 됩니다');
  }

  // Check 3: Project Directory
  s.start('프로젝트 디렉토리 확인 중...');
  try {
    await access(projectDir);
    s.stop(`프로젝트 디렉토리 확인됨: ${projectDir}`);
  } catch {
    s.stop(`프로젝트 디렉토리를 찾을 수 없습니다: ${projectDir} (나중에 생성해도 됩니다)`);
  }
}

// ============================================================================
// .env Setup Mode
// ============================================================================

async function setupEnv(): Promise<void> {
  const botToken = await text({
    message: 'Telegram 봇 토큰 (Bot Token)',
    placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    validate: validateBotToken,
  });
  if (isCancel(botToken)) { cancel('Setup cancelled.'); process.exit(0); }

  const userIds = await text({
    message: '허용할 Telegram User ID (쉼표로 구분)',
    placeholder: '123456789, 987654321',
    validate: validateUserIds,
  });
  if (isCancel(userIds)) { cancel('Setup cancelled.'); process.exit(0); }

  const serverUrl = await text({
    message: 'OpenCode 서버 URL',
    initialValue: 'http://127.0.0.1:4096',
  });
  if (isCancel(serverUrl)) { cancel('Setup cancelled.'); process.exit(0); }

  const username = await text({
    message: 'OpenCode 서버 사용자명',
    initialValue: 'opencode',
  });
  if (isCancel(username)) { cancel('Setup cancelled.'); process.exit(0); }

  const password = await text({
    message: 'OpenCode 서버 비밀번호 (없으면 비워두세요)',
    initialValue: '',
  });
  if (isCancel(password)) { cancel('Setup cancelled.'); process.exit(0); }

  const projectDir = await selectProjectDir(
    (serverUrl as string).trim(),
    (username as string).trim(),
    (password as string).trim(),
  );

  await runPreflightChecks(
    (botToken as string).trim(),
    (serverUrl as string).trim(),
    projectDir,
  );

  // Check if .env exists
  const envPath = resolve(process.cwd(), '.env');
  try {
    await access(envPath);
    const overwrite = await confirm({
      message: '.env 파일이 이미 존재합니다. 덮어쓰시겠습니까?',
      initialValue: false,
    });
    if (isCancel(overwrite) || !overwrite) {
      cancel('Setup cancelled.');
      process.exit(0);
    }
  } catch {
    // .env doesn't exist, proceed
  }

  // Generate .env content
  const envContent = `# Telegram Bot Token (from @BotFather)
BOT_TOKEN=${(botToken as string).trim()}

# Allowed Telegram user IDs (comma separated)
ALLOWED_USER_IDS=${(userIds as string).split(',').map(id => id.trim()).join(',')}

# OpenCode server URL
OPENCODE_SERVER_URL=${(serverUrl as string).trim()}

# OpenCode server credentials (optional, for HTTP Basic Auth)
OPENCODE_SERVER_USERNAME=${(username as string).trim()}
OPENCODE_SERVER_PASSWORD=${(password as string).trim()}

# Default project path
DEFAULT_PROJECT=${projectDir}
`;

  const s = spinner();
  s.start('.env 파일 저장 중...');
  await writeFile(envPath, envContent, 'utf-8');
  s.stop('.env 파일이 생성되었습니다');

  note(`다음 단계:
1. bun run start 으로 봇을 시작하세요
2. 텔레그램에서 봇에게 /start 를 전송하세요
3. 문제가 있으면 bun run doctor 로 진단하세요`, '완료');

  outro('설정이 완료되었습니다!');
}

// ============================================================================
// Ecosystem Config Helpers
// ============================================================================

async function readExistingEcosystem(): Promise<EcosystemConfig | null> {
  const ecosystemPath = resolve(process.cwd(), 'ecosystem.config.cjs');
  
  try {
    await access(ecosystemPath);
  } catch {
    return null; // File doesn't exist
  }

  const s = spinner();
  s.start('Reading existing ecosystem.config.cjs');

  try {
    // Dynamic import with file:// URL for .cjs files
    const imported = await import(`file://${ecosystemPath}`);
    const config = imported.default || imported;
    s.stop('Existing configuration loaded');
    
    if (!config.apps || !Array.isArray(config.apps)) {
      s.stop('Warning: Invalid ecosystem.config.cjs format');
      return { apps: [] };
    }
    
    return config;
  } catch (error) {
    s.stop('Warning: Could not parse existing ecosystem.config.cjs');
    return null;
  }
}

function generateAppConfig(config: InstanceConfig): PM2AppConfig {
  const projectRoot = resolve(process.cwd());
  const homePath = process.env.HOME || '~';
  const currentPath = process.env.PATH || '';

  return {
    name: `opencaddy-${config.name}`,
    script: 'src/main.ts',
    interpreter: 'bun',
    cwd: projectRoot,
    env: {
      PATH: `${homePath}/.bun/bin:${currentPath}`,
      BOT_TOKEN: config.botToken,
      ALLOWED_USER_IDS: config.userIds,
      DEFAULT_PROJECT: config.projectDir,
      INSTANCE_NAME: config.name,
      STATE_DIR: `data/instances/${config.name}`,
      OPENCODE_SERVER_URL: config.serverUrl,
      OPENCODE_SERVER_USERNAME: config.username,
      OPENCODE_SERVER_PASSWORD: config.password,
    },
    autorestart: true,
    max_memory_restart: '512M',
  };
}

function serializeEcosystemConfig(config: EcosystemConfig): string {
  const appsArray = config.apps.map((app) => {
    const envEntries = Object.entries(app.env)
      .map(([key, value]) => {
        const escapedValue = value.replace(/'/g, "\\'");
        return `      ${key}: '${escapedValue}'`;
      })
      .join(',\n');

    return `  {
    name: '${app.name}',
    script: '${app.script}',
    interpreter: '${app.interpreter}',
    cwd: '${app.cwd}',
    env: {
${envEntries},
    },
    autorestart: ${app.autorestart},
    max_memory_restart: '${app.max_memory_restart}',
  }`;
  }).join(',\n');

  return `module.exports = {
  apps: [
${appsArray},
  ],
};
`;
}

async function writeEcosystemConfig(config: EcosystemConfig): Promise<void> {
  const ecosystemPath = resolve(process.cwd(), 'ecosystem.config.cjs');
  const content = serializeEcosystemConfig(config);
  
  const s = spinner();
  s.start('Writing ecosystem.config.cjs');
  await writeFile(ecosystemPath, content, 'utf-8');
  s.stop('ecosystem.config.cjs updated');
}

async function createInstanceDir(instanceName: string): Promise<void> {
  const instanceDir = resolve(process.cwd(), 'data', 'instances', instanceName);
  
  const s = spinner();
  s.start(`Creating data/instances/${instanceName}/`);
  await mkdir(instanceDir, { recursive: true });
  s.stop(`Directory created: data/instances/${instanceName}/`);
}

// ============================================================================
// PM2 Setup Mode
// ============================================================================

async function setupPM2(): Promise<void> {
  // 1. Instance Name
  const instanceName = await text({
    message: 'Instance name (lowercase, alphanumeric + hyphens)',
    placeholder: 'my-bot',
    validate: validateInstanceName,
  });

  if (isCancel(instanceName)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 2. Project Directory
  const projectDir = await text({
    message: 'Project directory (absolute path)',
    placeholder: '/home/user/my-project',
    validate: validateProjectDir,
  });

  if (isCancel(projectDir)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 3. Bot Token
  const botToken = await text({
    message: 'Telegram bot token (from BotFather)',
    placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    validate: validateBotToken,
  });

  if (isCancel(botToken)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 4. User IDs
  const userIds = await text({
    message: 'Allowed Telegram user IDs (comma-separated)',
    placeholder: '123456789, 987654321',
    validate: validateUserIds,
  });

  if (isCancel(userIds)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 5. Server URL
  const serverUrl = await text({
    message: 'OpenCode server URL',
    placeholder: 'http://127.0.0.1:4096',
    initialValue: 'http://127.0.0.1:4096',
  });

  if (isCancel(serverUrl)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 6. Server Username
  const username = await text({
    message: 'OpenCode server username',
    placeholder: 'opencode',
    initialValue: 'opencode',
  });

  if (isCancel(username)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 7. Server Password
  const password = await text({
    message: 'OpenCode server password (optional, leave empty if none)',
    placeholder: '(empty for no auth)',
    initialValue: '',
  });

  if (isCancel(password)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  const config: InstanceConfig = {
    name: (instanceName as string).trim(),
    projectDir: (projectDir as string).trim(),
    botToken: (botToken as string).trim(),
    userIds: (userIds as string).split(',').map((id) => id.trim()).join(', '),
    serverUrl: (serverUrl as string).trim(),
    username: (username as string).trim(),
    password: (password as string).trim(),
  };

  // 8. Show Summary
  const summary = `
Instance Name:    ${config.name}
Project Dir:      ${config.projectDir}
Bot Token:        ${config.botToken.substring(0, 20)}...
User IDs:         ${config.userIds}
Server URL:       ${config.serverUrl}
Server Username:  ${config.username}
Server Password:  ${config.password ? '***' : '(none)'}
`;

  note(summary, 'Configuration Summary');

  const confirmSetup = await confirm({
    message: 'Save this configuration?',
    initialValue: true,
  });

  if (isCancel(confirmSetup) || !confirmSetup) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 9. Read existing ecosystem config
  const existingConfig = await readExistingEcosystem();
  let finalConfig: EcosystemConfig;

  if (existingConfig) {
    const existingAppIndex = existingConfig.apps.findIndex(
      (app) => app.name === `opencaddy-${config.name}`
    );

    if (existingAppIndex >= 0) {
      const overwrite = await confirm({
        message: `Instance '${config.name}' already exists. Overwrite?`,
        initialValue: false,
      });

      if (isCancel(overwrite)) {
        cancel('Setup cancelled.');
        process.exit(0);
      }

      if (!overwrite) {
        cancel('Setup cancelled. Choose a different instance name.');
        process.exit(0);
      }

      const newAppConfig = generateAppConfig(config);
      existingConfig.apps[existingAppIndex] = newAppConfig;
      finalConfig = existingConfig;
    } else {
      const newAppConfig = generateAppConfig(config);
      finalConfig = {
        apps: [...existingConfig.apps, newAppConfig],
      };
    }
  } else {
    const newAppConfig = generateAppConfig(config);
    finalConfig = {
      apps: [newAppConfig],
    };
  }

  // 10. Write ecosystem config
  await writeEcosystemConfig(finalConfig);

  // 11. Create instance directory
  await createInstanceDir(config.name);

  // 12. Show next steps
  const nextSteps = `
1. Install PM2 globally (if not already installed):
   bun add -g pm2

2. Start all instances:
   pm2 start ecosystem.config.cjs

3. Or start only this instance:
   pm2 start ecosystem.config.cjs --only opencaddy-${config.name}

4. View logs:
   pm2 logs

5. Or run standalone (without PM2):
   INSTANCE_NAME=${config.name} STATE_DIR=data/instances/${config.name} \\
   BOT_TOKEN="${config.botToken}" \\
   ALLOWED_USER_IDS="${config.userIds}" \\
   DEFAULT_PROJECT="${config.projectDir}" \\
   OPENCODE_SERVER_URL="${config.serverUrl}" \\
   OPENCODE_SERVER_USERNAME="${config.username}" \\
   OPENCODE_SERVER_PASSWORD="${config.password}" \\
   bun run src/main.ts
`;

  note(nextSteps, 'Next Steps');

  outro(`Instance '${config.name}' configured!`);
}

// ============================================================================
// Main Wizard
// ============================================================================

async function main(): Promise<void> {
  console.clear();
  
  intro('OpenCaddy Setup');

  const mode = await select({
    message: '설정 모드를 선택하세요',
    options: [
      { value: 'env', label: '간단 설정 (.env 파일 생성)', hint: '처음 사용하는 경우 권장' },
      { value: 'pm2', label: 'PM2 멀티인스턴스 설정', hint: 'ecosystem.config.cjs 생성' },
    ],
  });

  if (isCancel(mode)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  if (mode === 'env') {
    await setupEnv();
  } else {
    await setupPM2();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
