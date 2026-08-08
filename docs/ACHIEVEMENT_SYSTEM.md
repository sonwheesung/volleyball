# ACHIEVEMENT_SYSTEM — 플레이어 업적 (구단주의 발자취)

> 게임 속 선수 기록(시상·마일스톤·HOF)과 별개로, **플레이어(구단주) 본인의 장기 성취**를
> 트로피로 보여주는 메타 레이어. 관전형은 "당장 할 일"이 적어서, 장기 목표를 눈앞에 깔아주는
> 척추가 중요하다 — 업적이 그 역할(자발적 목표: "이번엔 3연패 노려볼까").
>
> 설계 원칙: 마일스톤과 동일하게 **새 시뮬 없이 기존 누적 산출물을 읽어 판정**한다.
> 달성 여부는 저장하지 않고 세이브 상태(archive/hof/milestones/cash/fanScore)에서 **재계산**한다
> (결정론·세이브 다이어트 — 프로젝트 철학과 정합).

## 데이터 출처 (전부 이미 영속됨)

| 입력 | 출처 | 쓰는 업적 |
|---|---|---|
| `archive: SeasonArchive[]` | 시즌 경계 적립 | 우승·시상·순위·연승연패·시즌수 |
| └ `championId` · `awards` | 플옵·시상 | 우승·시상 |
| └ `standings[]`(순위 teamId) | `computeStandings` | 순위(모든 순위·꼴찌 연속·만년 2위·가을 단골) |
| └ `streaks{teamId:[승,패]}` | `seasonStreaks` | 연승/연패 |
| └ `series{teamId:[W/L…][]}` | `seriesByTeam(buildPlayoffs)` | 플옵 서사(리버스 스윕·블론·스윕) |
| └ `record{teamId:[승,패]}` | `computeStandings` | 시즌 승수(무패·30승+·20승대·10승대·한자릿수·무승) |
| `hallOfFame: HofEntry[]` | 은퇴 enshrine | 레전드 배출 |
| `milestones: Milestone[]` | 기록 경신 감지 | 리그·구단 기록 |
| `cash` / `fanScore` | 재정·팬심 | 운영 |
| `careerLog{faSigns,coachHires,staffHires,interviews}` | 스토어가 액션마다 누적 | 단장(GM 액션) |
| `careerTotals{points,aces,setsWon,setsLost,matchWins,matchLosses}` | 스토어가 매 시즌말 누적(production+standings) + **평가 시 이번 시즌 진행분 실시간 가산** | 통산(첫 사건·누적 득점) |
| `selectedTeamId` | 내 팀 | 전부(귀속 판정) |

> **스키마 정정(발견 모드 감사 2026-07-15)**: `CareerTotals`(engine/achievements.ts:12) 실제 필드는 ~~`{points, aces, sets, matches}`~~ →
> **`{points, aces, setsWon, setsLost, matchWins, matchLosses}`** — 세트/경기는 승·패로 분리돼 있고 합산 `sets`·`matches` 필드는 없다.
> `first_set_win/loss`는 `setsWon/setsLost≥1`, `first_match_win/loss`는 `matchWins/matchLosses≥1`로 판정.
> **"첫 실점"(`first_concede`) 근사 주의**: 실점 카운터 필드가 스키마에 없어 `first_concede = (matchWins + matchLosses ≥ 1)`,
> 즉 **첫 경기 소화 프록시**로 판정한다(engine/achievements.ts:357). 실제 첫 실점 시점이 아니라 "첫 경기를 뛰면 열림" — 사실상 첫 득점과 동시.
>
> **통산 업적 시즌중 반영(2026-07-04 버그수정, 문의 12e03390)**: `careerTotals`는 `endSeason`에서만 누적돼 **시즌 중엔 0**
> → 첫 득점·첫 승·백점 등 통산 업적이 시즌 끝까지 안 열리던 버그(진단 스냅샷: 4경기 진행·careerTotals 전부 0). **평가 시**
> `data/careerTotals.achTotals(저장 + 이번 시즌 진행분)`을 쓴다(진행분=endSeason과 동일 leagueProduction/seasonResults/
> computeStandings, cutoff만 `playedThroughDay`). 적용처: 업적 화면 표시(`app/achievements.tsx`)·수령(`claimAchDiamonds`).
> 시즌 경계 이중계산 없음(경계에서 stored += 시즌분, 새 시즌 진행분 0 — `_gt_achmid` A/B/C 검증). ~~rehydrate 마이그레이션 시드는
> stored만(일회성 pre-claim은 과거 누적분만).~~ → **정정(2026-08-08)**: rehydrate claim 시드도 **exact**(아래 §입력 배선 참조) —
> stored만 쓰면 시즌 중 통산 업적이 시드에서 빠져 "신규 달성"으로 다이아가 나가는(유저에게 유리한) 어긋남이 있었다.
>
> `careerLog`는 경기 리플레이로 파생 불가(드래프트·영입·면담은 플레이어 액션) — cash·fanScore처럼
> 스토어 영속 카운터. 드래프트 업적만 예외로 `archive.length`(완료 시즌수)에서 파생.

