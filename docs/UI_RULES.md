# UI_RULES — UI 상호작용 규칙 (검수 기준)

> 보드 연출은 [`BOARD_RULES.md`](./BOARD_RULES.md)(코트 마커·안무) 소관. 본 문서는 **일반 UI 상호작용**
> 규칙 — 버튼·로딩·비활성·빈상태 등 화면 *조작* 품질. `verify-board` 스킬이 이 문서도 대조 검수한다.
> 새 UI 주의사항이 나오면: ① 본 문서에 행 추가 → ② 화면 수정 → ③ 검증(아래 방법) → ④ 커밋. (CLAUDE.md 11장)

## 주의사항 ↔ 규칙 대응표

| # | 규칙 | 왜 | 구현 | 검증 |
|---|---|---|---|---|
| **UI-5** | **전체화면 빈 상태(데이터 없음)는 공용 `EmptyState`로 화면 가운데 정렬 — 상단 좌측 박스 금지** | 데이터 없을 때 안내문이 상단에 좌측 정렬되면 휑하고 어색(사용자 보고 2026-06-24, 경기 결과 화면). 화면마다 박스/카드/맨텍스트 제각각이라 디자인도 안 모임 | **`components/Screen.tsx EmptyState`**(flex:1 가운데 정렬) — `<Screen scroll={false}>` 안에서 써서 세로 중앙. 적용: `results`·`news`(전체화면 빈 상태). **섹션 단위 "없음"**(다른 내용과 함께 뜨는 — draft 풀·records 카테고리 아래 등)은 인라인 Card/Muted 유지(전체 중앙 금지) | 빈 상태 화면 진입 시 안내문이 화면 가운데. `grep -rn EmptyState app/` |
| **UI-4** | **무거운 결정론 캐시는 그걸 유발한 액션의 로딩 뒤에서 미리 데운다 — 도착 화면 첫 렌더에 떠넘기지 않는다** | 시즌 결과(`allResults`)·생산(`leagueProduction`)은 전 시즌 결정론 시뮬이라 **첫 호출 ~1.8s**(이후 baseVersion 캐시로 0ms). 구단 확정 후 그냥 이동하면 스케줄/대시보드 **첫 렌더가 그만큼 멈춤**(도착 화면엔 로딩 게이트 없음) — "운영하기 누르니 오래 대기·로딩 없음"(2026-06-24 사용자 보고) | `app/team/[id].tsx` 구단 확정 effect: `setStarting(true)`로 `<Loading>`를 띄우고 **`requestAnimationFrame` 2프레임(UI-1 rAF×2) 뒤에서** `selectTeam`+`computeStandings(MAX)`+`leagueProduction(MAX)` 워밍 → 이동 후 스케줄·대시보드는 캐시라 즉시. (구 `InteractionManager.runAfterInteractions`는 페인트 보장이 약해 로딩이 안 뜨고 멈춘 듯 보였다 — 2026-06-24 rAF×2로 교정.) 로딩 메시지가 곧 그 작업. **스태프(`app/staff.tsx`)**: 감독·코치 영입/방출/경질은 `baseVersion`을 무효화해 화면의 부진경고용 `computeStandings`가 전 시즌을 재시뮬(폰 체감 ~1분, 2026-06-24 사용자 보고) → `busy` 게이트로 `<Loading "시즌 전력 다시 계산 중…">`를 먼저 그리고 `InteractionManager` 뒤에서 영입 실행+`computeStandings` 워밍(네이티브 스피너라 JS가 막혀도 회전) 후 본문은 워밍 캐시로 즉시. **모든 영입/방출은 confirm**. 스카우터·재계약은 무효화 없음(STAFF_SYSTEM 교정) → busy 없이 즉시 | 워밍 후 `computeStandings`/`leagueProduction` 재호출 0ms(캐시). 구단 선택 시 "시즌 일정 구성 중" 로딩 뜨고, 스케줄 진입 즉시. 스태프 코치 영입 시 로딩 뜨고 confirm 묻고, 스카우터는 즉시 |
| **UI-3** | **포지션 배지/색은 공용 컴포넌트·단일 토큰만 쓴다 — 화면마다 재구현 금지** | 같은 디자인을 화면마다 따로 그리면 디자인 변경이 한 곳에 안 모이고 **복붙 드리프트**가 생긴다(실제: `POS_COLOR`가 5곳에 복사돼 BoxScoreTable의 S색이 `#2FB48E`로 어긋남, PosTag는 고정폭이 없어 S·L(1자)/OH·OP·MB(2자) 배지 너비가 들쭉날쭉, 2026-06-24 사용자 보고) | **단일 소스** `components/posTokens.ts`(`POS_COLOR`·`POS_LABEL`·`POS_ORDER`). **배지는 공용 `PosTag`**(`components/Screen.tsx`) 하나 — 약어는 **고정 minWidth 34**로 정렬, `solid`/`compact` 변형(테이블=박스스코어), `full`=한글 풀라벨. BoxScoreTable·RosterList·MatchCourt·board-lab·debug-court 전부 토큰/PosTag로 통일(로컬 POS_COLOR 0) | `grep -rn "const POS_COLOR\|const POS_LABEL\|const POS_ORDER" app/ components/` → **posTokens.ts 외 0건**. 새 화면이 포지션 표시하면 PosTag 사용(인라인 배지 재구현 금지) |
| **UI-1** | **무거운 동기 작업은 로딩 표시 + 실행 버튼 비활성** | N회 반복 시뮬·무거운 셀렉터는 JS 단일 스레드를 막아 화면이 멈춤. 사용자가 "멈췄나?" 헷갈리고 중복 클릭 위험 | **sim-web**: `runHeavy`/`maybeHeavy`(`sim-web/main.ts`) — 버튼 `disabled`+"실행 중…"+스피너 표시 후 **rAF×2로 페인트 양보**하고 루프 실행, 완료 시 복구. 임계 `HEAVY_AT=100`. **앱**: `Loading`·`useDeferredReady`(`components/Screen.tsx`) — 무거운 화면(news·history·records·draft·fa·tryout 등) 첫 프레임 로딩 후 다음 틱 마운트 | sim-web: N=5000 실행 시 버튼 disabled·로딩 보임·완료 후 결과(브라우저). 앱: 무거운 화면 진입 시 로딩 게이트 |
| **UI-2** | **스크롤 영역(ScrollView/FlatList)을 Pressable·Touchable로 감싸지 않는다** | 모달 카드/배경을 Pressable로 두면(밖 탭 닫기용) 그 위의 가로 ScrollView 드래그를 **Pressable이 제스처로 가로채** 스크롤이 아예 안 먹는다. 레이아웃상 내용폭>뷰포트라 스크롤 가능한데도 손가락이 안 통한다(스코어박스 가로 스크롤 먹통의 진짜 원인, 2026-06-23) | 공용 `components/Popup.tsx` — 밖 탭 비활성(dismissable=false, 우리 팝업 전부)이면 배경·카드를 **일반 View**로(배경 터치는 먹어 뒤 화면 오작동은 막되 자식 ScrollView pan은 안 가로챔). dismissable일 때만 Pressable. 표 가로 스크롤은 **세로 중첩 없는 단일 가로 ScrollView + 내용에 명시적 폭**(`LiveBoxModal` `TABLE_W`) | 디바이스에서 표를 좌우로 밀어 리시브·범실까지 보임. **구조 변경(중첩·Modal→Popup·Pressable→View)은 Fast Refresh로 안 먹어 풀 리로드 필요** |

