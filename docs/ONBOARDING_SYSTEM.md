# 온보딩 / 스포트라이트 튜토리얼 시스템

> 게임 시작(구단 선택)부터 핵심 화면을 **스포트라이트**로 하나씩 안내한다. 설명 대상만 밝게,
> 나머지는 어둡게, 화면을 탭하면 다음으로. **스텝 단위로 "본 것"을 영구 추적**해서, 나중에 기능이
> 추가돼도 이미 본 스텝은 건너뛰고 **신규 스텝만** 스포트라이트가 잡는다(기존 유저). 신규 유저는
> 미본(=전부)을 순서대로 본다. 관전형 1순위(보는 게임)의 진입장벽을 낮추는 연출 투자.

관련: 첫 인트로 슬라이드(`app/onboarding.tsx`, 게임 소개 4장)는 **이 시스템 이전 단계**다 —
인트로 끝(`completeOnboarding`) → `select-team`부터 스포트라이트가 시작된다. UI 연출 규칙은 UI_RULES.

---

## 1. 핵심 원칙 — 스텝 단위 추적(확장성의 척추)

- **단위는 "스텝(팁)"**: 화면 전체가 아니라 *설명 한 조각*이 단위다. 각 스텝은 **고유 id**를 갖는다.
- **영구 추적**: 본 스텝 id는 `store.seenTips: Record<string, true>`에 영속 저장된다.
  세이브와 **별개**(초기화해도 유지) — `onboarded`·`supporter`와 같은 결(설정의 "튜토리얼 다시보기"로만 리셋).
- **게이트는 조건문 하나**: 어떤 화면이든 그 화면의 스텝 목록을 `!seenTips[id]`로 거른다.
  본 건 안 뜨고, 안 본 것만 순서대로 뜬다.
- **확장 규칙**: 새 기능을 붙이면 **새 id의 스텝**을 레지스트리에 추가만 하면 된다.
  - 기존 유저: 옛 id는 이미 seen → **신규 id만** 스포트라이트.
  - 신규 유저: 전부 미본 → 전부 순서대로.
  - 코드 분기 추가 없음 — 레지스트리에 한 줄.

> 안티패턴: "튜토리얼 봤나?"를 화면 단위 불리언 하나(`tutorialDone`)로 두는 것. 그러면 신규 스텝을
> 기존 유저에게 보여줄 수 없다(이미 true). **반드시 스텝 id 집합**으로 둔다.

---

## 2. 데이터 — 스텝 레지스트리 (`data/tutorialSteps.ts`)

```ts
export interface Tip {
  id: string;        // 영구 추적 키. 한 번 출시하면 절대 바꾸지 않는다(바꾸면 기존 유저가 다시 봄).
  screen: string;    // 어느 화면에서 뜨나(아래 SCREEN 키)
  order: number;     // 그 화면 안 순서
  anchor?: string;   // 밝게 띄울 대상 SpotlightTarget id. 없으면 전체 어둡게 + 가운데 카드(인트로형)
  title: string;
  body: string;
}
export const tipsForScreen = (screen: string): Tip[] =>
  TIPS.filter((t) => t.screen === screen).sort((a, b) => a.order - b.order);
```

- **screen 키**(현재): `select-team` · `team-detail` · `tab-schedule` · `tab-dashboard` ·
  `tab-squad` · `tab-office` · `tab-mypage` · `match`(경기 보드 — 2026-07-14 신설). (확장 시 새 키 추가.)
  - 2026-06-30 네비 개편: 구 `tab-history`(기록 탭) → `tab-mypage`(마이페이지 탭). `history.intro`/`history.ach`
    **id는 보존**하고 screen 키만 옮김(둘 다 마이페이지 허브에서 발화 — 기록·업적 카드 앵커 그대로 history-top·history-ach).
- **id 불변 규칙**: 출시된 id는 고정. 문구만 고치는 건 자유(추적과 무관). 대상이 바뀌면 **새 id**.

---

## 3. 연출 — 스포트라이트 (`components/Spotlight.tsx`)

