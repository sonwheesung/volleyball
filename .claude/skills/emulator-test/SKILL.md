---
name: emulator-test
description: Drive 배구명가(volleyball) on an Android emulator end-to-end via Expo Go ("에뮬레이터 테스트", "에뮬로 띄워서 테스트", "화면 직접 보면서 터치 테스트", "경기 보드 띄워서 봐줘", "run an emulator cycle", "E2E on emulator"). Claude boots the AVD, loads the app in Expo Go (managed workflow — no native build), then SEES screens via screencap→Read and TAPS by coordinate — catching real-device 렌더·화면전이·터치 bugs that npm test·sim·verify-board can't (the "관전형 1순위 = 보는 경험" gap). Use when the user wants visual/touch verification of a flow on device; for unit/sim/board-audit regression use run-all-tests·verify-board instead.
---

# Emulator Test — 배구명가 실기기 see-and-tap E2E (Expo Go 경로)

Claude가 안드로이드 에뮬레이터로 배구명가를 **Expo Go로 띄우고, 스크린샷으로 화면을 보고, 좌표로 탭**해 시나리오(사이클)를 끝까지 돈다. 유닛·sim·헤드리스 보드 감사(verify-board)가 못 보는 **실기기 렌더 결과·화면 전이·터치 반응**을 사람 눈으로 잡는다(시뮬·감사 PASS인데 실기기 버그 = 거짓 확신). 관전형이 1순위([[idle-definition]] — 경기 연출이 1순위 투자처)라 **"실제로 보기 좋은가"** 가 이 테스트의 고유 가치.

> **배구명가는 Expo Go 관리형**(네이티브 `android/` 없음, `expo start`). 사도전과 달리 `expo run:android`(네이티브 빌드)를 쓰지 않는다 — **Expo Go 앱에 dev 번들을 로드**한다. 서버 포트 **8082**([[server-ports]]).

## 진행 규율 (불변)

```
사이클 실행 → 오류 발견 시 → 즉시 수정 → 다시 시연(클린할 때까지) → 애매한 사항은 마지막에 한꺼번에 질문
```

- **오류**(크래시·렌더 깨짐·터치 무반응·게이트 오작동·잘못된 텍스트/수치·연출 어색)는 도중에 고치고 재시연. 고침은 그냥 끝내지 말고 **케이스 등재**(보드 연출 → `docs/BOARD_RULES.md` / UI 상호작용 → `docs/UI_RULES.md` / 영입·오프시즌 → `docs/EDGE_CASES.md`) + 사각 분석 + 형제 사냥(grep 전수) + 영향 계층 재검(`docs/README.md` 검증 루틴)까지 = 「완료」.
- **애매한 사항**(취향·문구 어색·밸런스 의문 — 「틀렸다」 단정 불가)은 건드리지 말고 **메모**, 오류 전부 고친 뒤 모아서 질문(도중에 멈춰 묻지 않음 — [[drive-to-completion-no-checkpoints]]).
- **추정 금지**: 수치·동작이 의심되면 화면으로 확인하고, 엔진 수치는 sim으로([[no-guessing-run-stats]]).

## 0. 사전조건 (시작 전 1회)

```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
EMU="$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe"
"$ADB" devices              # 이미 떠 있으면 부팅 스킵
"$EMU" -list-avds           # **volleyball** 전용 AVD 사용. ⚠ **sadojeon / emulator-5554는 다른 프로젝트(사도전) — 절대 건드리지 말 것**
```

- 환경: `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`. **배구명가 전용 AVD `volleyball`**(2026-06-29 생성, pixel_6·android-35). 없으면 생성:
  `echo no | "$LOCALAPPDATA/Android/Sdk/cmdline-tools/latest/bin/avdmanager.bat" create avd -n volleyball -k "system-images;android-35;google_apis;x86_64" -d pixel_6`.
- **다중 에뮬 안전(핵심)**: 사도전 등 다른 에뮬이 동시에 떠 있을 수 있다 → 배구명가는 **전용 포트 `emulator-5556`** 으로 띄우고, **모든 adb·expo 동작을 `-s emulator-5556` / `ANDROID_SERIAL`로 타겟 고정**(5554를 건드리면 남의 세션을 가로챈다 — 실제 사고 2026-06-29).
- **Expo Go 경로**라 JDK·네이티브 빌드 불요. 첫 로드 시 Metro가 JS 번들만 만든다(수십 초~1분).

## 1. 부팅 + Expo Go 로드

```bash
S=emulator-5556        # ⚠ 배구명가 전용 시리얼. 5554(사도전) 절대 타겟 금지
"$EMU" -avd volleyball -no-snapshot -no-boot-anim -gpu auto -port 5556 &   # 전용 포트(사도전 5554와 분리)
"$ADB" -s "$S" wait-for-device
until [ "$("$ADB" -s "$S" shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 5; done

# 개발 서버 + Expo Go 자동 설치·실행 — ANDROID_SERIAL로 5556에만(2개 떠 있을 때 엉뚱한 에뮬 방지)
cd /c/project/volleyball
ANDROID_SERIAL="$S" npx expo start --android --port 8082 &      # run_in_background. Expo Go가 5556에 dev 번들 로드
# 이후 모든 adb 동작은 `"$ADB" -s emulator-5556 ...` 로 타겟 고정(screencap·tap 포함). 대안: ANDROID_SERIAL 환경변수 유지
```