> **수령 상태 서버 pre-mark(2026-07-30 테스터)**: 업적 보상 수령 여부(`claimedAch`)는 로컬 영속이지만 **다이아 지급 진실은
> 서버 원장**(reason='achievement' ref=업적id, 계정 평생 멱등). 재설치·기기변경으로 로컬 `claimedAch`가 비면 **이미 받은 업적이
> "보상받기"로 다시 떠서 눌러야 "이미 지급됨" 안내**가 나오던 것(테스터 스크린샷) → `syncWallet`(로그인/포그라운드)에서 서버
> `getWallet().earnedAch`(지급 완료 업적 id 전체 distinct)를 **`claimedAch`에 합집합**으로 seed → 달성+지급완료 업적은 탭 없이
> 바로 "받음 ✓". 합집합만(로컬 확정 보존)·서버 진실로 미스매치 조용히 정합(재화는 서버 진실). 구서버(earnedAch 필드 없음)면 무변경(하위호환).
> 서버 쿼리는 원장 윈도우(recent 20)와 별개 전체 distinct — 오래된 지급 누락 방지. 정본 서버 파생: `docs/BACKEND_SYSTEM.md` §4.

> `SeasonArchive`(types/index.ts)에 `standings`·`streaks`를 추가(2026-06-13) — 둘 다 optional이라
> 구세이브 호환. 순위 업적은 정규리그 순위(standings), 우승 업적은 플옵 챔피언(championId)으로 구분.

## 판정 (engine/achievements.ts — 순수 함수)

- `ACHIEVEMENTS: Achievement[]` — 카탈로그(id·제목·설명·카테고리·목표치).
- `evalAchievements(input): AchievementStatus[]` — 각 업적의 `unlocked`(달성) + `progress {cur, target}`.
- 입력은 평범한 객체(스토어가 조립해 전달). 엔진은 React/스토어 무의존.

## 입력 배선 (`data/achSelect.ts` — 2026-08-08 신설, 운영 버그 수정)

### 사건 — 실유저가 다이아를 못 받았다

마이페이지 **하단 탭 아이콘의 빨간 점**(미수령 업적 알림)이 미수령을 못 잡았다.

| 위치 | 구 입력 | 결과 |
|---|---|---|
| `app/(tabs)/_layout.tsx` (탭 빨간 점) | **raw `careerTotals`** | ← 버그 |
| `app/(tabs)/mypage.tsx` (미수령 N건) | `achTotals` | 정상 |
| `app/achievements.tsx` (업적 카드) | `achTotals` | 정상 |
| `store/useGameStore` `claimAchDiamonds`(지급) | `achTotals` | 정상 |
| `store/useGameStore` rehydrate(구세이브 claim 시드) | **raw `careerTotals`** | ← 두 번째 raw |

`careerTotals`는 `endSeason`에서만 누적되므로 탭 입력은 **시즌 완주(36경기) 시점까지도 0**이다.
"한 박자 늦음"이 아니라 **시즌 하나 통째**이고, 통산 업적이 열리는 건 첫 시즌뿐이라 신규 유저에겐 **디스커버리 0**.

- **실측(가드 `_gt_achdot --mutant` 재현)**: 1경기 시점 **탭 0 / 카드 6**(`first_point·first_concede·first_ace·first_set_win·first_set_loss·first_match_win`),
  36경기(시즌 완주)까지도 탭 0 / 카드 9.
- **운영 실피해**: 유저가 스스로 업적 화면을 찾아 들어가 수령하자 정확히 그 6건(**60💎**)이 지급됐다 — 알림만 없었을 뿐 지급 경로는 정상.
- **원장·머니패스 무관** — 순수 표시(알림) 레이어 사고. `claimAchDiamonds`는 처음부터 `achTotals`를 썼다.

### 확정 설계 — 셀렉터 접기 + 하한 + 기회주의 캐시

