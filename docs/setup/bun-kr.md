[🇺🇸 English](bun.md)

# Bun 설치 가이드

Claude-Go는 Bun 런타임을 사용하여 실행됩니다. 이 문서는 Bun을 설치하고 설정하는 방법을 안내합니다.

## Bun 개요

Bun은 JavaScript 및 TypeScript를 위한 초고속 런타임, 패키지 매니저, 번들러, 그리고 테스트 러너입니다. Node.js의 대안으로 설계되었으며, 성능이 매우 뛰어나고 TypeScript를 기본적으로 지원합니다.

## 설치 (Linux 및 macOS)

터미널에서 다음 명령어를 실행하여 Bun을 설치할 수 있습니다:
```bash
curl -fsSL https://bun.sh/install | bash
```

## 설치 (Windows)

Windows 환경에서는 WSL(Windows Subsystem for Linux)을 사용하는 것을 강력히 권장합니다. 만약 직접 설치하고자 한다면 PowerShell에서 다음 명령어를 실행하십시오:
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

## 설치 확인

설치가 완료되면 새로운 터미널 창을 열고 다음 명령어를 실행하여 설치를 확인하십시오:
```bash
bun --version
```
버전 번호가 출력되면 정상적으로 설치된 것입니다.

## PATH 문제 해결

만약 `bun: command not found` 오류가 발생한다면, Bun 바이너리 디렉토리가 시스템의 PATH 환경 변수에 포함되어 있지 않은 것입니다.

1. `~/.bun/bin` 디렉토리를 PATH에 추가해야 합니다.
2. 다음 명령어를 실행하여 설정을 추가하고 적용하십시오:
   ```bash
   echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```
   - zsh 사용자는 `.bashrc` 대신 `.zshrc` 파일에 추가하십시오.

## 업데이트

Bun을 최신 버전으로 업데이트하려면 다음 명령어를 사용하십시오:
```bash
bun upgrade
```