3요소(컨텍스트 1 + 컴포넌트 2):

- **`SpotlightProvider`** (루트 `app/_layout.tsx`에 1회): 화면의 대상 사각형들을 보관
  (`Record<anchorId, Rect>`). 화면 전환 시 대상은 mount/unmount로 자동 등록·해제.
  **컨텍스트 2분리 필수**: `targets`(자주 바뀜)와 `setTarget`(영구 고정, `useCallback []`)을 **별도 컨텍스트**로
  제공한다. 하나로 묶으면 Provider value가 매 렌더 새 객체가 돼, Target의 측정 effect가 그 변화로 재실행되고
  cleanup이 방금 등록한 좌표를 즉시 지우는 **무한 루프**(측정이 영원히 안 끝나 카드가 한 번도 안 뜸)가 생긴다
  — 모든 화면에서 스포트라이트 미표시의 진짜 원인이었다(2026-06-24, 진단 태그 `a0·` 로 확인).
- **`SpotlightTarget id`**: 밝게 띄울 요소를 감싼다. `onLayout` + 마운트 직후 **여러 차례**(0·60·200·
  500·900ms) `measureInWindow`로 **윈도우 절대 좌표**를 측정해 Provider에 등록(스크롤뷰·화면전환
  애니메이션으로 첫 측정이 0/미안정인 경우 보강). 언마운트 시 해제.
- **대상 자동 스크롤 → 안착 대기 → 표시(2026-07-04 신설·순서 분리)**: 대상이 편안한 위치(상단~중앙, `rect.y`가
  60~0.5×화면높이)가 **아니면** ① **스크롤만 먼저** 걸고 ② **안착(≈680ms)까지 오버레이를 안 그리다가** ③ 안착 후 표시한다.
  - **왜 순서 분리**: 사용자 1차 보고(team.roster가 하단에 걸쳐 링이 밑동에만) → 스크롤 도입. 2차 보고: "스크롤과
    스포트라이트가 **동시에** 떠 이상" → 스크롤 중엔 오버레이를 숨기고(`revealed=false` → `return null`) 안착 후에만 표시.
  - **구현**: 각 화면 공통 `<Screen>`의 ScrollView를 `ScrollCtrlCtx`(leaf `components/spotlightCtx.ts`)로 내려줌.
    오버레이가 조율: 활성 팁의 `rect`가 안 편안하면 `scrollCtrl.scrollToWindowY(rect.y)` 호출(콘텐츠 최상단 센티넬 View +
    대상을 각각 `measureInWindow`로 오프셋 계산, 상단 90px 아래로) → `setTimeout(680ms)` 후 `revealed=true`.
    `SpotlightTarget`은 활성일 때 스크롤 직후 위치를 재측정([260·480·660ms])만 하고 스크롤은 안 건다(조율은 오버레이 단독).
    카드 위치: 대상이 화면보다 크면(선수단 전체) 카드를 **하단에 얹는다**.
  - ⚠ **안착 타이머는 `useRef` 보관(effect cleanup으로 지우지 말 것)**: 표시 결정 effect는 `rect` 변화(스크롤 후 재측정)로
    재실행되는데, 타이머를 effect 로컬 변수로 두고 cleanup에서 `clearTimeout`하면 재실행 때 **안착 전에 취소돼 팁이 영영 안 뜬다**
    (에뮬 실측 2026-07-04 — 3/4에서 아무 것도 안 뜸). 팁당 1회만 결정(`handledRef`)하고 타이머는 `revealTimer` ref에 담아
    **팁 교체/언마운트 때만** 정리. React useEffect의 흔한 함정.
  - ⚠ **`measureLayout` 금지(Fabric)**: 숫자 노드핸들 `node.measureLayout(handle,…)`은 New Architecture에서
    `"ref.measureLayout must be called with a ref to a native component"` 런타임 에러(에뮬 실측) → 센티넬+`measureInWindow`로 회피.
  - **검증**: 에뮬 see-and-tap로 team.ovr(즉시)·coach·roster·operate(스크롤 후 표시) 전부 확인. 커버리지 가드 `tools/_dv_tips.ts`.
  - **잔여 안전망(구 폴백 유지)**: 스크롤 불가(비-`<Screen>` — 예 `select-team` 자체 ScrollView, 팁은 최상단 카드라 무관)거나
    좌표를 ≈720ms 안에 못 받으면 **구멍 없이 전체 어둠 + 가운데 카드**(`onScreen` 검사) — 구 "시커멓고 멈춘 화면"(team.start) 방지.
