# 중계 현수막 (Broadcast Lower-Third) — 설계 + Phase1·3 구현 (2026-06-17 설계 / Phase1 2026-06-18 / Phase3 2026-06-29)

> **★ 구현 현황(2026-06-19)**: Phase 1 ✅ — `data/broadcast.ts buildMatchBanners`(기록 경신·PO 확정/탈락·**트리플 크라운**)
> + `components/BroadcastBanner.tsx`(하단 현수막 큐 애니메이션, kind 무관 tint/icon/title 렌더) + `app/match/[id]` finished 게이트 주입.
> 검증 `tools/simBroadcast.ts`·`tools/checkTripleCrown.ts`: 시즌0 PO확정 3·탈락 13·트리플크라운 1(KOVO 후위공격 기준)/126경기, 합성 1000점 돌파 현수막 ✅, 스포일러 누출 0(구조 보장).
> **Phase 3 ✅(2026-06-29)**: 경기 *중* 실시간 현수막 — `courtDirector.buildLiveBanners`(세트획득·연속득점·에이스/블록 누적,
> 순수 파생) + `app/match/[id]`가 재생 위치(ptIdx)에 맞춰 큐 재생. 스포일러 안전(배너 at은 rallies[0..at]로만 도출).
> 검증 `tools/_dv_livebanner.ts` 7/7(prefix 스포일러·세트승자/세트수 정합·빈도 ~8/경기·결정론).
> **추후**: 챔프전 우승 현수막(플레이오프는 경기단위 관전 안 함 — 보류, 우승은 `ChampionCelebration` 큰 화면이 담당 §7).
> **★ 우승 현수막 = 정규리그 우승(2026-06-26 구현)**: 관전되는 맥락(정규시즌 경기)에서 가장 "우승"에 가까운 순간 =
> **정규리그 1위(챔프전 직행) 확정**. `teamClinch(team, day, cutoff=1)`이 'clinched'면 그 경기로 1위를 수학적으로
> 확정한 것 → 🏆 골드 현수막 "OO 정규리그 우승 — 챔프전 직행!". 결과-결정(순위 확정)이라 finished 후만(스포일러 정책 자동).

> 실제 배구 TV 중계처럼, 큰 사건(우승·기록 경신·플레이오프 확정)을 경기 보드 **하단 현수막**으로
> 띄운다. 관전형 1순위(보는 경험의 품질, CLAUDE.md 2장)에 직결되는 연출 투자.

## 0. 원칙
- **새 저장 없음 — 순수 파생(결정론).** [[NEWS_SYSTEM]]과 동일 철학. archive(우승)·milestones(기록)·
  standings/일정(확정)에서 재계산. 현수막은 *데이터*가 아니라 *연출*이다.
- **뉴스 피드와 역할 분리:** 뉴스(`NEWS_SYSTEM`)는 *지나간 일*을 대시보드/연표로 조용히 전달(수동).
  현수막은 *지금 이 경기*의 사건을 보드 위에서 영화처럼 보여준다(관전 중 능동). 소스는 공유, 표면이 다름.
- **가짜 드라마 금지** — 기록에 근거한 사실만(뉴스와 동일).

## 1. 스포일러 정책 (가장 중요 — 결과 은닉과의 충돌 해소)

경기 보드는 **관전이 끝나기 전까지 결과(세트 스코어·승패)를 숨긴다**(`app/match/[id].tsx`의 `finished`
게이트, 결정론 시뮬이라 미리 알아도 숨김). 현수막이 결과를 드러내면 이 설계가 깨진다. 그래서 사건을
**결과 노출 여부로 2분류**한다:

| 분류 | 사건 | 띄우는 시점 | 이유 |
|---|---|---|---|
| **결과-결정** | 우승 확정 · 플레이오프 확정/시드 | **관전 종료 후(finished)만** | 이기는 걸 알게 됨 → 경기 중 금지 |
| **결과-중립** | 개인 기록 경신(통산 1만점 등) | **경기 중 실시간 가능** | 승패와 무관(패배 중에도 기록은 나옴) |

→ 사용자 요청 "경기 종료 시 + 경기 중 실시간"을 이렇게 매핑한다: **실시간 = 기록 한정**,
**우승·PO확정 = 종료 직후**. (우승·확정을 굳이 경기 중에 띄우려면 스포일러를 감수하는 명시적 옵션이
필요 — 기본은 금지.)

