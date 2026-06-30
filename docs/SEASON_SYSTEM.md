# 시즌 진행·일정·순위·오프시즌 (SEASON_SYSTEM)

> CLAUDE.md Phase 3(시즌 루프) + 11장(SOLID 오케스트레이션)을 구현 수준으로 정리한 문서다.
> 다른 시스템(훈련/노쇠/경기/생산/FA/드래프트)을 **호출로 조합**하는 "진행"의 본체.
> 모든 것은 시드 결정론 + 리플레이(상태 저장 대신 `currentDay`+`results`에서 재계산).

---

## 0. 핵심 원칙 — 저장하지 않고 재계산

- 세이브에 **진화된 스탯을 저장하지 않는다.** `currentDay`(시즌 내 경과일)와 `results`(치른 경기)만 둔다.
- 화면/순위/생산은 그 시점 base 스냅샷 + `currentDay` 로 **매번 재계산**(`evolvePlayer`).
- 선수별 RNG는 id 해시로 고정 → 같은 날 = 같은 결과(결정론).
- 시즌 경계에서만 진화 결과를 **base 스냅샷으로 커밋**(`commitPlayerBase`/`commitRosters`).
  → 다음 시즌 리플레이 비용을 시즌 1개로 한정(100시즌 운영 성능).

---

## 1. 일정 (engine/season.ts)

- **더블 라운드로빈 × 6라운드(LEGS=6)** — KOVO 여자부 정규리그. 서클 방식 결정론 생성.
- 7개 팀(홀수) → BYE 슬롯 추가, 라운드당 3경기. **매 라운드 홈/원정 반전.**
- 라운드 수 = (8−1) × 6 = **42 매치데이**, 경기 수 = 42 × 3 = **126경기**.
- `GAME_INTERVAL=4`(매치데이 간 4일), `SEASON_OFFSET=0`(첫 매치데이 day 0) → 마지막 day 164.
- `teamScheduleEntries`: 선택 팀 기준 캘린더(경기만 — 경기 전날 '전술 훈련' 점은 2026-06-17 제거, 매치 라벨과 충돌·정보량 적음).

## 2. 캘린더 (lib/calendar.ts)

- 시즌 시작 `2025-10-18`(`SEASON_START`). `dateForDay(dayIndex)` → 실제 날짜.
- `monthGrid` 6주(42칸) 그리드. UI 캘린더가 현재일(`currentDay`)을 추적.

## 3. 순위·리더보드 (data/standings.ts)

- `seasonResults(uptoDay)` — 전 경기 결정론 재시뮬 중 `dayIndex ≤ uptoDay`만.
- `computeStandings(uptoDay)` — **KOVO 승점제**(2026-06-19): 승 3-0·3-1=3점 / 3-2=2점, 패 2-3=1점 / 0-3·1-3=0점.
  정렬 = 승점 → 승률 → 세트득실률 → 점수득실률(KOVO 순위 결정 규칙). `baseVersion`별 캐시. 순위 화면에 승점 컬럼.
- `standingsWorstFirst()` — 드래프트 순번(하위 우선) 소스.
- 개인 리더보드/대시보드 요약은 `data/production.ts`(생산)와 `overall`로 산출.

### 3.1 "치른 경기까지만" 컷오프 — `playedThroughDay(results)` (2026-06-18)
- **문제**: `setDay`는 다음 경기를 관전하기 **전에** `currentDay`를 그 경기일로 올린다(그 사이 진화
  재계산용). 그래서 화면이 `computeStandings(currentDay)`를 쓰면 **아직 관전·기록 안 한 경기까지**
  순위·결과에 선반영돼, `results` 기반인 대시보드 성적(1승)과 어긋났다(순위표 2경기, 사용자 보고).
- **해결**: `playedThroughDay(results)` = `results`로 완료한 경기 중 최대 `dayIndex`(없으면 −1).
  순위/결과/대시보드 순위/PO 확정(clinch)은 `currentDay` 대신 이 값을 컷오프로 쓴다 → 전부 `results`
  기준으로 일치(미관전 경기 비노출, 스포일러 안전). 검증: 1경기 기록 시 순위표 played 2→1.
  적용처: `app/standings.tsx`·`app/(tabs)/index.tsx`·`app/results.tsx`·`app/(tabs)/schedule.tsx`(clinch).