- **`SpotlightOverlay screen`**: 각 화면 끝에 1개. 그 화면의 미본 스텝 큐(`tipsForScreen(screen)
  .filter(!seen)`)의 **첫 스텝**을 띄운다. 투명 `Modal`(최상위·탭바 위 포함) 위에:
  - **둥근 구멍(2026-06-25 재교정 — 거대 테두리 기법)**: 구 4밴드는 **직각 구멍**이라 둥근 카드와 안 맞아 모서리가
    각졌다(사용자 2차 보고). → **단일 View의 거대 borderWidth(=SW+SH)로 어둠을 만들고**, content 영역(투명)을
    구멍에 맞춘다. `borderRadius = R + BIG`이면 inner(구멍) 반경 = `(R+BIG) − BIG = R`로 **카드처럼 둥근 구멍**.
    `R = (tip.radius ?? CARD_RADIUS=18) + PAD(8)`(기본 26 — 카드와 동심원). 작은 구멍은 `min(R, w/2, h/2)` 클램프.
    검증: 브라우저 재현 computed style — outerR 1026 − border 1000 = inner 26 = R(스크린샷은 환경상 타임아웃, 기하 확인).
    강조 링도 같은 `R`. 카드 아닌 대상은 `Tip.radius`로 개별 지정.
  - anchor 없으면 전체 어둠 + 가운데 카드.
  - **설명 카드**: 대상 위/아래 빈 쪽에 제목·본문 + "탭하여 계속 (n/총)".
  - **탭하면 다음**: 오버레이 아무 데나 탭 → `markTip(현재 id)` → 큐의 다음 스텝. 큐 비면 사라짐.
    (탭은 오버레이가 가로채므로 밑 요소는 안 눌린다 — 흐름은 튜토리얼이 통제.)

> 왜 Modal인가: 탭바·헤더까지 덮어야 "그 외는 어둡게"가 완성된다. `measureInWindow`(윈도우 좌표)와
> 풀스크린 Modal(0,0 기준)이 좌표계가 같아 구멍이 정확히 맞는다.

### 3.1 포커스 게이트 — 이중 스포트라이트 차단(2026-06-25)
> **증상(사용자 보고)**: 설정 → "튜토리얼 다시보기" 누르면 **구단 선택 스포트라이트 + (배경) 탭 화면 스포트라이트가
> 동시에** 뜬다.
> **원인**: `settings`는 `(tabs)` 위에 push돼 있고, 다시보기는 `resetTips()`(seenTips 비움) + `router.replace('/onboarding')`
> → `(tabs)`가 **스택에 mount된 채로 남는다**. onboarding→`select-team`으로 가면 스택에 `select-team`(최상위)·`(tabs)`
> (배경)가 공존하고, seenTips가 비어 **두 화면의 `SpotlightOverlay`가 동시에 활성**(각자 Modal). 정상 플레이에서도
> `select-team`은 `(tabs)` 밑에 남지만 그땐 그 팁이 이미 seen이라 안 떴을 뿐 — 구조적 사각.
> **1차 수정(실패)**: `SpotlightOverlay`마다 `useSegments()`로 현재 라우트를 판정. **탭에선 각 탭 컴포넌트가 자기
> 라우트로 인식**해 모두 focused=true → 대시보드·일정 탭 팁이 동시에 떴다(사용자 스샷 2026-06-25 — 일정 화면에
> "구단 현황 1/4" + "다음 경기 1/3" 동시).
> **2차 수정(구조적 보장)**: 활성 화면을 **`SpotlightProvider`에서 `usePathname()`로 한 번만** 계산해 `ActiveScreenCtx`로
> 공유. 모든 오버레이가 **같은 값**을 보고 `activeScreen === screen`일 때만 표시 → **at most one만 매치 = 이중 표시
> 구조적 불가**(usePathname이 부정확해도 둘은 절대 안 뜸 — 최악은 한 화면 누락). 폴백 없음(불일치=숨김, 이중>누락 우선).
> 경로 매핑 `screenFromPathname`은 `/`·`/index`·`(tabs)`·`endsWith('/schedule')` 등 변형을 관대히 흡수.
> **기기 확인**: 리로드 후 ① 이중 표시 사라짐(보장) ② 각 화면 팁이 1회씩 뜨는지(매핑 누락 시 그 화면만 안 뜸 → 경로 추가).
> (`@react-navigation useIsFocused`는 과거 오버레이를 영구 비표시한 이력이 있어 회피 — `usePathname` 전역 1회 계산으로 대체.)