## 2. 트리거 4종 — 데이터 출처 & 신규 작업

| 트리거 | 출처 | 상태 | 신규 작업 |
|---|---|---|---|
| **우승 확정** | `archive.championId` (data/playoffs.ts) | ✅ 있음 | 없음 — 챔프전 종료 현수막 |
| **기록 경신** | `Milestone`(engine/milestones.ts `crossedThresholds`) | ⚠ 시즌말 계산만 | **경기단위 감지** `detectMatchMilestones()` — 선수 career 기준선 + 이 경기 생산으로 임계 교차 판정 |
| **PO 확정/시드** | `computeStandings` + 잔여 일정 | ✅ **구현** `engine/clinch.ts`·`data/clinch.ts` | 보수적 승수 기반 확정/탈락/경합+매직넘버. 일정 화면 표시 중 |
| **정규리그 우승(1위 확정)** | `teamClinch`(cutoff=1) | ✅ **구현(2026-06-26)** `data/clinch.teamTitleClinch`·`broadcast.ts champion 배너` | 1위 수학적 확정(챔프전 직행) → 🏆 골드 현수막. 결과-결정(finished 후). 검증 `simBroadcast` |
| **트리플 크라운** (KOVO 공식, 결과-중립, 2026-06-19 구현) | `production`(before/after diff) | ✅ **구현** `data/broadcast.ts` | 한 경기 **후위공격·블로킹·서브 에이스 각 3개 이상**(KOVO 공식 정의, 2005-06 도입). 엔진 생산이 공격을 후위/전위 미분리 → `production`이 OH/OP 킬에 `BACK_ATK_RATE=0.24`로 **후위공격(backSpikes) 별도 귀속**(독립 rng — 기존 spike/block/ace 귀속 불변, backSpikes만 가산. 검증: backSpikes/spikes 18.8% ≈ 엔진 백어택 18.3%). 빈도(`tools/checkTripleCrown.ts`): **시즌당 ~1건**(실제 KOVO 여자부도 매우 희귀 — 후위공격 3+이 블록 3+·에이스 3+와 동시 = 극히 드묾). 개인 업적이라 승패 무노출 → finished 후 안전 |

> 기록 경신의 경기단위 감지는 **랠리별 개인 기록 귀속**에 의존(현재 알려진 공백 — PointLog→production
> 참가자 id). 경기말 집계는 근사 가능하나, 경기 *중* 실시간(그 랠리에 뜨는)은 귀속 정밀도가 선결.

## 3. 표면 & 연출