## 대원칙
- **동기 작업은 페인트를 먼저 시킨다**: 로딩/비활성 DOM을 그린 뒤 `requestAnimationFrame`(또는 `InteractionManager`/`setTimeout 0`)으로 한 틱 양보하고 무거운 일을 한다. 안 그러면 로딩이 화면에 안 뜨고 그냥 멈춘 것처럼 보인다.
- **빠른 작업엔 로딩 금지**: 즉시 끝나는 건(임계 미만) 로딩을 띄우지 않는다 — 1프레임 깜빡임이 오히려 거슬린다.
- **느슨하게 풀지 않는다**: 무거운데 로딩이 없으면 화면을 고친다(임계·로딩 추가). 룰을 끄지 않는다.
- **스크롤은 제스처를 받아야 한다(UI-2)**: 가로/세로 ScrollView를 Pressable·Touchable로 감싸면 드래그를 부모가 가로채 안 밀린다. 밖 탭 닫기가 필요 없으면 부모를 View로 둔다. 또 **가로 ScrollView 안에 세로 ScrollView를 중첩하지 않는다**(내부 폭 측정이 무너져 스크롤 불가) — 한 방향만, 와이드 표는 컨텐츠에 **명시적 폭**을 준다.

## 진단 이력 — 스코어박스 가로 스크롤 (2026-06-23)

사용자가 "가로 스크롤이 안 된다"를 3회 반복 보고. **틀린 가설을 순서대로 버린 기록**(추정 금지·재현으로 확인):

1. **(가설1, 부분기여) 중첩 스크롤** — 가로 ScrollView 안에 세로 ScrollView(H>V) → 내부 폭 측정 붕괴. 세로 중첩 제거 + 명시적 폭(`TABLE_W`)으로 *레이아웃은* 정상화. 그래도 안 밀림.
2. **(가설2, 결정적 원인) Pressable 제스처 가로채기** — 모달 카드/배경이 `Pressable`(밖 탭 닫기용)이라 그 위 가로 드래그를 Pressable이 먹어 ScrollView로 안 넘어감. → 비-dismissable 팝업은 배경·카드를 **View로** 교체하니 **즉시 스크롤됨**.
3. **교훈**: ① 레이아웃상 "스크롤 가능"(내용>뷰포트)인데도 안 밀리면 **제스처 가로채기**를 의심(부모 Pressable/Touchable). ② 시각 검증을 못 하는 환경(이 앱은 네이티브 전용 — 웹 미부팅)에선 레이아웃만 보지 말고 **제스처 책임 사슬**까지 추론. ③ **구조 변경은 Fast Refresh로 안 먹어** 사용자가 옛 화면을 보고 "여전히 안 됨"이라 할 수 있음 → 풀 리로드 안내.