### 3.2 기준 재결정 — "리그 진행"(`currentDay`)으로 통일 (2026-06-24, 사용자 결정)
- **사용자 보고**: 경기 결과는 비었는데(관전 0) 기록 화면(시즌 리더)엔 선수 기록이 있다. 원인 = **§3.1을 어긴
  화면이 있었다** — `history.tsx` 시즌 리더보드만 `leagueProduction(currentDay)`(리그 기준)을 써서, 관전 기준인
  결과/순위와 어긋났다. 관전형은 시즌이 **자동 진행**되므로(currentDay 이동), "치른 경기" = 리그가 친 경기로
  봐야 한다는 게 사용자 판단(③ 중 "리그 진행 기준 통일" 선택).
- **결정**: 결과/리더/순위 표시 기준을 **`currentDay`(리그 진행)** 으로 통일 — §3.1의 "관전 기준"을 표시 화면에선 뒤집는다.
  단 **현재 경기일의 미관전 경기는 제외**(스포일러): `dayIndex < currentDay || results[fixtureId]`(지난 경기일 전부 +
  내가 관전 완료한 경기). 시작(currentDay 0)엔 0경기 → 빈 상태 유지.
- **단일 컷오프 헬퍼 — `leagueDisplayDay(currentDay) = currentDay − 1`** (`data/standings.ts`): "현재 경기일 **직전**까지"가
  리그가 완료한 경기(현재 경기일은 관전 중이라 제외 → 스포일러 안전). 시작(currentDay 0)엔 −1 → 빈 집계. 결과/순위/
  대시보드/시즌리더가 **모두 이 컷오프**를 쓴다(집계 화면은 좌우대칭 — 내 현재경기만 빼는 비대칭 없음).
- **✅ 전수 통일 완료(2026-06-24) — `leagueDisplayDay` 균일 적용(내부 불일치 0)**:
  - `app/results.tsx`(결과 목록): `seasonResults(leagueDisplayDay(currentDay))` — `results`(관전) 의존 제거, 순수 리그 기준.
  - `app/standings.tsx`·`app/(tabs)/index.tsx`(대시보드 순위 + **성적 W/L 카드**): `playedThroughDay` → `leagueDisplayDay(currentDay)`.
    성적 카드도 `results[id]`(관전)에서 `seasonResults(leagueDisplayDay)` 내 팀 집계로 — 순위와 같은 기준이라 안 어긋남.
  - `app/(tabs)/history.tsx`(시즌 리더): `leagueProduction(currentDay)` → `leagueProduction(leagueDisplayDay(currentDay))` — currentDay 직접 사용이 day0 스포일러(미플레이 시즌 선반영)였던 것도 동시 해소.
  - `app/(tabs)/schedule.tsx`(빅매치 순위)·`app/staff.tsx`(내 순위): `currentDay>0?currentDay:MAX` → `leagueDisplayDay(currentDay)` — day0 MAX는 전 시즌 선반영 스포일러였음(같이 해소).
  - **`data/records.ts seasonSnapshot`(기록 탭 순위표+잠정 시상)**: 현재 시즌 분기가 `computeStandings(currentDay)`/`currentSeasonAwards(…,currentDay)` → `leagueDisplayDay(currentDay)`. **1차 누락분**(사용자 보고 2026-06-24: 경기 결과는 비었는데 기록 탭 순위/리더가 1라운드 표시) — 표시 셀렉터 전수(`grep computeStandings(currentDay)`=0) 확인.
  - 효과: 결과·순위·성적·시즌리더·빅매치·스태프순위가 **전부 같은 컷오프**(현재 경기일 직전까지) → 내부 불일치 0. 균일 지연(현재 경기일 게임은 모두 동일하게 다음 진행 후 노출) 수용.
- **clinch(PO 확정)는 예외 — `playedThroughDay(results)` 유지**: PO 확정 노출은 `BROADCAST_SYSTEM` 스포일러 정책상
  "결과-결정"이라 관전 후에만. 표시 기준 통일과 별개 개념이라 관전 기준을 지킨다.
- 검증: `results`/`standings`/`index`(순위·성적)/leaders 모두 currentDay 0→빈집계·진행 후→리그 진행분 동일 수치. 회귀: `checkRecords`·`_ev_rest`·205 테스트·tsc.

## 4. 경기 진행 ("진행" 1일)

진행 버튼은 **함수 호출 합성**이다(시스템 교체 가능, SOLID):

```
advance(targetDay):
  for 지나간 매치데이의 각 fixture:
    home/away = getEvolvedTeamPlayers(teamId, fixture.dayIndex)   // 그날 스탯
    sim = simulateMatch(fixture.seed, home, away)                 // 풀 랠리 체인 엔진
    recordResult(sim)                                             // 세이브
  setDay(targetDay)
```