1. **호출부 접기(본론)**: `AchInput` 손 조립을 **`data/achSelect.ts` 하나로** 접는다. 위 5개 호출부 전부 셀렉터 경유.
   6번째 호출부가 생겨도 같은 어긋남이 재발하지 않게, **UI(`app/`)에서 `evalAchievements` 직접 사용은 구조 가드
   `_dv_arch` `[ach-eval]` 규칙이 FAIL**로 막는다(CLAUDE §11 UI → 셀렉터 → 엔진).
   - `mode: 'floor' | 'exact'`.
   - rehydrate claim 시드(`:1820`)는 raw → **`exact`로 교정**(위 취소선 정정).
2. **하한(`'floor'`) = 시뮬 0회**: `MatchResult{fixtureId, homeSets, awaySets}`만으로 순수 산술 유도.
   - 유도 가능: `setsWon`·`setsLost`·`matchWins`·`matchLosses` (유저가 기록한 결과에서 직독)
   - 유도 **불가**: `points`·`aces`(선수별 생산 = 풀 시뮬 필요) → 저장값 그대로
   - 커버 업적: `first_set_win`·`first_set_loss`·`first_match_win`·`first_match_loss`·`first_concede`
     → **첫 경기에서 6개 중 4개가 잡혀 점이 켜진다**(실피해 해소).
   - **하한 성질(불변식)**: `floor ≤ exact` 필드별 → **거짓 양성 0**. `exact`는 cutoff 이하 *모든* 픽스처를 리플레이하고
     `results`는 그 부분집합이라 자연히 성립. 업적 `cur`는 totals에 단조 증가.
   - ⚠ **고아 `fixtureId` 반드시 스킵**: 시즌 롤오버 후 `results`에 남은 키는 `getFixture`가 `undefined`를 준다
     (`data/standings.ts playedThroughDay`와 같은 패턴). 안 하면 승패 과다 집계로 하한 성질이 붕괴한다.
3. **정확값 기회주의 캐시**: 마이페이지·업적 화면·수령 경로가 **이미 계산한** `achTotals`를 **비영속** 스토어 필드
   `achTotalsCache: {teamId, season, cutoff, totals}`에 남기고, 탭은 그 키가 현재 상태와 같을 때만 정확값을 쓴다(아니면 하한).
   - **반드시 비영속** — 새 영속 필드는 세이브 마이그레이션 체인 부채(SAVE_SYSTEM). `freshSave`에 넣어
     `selectTeam`·`resetSave`·크래시리셋에서 자동 폐기 + rehydrate(계정 슬롯 전환)에서 명시 폐기.
   - 탭 점 = 하한 미수령 ∪ (신선하면) 정확값 미수령. 구현은 필드별 `max`(신선 캐시 = 같은 키의 exact이므로 max = exact).
4. **탭에서 시뮬 트리거 금지**: `_layout.tsx`는 앱 루트에 **상시 마운트**다. `achTotals`를 직접 부르면 콜드 시
   시즌 전체 재시뮬(폰 20~30s) = 앱 루트 동기 프리즈. 하한 + 캐시된 정확값만 읽는다(가드 C7c가 정적 강제).

### 빨간 점의 의미 = **미수령 기준** (우편과 다른 의도적 예외)

`MAILBOX_SYSTEM.md §6.3`은 우편 배지에서 "미수령 기준 점"을 **nag라며 기각**하고 "확인(read) 기준"을 택했다.
업적 빨간 점은 그 결정의 **의도적 예외**로 미수령 기준을 유지한다. 근거:

- **우편**: 빨간 점 = "새 소식 있음"(awareness). 안 받아도 우편함에 30일 보존되고 카드 텍스트("받을 우편 N건")가 수령을 따로 유도한다 → 점까지 미수령으로 물리면 이중 재촉.
- **업적**: 미수령 = **실제 손해**(달성했는데 다이아가 계정에 안 들어옴)이고, 달성 사실 자체가 유저에게 통지되는 다른 경로가 없다.
  이번 사건이 정확히 그 손해를 냈다(6건 60💎이 유저가 우연히 화면에 들어갈 때까지 지연). **재촉이 정당한 유일한 케이스**라 예외로 둔다.
- 대신 **관전형 nag 최소화**: 점은 마이페이지 탭 **하나**에만(별도 푸시·모달·인터럽트 없음), `claimedAch` 필터 뒤에서 판정해
  "눌러도 못 받는 점"을 만들지 않는다.

### 엣지 (반드시 유지)

