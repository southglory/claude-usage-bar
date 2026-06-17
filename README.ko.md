# Claude Multi-Account Usage

[English](README.md) · **한국어**

> **여러 Claude 계정의 5시간 / 7일 사용량을 한 번에** VS Code 상태바에서 확인하세요 — 진행 바, 색상 경고, 숨쉬는 쿼카 마스코트, 토큰 비용 대시보드까지.

대부분의 Claude 상태바 확장은 `~/.claude` 하나만 추적합니다. 계정을 둘 이상 쓰면 —
개인·업무 로그인이라든가 [cc-switch](https://github.com/farion1231/cc-switch)
`ccp`/`ccw` 구성 — 나머지는 보이지 않죠. **Claude Multi-Account Usage** 는 모든 계정을
나란히 보여주고, **터미널에서만 쓰는 계정의 사용량까지** 표시합니다.

무료, MIT 라이선스, 완전 오픈소스 — 로컬 Claude 자격증명을 읽기 때문에
[모든 코드를 직접 감사](#개인정보--왜-오픈소스인가)할 수 있게 공개합니다.

**여러 계정을 한 줄에:**

![상태바의 여러 Claude 계정](images/statusbar.png)

**계정에 마우스를 올리면 사용량·리셋 시각·빠른 작업:**

![호버 툴팁: 사용량 바, 리셋, Dashboard / Terminal / Cache / Settings](images/tooltip.png)

## 기능

- **N개 계정 나란히** — 이름 하드코딩 없음, 개수 제한 없음.
- **자동 탐지** — 목록을 비워두면 홈에서 `.claude*` 디렉터리를 찾습니다. 라벨은 **폴더 이름 그대로**(`.claude`, `.claude-work`) — 파싱·강제 규칙 없음. 원하는 이름으로 자유롭게 바꾸세요.
- **대시보드에서 추가 & 첫 로그인** — 두 번째 `.claude-…` 계정을 이름 지어 추가하고, 패널에서 바로 터미널을 열어 첫 로그인까지.
- **진행 바** — 계정마다 5h · 7d 퍼센트 옆에 높이가 균일한 깔끔한 바(위 스크린샷 참고).
- **색상 임계** — 사용량이 오르면 초록 → 노랑 → 빨강. 한도에 도달하면 리셋 카운트다운 표시.
- **숨쉬는 쿼카 마스코트** — 위아래로 까딱이는 2프레임 픽셀 쿼카(설정에서 끄거나 교체 가능).
- **사용량 대시보드** — 계정마다 깔끔한 카드 하나: 오늘 지출, 5h/7d 바, **토큰 비용 타일**(5h / 오늘 / 7일 / 월). **Details** 하나만 펼치면 5h 토큰 분해, 프로젝트별 비용, 30일 히스토리 스파크라인, 시간대별 평균 비용까지. 비용 = 세션 로그의 토큰 수 × 단가 — 실제 구독 청구액이 아니라 API 환산 추정치입니다.
- **계정별 터미널** — 해당 계정의 `CLAUDE_CONFIG_DIR` 을 주입한 Claude 터미널을 엽니다. 전역 전환 없이 여러 계정 동시 실행.
- **cc-switch 호환** — `command: "ccw"` / `"ccp"` 로 기존 래퍼를 그대로 실행.

## 데이터 소스

계정마다 사용량은 두 소스 중 하나에서 가져옵니다(순서대로):

1. **캐시 파일** — `<CLAUDE_CONFIG_DIR>/vscode-claude-status-cache.json`. Claude Code의 VS Code 통합이 써주지만, **VS Code가 폴링하는 단 한 계정**에만 써줍니다 — 터미널에서만 쓰는 두 번째 계정에는 생기지 않습니다.

   ```jsonc
   { "usageData": { "utilization5h": 0.29, "utilization7d": 0.04,
                    "reset5hAt": 1781493600, "reset7dAt": 1782054000,
                    "limitStatus": "allowed" } }
   ```

2. **API 폴백** (`fetchUsageViaApi`, 기본 켜짐) — 캐시 파일이 없으면 해당 계정의 `.credentials.json` OAuth 토큰을 읽어 `api.anthropic.com` 의 rate-limit 응답 헤더에서 사용량을 직접 가져옵니다(`long-kudo.vscode-claude-status` 방식). 두 번째 계정 사용량을 보여줄 수 있는 유일한 방법입니다. 새로고침마다 토큰 1개짜리 작은 요청을 보내며, 툴팁에 `via API` / `via cache` 로 표시됩니다. 끄면 캐시 파일만 사용합니다.

캐시도 자격증명도 아직 없으면 **Log in**(대시보드 또는 툴팁)으로 로그인해 `.credentials.json` 을 만드세요.

## 설치

- **개발 실행**: 이 폴더를 VS Code로 열고 `F5`(Extension Development Host).
- **VSIX**: `code --install-extension southglory.claude-multi-usage-0.5.0.vsix` (또는 확장 패널 → ⋯ → *Install from VSIX…*).
- **마켓플레이스**: "Claude Multi-Account Usage" 검색(게시 후).

## 설정 (`settings.json`)

```jsonc
"claudeMultiUsage.accounts": [
  { "label": ".claude",      "dir": "~/.claude" },
  { "label": ".claude-work", "dir": "~/.claude-work" }
  // 라벨은 자유 텍스트 — 원하는 이름으로
],
"claudeMultiUsage.refreshIntervalSeconds": 30,
"claudeMultiUsage.progressBarLength": 8,
"claudeMultiUsage.warnAt": 0.5,            // 노란색 임계
"claudeMultiUsage.critAt": 0.9,            // 빨간색 임계
"claudeMultiUsage.show7d": true,
"claudeMultiUsage.showCharacter": true,    // 숨쉬는 쿼카 마스코트
"claudeMultiUsage.enableAnimation": true,
"claudeMultiUsage.launchCommand": "claude", // command 없는 계정의 기본 실행 명령
"claudeMultiUsage.clickAction": "refresh"   // refresh | dashboard | launch | openCache
```

`dir` 은 `~`, `%USERPROFILE%`, `${env:VAR}` 를 확장합니다. 자동 탐지는 목록이 비어 있을
때만 동작합니다. 각 계정은 `<쿼카> <라벨> <바> <5h>% · <7d>%` 형태로 표시됩니다(위
상태바 스크린샷 참고) — 앞 %가 5시간, 뒤 %가 7일.

**좌클릭** 은 `clickAction`(기본 새로고침)을 실행합니다. 호버 툴팁에 **Dashboard ·
Terminal · Cache · Settings** 링크가 있습니다 — VS Code가 상태바 항목의 커스텀 우클릭
메뉴를 지원하지 않아 툴팁에 둡니다.

## 계정 추가 & 첫 로그인

**대시보드**(툴팁 → *Dashboard*, 또는 *Open Usage Dashboard* 명령)를 엽니다:

1. **Add account** 에서 라벨(그대로 표시, 예: `.claude-work`)과 config 디렉터리(예: `~/.claude-work`)를 입력.
2. **Add & log in** 은 저장 후 `CLAUDE_CONFIG_DIR` 을 설정한 터미널을 열고 `claude` 를 실행 — 새 디렉터리면 로그인 화면이 뜹니다. (**Add only** 는 터미널을 열지 않음.)
3. 각 계정 카드에 **Log in**(재인증), **Open terminal**, **Cache file**, **Remove** 버튼.

## 계정 전환 (cc-switch 내장)

전역 상태를 건드리지 않고 계정별 터미널을 엽니다. 두 가지 방식:

1. **env 주입(기본)** — `command` 미지정: `CLAUDE_CONFIG_DIR` 주입 후 `launchCommand`(기본 `claude`) 실행. `ccw/ccp` 별칭이 없어도 동작.
2. **cc-switch 래퍼 그대로** — `command: "ccw"` / `"ccp"`: 그 래퍼를 그대로 실행(일반 터미널에서 `ccw` 친 것과 동일).

## 단축키

```jsonc
{ "key": "ctrl+alt+1", "command": "claudeMultiUsage.launch", "args": 0 }, // 1번째 계정
{ "key": "ctrl+alt+0", "command": "claudeMultiUsage.launch" }            // 인자 없으면 선택창
```

## 명령

`Claude Multi Usage: Open Usage Dashboard` · `Refresh` · `Open Settings` ·
`Open Cache File` · `Claude: Open Terminal for Account` · `Add Account` · `Remove Account`

## 나만의 마스코트 만들기

쿼카가 싫다면 직접 그리세요. 브라우저에서 **`tools/mascot-maker.html`** 을 열면 픽셀
에디터가 나옵니다 — 프레임마다 그리고, 이전 프레임을 어니언 스킨으로 겹쳐 보고, 루프를
미리 봅니다.

![Mascot Maker: 프레임과 실시간 애니메이션 미리보기가 있는 픽셀 에디터](images/mascot-maker.png)

`mascot.json` 을 내보낸 뒤 폰트를 빌드합니다:

```sh
uv run --with fonttools python tools/build_mascot_font.py mascot.json mascot.ttf mascot
```

붙여넣을 `contributes.icons` 블록과 `characterFrames` 값을 출력해줍니다. `mascot.ttf` 를
`package.json` 옆에 두고 다시 패키징하면 상태바에서 마스코트가 움직입니다.

> 픽셀 마스코트는 폰트 번들이 필요합니다(위). 재패키징 없이 빠르게 바꾸려면
> `claudeMultiUsage.characterFrames` 에 이모지/코디콘을 넣으세요. 예: `["▃","▆"]`.

기본 쿼카도 같은 방식으로 생성됩니다:

```sh
uv run --with fonttools python tools/build_quokka_font.py
```

## 개인정보 & 왜 오픈소스인가

이 확장은 민감한 로컬 파일 — 각 계정의 `.credentials.json` OAuth 토큰 — 을 읽어 사용량을
가져옵니다. 그래서 **일부러 완전 오픈소스**로 둡니다: 말로 믿지 말고 코드를 보세요.

- **토큰은 기기를 떠나지 않습니다.** 본인 사용량을 읽기 위해 **`api.anthropic.com`** 을
  직접 호출(Claude Code가 쓰는 그 엔드포인트)할 때를 제외하고는요. **제3자 서버·텔레메트리·
  분석 없음.**
- API 폴백은 **옵트아웃** — `claudeMultiUsage.fetchUsageViaApi: false` 로 두면 로컬 캐시
  파일만 쓰고 네트워크 호출을 전혀 하지 않습니다.
- 각 config 디렉터리에서 읽는 것 전부: `vscode-claude-status-cache.json`,
  `.credentials.json`, 그리고 비용 추정을 위한 `projects/**` 의 토큰 수.

이상한 점이 보이면 이슈나 PR 을 — 그게 MIT 의 취지입니다.

## 기여

이슈와 PR 환영합니다: <https://github.com/southglory/claude-usage-bar>. 확장은 순수
JavaScript(빌드 단계 없음)이고, 마스코트 폰트와 `.vsix` 는 `tools/` 의 스크립트로
생성됩니다.

---

## 라이선스

[MIT](LICENSE) © southglory — 자유롭게 사용·포크·수정.