- 진화(훈련+노쇠)는 `getEvolvedTeamPlayers`가 `evolvePlayer(base, 감독선호, day)`로 그날 재계산.
- **명단은 날짜 인지**: standings/production/playoffs는 `availableTeamPlayers(team, day)`
  (= 그날 명단(시즌 중 이동 반영) − 부상자)를 사용(`data/dynamics.ts`). 과거 경기는 그때 명단으로 고정.
- 개인 생산은 순위/리더보드 조회 시 `leagueProduction`이 `attributeProduction`으로 재귀속.
- **모든 팀**에 진화·생산이 동일 적용(사용자 팀 특례 없음). 현재 전 구단 자동.

## 5. 포스트시즌 (engine/playoffs.ts, data/playoffs.ts)

KOVO 방식:
- **준PO/PO**: 정규 2위 vs 3위, **3전 2선승**(target=2).
- **챔피언결정전**: 정규 1위 vs PO 승자, **5전 3선승**(target=3).
- 상위 시드 홈 어드밴티지 **×1.03 능력 승수**(`HI_EDGE`, OVR가산 아님). 매치업별 시드로 `playSeries` 결정론.
- 우승 팀은 `recordChampion(season, championId)` → `archive`에 연표 보존.

## 5.5 시즌 결산 (app/season-recap.tsx) — 2026-06-30 신설 (독립 리뷰 거침)

> **왜**: AWARDS_SYSTEM §0이 시상식을 "1년에 한 번 멈춰 음미하는 순간"으로 규정했는데, 시상(MVP·베스트7)이
> 기록 탭 텍스트 배열로만 묻혀 유저가 *뉴스 기사로* "누가 MVP였지"를 확인하는 미달 구현이었다(사용자 피드백).
> 결산은 신규 스코프가 아니라 **이미 내려진 결정의 이행** — 관전형 1순위(연출=1순위 투자처)에 정면 부합.

- **위치**: 포스트시즌 → **[시즌 결산]** → 외국인 트라이아웃. `endSeason` **이전**이라 이번 시즌 시상은 아직
  archive에 안 구워짐 → **`seasonSnapshot(season, season, currentDay)`(=`currentSeasonAwards`+`computeStandings`)
  + `leagueProduction(leagueDisplayDay)`로 그 자리 재계산**(tryout 잠정 시상·records 탭과 동일 경로). 우승팀은
  포스트시즌 `recordChampion`이 박은 `archive.find(a=>a.season===season)?.championId`로 읽음. **새 영속 필드 0**.
- **연출 규율(리뷰)**: **강제 도착·선택 정독·단일 한 장**(스크롤 1장 + 하단 "외국인 트라이아웃 →" 버튼 하나).
  🚫 **다단계 캐러셀/"탭하여 계속 n/총" 순차 공개 금지**(그 순간 "손이 가는 게임"=관전형 위반). 결산은 정적 표지.
- **내용 한정**(과부하 방지 — 깊은 건 기록 탭 drill-down): ① 우리 팀 헤드라인 한 줄(최종 순위·W/L·우승/PO)
  ② 우리 선수 하이라이트(내 수상자 + 내 팀 생산 상위 1~3 = 단장 결정의 성적표) ③ 리그 시상 3종(MVP·신인·기량발전,
  이름+팀+한 줄 스탯) ④ **베스트7 코트**(아래). + (선택, 하단 한 줄) 재정·팬덤.
  🚫 제외: 리그 전체 순위표 풀버전·6부문 기록왕 전체(내 선수가 왕일 때만 강조)·라운드MVP·박스스코어.
- **베스트7 코트(`components/Best7Court.tsx`, 재사용)**: 베스트7(S·OH·OH·OP·MB·MB·L)을 코트 포메이션 7마커
  (이름·팀·포지션)로. **구단색 틴트(teamColors) + 우리 팀 선수 border 강조.** `SeasonAwards` 입력만 받아
  현재 시즌(잠정)·과거 시즌(`archive[].awards`) 공용 → 기록 탭 시상식에도 동일 컴포넌트(AwardIllustration 패턴).
  🚫 **가짜 드라마 금지**: 7명은 서로 다른 팀 올스타지 *함께 뛴 라인업 아님* → "최강 라인업/드림팀" 라벨·랠리
  애니메이션 금지. **정적 명예 포메이션**("시즌 베스트7")으로만(실제 수상자 배치=사실 나열).
- **성능**: `leagueProduction` 풀시즌 재계산이 무거움 → `useDeferredReady`+`<Loading variant="list">`(tryout 패턴).

### 5.5 D 시즌 시작 로딩 (app/season-start.tsx) — 2026-06-30 신설