| 엣지 | 규칙 |
|---|---|
| `resetSave`/`selectTeam` | `claimedAch`는 보존, `careerTotals`·`results`는 리셋 → **재시작 유저는 통산 점이 안 뜨는 게 정상**(계정 평생 1회). 반드시 `claimedAch` 필터 뒤에서 판정(가드 C5b). |
| 수화 전 호출 | `hasUnclaimedAch` useMemo는 `if (!hydrated) return <Loading/>` **앞**에서 실행된다(훅 규칙). `selectedTeamId` null 단락이 freshSave 기본값 오판정을 막는 유일한 가드 — **제거 금지**. |
| `signOut` | `store/useAuthStore`의 로그아웃은 게임 스토어를 안 건드린다 → 다음 로그인 전 창에 이전 계정 상태가 남는다. 하한은 순수 산술이라 무해, **정확값 캐시는 계정 전환(rehydrate/resetSave) 시 폐기**. |
| `syncWallet` `earnedAch` 병합 | 비동기(§4). 재설치·기기변경 시 점이 켜졌다 수초 뒤 꺼지는 **깜빡임을 수용**한다 — 첫 sync 전 보류로 만들면 오프라인에서 영영 안 켜진다. |
| 오프라인/미로그인 | `claimAchDiamonds`가 `offline` 반환. 점은 켜지고 수령은 재시도로 수렴 — 정상 동작. |

### 가드

- **`tools/_gt_achdot.ts`**(신설) — 실 스토어 구동. C1 거짓양성 금지 / **C2 `n ≥ 1 ⇒ tabIds ≥ 1`(이번 버그를 잡는 한 줄)** /
  C3 오프시즌 하한==정확 / C4 고아키 내성 / C5 claimed 정합(+resetSave) / C6 캐시 신선·stale 폴백 / C7 5개 호출부 배선 정적강제.
  A/B: `--mutant`(구 raw 배선으로 되돌리면 C2가 FAIL로 뒤집힘) + 소스 변이 2종(하한 유도 제거 → C2 FAIL, 고아 스킵 제거 → C4a FAIL).
- **`tools/_dv_arch.ts` `[ach-eval]`** — `app/`에서 `evalAchievements` 사용 시 FAIL(구조적 재발 차단).
- **`tools/_gt_achmid.ts`** — **함수만** 봉인(배선 아님). 이번 사각의 원인이라 헤더에 범위 경고를 박았다.

## 카테고리·카탈로그 (v5 — 총 86개)

- **우승(9)**: 첫 우승 · 통산 3/5/10/15/20회 · 2연패 · 3연패 · 5연패
- **시상(16)**: MVP 1/3/5회·2연패 · 챔프전MVP · 신인상 1/3회 · 기량발전상 · 득점왕 ·
  기록왕 5/15회·한시즌 4부문 · 베스트7 한시즌3인/통산10 · 시상식 싹쓸이 · 라운드MVP 5
- **레전드(9)**: HOF 1/3/5/10명 · 헌액 레전드 1/3명(구 "영구결번" — BROADCAST §8 헌액 용어 통일 2026-06-30) · 3포지션 HOF · 8000득점 HOF · 15시즌 HOF
- **기록(5)**: 리그 역대기록 · 헤드라인 1/5회 · 구단 기록 · 마일스톤 통산 20
- **서사(18)**: 10/15연승 · 10연패 · 모든 순위 경험 · 최하위의 반란(꼴찌 이듬해 가을야구) ·
  꼴찌 3연속 · 만년 2위 · 가을 단골 · 3위 5연속 · 대역전극(챔프전 2패→3승) · 3-0 스윕 우승 · 통한의 준우승(2승→3패) ·
  시즌 승수: 무패(전승)·30승+·20승대·10승대·한 자릿수승·무승(전패)
  > 무패·무승은 **의도된 전설 극단**: 구조상 가능(엔진 하드 차단 없음)하나 parity가 막아 정상 플레이엔 거의 안 나옴
  > (200시즌 미관측 — 최고 35승1패·최저 2승34패). 죽은 업적 아님 — 최종 전설 트로피.
- **단장(9)**: 첫 드래프트 · 드래프트 10회 · 첫 영입 · 영입 15명 · 감독 선임 1/5회 · 전문 스태프 · 면담 1/20회
- **통산(12)**: 첫 득점·첫 실점·첫 서브에이스·첫 세트 승/패·첫 경기 승/패 · 통산 득점 100/1천/1만/10만/백만
  > 백만 득점은 보장 도달이나 ~445시즌 그라인드(팀 ~2,250점/시즌) — 끝판왕 트로피.
- **운영(8)**: 운영자금 20/50/100억 · 팬심 70/90 · 10/50/100시즌

