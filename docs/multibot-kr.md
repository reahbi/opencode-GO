[🇺🇸 English](multibot.md)

# 멀티봇 모드 가이드

여러 명의 AI 봇을 동시에 운영하며 협업하는 **멀티봇 모드**에 오신 것을 환영합니다! 🤖🤖

이 가이드는 한 그룹 채팅에서 여러 개의 봇을 조종하고, 봇들끼리 토론하거나 코드를 리뷰하게 만드는 방법을 친절하게 설명합니다.

---

## 목차
1. [멀티봇이란?](#멀티봇이란)
2. [빠른 시작 (5분 세팅)](#빠른-시작-5분-세팅)
3. [봇 역할 이해하기](#봇-역할-이해하기)
4. [그룹 채팅 사용법](#그룹-채팅-사용법)
5. [토론 기능 (/debate) 🧪](#토론-기능-debate-)
6. [코드 리뷰 기능 (/review) 🧪](#코드-리뷰-기능-review-)
7. [봇 관리](#봇-관리)
8. [그룹 설정 (/groupsettings)](#그룹-설정-groupsettings)
9. [개인 설정 (/settings)](#개인-설정-settings)
10. [수동 설정 (ecosystem.config.cjs)](#수동-설정-ecosystemconfigcjs)
11. [환경변수 레퍼런스](#환경변수-레퍼런스)
12. [문제 해결 (FAQ)](#문제-해결-faq)

---

## 멀티봇이란?
멀티봇 모드는 각기 다른 전문 분야(역할)를 가진 봇들을 하나의 팀처럼 운영하는 방식입니다.

*   **전문성 분리:** 한 봇이 모든 걸 다 하기보다, 한 명은 코드 작성(Writer), 한 명은 코드 리뷰(Reader)를 맡으면 훨씬 더 꼼꼼한 결과가 나옵니다. 🎭
*   **협업 기능:** 봇들끼리 특정 주제로 찬반 토론을 하거나, 내가 짠 코드를 다른 봇이 검토하게 시킬 수 있습니다.
*   **@멘션 조종:** 그룹 채팅에서 `@WriterBot`에게는 명령을 내리고, `@ReaderBot`에게는 질문을 던지는 식으로 효율적인 워크플로우를 만들 수 있습니다. 🔍

---

## 빠른 시작 (5분 세팅)

### 1단계: BotFather에서 봇 만들기 🤖
먼저 사용할 봇이 최소 2개 필요합니다.
1. 텔레그램에서 [@BotFather](https://t.me/botfather)를 찾습니다.
2. `/newbot` 명령어로 첫 번째 봇(예: `MyWriterBot`)을 만들고 **API Token**을 복사해둡니다.
3. 한 번 더 `/newbot`을 실행해 두 번째 봇(예: `MyReaderBot`)을 만들고 토큰을 챙깁니다.
4. **중요:** 각 봇 설정에서 `Bot Settings` -> `Allow Groups?`가 `Enabled`인지 꼭 확인하세요!

### 2단계: `/addbot` 마법사 실행 🪄
원래 사용하던 봇과의 **1:1 채팅(DM)**에서 진행합니다.

1. 봇에게 `/addbot`을 보냅니다.
   > 🤖 **봇 추가 마법사**
   >
   > BotFather에서 발급받은 새 봇의 토큰을 보내주세요.

2. 새로 만든 봇의 API 토큰을 붙여넣습니다.
   > ✅ **@MyWriterBot** 확인됨
   >
   > 역할을 선택하세요:
   > `[✏️ Writer]` `[🔒 Reader]`

3. 역할 버튼을 누릅니다. 그러면 프로젝트 목록이 나옵니다.
   > 역할: **✏️ Writer**
   >
   > 프로젝트를 선택하세요:
   > `[📁 my-project]` `[✏️ 직접 입력]`

4. 프로젝트를 선택하면 등록 완료! 바로 시작할 수 있습니다.
   > ✅ **봇 등록 완료!**
   >
   > `[🚀 지금 시작 (PM2)]` `[📋 설정만 저장]`

5. `🚀 지금 시작`을 누르면 봇이 즉시 서버에서 실행됩니다.

> 💡 두 번째 봇도 같은 방법으로 추가하세요. 이번엔 `🔒 Reader` 역할을 고르면 됩니다.

### 3단계: 그룹 채팅 초대 👥
1. 텔레그램에서 새 그룹을 만듭니다.
2. 위에서 만든 봇들을 모두 그룹에 초대합니다.

### 4단계: 첫 대화 해보기 💬
```
👤 나: @MyWriterBot /new 리팩토링 프로젝트
🤖 WriterBot: ✅ Session created

👤 나: @MyWriterBot auth.ts 파일 리팩토링 해줘
🤖 WriterBot: (실시간 스트리밍으로 작업 진행...)

👤 나: @MyReaderBot 방금 변경된 코드 문제 없는지 봐줘
🤖 ReaderBot: 전체적으로 좋지만 null 체크가 빠져있네요...
```

---

## 봇 역할 이해하기

### ✏️ Writer (작성자)
코드를 직접 수정하고 파일을 생성하는 '행동 대장'입니다.
*   **권한:** 파일 읽기/쓰기 모두 가능합니다.
*   **용도:** "이 함수 리팩토링해줘", "새로운 API 엔드포인트 만들어줘" 같은 요청에 적합합니다.
*   **리뷰 모드:** 기본적으로 **OFF** 상태입니다.

### 🔒 Reader (리뷰어)
코드를 분석하고 조언을 해주는 '꼼꼼한 검토자'입니다.
*   **권한:** 기본적으로 **읽기 전용**입니다. (수정 요청은 자동으로 거절합니다.)
*   **용도:** 코드 분석, 버그 찾기, 아키텍처 질문 등에 사용하세요.
*   **리뷰 모드:** 기본적으로 **ON** 상태입니다.

### ⚙️ Standalone (독립형)
역할 구분이 없는 기본 상태입니다. 혼자서 모든 일을 처리할 때 사용하며, 봇들 간의 토론이나 리뷰 기능은 사용할 수 없습니다.

---

## 그룹 채팅 사용법

### @멘션으로 대화하기
그룹 채팅에서는 봇들이 모든 대화를 듣지 않습니다. 반드시 **@멘션**으로 봇을 불러야 응답합니다.

*   **사용 예시:**
    *   👤 유저: `@MyWriterBot 이 파일 로그 추가해줘`
    *   🤖 WriterBot: `네, 로그를 추가하겠습니다... (작업 시작)`
    *   👤 유저: `@MyReaderBot 방금 Writer가 고친 코드 문제 없어?`
    *   🤖 ReaderBot: `분석 결과, 예외 처리가 부족해 보입니다...`

멘션 없이 메시지를 보내면 봇들은 조용히 지켜보기만 합니다. 🤫

### 권한 버튼
봇이 파일을 수정하려고 하면 **[승인] / [거부]** 버튼이 나옵니다.
*   **개인 채팅:** 누구나 누를 수 있습니다.
*   **그룹 채팅:** 보안을 위해 **명령을 내린 본인**만 버튼을 누를 수 있습니다. 다른 사람이 누르면 "권한이 없습니다"라는 알림이 뜹니다. 🔒

---

## 토론 기능 (/debate) 🧪

> **🧪 테스트 중**: 이 기능은 현재 테스트 단계입니다. 일부 동작이 불안정할 수 있습니다.

두 봇이 서로 의견을 주고받으며 결론을 내는 기능입니다.

### 사용법
채팅창에 `/debate [주제]`를 입력하세요.

### 예시 대화
```
👤 나: /debate 이번 프로젝트에 React 대신 Vue를 쓰는 게 어떨까?

🎭 토론 시작: React vs Vue

🤖 WriterBot (1라운드):
  Vue는 학습 곡선이 낮고 Single File Component가
  생산성을 높여줍니다...

🤖 ReaderBot (2라운드):
  그러나 React의 생태계와 커뮤니티 규모를 고려하면
  장기적 유지보수에 유리합니다...

🤖 WriterBot (3라운드):
  Vue 3의 Composition API가 React Hooks와 비슷한
  수준의 유연성을 제공하므로...

... (최대 6라운드)

🏁 토론 종료: 최대 라운드 도달
```

### 팁
- 주제가 구체적일수록 더 수준 높은 토론이 됩니다 (❌ "뭐가 좋아?" → ✅ "이 프로젝트에 TypeScript strict mode를 적용해야 할까?")
- 각 라운드당 최대 5분 답변 시간이 있습니다
- 상대 봇이 오프라인이면 타임아웃 됩니다
- 기본 토론 라운드 수는 `/groupsettings`에서 변경할 수 있습니다
- `/debate [라운드] 주제` 형식으로 인라인 지정도 가능합니다

---

## 코드 리뷰 기능 (/review) 🧪

> **🧪 테스트 중**: 이 기능은 현재 테스트 단계입니다. 일부 동작이 불안정할 수 있습니다.

한 봇이 작업한 내용을 다른 봇에게 검토받는 협업의 꽃입니다.

### 사용법
검토하고 싶은 내용을 적고 `/review`를 입력하세요.

### 예시 대화
```
👤 나: /review auth.ts 파일의 보안 상태

🔍 리뷰 시작: auth.ts 보안 상태

🤖 ReaderBot:
  🔎 코드 리뷰 결과:

  ✅ 잘된 점:
  - JWT 토큰 만료 시간이 적절하게 설정됨
  - bcrypt 해싱이 올바르게 구현됨

  ⚠️ 개선 필요:
  - line 42: password를 평문으로 로깅하고 있음
  - line 67: SQL injection 가능성 있음
  - rate limiting이 없어서 brute force 공격에 취약

✅ 리뷰 완료
```

### 팁
- 리뷰 대상을 구체적으로 설명할수록 정확한 리뷰를 받을 수 있습니다
- 토론과 달리 리뷰는 **한 방향** — Reader가 분석 결과를 한 번 전달하면 끝

---

## 봇 관리

### /bots — 봇 현황 확인
현재 내 팀에 어떤 봇들이 있고, 깨어 있는지(Online) 확인할 수 있습니다.

> **출력 예시:**
> 🟢 **MyWriterBot** (Writer) - 온라인
> 🟢 **MyReaderBot** (Reader) - 온라인
> 🔴 **TestBot** (Standalone) - 오프라인

### /addbot — 새 봇 추가 (마법사)
새 봇을 팀에 합류시킬 때 사용합니다. **반드시 봇과의 1:1 채팅(DM)**에서 진행하세요.

자세한 단계별 안내는 [빠른 시작 2단계](#2단계-addbot-마법사-실행-)를 참고하세요.

### /cancel — 마법사 취소
봇 추가 도중에 마음이 바뀌었다면 언제든 `/cancel`을 입력해 중단할 수 있습니다. ❌

---

## 그룹 설정 (/groupsettings)

그룹 채팅 전용 공유 설정을 관리합니다. **이 설정은 그룹 내 모든 봇에게 적용됩니다.**

### 사용법
그룹 채팅에서 `/groupsettings`를 입력하세요.

> **참고**: 그룹에 여러 봇이 있어도 **한 봇만 응답**합니다 (알파벳 순 첫 번째).

### 메뉴 구성

| 메뉴 | 설명 |
|---|---|
| 🎭 Debate 설정 | 토론 라운드 수 설정 (3/6/10/무제한/직접입력) |
| 🤖 봇 상세 | 이 채팅방에 있는 봇들의 역할, 에이전트, 온라인 상태 |

### 표시 정보
- **🟢/🔴**: 봇 온라인/오프라인 상태 (3분 기준)
- **역할**: ✏️ Writer / 🔒 Reader / ⚙️ Standalone
- **에이전트**: 각 봇이 현재 사용 중인 AI 에이전트

### 예시 화면
```
⚙️ Group Settings
이 채팅방의 모든 봇에 적용됩니다

🎭 Debate: 6 rounds

🟢 @MyWriterBot
   ✏️ writer · 🤖 claude-sonnet
🟢 @MyReaderBot
   🔒 reader · 🤖 default
```

---

## 개인 설정 (/settings)

각 봇의 **개별** 동작 방식을 세밀하게 조정할 수 있습니다.

### Review Mode 토글
1. `/settings` 입력
2. `🤖 Agent & Mode` 버튼 클릭
3. `🔒 Toggle Review Mode` 버튼 클릭

| | Review Mode ON | Review Mode OFF |
|---|---|---|
| 파일 수정 | ❌ 자동 거부 | ✅ 허용 (승인 필요) |
| 코드 분석 | ✅ | ✅ |
| Reader 봇 기본값 | ⬅️ 이것 | |
| Writer 봇 기본값 | | ⬅️ 이것 |

> 💡 설정은 **즉시 적용**됩니다. 봇 재시작이 필요 없어요!
> 💡 `/settings`에서 바꾼 값은 봇 역할 기본값보다 우선합니다.

---

## 수동 설정 (ecosystem.config.cjs)

`/addbot` 마법사를 쓰지 않고 개발자가 직접 파일을 수정해서 봇을 늘릴 수도 있습니다.

```javascript
// ecosystem.config.cjs
const COORDINATION_DIR = '/tmp/opencode-go-coordination'

module.exports = {
  apps: [
    {
      name: 'opencode-go-writer',
      script: 'src/main.ts',
      interpreter: 'bun',
      cwd: '/path/to/opencode-go',
      env: {
        BOT_TOKEN: '여기에-Writer-봇-토큰',
        ALLOWED_USER_IDS: '내-텔레그램-유저-ID',
        DEFAULT_PROJECT: '/path/to/my-project',
        INSTANCE_NAME: 'writer',
        STATE_DIR: 'data/instances/writer',
        OPENCODE_SERVER_URL: 'http://127.0.0.1:4096',
        BOT_ROLE: 'writer',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'opencode-go-reader',
      script: 'src/main.ts',
      interpreter: 'bun',
      cwd: '/path/to/opencode-go',
      env: {
        BOT_TOKEN: '여기에-Reader-봇-토큰',
        ALLOWED_USER_IDS: '내-텔레그램-유저-ID',
        DEFAULT_PROJECT: '/path/to/my-project',
        INSTANCE_NAME: 'reader',
        STATE_DIR: 'data/instances/reader',
        OPENCODE_SERVER_URL: 'http://127.0.0.1:4096',
        BOT_ROLE: 'reader',
        GROUP_CHAT_ENABLED: 'true',
        COORDINATION_DIR,
      },
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
}
```

> ⚠️ **중요:** `STATE_DIR`은 봇마다 **반드시 다른 경로**를 써야 합니다. 같으면 상태가 충돌합니다.
> ⚠️ **중요:** `COORDINATION_DIR`은 모든 봇이 **같은 경로**를 써야 합니다. 다르면 서로 통신이 안 됩니다.

PM2 명령어:
```bash
pm2 start ecosystem.config.cjs   # 전체 시작
pm2 restart all                   # 전체 재시작
pm2 logs                          # 로그 보기
pm2 list                          # 상태 확인
pm2 stop all                      # 전체 중지
```

---

## 환경변수 레퍼런스

멀티봇 운영에 꼭 필요한 설정값들입니다.

| 변수 | 필수 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `BOT_ROLE` | ✅ | `standalone` | 봇의 역할 (`writer`, `reader`, `standalone`) |
| `GROUP_CHAT_ENABLED` | - | `false` | 그룹 채팅 응답 허용 여부 (`true` 권장) |
| `COORDINATION_DIR` | ✅ | - | 봇들이 대화 기록을 공유할 절대 경로 |
| `INSTANCE_NAME` | - | 프로젝트 폴더명 | `/bots` 목록과 로그에 보이는 이름 |
| `STATE_DIR` | - | `data/` | 봇의 상태 파일 저장 폴더 (봇마다 다르게!) |

---

## 문제 해결 (FAQ)

**Q: 봇이 그룹 채팅에서 대답을 안 해요!** 🔴
*   **A1:** `@멘션`으로 불렀는지 확인하세요.
*   **A2:** 환경변수 `GROUP_CHAT_ENABLED`가 `true`인지 확인하세요.
*   **A3:** BotFather에게 가서 `Allow Groups?` 설정을 켰는지 확인하세요.

**Q: /debate 토론 기능이 작동하지 않아요.**
*   **A1:** 봇들의 `BOT_ROLE`이 각각 `writer`와 `reader`여야 합니다. 둘 다 `standalone`이면 토론할 상대가 없는 것으로 간주합니다.
*   **A2:** 두 봇의 `COORDINATION_DIR`이 **완전히 같은 폴더**를 바라보고 있는지 확인하세요.

**Q: 토론 중에 봇이 멈췄어요.**
*   **A:** 토론은 봇당 최대 5분의 답변 제한 시간이 있습니다. 상대 봇이 꺼져 있거나 응답이 너무 길어지면 타임아웃이 발생할 수 있습니다. `pm2 status`로 봇 상태를 확인해 보세요.

**Q: 그룹에서 다른 사람이 승인 버튼을 눌러도 되나요?**
*   **A:** 아니요! 보안을 위해 명령어를 입력한 사람만 버튼을 누를 수 있도록 설계되었습니다. 🔒

**Q: /addbot을 했는데 봇이 안 떠요.**
*   **A:** 서버에 `pm2`가 설치되어 있는지 확인해 주세요. 마법사는 `pm2`를 이용해 새 프로세스를 띄웁니다.

---

즐거운 협업 코딩 되세요! 🟢🚀