---

## 4. 상태 (`store/useGameStore.ts`)

```ts
seenTips: Record<string, true>;     // 본 스텝 id 집합(영속, 세이브와 별개 — 초기화해도 유지)
markTip: (id: string) => void;      // 한 스텝 완료
resetTips: () => void;              // 전체 리셋(설정 "튜토리얼 다시보기")
```

- `seenTips`는 `freshSave`(게임 초기화) **밖**에 둔다 → 초기화해도 유지(`onboarded`와 동일 패턴).
- **persist `partialize`에 반드시 포함**(`store/useGameStore.ts`) — 빠지면 리로드마다 `{}`로 초기화돼
  튜토리얼이 매번 다시 뜬다(영구 추적 깨짐). 2026-06-24 누락 교정.
- 설정의 "튜토리얼 다시보기"(`app/settings.tsx`)는 `replayOnboarding()` + **`resetTips()`** 를 같이
  호출해 인트로와 스포트라이트를 처음부터 다시 보게 한다.

---

## 5. 초기 스텝 세트 (확장 가능 — 레지스트리에 추가만)

화면당 **상호작용 요소를 위→아래 순서로 다 짚는다**(2026-06-24 — 1화면 1팁에서 확장). `data/tutorialSteps.ts` 참조.

| screen | 스텝(순서) | 짚는 상호작용 |
|---|---|---|
| select-team | `select.pick` | 첫 구단 카드(미리보기) |
| team-detail | `team.ovr` → `team.coach` → `team.roster` → `team.start` | 팀 전력 · 감독 카드 · 선수단 목록 · 운영하기 버튼 |
| tab-schedule | `sched.next` → `sched.calendar` → `sched.results` | 다음 경기(관전) · 캘린더 버튼 · 전 구단 결과 버튼 |
| tab-dashboard | `dash.overview` → `dash.finance` → `dash.standings` → `dash.news` | 구단 현황 · 재정 카드 · 순위 카드(탭) · 뉴스 카드(탭) |
| tab-squad | `squad.coach` → `squad.intro` | 감독 카드 · 선수단 목록 |
| tab-office | `office.intro` → `office.staff` → `office.tx` | 계약 관리 · 스태프 계약 · 시즌 중 FA |
| tab-mypage | `history.intro` → `history.ach` | 마이페이지 허브 — 기록 카드(→/records-archive: 시즌/통산/명전/연표) · 업적 카드(→/achievements) |
| match | `match-spectate` → `match.controls` | 경기 보드(첫 관전) — 관전 모드 안내(가운데 카드) · 하단 컨트롤(스코어박스·⚙개입·나가기) |

> 새 화면/기능이 생기면 그 화면 키 + 새 id를 한 행 추가하면 자동으로 신규 유저 전체·기존 유저 신규분에
> 스포트라이트가 잡힌다. 한 화면에 상호작용 요소를 추가하면 그 화면에 새 order의 팁을 끼우면 된다(앵커 래핑 + 한 줄).

### 5.1 경기 보드 스포트라이트(2026-07-14 신설 — 구 수동 관전 팝업 승계)