- 이미 Expo Go가 떠 번들을 받은 뒤면 재시작 말고 화면만 다시: `"$ADB" shell am start -n host.exp.exponent/.MainActivity` 후 최근앱/딥링크.
- **번들 에러 화면(빨간 LogBox)** 이 뜨면 그 자체가 오류 — 메시지를 Read로 읽고 원인 수정 후 reload(에뮬에서 `r` 키 = `"$ADB" shell input text "rr"` 아님, Metro 콘솔 `r` 또는 앱 흔들기 `"$ADB" shell input keyevent 82`→Reload).
- ⚠ 테스트 파일은 `engine/**/*.test.ts`(app/ 밖)이라 expo-router require.context가 안 끌어온다 — metro blockList 불요(현재 app/에 .test 없음). app/에 테스트 파일 추가 시엔 blockList 필요.

## 2. 보고-판단-탭 루프 (핵심)

한 동작 = 한 확인. 절대 화면 안 보고 연속 탭하지 않는다.

> ⚠ **2개 에뮬이면 bare `adb`는 "more than one device" 에러.** 시작에 `export ANDROID_SERIAL=emulator-5556` 한 번 → 아래 모든 `"$ADB"` 명령이 5556(배구명가)만 타겟(또는 매 명령에 `-s emulator-5556`). 5554(사도전)로 새면 사고.

```bash
"$ADB" exec-out screencap -p > shot.png    # (ANDROID_SERIAL=emulator-5556 전제) scratchpad에
```
→ **Read(shot.png)** 로 화면을 눈으로 본다 → 다음 동작 판단 → 탭 → 다시 screencap.

### ⚠ 좌표 환산 (가장 자주 틀림)

- screencap PNG는 기기 네이티브 해상도(pixel_6 = **1080×2400**). Read로 열면 harness가 축소 표시하고 **"× N.NN" 배율 안내**를 붙인다(1080폭이면 보통 ×1.20).
- **내가 본 좌표 × (안내 배율) = 기기 좌표.** `adb shell input tap`은 **기기 좌표**를 받는다 → 항상 본 좌표에 배율을 곱해 탭(안 곱하면 위/아래로 빗나감).

```bash
"$ADB" shell input tap 712 2233          # 기기 좌표(= 본 좌표 593,1861 × 1.2)
"$ADB" shell input swipe 540 1600 540 600 300   # 스크롤(기기 좌표)
"$ADB" shell input keyevent 4            # 뒤로가기
```

### 빗나가면 — uiautomator bounds

RN 텍스트 노드는 안 잡혀도 **버튼 bounds는 잡힌다**.

```bash
MSYS_NO_PATHCONV=1 "$ADB" shell uiautomator dump /sdcard/ui.xml   # Git Bash: 프리픽스 필수(경로 망가짐 방지)
MSYS_NO_PATHCONV=1 "$ADB" shell cat /sdcard/ui.xml > ui.xml
# bounds="[x1,y1][x2,y2]" 중심 = ((x1+x2)/2,(y1+y2)/2) 로 탭(이미 기기 좌표 — 배율 곱 X)
```

## 3. 배구명가 사이클 (관전형 1순위 중심)

> **상세 테스트 케이스 대본 = [`docs/EMULATOR_E2E.md`](../../../docs/EMULATOR_E2E.md)** — 각 사이클(C1~C5)을
> "어느 화면에서 · 무엇을 확인하고 · 어디를 어떤 순서로 탭하는지" 케이스 단위로 적어 둔다. **돌리기 전에 그 문서를 열어
> 해당 사이클 표를 따라 한다.** C1(온보딩 19스텝)은 스텝별 anchor·기대·확인포인트가 전부 표로 있다. 새로 검수하다 나온
> 케이스·메모는 그 문서에 추가(스킬 본문은 방법, 대본은 케이스).
>
> 사이클 사전조건 7항목(①빌드/환경 ②세이브 상태(새 게임/이어하기) ③서포터/권한 ④보유 자원(현금·로스터) ⑤도메인 상태(시즌·날짜·순위) ⑥선행 화면 ⑦선행 동작)을 기입하고 돈다. 같은 화면도 *경로*가 상태를 가른다.