> **왜**: 드래프트 끝 "시즌 시작하기"를 누르면 `store.endSeason`(§6, 오프시즌 단일 합성 — buildDraftContext·
> resolveDraft·fillRosters·leagueProduction 다회·HOF)이 **무거운 동기 작업**이라 JS 스레드를 길게(실기기 ~15s)
> 막아 화면이 멈춘 듯 보였다(사용자 보고 2026-06-30). 기다림을 유의미하게 — 전용 로딩 화면(`<Loading variant="brand">`
> 워드마크 "배구명가" + **원형 스피너(회전 링)**)으로 가린다. 관전형 1순위(연출=투자처)에 부합.

- **흐름**: 드래프트(`onFinish`) → `showSeasonStartAd()`(MONETIZATION §3, 첫 시즌 외 광고 — 항상 resolve) →
  `router.replace('/season-start')` → 로딩 표시 → `endSeason()` → `router.replace('/enshrine')` → (헌액 0명이면 통과) 탭.
- **⚠ 페인트-전-블록 버그(실기기 발견·교정 2026-06-30)**: 초기 구현은 `InteractionManager.runAfterInteractions`로
  endSeason을 미뤘으나, 이게 **화면 전환 애니메이션/첫 페인트보다 일찍 발화**해 endSeason 동기 블록이
  **직전 화면(드래프트)을 그대로 얼린 채** 돌았다(브랜드 로딩이 끝까지 안 보임 — 45프레임 ≈18s 전수 드래프트 동결 확인).
  → **교정**: `setTimeout(~500ms, 전환 ≈350ms 초과) + 2×requestAnimationFrame`으로 **전환 완료 + 로딩 첫 페인트를
  보장한 뒤** endSeason 실행. 그러면 로딩이 최상단으로 그려진 상태에서 블록이 시작돼 사용자가 로딩을 본다.
- **연출 변천(2026-06-30 — 같은 날 3안)**: ~~단일 통통 공~~ → ~~서브 연습처럼 좌우로 날아다니는 여러 공(`ServeBall`×3)~~
  → **원형 스피너(회전 링, `BrandLoading`)**. 사용자가 여러 공 안을 보고 "공이 밑으로 뚝 떨어지고 끝이라 별로 —
  그냥 원으로 도는 로딩"으로 교정 요청. 이유는 아래 동결 현상.
- **⚠ 블록 중엔 네이티브 애니도 멈춘다(실측 정정 2026-06-30)**: 당초 "useNativeDriver라 블록 중에도 계속 난다"고
  적었으나 **에뮬레이터 실측에서 거짓**. 광고 확인 직후 8프레임을 연속 캡처해 MD5 비교 → **블록 전 3프레임은 서로 다르고
  (공 이동), 블록 시작 후 5프레임은 전부 동일**(동결). 즉 endSeason 동기 블록이 JS뿐 아니라 네이티브 애니까지 멈춘다
  (적어도 에뮬에서). 메시지 회전(setInterval)도 블록 중 정지 → 첫 메시지로 고정. 긴 블록(에뮬 ~2.5분) 동안 정지.
  실기기 release에서 네이티브 애니가 블록을 견디는지는 미검증. → 동결 시 **날아가던 공은 "바닥에 떨어진 채 정지"로
  보여 흉하지만, 회전 링은 "멈춘 동그라미"라 거슬리지 않는다** → 스피너 채택.
- **미결(블록 내내 연출 유지)**: 블록 동안에도 스피너가 돌고 메시지가 순차로 바뀌게 하려면 endSeason을 **청크로 쪼개
  매 청크 사이 yield**(setTimeout/await)해 JS 스레드를 양보해야 한다. endSeason은 중간 commit(commitRosters·
  setAwardScores·commitCoachPool 등)과 그 결과를 읽는 계산이 뒤섞인 ~200줄 단일 함수라 **순서 보존이 핵심**(결정론:
  같은 세이브→같은 결과). 리스크가 있어 플랜 리뷰+결정론 검증(N≥10,000) 후 별도 작업으로 다룬다(보류 — 사용자가
  스피너로 갈음, 2026-06-30).
- **연출 텍스트 규율**: 로딩 문구는 분위기 카피지 데이터 주장 아님(가짜 드라마 금지 무관).
- **검수**: UI_RULES "시즌 시작 로딩" 케이스 — 광고 확인 직후 ~수초간 캡처해 **브랜드 로딩(드래프트 아님)** 이 떠야 PASS.

## 6. 오프시즌 오케스트레이션 (store.endSeason)