> 귀속 주의: HOF `teamId`는 "마지막 소속"이라 내 팀 배출 판정은 근사.
> 단발(target 1)은 달성/미달성, 카운트(target N)는 진행바. 우승=플옵챔피언, 순위=정규리그.

## 화면 (app/achievements.tsx)

- 헤더: 달성 N / 전체 M.
- 카테고리별 그룹. 달성=강조+체크, 미달성=흐리게+진행바(`cur/target`).
- 진행치 라벨(`progressLabel`): **달성 시 무조건 "달성"**(2026-07-11 테스터 피드백) — 카운터형(백점돌파 target=100 등)이 완료 시 "100/100"이 아니라 "달성"으로 표기(진행바=`target>1 && !unlocked`와 일관). 미완 카운터는 분수 유지(천점클럽 640/1000), 단발 미달성은 "미달성".
- 숨김(hidden) 업적 없음(v1) — 전부 목표를 보여줘 자발적 목표 설정을 돕는다.
- **미수령 알림 3곳**: ①마이페이지 **탭 아이콘 빨간 점**(`app/(tabs)/_layout.tsx` — 하한 모드) ②마이페이지 업적 카드 "N건"
  (`mypage.tsx` — 정확 모드, 페인트 후 계산) ③업적 화면 카드별 점 + 상단 일괄 버튼(`achievements.tsx` — 정확 모드).
  세 곳의 입력은 전부 `data/achSelect` 셀렉터가 조립한다(위 §입력 배선).

## 검증 (tools/simAchievements.ts)

N시즌을 실제로 돌려(store.endSeason 재현) 누적 archive·HOF·마일스톤에 `evalAchievements`를 매 시즌
적용 — 합성 픽스처가 아니라 생성 데이터로 "업적이 실제로 풀리는지 + 임계가 도달 가능한지" 확인.

- **✅ 재측정 결과 (N=200시즌 · 엔진 738983b · 2026-06-26, 86개 카탈로그·OP 공격집중 반영 후)**:
  - 비운영 74종 중 **71종이 리그 시뮬에서 실제 도달**(71/74). 나머지 3종은 **의도된 끝판왕**(`legendaryExtreme`):
    무패의 전설(전승)·굴욕의 시즌(전패)·백만 득점 — 구조상 가능하나 parity가 막거나(전승/전패 미관측: 최고 35승1패) ~445시즌
    그라인드(백만점)라 200시즌엔 미도달. **죽은 업적 아님 = 최종 전설 트로피.** → 비운영은 71 도달 + 3 의도전설 = **74/74 정상**.
  - 시뮬 밖 12종 = 운영 5(자금 3·팬심 2) + 단장 7(FA·감독·스태프·면담 액션 — AI 리그엔 내 팀 액션 없음, 앱 플레이 소관). `opCats` 분류.
    (운영/단장 카테고리 일부—한 세대·드래프트 등—는 시즌수 파생이라 시뮬에서 잡혀 opCats서 제외.)
  - **난이도 분포(비운영 74종)**: 🟢쉬움 39 · 🟡보통 17 · 🔴어려움 11 · 🟣매우 3 · 🌑전설 1 · 🔒의도전설(끝판왕) 3 — 임계 건강.
    가장 늦게 깨지는 도달 업적: 전설의 산실(HOF 10명, ~92시즌)·전설의 구단(통산 20회 우승, ~64시즌)·대역전극(리버스 스윕).
  - 구 수치(120시즌·68카탈로그·56/56)는 카탈로그 86 확장 + OP 공격집중(MATCH 4.x)으로 무효 → 본 N=200 값으로 대체(STATS_PROTOCOL §3).
- **발견·수정(2026-06-13)**:
  - `영구결번`·`리그기록` 미달성 → `LEGEND_POINTS=9000`이 도달 최대 통산(8645)보다 높아 레전드 0명,
    `league` 마일스톤(레전드 추월)이 연쇄 봉쇄. `9000→7500`으로 레전드가 생겨 둘 다 도달.
  - `전 포지션 HOF` 구조적 불가(HOF가 득점 기준 → 리베로 영영 미등재) → **3포지션**으로 완화.
  - `꼴찌→다음 시즌 우승` 60시즌×7팀 0건(사실상 불가) → **꼴찌 이듬해 가을야구(3위 이내)**로 완화.

## 이후(보류)

- 달성 순간 토스트/뉴스 연동(NEWS_SYSTEM) — "seen" 집합(UI 영속 상태) 필요, v2.
- worst-to-first 등 순위 이력 기반 — archive에 시즌별 최종 순위가 없어 v2(아카이브 확장 시).