- **C1 온보딩·구단 선택**: 첫 실행 → 인트로 슬라이드 → 구단 선택(정체성 서사 표시) → 대시보드. 스포트라이트 튜토리얼·세이프에어리어(노치/홈인디케이터) 확인.
- **C2 경기 보드 관전(★ 1순위)**: 일정 → 경기 진입 → **코트 높이(스크롤 없이 한 화면)**·마커 6인 로테이션·스코어보드(세트/점수)·랠리 연출·중계 현수막(실시간: 세트획득·연속·에이스/블록 — Phase3)·종료 후 결과-결정 현수막. `docs/BOARD_RULES.md` 관찰 룰 대조(어색한 장면).
- **C3 시즌 진행**: 자동 진행/이어보기 → 빅매치 표시 → 시즌 종료 → 시상식·뉴스. 무푸시·관전형 흐름.
- **C4 단장 업무**: FA 센터(미리보기=결과)·드래프트·계약 관리(다크 글래스 ActionSheet)·트라이아웃·스태프. 자금/캡 게이트 표시.
- **C5 뉴스·기록**: 뉴스 피드(읽음 즉시반영·sponsor 예고)·기록/명예의전당·연표.
- **관찰 고유가치(눈으로만)**: placeholder 날것(`{name}`)·조사 깨짐(`달리기(으)로`)·포지션 라벨 영/한 혼용·외인 연고 성격 같은 **표시 텍스트 버그**(엔진 sim은 key로만 해소해 못 봄). UI-12 카테고리 색·카드 보더·로딩/비활성.
- **dev 화면**: 감사·실험실·테스트경기는 `DEV_TOOLS`(`__DEV__`&&SHOW_DEV_TOOLS) 게이트 — dev 빌드면 보인다([[audit-screen-dev-only]]).

## 3.5 태블릿 프로파일 (반응형/폼팩터 검수 — 2026-07-16 신설)

태블릿 반응형·Android 16 회전 검증(#130)용. 폰 AVD와 별개로 **`volleyball_tab`**(pixel_tablet, 2560×1600 @320dpi = sw800dp)을 쓴다 — **전용 포트 5558**(폰 5556·사도전 5554와 분리).

```bash
# AVD 없으면: echo no | avdmanager.bat create avd -n volleyball_tab -k "system-images;android-35;google_apis;x86_64" -d pixel_tablet
#   (#130 API36 검증 때는 android-36 이미지로 별도 생성)
"$EMU" -avd volleyball_tab -no-snapshot -no-boot-anim -gpu auto -port 5558 &   # run_in_background
S=emulator-5558   # 이후 모든 adb를 -s $S 로
# Expo Go 설치(새 AVD엔 없음): "$ADB" -s $S install -r ~/.expo/android-apk-cache/Expo-Go-*.apk
# 실행 중 Metro(8082)에 딥링크(에뮬은 LAN IP 대신 10.0.2.2):
MSYS_NO_PATHCONV=1 "$ADB" -s $S shell am start -a android.intent.action.VIEW -d "exp://10.0.2.2:8082"
```

- **레터박스가 정상이다**: 세로 고정 앱이라 가로 태블릿에선 중앙 세로 창(~600×800dp, 양옆 검정)으로 뜬다(API 35까지 실측 — 전 화면 렌더 정상 2026-07-16). 이걸 버그로 오인하지 말 것. API 36에선 회전 강제 가능성(#130) — 그게 이 프로파일의 검증 대상.
- **시스템 팁 다이얼로그**("See and do more" — 태블릿 첫 실행 멀티태스킹 안내)가 앱 위에 뜬다 → "Got it" 닫고 진행. Expo dev 메뉴도 첫 로드에 뜸 → X 닫기.
- 창이 좁아졌으므로 탭 좌표는 폰 대본과 다르다 — 매 스텝 screencap→Read→배율 곱 원칙 그대로.
- 끝나면 `"$ADB" -s emulator-5558 emu kill` (5554·5556 금지).

## 4. 끝나면

- **결과 기록**: 사이클·날짜·사전조건·PASS/오류·애매(질문대기). 핵심 스크린샷만 보관(scratchpad).
- 오류 고쳤으면 BOARD_RULES/UI_RULES/EDGE_CASES 등재 + 형제 사냥 + 영향 계층(`README` 검증 루틴) 재실행. 기능 완성이면 자동 커밋·푸시([[auto-push-on-feature]]).
- 에뮬은 PC를 점유 → 끝나면 정리: **`"$ADB" -s emulator-5556 emu kill`** (배구명가만 — 사도전 5554는 절대 kill 금지). Metro 백그라운드도 종료.

## 트리거 메모

- "에뮬레이터로 테스트", "에뮬로 띄워서 봐줘", "경기 보드 직접 띄워서", "사이클 돌려", "C2 돌려줘" 류.
- 단위/sim 회귀 → `run-all-tests`. 보드 연출 헤드리스 감사 → `verify-board`. 밸런스 수치 → `sim-league`. **실기기 눈·터치 = 이 스킬.**
- 범용 원본: `C:\project\common\.claude\skills\emulator-test`(플레이스홀더). 본 파일은 배구명가 구체본(Expo Go·AVD sadojeon·8082·사이클 C1~C5).
