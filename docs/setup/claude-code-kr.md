[English](claude-code.md)

# Claude Code 설정 가이드

Claude-Go는 Claude Code CLI와 Claude Agent SDK를 사용하여 AI와 직접 통신합니다 — 별도 서버가 필요 없습니다.

## Claude Code 개요

Claude Code는 Anthropic의 공식 CLI입니다. Claude-Go는 Claude Agent SDK를 프로세스 내에 임베드하여 `query()`로 AI와 직접 통신합니다. **별도의 서버 프로세스가 필요 없습니다.**

## 설치

1. Claude Code CLI 설치:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. 인증 (한 번만 실행):
   ```bash
   claude
   ```
   프롬프트에 따라 Anthropic 계정으로 로그인하세요.

3. 설치 확인:
   ```bash
   claude --version
   ```

## 환경 설정

Claude-Go에서 사용 가능한 Claude 관련 환경 변수:

```bash
# Claude 모델 (선택, 기본값: claude-sonnet-4-5)
CLAUDE_MODEL=claude-sonnet-4-5

# Claude Code 실행 파일 경로 (선택, PATH에 있으면 자동 감지)
CLAUDE_CODE_PATH=/usr/local/bin/claude

# Extended Thinking 토큰 한도 (선택, 0 = 비활성화)
MAX_THINKING_TOKENS=0

# 세션당 최대 비용 USD (선택, 미설정시 제한 없음)
MAX_BUDGET_USD=5.00
```

## 동작 방식

Claude-Go는 **단일 프로세스**로 실행됩니다 — 별도 서버가 필요 없습니다:

```
Bot ← Agent SDK query() 임베드 (같은 프로세스)
```

- Claude Agent SDK의 `query()` 함수는 실시간 스트리밍을 위한 `AsyncGenerator`를 반환합니다
- 세션은 JSON 파일로 로컬 관리됩니다 (서버 API 불필요)
- 요약은 Claude CLI 서브프로세스로 생성됩니다 (`claude -p`)
- Permission 모드는 `bypassPermissions`로 설정됩니다 — AI가 도구를 프롬프트 없이 실행합니다

## 동작 확인

Claude-Go 설정 후 진단 도구를 실행하세요:
```bash
bun run doctor
```

Claude Code CLI가 설치되어 있고 접근 가능한지 확인합니다.

## 모델 선택

텔레그램에서 `/agents` 명령으로 런타임에 AI 모델을 변경하거나, `CLAUDE_MODEL` 환경 변수로 기본 모델을 설정할 수 있습니다.

## Extended Thinking

Extended Thinking은 Claude의 사고 과정을 표시합니다. 메시지에 "think", "분석", "deep" 같은 키워드가 포함되면 자동으로 활성화되거나, `MAX_THINKING_TOKENS`를 0이 아닌 값으로 설정하여 기본 활성화할 수 있습니다.

## 비용 제어

`MAX_BUDGET_USD`를 설정하여 세션당 지출을 제한할 수 있습니다. SDK의 `maxBudgetUsd` 옵션에 직접 전달됩니다. 텔레그램 `/settings`에서 세션별로도 설정할 수 있습니다.