> **진행 게이트(2026-06-27 cache-persist 전환)**: `endSeason`은 정규시즌이 **실제로 끝났을 때만**(전 경기 results
> 완비 = `planNextAction(...).kind === 'seasonOver'`) 진행하고, 아니면 **즉시 return**(no-op). 확정 버튼 연타로 인한
> 시즌 2전진(더블탭)도 이 게이트가 차단(롤오버 후 results가 비워져 planNextAction이 다시 'match'를 돌려줌).
> → `setDay(164)`만으론 진행 안 됨(results를 채워야). 테스트 하네스도 전 경기 `recordResult` 후 endSeason해야(`_gt_derived` 2026-06-29 교정).

시즌 종료 → 다음 시즌 base를 만드는 **단일 합성 함수**. 단계(2026-06 갱신):

```
0)   시상식·마일스톤: currentSeasonAwards → archive에 영구 보존(AWARDS_SYSTEM),
     detectSeasonMilestones → milestones 적립(big 영구+일반 300건, MILESTONE_SYSTEM),
     seasonInjuryDays 채집(만성용, INJURY_SYSTEM)
0.4) 시즌 중 이동 반영: seasonTxLog(방출/영입, 플레이어+AI)를 commitRosters로 영구 반영(TRANSACTION_SYSTEM)
1)   buildDraftContext: 롤오버(evolve 164일+나이+1+경력+1) · 은퇴 · 경쟁 FA(영입/보상) · 순번 · 신인 클래스
2)   resolveDraft:      내 위시리스트 + AI 니즈 기반 지명(순번 존중, 스카우트 공개도)
3)   fillRosters:       클래스 소진 후 남은 공백 신인 자동 충원
3.5) 경기 생산 → 성장·통산: leagueProduction(전체) → applyMatchXp + accrueCareer (experience/production)
3.6) 명예의전당: 은퇴자 중 통산 4000점↑ 등재(**7500**점↑ 영구결번급 — 9000은 60시즌 통산 최고 ~8645라 도달불가여서 7500으로 리밸런스, `store:LEGEND_POINTS`)
4)   이적자 clubTenure=0 (프랜차이즈 판정)
4.5) 만성 노쇠가속: 7경기↑ 결장자 jump 영구 -1 (INJURY_SYSTEM)
4.6) 다음 FA 풀: 미계약·비은퇴 → faPool (시즌 중 영입 풀, TRANSACTION_SYSTEM)
→ commitPlayerBase + commitRosters + setTxContext, 세이브 리셋(season+1, currentDay 0; archive/HOF/milestones 보존)
```

- 각 단계는 독립 순수 모듈. 한 시스템(예: 경기 엔진)을 바꿔도 타입 계약(`SimResult`/`ProdLine`)만
  지키면 나머지는 무영향.

## 7. 상태/저장 (store/useGameStore.ts, data/league.ts)

- 세이브(영속): `selectedTeamId, season, currentDay, results, 계약/방출 오버라이드,
  playerBase, rosters, FA/드래프트 선택, protectedIds, archive(+awards), hallOfFame,
  milestones, inSeasonTx, faPool, subPolicy, trainingFocus, staffHead/Assistants/Scouts`.
- `data/league.ts`: 싱글톤 LEAGUE/SEASON + 가변 로스터·선수 레지스트리 + `baseVersion`(파생 캐시 무효화).
- 리하이드레이트 시 `commitPlayerBase`/`commitRosters`로 base 복원.

---

## 8. 구현 현황 / 미구현

| 영역 | 상태 |
|---|---|
| 일정·캘린더·순위·리더보드 | ✅ |
| 시즌 자동 진행(진화+경기+생산 재계산) | ✅ |
| 포스트시즌 + 역대 우승 아카이브 | ✅ |
| 오프시즌 오케스트레이션(롤오버~성장 적립) | ✅ |
| 이어하기(세이브/리하이드레이트) | ✅ |
| MVP·개인 타이틀·명예의전당/영구결번 | ✅ 구현(2026-06) — AWARDS_SYSTEM(시상식·archive 보존), HOF는 endSeason 3.6 |
| 부상 결장·시즌 중 이동(명단 날짜 인지) | ✅ 구현(2026-06) — INJURY/TRANSACTION_SYSTEM(`data/dynamics.ts`) |
| 포스트시즌 직접 지휘 / 라인업 수동 개입 | ❌ 미구현(자동 완성 후 오버라이드로 개방 예정) |

> 검증: `npm test`(205) · `npx tsc --noEmit`(+ `-p tsconfig.test.json`) · `npx expo export --platform android`.
