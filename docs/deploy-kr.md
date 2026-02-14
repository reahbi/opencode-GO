[🇺🇸 English](deploy.md)

# PM2 배포 가이드 (Deployment)

이 문서는 PM2 프로세스 매니저를 사용하여 Claude-Go를 안정적으로 배포하고 관리하는 방법을 설명합니다.

## PM2 개요

PM2는 Node.js 애플리케이션을 위한 프로덕션 프로세스 매니저입니다. 애플리케이션이 예기치 않게 종료되었을 때 자동으로 재시작해주며, 로그 관리 및 시스템 부팅 시 자동 시작 기능을 제공합니다.

## PM2 설치

Bun 전용 PM2 패키지를 설치하거나 기존 PM2를 사용할 수 있습니다:
```bash
bun add -g pm2
# 또는
npm install -g pm2
```

## 설정 및 시작

1. 프로젝트 초기 설정을 수행합니다:
   ```bash
   bun run setup
   ```
   설정 과정에서 PM2 멀티 인스턴스 설정을 선택할 수 있습니다.
2. 생성된 설정 파일을 사용하여 애플리케이션을 시작합니다:
   ```bash
   pm2 start ecosystem.config.cjs
   ```

## 주요 명령어

배포된 애플리케이션을 관리하기 위해 다음 명령어들을 활용하십시오:

- **로그 확인**: `pm2 logs`
- **재시작**: `pm2 restart ecosystem.config.cjs`
- **중지**: `pm2 stop ecosystem.config.cjs`
- **프로세스 삭제**: `pm2 delete ecosystem.config.cjs`

## 시스템 부팅 시 자동 시작 설정

서버가 재부팅되었을 때 봇이 자동으로 실행되도록 설정할 수 있습니다:

1. 시스템 서비스 등록 명령어를 생성합니다:
   ```bash
   pm2 startup
   ```
   (출력된 명령어를 터미널에 복사하여 실행하십시오.)
2. 현재 실행 중인 프로세스 목록을 저장합니다:
   ```bash
   pm2 save
   ```

## 다중 인스턴스 관리

`bun run setup`을 통해 여러 프로젝트를 각각 다른 텔레그램 봇으로 관리할 수 있습니다. 각 인스턴스는 고유한 프로젝트 경로와 봇 토큰을 가질 수 있으며, PM2를 통해 독립적인 프로세스로 실행됩니다.

**주의사항**:
- 각 인스턴스는 반드시 서로 다른 `BOT_TOKEN`을 사용해야 합니다.
- 데이터 충돌을 방지하기 위해 각 인스턴스마다 별도의 `STATE_DIR`를 설정하는 것이 좋습니다.
- 인스턴스 이름은 `.env`의 `INSTANCE_NAME` 변수를 통해 구분할 수 있습니다.

## 멀티봇 모드 (Writer/Reader)

여러 봇을 한 그룹 채팅에서 협업시키려면 추가 설정이 필요합니다.

### 필수 환경변수

| 변수 | 설명 |
|---|---|
| `BOT_ROLE` | `writer` 또는 `reader` (협업 역할) |
| `GROUP_CHAT_ENABLED` | `true` (그룹 채팅 응답 허용) |
| `COORDINATION_DIR` | 봇 간 공유 디렉토리 (모든 봇이 동일하게) |
| `STATE_DIR` | 봇별 상태 디렉토리 (각 봇마다 다르게) |

### ecosystem.config.cjs 예시

```javascript
const COORDINATION_DIR = '/tmp/claude-go-coordination'

module.exports = {
  apps: [
    {
      name: 'claude-go-writer',
      script: 'src/main.ts',
      interpreter: 'bun',
      env: {
        BOT_TOKEN: 'writer-bot-token',
        ALLOWED_USER_IDS: 'your-user-id',
        DEFAULT_PROJECT: '/path/to/project',
        INSTANCE_NAME: 'writer',
        STATE_DIR: 'data/instances/writer',
        BOT_ROLE: 'writer',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
    },
    {
      name: 'claude-go-reader',
      script: 'src/main.ts',
      interpreter: 'bun',
      env: {
        BOT_TOKEN: 'reader-bot-token',
        ALLOWED_USER_IDS: 'your-user-id',
        DEFAULT_PROJECT: '/path/to/project',
        INSTANCE_NAME: 'reader',
        STATE_DIR: 'data/instances/reader',
        BOT_ROLE: 'reader',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
    },
  ],
}
```

### 대안: /addbot 마법사

텔레그램에서 `/addbot` 명령으로도 봇을 추가할 수 있습니다. 마법사가 토큰 검증부터 PM2 설정까지 안내합니다.

자세한 내용: [멀티봇 가이드](multibot.md)