경기 보드(`app/match/[id].tsx`)에 스포트라이트 2스텝을 신설했다. 독립 리뷰가 **C1(스포트라이트 코어에 "가운데 카드 전용
스텝" 신 개념 추가)을 폐기**하고 **C2(조건부 문구 — 기존 anchor-없음=가운데 카드 폴백을 그대로 사용)를 채택**했다.
따라서 `Spotlight.tsx`는 **`screenFromPathname`에 `/match/` 매핑 한 줄만** 더하고 측정·큐·폴백 로직은 무수정
(measure 타이밍 버그 5회 수정 이력 보호). 경로는 `startsWith('/match/')` — `/matchresult/`는 6번째 문자에서 갈라져 오매치 없음.

- **기존 팝업 승계**: 기존의 수동 "📺 관전 모드" 1회 팝업(`showTip` state + `markTip('match-spectate')`)을 **완전 삭제**하고,
  스텝① id를 그 **`match-spectate`를 그대로 승계**했다 → 이미 팝업을 본 기존 유저는 seenTips에 이미 있어 자동 skip(재노출 없음).
  ⚠ 팝업을 안 지우면 신규 유저에게 팝업이 먼저 `markTip('match-spectate')`을 호출해 스포트라이트가 영영 안 뜨는 사일런트 버그가
  된다(리뷰가 지목한 치명 함정) — 그래서 삭제가 필수.
- **일시정지 배선**: 구 `showTip` 항을 `tutorialActive`(= `match` 화면에 미본 스텝이 하나라도 남았나)로 교체해
  `paused = statsOpen || tutorialActive || interveneOpen`. 결정론 무영향 — 재생 프레임만 멈추고 엔진 시뮬은 불변.
  `tutorialActive`는 `sandbox !== '1'` 가드를 포함(구 `showTip`의 sandbox 예외 승계) — 안 그러면 오버레이를 안 그리는
  샌드박스에서 탭해 넘길 대상이 없는데 paused가 영영 true가 된다.
- **샌드박스 가드**: 오버레이는 `{!isSandbox && <SpotlightOverlay screen="match" />}`로 감싼다 — board-lab·DEV 테스트
  경기(구 팝업의 `sandbox!=='1'` 예외)에는 튜토리얼을 띄우지 않는다.
- ⚠ **스포일러 금지**: 두 스텝 body에 스코어·승패·세트 결과를 절대 넣지 않는다(결정론 결과 누출 방지 — "다시 봐도 같은 경기").

---

## 6. 기본 스태프 지급(관련 결정, STAFF_SYSTEM 7과 연동)

게임 시작 시 플레이어 팀은 **기본 전문코치 1 + 스카우터 1**을 갖고 출발한다(2026-06-24).
- 왜: AI 팀은 이미 기본 스태프(코치 2 + 스카우터 1, `data/league.ts` `aiTeam*`)를 갖는데
  플레이어만 0에서 시작해, "스태프 0" 빈 화면이 어색하고 초반 성장·스카우팅이 불리했다(사용자 보고).
- 어떻게: `selectTeam` 시 `grantStartingStaff(teamId)` — 팀에 영입 스태프가 없으면 FA 풀에서
  중위권 전문코치 1 + 스카우터 1을 **결정론**으로 자동 영입(예산 내). 이후 단장이 방출·상위 교체 가능
  (슬롯 3 + 상위 풀로 AI를 능가하는 레버는 그대로 — STAFF_SYSTEM 7).
- 영속: 스토어 `staffAssistants`·`staffScouts`에 반영되어 리로드에도 유지.

---

## 7. 검증

- `tipsForScreen`가 화면별 순서대로 반환. `seenTips`에 든 id는 큐에서 빠진다(미본만).
- 새 id를 레지스트리에 추가하면 기존 세이브(그 id 미보유)에서 스포트라이트가 뜬다 — "신규만" 보장.
- 설정 "튜토리얼 다시보기" → `seenTips` 비고 인트로부터 전체 재생.
- 기본 스태프: `selectTeam` 후 `teamAssistants(myTeam).length===1 && teamScouts(myTeam).length===1`.
