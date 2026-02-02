# OpenCode 서버 설정 가이드

OpenCaddy는 OpenCode AI 코딩 어시스턴트 서버와 통신하여 작업을 수행합니다. 이 문서는 OpenCode 서버를 설치하고 설정하는 방법을 안내합니다.

## OpenCode 개요

OpenCode는 강력한 AI 코딩 어시스턴트 서버입니다. OpenCaddy는 이 서버에 연결하여 텔레그램을 통해 AI와 대화하고 코드 수정 요청을 전달하는 클라이언트 역할을 합니다.

## 설치 및 시작

1. 설치 방법은 OpenCode 공식 문서(https://opencode.ai) 또는 프로젝트의 README를 참고하십시오.
2. 서버를 시작하려면 다음 명령어를 실행합니다:
   ```bash
   opencode serve
   ```
   기본적으로 서버는 4096 포트에서 동작합니다.

## 서버 연결 확인

서버가 정상적으로 실행 중인지 확인하려면 다음 명령어를 사용하십시오:
```bash
curl http://127.0.0.1:4096/health
```
정상이라면 서버로부터 상태 응답을 받게 됩니다.

## 포트 변경 및 설정

기본 포트(4096)가 아닌 다른 포트를 사용하려면 다음과 같이 실행합니다:
```bash
opencode serve --port 8080
```
이 경우, OpenCaddy의 `.env` 파일에서 `OPENCODE_SERVER_URL` 값을 수정해야 합니다:
`OPENCODE_SERVER_URL=http://127.0.0.1:8080`

## 인증 설정 (선택 사항)

보안을 위해 OpenCode 서버에 사용자명과 비밀번호를 설정할 수 있습니다.
1. 서버 시작 시 사용자명과 비밀번호를 지정합니다.
2. OpenCaddy의 `.env` 파일에서 `OPENCODE_SERVER_USERNAME`과 `OPENCODE_SERVER_PASSWORD` 항목을 서버 설정과 일치시키십시오.

## 원격 서버 사용

OpenCode 서버가 다른 장비에서 실행 중인 경우:
1. `.env` 파일의 `OPENCODE_SERVER_URL`을 해당 서버의 IP 주소로 설정합니다.
   예: `OPENCODE_SERVER_URL=http://192.168.1.100:4096`
2. 해당 서버의 방화벽 설정에서 4096(또는 설정한 포트) 포트가 허용되어 있는지 확인하십시오.