- **위치:** 경기 보드 하단(lower-third). 기존 상단 캡션 배지(`MatchCourt` `howBadge`)·중계 피드와 별도 레이어.
- **연출:** `Animated` 슬라이드 인 → 홀드(2~3초) → 슬라이드 아웃. 큐(여러 사건이면 순차). `howBadge` 스타일 재활용.
- **종류별 톤:** 🏆 우승(골드)·📊 기록(블루)·✅ 확정(그린). 내 팀이면 강조.
- **색 규칙(2026-07-11 버그 교훈):** 바 배경은 테마 무관 **흰색 고정**(#FFFFFFF2) — 따라서 바 내부 텍스트도
  **고정 어두운 색**(#16202C 등)으로 짝을 맞춘다. `theme.text`를 쓰면 다크 모드에서 근백색이 흰 바에 얹혀
  화이트-온-화이트로 안 보임(제목이 퇴장 페이드 때만 어렴풋이 보이는 증상 — 사용자 제보). 테마 도입(7884e6a) 때
  배경 하드코딩+제목 테마화가 엇갈린 것이 원인. 하드코딩 배경 위 텍스트는 테마 토큰 금지.
- **종료 현수막:** `finished` 게이트가 열리는 순간 결과-결정 현수막을 큐로 재생.

## 4. 구현 단계

- **Phase 1 (싸고·스포일러 안전):** 하단 현수막 컴포넌트 + **경기 종료 시** 재생. 우승(기존 데이터) +
  경기단위 기록 감지(`detectMatchMilestones`, 경기말). 결정론 파생.
- **Phase 2 (신규 시스템):** ✅ `clinch.ts` 매직넘버 감지 구현(확정/탈락/경합) — 일정 화면 표시. 현수막 연출·시드 세분은 추후.
- **Phase 3 ✅ 구현(2026-06-29):** 경기 *중* 실시간 현수막 — 랠리별 개인 귀속이 이미 100% 검증됨(`_ev_scorer`·
  `_ev_setmatch`·`_ev_digmatch` 보드==박스)이라 선결 충족. `reconstructRallies(sim)`에서 순수 파생.
  - **이벤트(전부 결과-중립 또는 "관전과 동시"=스포일러 안전)**: ① **세트 획득**("OO N세트 획득!" — 세트 종결
    랠리의 scorer=세트 승자. 관전자가 세트 끝을 보는 순간이라 안전) ② **연속 득점**(한 팀 run≥6·9·12 → "OO 6연속 득점!")
    ③ **서브 에이스 누적**(선수 한 경기 3·5·7개 → "PLAYER 서브 에이스 N개!") ④ **블로킹 누적**(선수 5·8개).
  - **빈도 게이팅(스팸 방지, §6)**: 매 에이스/블록이 아니라 **누적 임계**(에이스 3·5·7 / 블록 5·8 — MB 3블록은 흔해 5+만)·**run 임계**(6·9·12)로만 → 경기당 ~8건(`courtDirector.ts` ACE_TH/BLK_TH/RUN_TH 실측).
    에이스·블록 단발은 이미 상단 콜아웃 배지(`HOW_CAPTION`)·중계 피드가 담당 — 현수막은 "사건"만.
  - **스포일러 안전(구조)**: 각 배너 `at`(랠리 인덱스)는 `rallies[0..at]`만으로 도출(미래 미참조) — 가드가
    prefix 재현으로 전수 검증. 결과-결정(우승/PO)은 여전히 finished 후만(기존 buildMatchBanners 불변).
  - **코드**: `components/courtDirector.buildLiveBanners(rallies, mineSide, names)` 순수 → `app/match/[id]`가
    재생 위치(`score.ptIdx`)가 배너 `at`에 도달하면 큐에 넣어 `BroadcastBanner`로 재생(finished 전용 큐와 별개).
    BannerKind에 `setwon·run·acemulti·blockmulti` 추가. 검증 `tools/_dv_livebanner.ts`(prefix 스포일러·빈도·세트승자 정합·결정론).

## 5. 코드 맵
- `data/broadcast.ts` — `buildMatchBanners(...)` 순수 집계(우승·기록·확정 → Banner[]) + `BannerKind` 실시간 4종(`setwon·run·acemulti·blockmulti`).
- `components/courtDirector.ts` — `buildLiveBanners(rallies, mineSide, names)` 경기 중 실시간 현수막(Phase 3, 순수 파생). `app/match/[id].tsx`가 `score.ptIdx` 도달 시 큐 재생.
- `tools/_dv_livebanner.ts` — 실시간 현수막 가드(prefix 스포일러·세트승자/세트수 정합·빈도·결정론).
- `engine/clinch.ts` — `detectClinch(standings, remaining)` 매직넘버(Phase 2).
- `data/milestones.ts` — `detectMatchMilestones()` 추가(경기단위).
- `components/BroadcastBanner.tsx` — 하단 현수막 렌더/애니메이션.
- `app/match/[id].tsx` — finished 시 결과-결정 현수막 큐 주입.
- `tools/simBroadcast.ts` — N경기 현수막 발생 빈도·스포일러 누출 0 검증.

## 6. 검증 기준
- **스포일러 누출 0:** 결과-결정 현수막이 finished 이전에 절대 안 뜸(도구로 전수 검사).
- 결정론: 같은 시드 → 같은 현수막(파생이라 자동).
- 빈도 sanity: 현수막이 너무 잦으면(매 경기) 가치 하락 — big 사건 위주 게이팅.

## 7. 우승 축하 화면 (일러스트 연출, 2026-06-26 구현 — 사용자 요청)
> 현수막(하단 띠)과 별개로, **우승 확정 순간을 일러스트가 있는 큰 화면**으로 연출(관전형 1순위 — 보는 경험).
> 컨셉: 얼굴 없는 둥근 **블롭 선수들이 우승컵을 든** 미니멀 벡터(라바풍). sim-web '🏆 우승 화면' 탭에서 룩 합의 후 구현.
- **트리거**: `app/playoffs.tsx` — `po.championId === my`(내 구단 우승)일 때 화면 상단에 `ChampionCelebration` 표시.
- **컴포넌트**:
  - `components/ChampionIllustration.tsx` — `react-native-svg` 벡터(블롭 3인 + 컵 + 콘페티 + 배구공). 이미지 파일 0·전 해상도 선명.
  - `components/ChampionCelebration.tsx` — 어두운 팀색 카드 + 일러스트 + 팀명·N시즌 챔피언·(선택)MVP·"시즌 마무리 →".
  - `lib/teamColor.ts` `teamColors(id)` — **가운데 선수·배경·강조 텍스트가 우승팀 색**. **✅ `CLUB_IDENTITY` 실제 구단
    색(hue) 연결됨(2026-06-26)**: `clubIdentity(id)?.hue`를 우선 쓰고(비표준 id면 id 해시 폴백) 5색 파생 → 구단마다
    고유 시그니처 색(타이드=딥블루·블레이즈=스칼렛 등, CLUB_IDENTITY_SYSTEM §2). sim-web 우승 탭도 동일 `teamColors`
    임포트(자체 hue 재구현 제거 — 단일 소스).
- **MVP**: ~~챔프전 MVP(`finalsMvp`)는 endSeason 후에만 산출 → 축하 화면엔 생략~~ **정정(2026-06-30)**: 챔프전
  MVP는 `currentSeasonAwards(season).finalsMvp`로 **플레이오프 시점에 이미 계산 가능**(시즌 종료 = uptoDay≥REF_DAY →
  seasonDone, 우승팀 최고 생산자). 그래서 `app/playoffs.tsx`가 `ChampionCelebration`에 **`mvpName` 전달** → 우승
  세리머니에 "챔프전 MVP · {이름}" 표시(축하 순간이 비지 않게, 사용자 요청). 무챔프/내 팀 비우승 시엔 미표시(정상).
  **연표(기록 탭) 시상식 섹션도 시즌별로 챔프전 MVP 표시**(유지).
- **재활용(추후)**: 같은 블롭 캐릭터로 컵→메달·꽃다발·기록판 교체해 시상식·기록 경신·연표 썸네일에 통일감 있게 확장.

## 8. 명예의전당 헌액 연출 + 헌액 번호 (2026-06-26 설계 — 독립 리뷰 반영)
> 은퇴 레전드를 **유니폼 + 등번호 일러스트**로 기린다. 핵심 경험이 "보는 것"이므로 헌액을 큰 화면으로 연출.
> **독립 리뷰(새 세션 Agent, 룰 1.5)가 교정한 두 가지**: (1) "영구결번"은 번호를 영원히 봉인한다는 뜻이라
> **무한 플레이(1만 시즌+)에서 번호 고갈** 모순 → **"헌액 번호"(비소모)** 로 바꾼다. (2) 후배가 같은 번호를
> 달았을 때 "계승자/물려받았다"는 **없는 인과(가짜 드라마)** → **"번호 계보(사실)"** — 같은 번호를 단 과거
> 레전드를 *사실로만* 나열한다(인과 주장 금지, CLAUDE.md 가짜 드라마 금지).

### 8.1 헌액 번호 — 비소모·결정론·동결 (`engine/jersey.ts`)
- `jerseyNumber(id) → 1~99`: **id 시드 결정론·무저장**. `createRng(strSeed('jersey:v1:'+id)).next()`로 파생.
  특성·관계망과 같은 패턴(메인 RNG 비소모). 세이브에 새 필드 0 — 표시 때 재계산.
- **버전 동결(`JERSEY_SEED_VERSION=1`)**: 해시 식을 바꾸면 과거 세이브의 번호가 흔들리므로 식을 고정한다.
  바꿔야 하면 버전을 올리되 그 시점부터 번호가 달라짐을 문서에 남긴다(마이그레이션 주의).
- **비소모(핵심)**: 번호는 **표시·명예 라벨**일 뿐 코트에서 실제 배정·고갈되지 않는다. 그래서 1만 시즌+에도
  안전(시뮬: 레전드 7500+ 기준 1000년 팀당 ≈9명 → 99번 여유, 그러나 *고갈 개념 자체를 없앤다*).
  현역 선수 번호는 노출하지 않는다(표시는 HOF/레전드 한정 — 충돌 혼동 회피, 유일성 불요).

### 8.2 헌액 번호 티어 (의미 인플레이션 방지)
- `HofEntry.legend`(통산 7500+) = **헌액 번호**(유니폼 일러스트 + 번호). `points`로 표시 색 강조.
- **초레전드 금색(`SUPER_LEGEND_POINTS=10000`)**: 1000년+ 플레이 시 레전드가 흔해져도 최상위는 금색으로
  구분(표시 전용 티어, 엔진 무파급). store 상수 변경 없음 — `HofEntry.points`로 판정.

### 8.3 번호 계보 — 사실만 (`data/legends.ts numberLineage`)
- `numberLineage(hallOfFame, teamId, number, excludeId) → HofEntry[]`: 같은 구단·같은 헌액 번호를 단
  **과거 레전드**(retiredSeason 더 이름·legend·자기 제외)를 통산점 내림차순으로. 순수 파생.
- 표기 규칙: **"○번 — 이 번호의 과거 레전드: XX(통산 N점)"** 사실 나열만. **금지**: "계승자/물려받았다/
  뒤를 잇는다" 같은 인과·운명 서사(id 해시 우연을 드라마로 둔갑 = 가짜 드라마).

### 8.4 일러스트 + 표시 위치
- `components/LegendIllustration.tsx` — `react-native-svg` 유니폼(팀색 `lib/teamColor` primary/light) + 중앙
  등번호. **자릿수별 폰트(1자리 84 / 2자리 56 + `textLength=74` 폭 클램프)** — 2자리 오버플로 교정(웹 스크린샷
  검증 7·10·23·99). 이미지 파일 0·전 해상도 선명.
- **기록 탭 명예의전당(`app/records-archive.tsx` HofView)**: 레전드는 유니폼 일러스트 + "헌액 번호 N번" +
  번호 계보 한 줄. 비-레전드 HOF는 기존 행 유지.
  > **코드맵 정정(발견 모드 감사 2026-07-15)**: ~~`app/(tabs)/history.tsx`~~ → `app/records-archive.tsx`(HofView). 2026-06-30 기록 탭 → 마이페이지 허브 개편으로 이관(AWARDS §5 공통 뿌리).
- **뉴스(`data/news.ts`)**: HOF 헌액/은퇴 세리머니 본문의 "영구결번" 문구를 "헌액 번호 N번"으로 교체 +
  번호 계보가 있으면 사실 문장 추가("이 번호를 단 과거 레전드: …").
- **헌액 화면(`app/enshrine.tsx`, 2026-06-26 구현)**: 오프시즌 진행 중 — **season-start(`endSeason`) 직후** 진입(체인 첫 상호작용 단계).
  이번 시즌(`retiredSeason === season-1`) 새 레전드를 유니폼+헌액 번호+계보로 큰 화면 연출(내 구단 강조,
  ChampionCelebration 패턴). ~~**새 레전드 0명이면 즉시 통과**(`router.replace('/(tabs)')` — 빈 화면 강요 안 함, 관전형).~~
  → **정정(2026-07-08 사용자 결정 — 스킵 방지)**: 0명이어도 자동 통과하지 않고 **"이번 시즌 헌액자는 없습니다." 조용한 한 장**(명전 톤) + "새 시즌 준비로 →"로 탭 한 번 진행(강제 대기·타이머 없음).
  진행 시 `/(tabs)`가 아니라 **다음 단계 `training-camp?chain=1`(전지훈련)로 `router.replace`**(체인 순서 변경 2026-07-08: 헌액 → 전지훈련 → 개막 브리지 → 홈, SEASON §5.5 D).
  ~~draft.tsx·draft-live.tsx 의 `onFinish` 가 `/(tabs)` 대신 `/enshrine` 으로 라우팅(헌액 화면이 다음 시즌 입구).~~ → 현재는 `onFinish → season-start → enshrine`(season-start 로딩이 endSeason을 돌린 뒤 enshrine으로 replace).
