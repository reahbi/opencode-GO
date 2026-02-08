[🇺🇸 English](troubleshooting.md)

# 문제 해결 가이드 (Troubleshooting)

OpenCode-Go 사용 중 발생할 수 있는 주요 문제들과 해결 방법을 안내합니다.

## <a id="env-missing"></a>환경변수 누락

**증상**: 실행 시 `BOT_TOKEN is required. Set it in .env file.` 에러 발생
**원인**: `.env` 파일이 존재하지 않거나 필수 환경 변수가 설정되지 않음
**해결**:
```bash
cp .env.example .env
```
이후 `.env` 파일을 열어 `BOT_TOKEN`, `ALLOWED_USER_IDS`, `DEFAULT_PROJECT` 등 필수 변수를 설정하십시오.

## <a id="invalid-user-id"></a>User ID 형식 오류

**증상**: `Invalid user ID: abc123` 에러 발생
**원인**: `ALLOWED_USER_IDS`에 숫자가 아닌 문자열이나 잘못된 형식이 입력됨
**해결**:
@userinfobot을 통해 본인의 숫자형 ID를 다시 확인한 후, `.env` 파일에 숫자만 입력하십시오. 여러 개인 경우 쉼표로 구분합니다.

## <a id="server-unreachable"></a>OpenCode 서버 연결 불가

**증상**: `Cannot connect to OpenCode at http://...` 에러 발생
**원인**: OpenCode 서버가 실행 중이 아니거나, URL 설정이 잘못되었거나, 방화벽에 의해 차단됨
**해결**:
```bash
# 서버 실행 확인
opencode serve
# 연결 테스트
curl http://127.0.0.1:4096/health
```
`.env`의 `OPENCODE_SERVER_URL`이 실제 서버 주소와 일치하는지 확인하십시오.

## <a id="token-invalid"></a>봇 토큰 무효

**증상**: 텔레그램 API로부터 `Unauthorized` 에러 발생
**원인**: 입력한 봇 토큰이 잘못되었거나, @BotFather에 의해 폐기됨
**해결**:
@BotFather에게서 받은 토큰을 정확히 복사하여 `.env`의 `BOT_TOKEN`에 붙여넣으십시오. 필요하다면 새로운 토큰을 발급받으십시오.

## <a id="no-response"></a>봇이 응답하지 않음

**증상**: 메시지를 보냈으나 봇이 아무런 반응을 보이지 않음
**원인**: 본인의 텔레그램 ID가 `ALLOWED_USER_IDS`에 포함되지 않음 (보안 정책상 무시됨)
**해결**:
본인의 ID를 확인하여 `.env`의 `ALLOWED_USER_IDS`에 추가한 후 봇을 재시작하십시오.

## <a id="project-not-found"></a>프로젝트 디렉토리 없음

**증상**: `Project at /path/to/project not found` 에러 발생
**원인**: `DEFAULT_PROJECT`에 설정된 경로가 존재하지 않거나, 절대 경로가 아닌 상대 경로를 사용함
**해결**:
```bash
ls -d /absolute/path/to/project
```
경로가 실제로 존재하는지 확인하고, 반드시 절대 경로(Absolute Path)를 사용하십시오.

## <a id="state-corruption"></a>state.json 손상

**증상**: `Failed to parse state file` 에러 발생
**원인**: `data/state.json` 파일이 손상되었거나, 비정상적인 종료로 인해 파일 내용이 깨짐
**해결**:
```bash
rm data/state.json
```
해당 파일을 삭제한 후 봇을 다시 시작하면 기본값으로 자동 재생성됩니다.

## <a id="permission-denied"></a>파일 권한 문제

**증상**: `EACCES: permission denied` 에러 발생
**원인**: `data/` 디렉토리 또는 로그 파일에 대한 쓰기 권한이 없음
**해결**:
```bash
chmod 755 data/
```
디렉토리의 소유자와 권한을 확인하여 실행 사용자가 파일을 쓸 수 있도록 설정하십시오.

## <a id="bun-not-found"></a>Bun 미설치/PATH 문제

**증상**: `bun: command not found` 오류 발생
**원인**: Bun이 설치되어 있지 않거나, 설치 경로가 시스템 PATH에 포함되어 있지 않음
**해결**:
`docs/setup/bun.md` 문서를 참고하여 Bun을 설치하고 PATH 설정을 완료하십시오.

## <a id="port-in-use"></a>포트 충돌

**증상**: `address already in use` 에러 발생 (서버 실행 시)
**원인**: 이미 다른 프로세스가 동일한 포트(기본 4096)를 사용 중임
**해결**:
```bash
lsof -i :4096
```
해당 포트를 사용하는 프로세스를 종료하거나, 다른 포트를 사용하여 서버를 실행하십시오.

---

## 멀티봇 관련 문제

## <a id="group-no-response"></a>그룹 채팅에서 봇이 응답 안 함

**증상**: 그룹에서 @멘션을 해도 봇이 응답하지 않음
**원인**: 그룹 채팅 기능이 비활성화되어 있거나, BotFather 설정 누락
**해결**:
1. `.env`에서 `GROUP_CHAT_ENABLED=true` 확인
2. BotFather에서 봇 설정 → `Bot Settings` → `Allow Groups?` → `Enabled`
3. 봇 재시작 후 그룹에 다시 초대

## <a id="debate-not-working"></a>/debate 토론 기능 작동 안 함

**증상**: `/debate` 명령 후 토론이 시작되지 않음
**원인**: 봇 역할 설정 누락 또는 coordination 디렉토리 불일치
**해결**:
1. 두 봇의 `BOT_ROLE`이 각각 `writer`와 `reader`인지 확인
2. 두 봇의 `COORDINATION_DIR`이 **완전히 동일한 경로**인지 확인
3. 상대 봇이 온라인인지 `/bots` 명령으로 확인

## <a id="coordination-dir"></a>봇 간 통신 실패

**증상**: `/debate`, `/review` 등 협업 기능이 작동하지 않음
**원인**: `COORDINATION_DIR` 경로가 다르거나, 디렉토리 권한 문제
**해결**:
```bash
# 모든 봇에서 동일한 경로 사용 확인
echo $COORDINATION_DIR

    # 디렉토리 권한 확인
    ls -la /tmp/opencode-go-coordination/
```

## <a id="duplicate-groupsettings"></a>/groupsettings 중복 응답

**증상**: `/groupsettings` 명령 시 여러 봇이 동시에 응답
**원인**: 봇 버전 불일치 (일부 봇만 업데이트됨)
**해결**:
```bash
pm2 restart all
```
모든 봇을 동일한 버전으로 업데이트 후 재시작하십시오.
