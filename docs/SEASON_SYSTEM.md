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

- 시즌 시작 `2025-10-18`(`SEASON_START`). `dateForDay(dayIndex, season)` → 실제 날짜(시즌마다 개막 연도 +1 전진, `lib/calendar.ts` UV-6 · 발견 모드 감사 2026-07-15: 구 `dateForDay(dayIndex)` 단일 인자 서명 정정).
- `monthGrid` 6주(42칸) 그리드. UI 캘린더가 현재일(`currentDay`)을 추적.

### 2.1 시즌 연도 라벨 — "N시즌" → V리그식 연도 (2026-07-04 사용자 결정, EC-REC-01 후속)

- **표기 정책**: 시즌은 세는 숫자("3시즌")가 아니라 **연도**("2027-28")로 부른다. `data/seasonLabel.ts`:
  - `seasonYear(idx)` — 0-based 시즌 인덱스 → `"YYYY-YY"`. **1시즌(idx0)=2025-26**(SEASON_START 2025-10 기준, 게임 직전 배경 5시즌=2020-21~2024-25 다음). 음수 idx(배경)·세기 경계 지원, 100시즌+ 라벨 겹침 0.
  - `seasonYearRange(from, to)` — 통산 범위("2025-26 ~ 2027-28").
- **적용**: 일정 헤더(`2025-26 일정 · 1번째 시즌` — 연도+몇번째)·선수상세(시즌별기록/통산범위/수상/마일스톤)·기록화면(스텝퍼·연표·마일스톤·HOF은퇴)·순위/포스트/시상/FA/뉴스/대시보드/설정·배경스토리(select-team·team). 로직용 `season+1`(buildDraftContext 등)은 표시 아님 → 불변.
- **예외(count 유지, 연도 아님)**: 통산 리더보드 현역 스팬(`seasonLines.length` "N시즌 활약")·HOF 커리어 longevity(`h.seasons`). 특정 시즌이 아니라 "몇 시즌에 걸쳐"라서.
- 가드 `tools/_dv_seasonlabel.ts`(앵커·겹침0·범위)·`_dv_careerseasons.ts`(분모 정당성).

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
  > **⚠ 표시엔 §3.3의 `displayCutoff`로 승격됨(2026-07-07)** — `leagueDisplayDay` 단독은 "방금 관전한 경기"와
  > "시즌 마지막 경기일"을 놓친다(아래 §3.3). 비표시 용도(진단 리플레이)만 이 헬퍼를 계속 쓴다(~~계약 시장가~~ 는 §3.3 이행분).
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

### 3.3 표시 컷오프 결함 2건 → `displayCutoff(currentDay, results, myTeamId?)` (2026-07-07, 4-에이전트 UI 감사)

> **정정**: §3.2의 ~~`leagueDisplayDay(currentDay) = currentDay − 1` **단독** 표시 컷오프~~ 는 결정론 리프로로 확인된
> 두 사각이 있었다. **결과 인지(results-aware) 컷오프 `displayCutoff`로 승격**한다(표시 화면 전용).

- **결함 F2-a (방금 관전한 경기 누락)**: `currentDay`는 다음 경기 진행(`schedule` `setDay`) 때만 올라가고
  `recordResult`는 올리지 않는다. 그래서 내 D일 경기를 막 기록한 직후에도 `currentDay=D` → `leagueDisplayDay=D−1`
  이라 **방금 본 D일 경기가 순위·결과·대시보드·뉴스에서 빠졌다**(대시보드 성적 31-4가 실제 32-4보다 1경기 적게 보임).
- **결함 F2-b (시즌 마지막 경기일 영구 누락)**: 시즌 끝엔 다음 경기가 없어 `currentDay`가 내 마지막 경기일에서
  멈춘다. 그래서 리그 최종 매치데이(최대 6경기)가 **영원히** 순위/결과/대시보드/뉴스/기록에 안 뜬다 — 반면
  플레이오프·시상·아카이브는 `MAX` 기준이라 **화면끼리 모순**(대시보드 vs 순위표, PO 시드 vs 순위, 기록왕 불일치).
- **해결 — `displayCutoff(currentDay, results, myTeamId?)`** (`data/standings.ts`):
  - 시즌 종료(내 팀 전 일정 기록 완료 = `seasonComplete(results, myTeamId)`)면 **`SEASON_DAYS`(engine/calendar=164)로 승격**
    → 리그 최종일 전체 공개(순위·결과·기록·뉴스가 PO/시상/아카이브와 일치).
  - 아니면 **`max(currentDay − 1, playedThroughDay(results))`** → 방금 기록한 경기까지 포함.
- **스포일러 안전성(논증)**: `playedThroughDay`는 내가 **이미 관전·기록한** 경기만 반영한다. 같은 날 타팀 경기는
  기존 "다음" 버튼이 하던 것과 **똑같이 함께** 공개될 뿐이고, 내 **미관전 미래 경기일은 항상 `playedThroughDay`보다
  크므로** 미래 결과는 새지 않는다. 즉 이 변경은 이미 `playedThroughDay`를 쓰던 clinch(문서화된 예외, §3.2)의
  기준으로 **표시 계층을 통일**하는 것이다. `leagueDisplayDay`는 표시엔 **deprecated**(주석 명기), 비표시 용도만 유지.
- **재배선(전수 — grep `leagueDisplayDay` 형제 사냥)**: `index`(순위·성적·뉴스)·`schedule`(빅매치 순위)·`standings`·
  `results`·`news`+`news/[id]`(피드 인자)·`records-archive`(라이브 리더 + **잠정 라벨 경계도 같은 `seasonComplete`로**)·
  `season-recap`·`staff`·`player/[id]`(시즌 생산)·`data/records.ts seasonSnapshot`(cutoff 인자화). **면담 설득 perfT**
  (`store` §3, F3)도 같은 컷오프로 통일(치른 경기 0이면 직전 시즌 최종 순위 폴백).
- **계약 시장가도 `displayCutoff`로 이행(2026-07-07)** — 사유: `player/[id]`(displayCutoff)와 `contracts`(구 `leagueDisplayDay`)가
  같은 선수의 시장가/저평가 라벨을 **이원화**해 보였고, 재계약 오퍼 가격이 stale 컷오프로 계산됐다. `app/contracts.tsx`의
  3개 `getPlayerProduction(…, leagueDisplayDay(currentDay))` 사이트(재계약 오퍼·행 라벨·FA 요구액)를 `displayCutoff(currentDay,
  results, teamId)`로 통일 → player 상세와 동일 데이터 경로. (§3.2 "비표시=계약 시장가" 서술은 이로써 취소.)
- **F1 근원 노트(형제 배선)**: 표시 계층 필터(`freshNews`) 도입 시 **상세 화면 배선 누락**으로 목록↔상세 인덱스가
  어긋났다(NEWS §3.6, F1 — 사용자 보고 버그). 공통 컷오프/필터를 새로 넣으면 **모든 파생 표면이 같이 쓰는지 grep 전수**
  가 규율이다(TEST_METHODOLOGY 형제 사냥) — "표시 계층 필터 도입 시 상세 화면 누락".
- 검증: `tools/_dv_displaycutoff.ts`(F2 경계 — 방금 기록 경기 포함 / 시즌말 전 리그 최종일 공개 = 아카이브·PO 수치
  일치 / 미래 누수 0, A/B) + 기존 `_dv_newsday0`·`_dv_newsorder`·`_dv_seasondays`·205 테스트·tsc.

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

## 5. 포스트시즌 — 달력 편입 (engine/playoffs.ts, data/playoffs.ts, data/postseason.ts)

KOVO 방식:
- **준PO/PO**: 정규 2위 vs 3위, **3전 2선승**(target=2).
- **챔피언결정전**: 정규 1위 vs PO 승자, **5전 3선승**(target=3).
- 상위 시드 홈 어드밴티지 **×1.03 능력 승수**(`HI_EDGE`, OVR가산 아님). 매치업별 시드로 `playSeries` 결정론.
- 우승 팀은 `recordChampion(season, championId)` → `archive`에 연표 보존.

### 5.0 달력 편입 (2026-07-08, 사용자 결정 + 독립 리뷰 반영) — 구 "한 화면 단계 공개" 대체

> **정정**: ~~**단계별 공개(A2, 2026-07-01)** — `app/playoffs.tsx`가 진입 즉시 buildPlayoffs로 준PO·챔프전·우승을
> 일괄 계산하고 탭마다 한 단계씩 공개(recordChampion은 진입 시 적립)~~ 는 **플옵을 달력 밖에 두어** 시즌 서사를
> 끊었다(정규 164일 종료 후 별도 화면에서 결과 통보). → **포스트시즌을 시즌 달력 안으로 편입**한다: currentDay가 164를
> 넘어 흐르고, 준PO·결승 경기가 **고정 슬롯**에 놓여 정규 경기와 **같은 진행/관전 패턴**으로 소비된다.

- **고정 슬롯(격일, `engine/calendar.ts`)**: 정규 종료 `SEASON_DAYS=164` 뒤 —
  휴식 2일(165·166) → **준PO 1·2·3차전 = day 167·169·171**(`PO_SLOTS`) → 휴식(172~174) →
  **결승 1~5차전 = day 175·177·179·181·183**(`FINAL_SLOTS`) → `POSTSEASON_LAST_DAY=183`. 시리즈 조기 종료 시
  남은 슬롯은 **자연 소멸**(진행이 다음 라운드/오프시즌으로 점프). 게임 인덱스 g(0-based) → 슬롯 day는 `poSlotDay`/`finalSlotDay`.
- **동결 규칙(사실화)**: 진화 조회는 **전역 `min(day, SEASON_DAYS)` 클램프**(`evolvedPlayers`·`evolveOnDay`·
  `availableTeamPlayers` 3개 루트, awards.ts REF_DAY 클램프 선례). 즉 **플옵 기간 훈련·노쇠·부상 복귀 없음** —
  "포스트시즌 엔트리·훈련은 정규 종료(164) 시점 확정". `buildPlayoffs`/보드 재생은 `availableTeamPlayers(id, 164)`로 명시 동결.
  currentDay>164여도 스탯·순위·생산이 정규 종료값으로 고정되므로 `currentDay>164 전수 스윕`을 캘러 단위가 아닌 **루트 클램프**로 방어.
- **플옵 기간 개입 비활성**: 선발/벤치 건의는 **비활성 + 사유 표기**("포스트시즌 엔트리 확정") — no-op 건의 금지.
  day-aware 개입(플옵 라인업 반영)은 **Phase2 별도(이번 범위 밖, 보류)**.
- **플옵 기간 지갑·명단 액션 차단(2026-07-08 추가)**: ~~건의(선발/벤치)만 차단하고 지갑·명단 변경 액션은 열려 있던 사각~~ →
  정정. 엔트리가 164로 동결이라 **플옵 기간 선수단·지갑 변경은 새 선수가 0경기 뛰는데 돈·교체권만 태우는 유해 no-op**. 스토어가
  `currentDay>SEASON_DAYS`면 **전부 `false`로 차단**(딥링크/UI 우회 방어): **`release`·`signInSeason`·`replaceForeign`·`replaceAsian`**
  (건의 `suggestBench`/`suggestStart`는 기존대로 `reason:'postseason'`). `app/transactions.tsx`는 플옵 기간 안내 카드
  ("포스트시즌 — 선수단 이동은 시즌 종료 후") + 영입/교체 버튼 비활성(단장실 진입점은 유지, 화면에서 사유 노출).
  가드: `_dv_postseason` ⑦(4종 전부 false·지갑/교체권/명단 무변화 + day164 성공 A/B 경계 이빨). *참고: 오프시즌 전용 액션
  (`trainingCamp`=`currentDay!==0`·FA/드래프트 계획 토글)은 이미 오프시즌 게이트가 있어 중복 게이트 안 함. `unrelease`는 당일
  release만 되돌리는데 플옵 release 자체가 차단이라 자연 무효.*
- **`app/playoffs.tsx` 딥링크 스포일러 방어(2026-07-08)**: 진출 시드(=최종 순위 top3)를 무조건 렌더하던 것 → 정규 종료
  전(`!inPostseason(currentDay)`) 진입 시 브라켓 대신 안내("포스트시즌은 정규 리그 종료 후")로 가림(구 헤더 주석의 'deep-link 안전' 주장 정정).

### 5.1 진행·관전 (app/(tabs)/schedule.tsx, app/match/[id].tsx)

- **진행 단위 = 다음 플옵 경기일로 점프**(`nextPoGame`, data/postseason). 휴식일을 하루씩 탭하지 않는다(지루함 방지, 리뷰 확정).
- **내 팀 경기 = 보러가기 경유 강제**(경기 보드 진입이 유일한 진행 경로 — 정규와 동일 패턴). 단 **보드 내 "⏭ 결과"·나가기
  "결과 확정" 경로는 유지**(경유 강제 ≠ 정주행 강제 — 관전형, `BOARD_RULES` 스킵 경로 보존). 보드 종료(확정/⏭/끝까지) 시
  `setDay(슬롯day)`로 currentDay 전진 → 그 경기 공개.
- **타 구단 경기 = 결과 확인만**(자동 진행: `setDay(슬롯day)` 즉시 + 그날 결과·시리즈 현황 표시). 미진출 시즌도 동일(전 경기 타팀).
- **보드 재생 = 재생(바이트 동일, 최대 급소)**: `playSeries`는 `availableTeamPlayers(id,164)` 동결 스쿼드 + `HI_EDGE=1.03` +
  게임 시드(`seedBase+g*1009`, hi=홈)로 돈다. 내 경기 보드 재생은 **플옵 전용 박스 빌더 `buildPlayoffBox`**(data/postseason)로
  playSeries와 **입력을 바이트 공유** — 일반 `buildMatchBox`(dayIndex 기반 rest·부상)를 쓰면 점수판과 **다른 경기가 재생된다(금지)**.
  가드가 "보드 재생 g게임 세트 스코어 == series.games[g]" 증명(`_dv_playoffs`, 실측 180/180 게임 일치).

#### 5.1.1 명칭 통일 (2026-07-09, 사용자 결정 — 에뮬 혼용 발견) — 한 무대 = 한 이름

한 화면에 "플레이오프·포스트시즌·준플레이오프"가 같은 대상에 뒤섞여 있었다(같은 2위vs3위 시리즈를
결과 카드는 "플레이오프", 다음경기 카드는 "준플레이오프"로 부름). 아래로 고정한다:

| 대상 | 확정 명칭 | 비고 |
|---|---|---|
| 무대 전체(상위 3팀이 겨루는 판) | **포스트시즌** | 진출/탈락/경합/매직넘버 등 **단계 진입** 문구는 전부 "포스트시즌 …" |
| 2위 vs 3위 시리즈(3전2선승) | **플레이오프** | KOVO 실제 명칭. **"준플레이오프"는 오기 — 전면 제거·금지어** |
| 1위 vs 플레이오프 승자(5전3선승) | **챔피언결정전** | 유지 |

- **clinch(단계 진입) 문구** = "포스트시즌 진출 확정/탈락/경합 중/매직넘버 N"(구 "플레이오프 …"). 일정 화면 clinch 카드
  헤더도 "포스트시즌". 경기 중 현수막(`data/broadcast.ts`) clinch 배너도 "포스트시즌 확정!/탈락".
- **시리즈 명칭** = "플레이오프"(2v3)·"챔피언결정전"(결승) 고정. `season-recap`의 poOut 헤드라인은 "플레이오프 탈락 (W-L)"
  (구 "준PO" 접두 제거). 뉴스(`data/news.ts` playoff kind) 경기·확정 기사도 "플레이오프"(구 "준플레이오프").
- **"봄배구"** = 뉴스 본문·구단 정체성의 **분위기 flavor**(무대 라벨이 아님)로 의도적으로 유지(누적 서사). 금지 대상 아님.
- 가드: `_dv_copylint`에 금지어 **"준플레이오프"** 추가(소스 전수 0건). 오기 재유입 차단.

### 5.1.2 포스트시즌 구간 레이아웃 — 정규 카드가 밀어내지 않게 (2026-07-09)

정규 완료 후(`postseason != null`, 즉 `currentDay > SEASON_DAYS`) 일정 화면에서 **"정규리그 진행 164/164" 카드와
clinch 카드를 숨긴다**. 스테일 정규 정보가 상단을 점유해 포스트시즌 브라켓/다음 경기를 아래로 밀어내던 것 수정 —
포스트시즌 구간엔 브라켓·다음 경기가 최상단.

### 5.1.3 우리 팀 일정에 포스트시즌 경기 편입 (app/calendar.tsx, 2026-07-09)

`teamScheduleEntries`(engine/season.ts)는 정규 `SEASON`(164일)만 순회 → 포스트시즌 경기(buildPlayoffs 파생)가
"우리 팀 일정"에 **구조적으로 안 나왔다**(에뮬: 3월 31일 정규 끝에서 일정이 끊기고 챔프전 없음). 수정: 캘린더가
포스트시즌 구간(`currentDay > SEASON_DAYS`)에서 `myPostseasonCalendarRows(buildPlayoffs(season), teamId, currentDay)`로
내 팀 플옵 행(플레이오프/챔피언결정전)을 정규 엔트리 **뒤에 append**. 스포일러 안전: **치른 경기(결과) + 다음 1경기(예정)만**
노출(더 깊은 브라켓·미래 결과 누수 0 — postseasonReveal 트랙과 동일 규율). 미진출 시즌은 0행(정상). 진화·일정 편입은
`app/calendar.tsx`가, 파생 로직은 `data/postseason.ts`(단일 출처, 테스트 가능)가 맡는다.

### 5.2 스포일러 — 포스트시즌 컷오프 트랙 (data/postseason.ts)

- **치른 플옵 경기 = currentDay에서 파생**(신규 영속 필드 0 — results에 안 씀). `postseasonReveal(playoffs, currentDay)` →
  `{poRevealed, finalRevealed, poDone, finalDone, championRevealed}`. 슬롯 day ≤ currentDay 인 게임만 공개(내 미관전
  미래 게임은 보드 경유 후에만 currentDay가 그 슬롯에 도달 → 누수 0).
- **§3.3 `displayCutoff`와 충돌 회피**: `displayCutoff`는 시즌완료 시 `SEASON_DAYS(164)`로 승격해 순위·결과를 전부 공개하지만,
  **우승/챔프MVP는 그와 별개**(결승 진행 중 우승 스포일 금지). 따라서 **포스트시즌 전용 컷오프 트랙**을 둔다 —
  `currentSeasonAwards(season, uptoDay, poDay=raw currentDay)`가 챔피언/finalsMvp를 `revealedChampionId(…, poDay)`로 게이트
  (표준 uptoDay=164 클램프는 순위/생산용, poDay=raw currentDay는 우승 노출용). `recordChampion`은 `championRevealed`(결승 전
  게임 공개) 후 **시상식(champion-ceremony) 진입 시** 적립(§5.3 — archive.championId가 "시상식 봤음" 마커를 겸함, 영속 0).
- **미래 결과 읽는 표면 전수 게이트**: 기록 탭 잠정 시상 `finalsMvp`(우승팀 소속=우승 스포일러)·대시보드·뉴스·업적 —
  플옵 기간 `buildPlayoffs` 미공개 결과가 새는 곳 전부 컷오프 트랙 적용. **결승 노출 게이트는 일정 화면이 건다**(뉴스가 게이트 역할 금지).
- **뉴스(playoff kind, NEWS §3.2)**: `buildNewsFeed(..., poDay=raw currentDay)`가 준PO/결승 **치른(공개) 게임 결과** +
  **준PO 시리즈 확정("결승 대진 확정")** 기사를 생성 — kord=결정론 순번(생성 순서=게임 순서 append-only라 안정),
  ref=`po:g`/`final:g`/`po:clinch`(헤드라인 키 금지). **우승 기사는 archive(champion) 경로**(recordChampion 후에만 존재 →
  타이밍 자동 게이트, 중복 금지). 가드: `_dv_postseason` ②b(결승 확정 전 우승 기사 0·기사 수=공개 게임 수·키 안정) + simNews.

### 5.3 세리머니 3단 고정 (리뷰 확정) + 세이브 호환

- **체인**: 결승 종료 → 일정 화면 "**시상식 보러가기**" → **`app/champion-ceremony.tsx`(우승팀 시상식 — 우승·챔프MVP.
  ChampionCelebration 오버레이 흡수·대체, 미니멀. **진입 시 recordChampion 적립**)** → 기존 `awards-ceremony`(리그 시상식 —
  MVP·신인·베스트7, **최소 수정**: 사용자 UI+BGM 작업 예정. 종료·건너뛰기 = `dismissAll`+`replace`로 **일정 복귀**) →
  일정 화면이 "**시즌 결산**" 버튼 노출(마커 = `archive[season].championId` 존재 — 영속 0 파생, 앱 재시작에도 유지) →
  ~~`season-recap` → 기존 오프시즌 체인(외국인→드래프트→전지훈련) 불변.~~
  → **정정(2026-07-24, §5.6 허브 전환)**: 시상식 종료 후 일정 화면이 노출하는 것은 단일 "시즌 결산" 버튼이 아니라
  **오프시즌 허브 카드(권장 순서 번호 목록)** 이고, `season-recap`은 그 1번 항목이다. 결산 화면은 다음 단계로 push하지
  않고 **일정으로 복귀**한다(체인 해체 — §5.6). 시상식 자체의 `dismissAll`+일정 복귀 패턴은 그대로(그게 허브의 원형).
  챔프MVP 수여 연출은 champion-ceremony 한 곳만(중복 금지 — awards-ceremony의 챔프MVP 비트 제거). **미우승 시즌**: 우승팀
  시상식은 짧은 결과 통지(타 구단 대관식 풀 연출 강제 금지).
- **플옵 기간 건의 비활성(§5.0)**: player 상세 "감독 건의" 카드가 `currentDay>SEASON_DAYS`면 버튼 대신
  "포스트시즌 엔트리 확정 — 건의는 다음 시즌부터" 안내. 스토어 `suggestBench`/`suggestStart`도 `reason:'postseason'`으로
  거절(UI 우회·딥링크 방어) — `OwnerRejectReason`에 `postseason` 추가.
- **`app/playoffs.tsx`는 브라켓/시리즈 현황 화면으로 재편**(스포일러 없이 `postseasonReveal`로 치른 경기까지) — 진입 즉시 recordChampion 제거.
- **세이브 호환(A안)**: `saveMigration` v3 정규화 — 구세이브가 "정규 완료 + `archive[season].championId` 존재"면 포스트시즌 소비로
  간주하고 `currentDay`를 `POSTSEASON_LAST_DAY(183)`로 승격 → 오프시즌 체인 직행(재관전 강요 금지). `SAVE_VERSION` 2→3.

#### 5.3.1 시상식 "이어보기" — 우승 적립과 관람 진행도의 분리 (2026-07-24, 사용자 결정)

**증상(에뮬 E2E)**: 리그 시상식(9개 포스터)을 보다가 중간에 나가면 일정 화면이 곧바로 "시상식이 끝났습니다"로 바뀌어
**남은 상을 영영 못 본다**. 원인 = `champion-ceremony` **진입 시** `recordChampion`이 찍는 `archive[season].championId`가
"우승 적립"과 "시상식 다 봤음"이라는 **두 의미를 겸직**하고 있었기 때문(§5.3 원설계).

**결정 = (a) 마커 분리** — `recordChampion` 시점은 **그대로 두고**(우승 적립), **관람 진행도만 별도 추적**한다.

> **왜 (b)(완료 마커 자체를 뒤로 이동)가 아닌가** — `archive[season].championId`에 매달린 소비처를 전수 추적한 결과:
> ①일정 탭 **오프시즌 허브 게이트**(`ceremonyDone`, §5.6) ②`season-recap` 진입 게이트 ③`season-recap-detail` 우승/챔프MVP
> 스포일러 게이트 ④`awards-ceremony` 자신의 진입 가드(`championRevealed` — 늦추면 **자기 자신을 막는 닭-달걀**)
> ⑤뉴스 우승 기사 경로 ⑥`records-archive` 우승 표기 ⑦`endSeason`이 같은 시즌 엔트리에 `awards`를 병합.
> 즉 (b)는 "시상식을 끝까지 안 보면 오프시즌 업무 전체(결산·트라이아웃·FA·드래프트)가 안 열린다" =
> **5b0ce5e가 방금 봉인한 오프시즌 소프트락 구조의 부활**이다. → (a) 채택.

- **신규 영속 1필드 `ceremonyProgress: number`**(`campDoneSeason` 패턴 — 시즌 경계에서 자기 리셋이라 구세이브 안전):
  - `0` = 미관람(처음부터) · `n>0` = **n번째 비트에서 이탈**(그 비트부터 이어보기) · `-1` = **끝까지 봄(완료)**.
  - `endSeason`의 새 시즌 리셋 블록에서 `0`으로 초기화(`watchProgress`와 같은 자리). 구세이브 누락 = 기본 `0` → "처음부터"라
    안전(재관람 유도일 뿐 손실 없음). 등록 3곳: 스토어 기본값 · `partialize` · `saveMigration`(SAVE_DEFAULTS·KIND).
- **일정 화면(§5.3 카드)**: `ceremonyDone`(= archive championId, **불변**)는 오프시즌 허브를 여는 게이트로 그대로 쓰고,
  카드 문구만 진행도로 갈린다 — `ceremonyProgress === -1`이면 "시상식이 끝났습니다", 아니면 **"시상식 이어보기 →"**.
  라우트: `0`이면 `/champion-ceremony`(체인 처음부터), `n>0`이면 `/awards-ceremony`(그 비트부터).
- **이어보기는 차단이 아니다** — 허브·결산은 진행도와 무관하게 열려 있다(관전형 = 보는 건 권장, 강요 금지.
  차단형 모달 금지 — 라이브 드래프트가 같은 이유로 버튼 방식을 택한 것과 동일 판단).
- **재진입은 "본 데까지 건너뛰고 이어서"**(처음부터가 아니라). 근거: ①목적은 *못 본 상*을 보게 하는 것이지 재관람 강요가 아니다
  ②라이브 드래프트 재개(`draftSelections`로 시퀀스 재계산 → fast-forward)와 같은 문법 ③이미 본 상은 시즌 결산·기록 아카이브에서
  언제든 다시 볼 수 있다. 비트 수가 시즌마다 다르므로 저장값은 `min(progress, last)`로 클램프.
- **"건너뛰기"도 이탈과 동일 취급**(완료 아님 — 진행도 보존). "지금은 안 볼래"지 "다시는 안 볼래"가 아니고, 이어보기 카드는
  차단이 아닌 조용한 잔여 안내라 nag가 되지 않는다. 새 시즌을 시작하면 진행도 리셋 + `seasonOver` 위상 종료로 카드 자체가 사라진다.

### ★ 상비 가드
- `tools/_dv_playoffs.ts`(확장): 기존 8검사(불변식·상위시드·결정론·A/B) + **보드 재생 == series.games 세트스코어**(내 팀·타 팀).
- `tools/_dv_postseason.ts`(신규): ①달력 슬롯·조기종료 소멸 ②치른 경기 파생(컷오프) 스포일러 0(결승 전 finalsMvp/우승기사/champion 비노출)
  ③recordChampion 시점 ④세이브 A안 마이그레이션 경로 ⑤결정론(같은 시드 2회) ⑥구플로우 대비 champion 바이트 동일(시드 보존)
  **⑦플옵 기간 지갑·명단 액션 차단**(release·signInSeason·replaceForeign·replaceAsian 4종 false·무변화 + day164 성공 경계 A/B)
  **⑧우리 팀 일정 포스트시즌 편입**(진출 3팀 각 ≥1경기 · day165엔 치른 경기 0(미래 결과 누수 0) · 미래는 다음 1경기만 · 미진출 팀 0행).
- `tools/_dv_copylint.ts`(확장): 금지어에 **"준플레이오프"**(포스트시즌 명칭 통일 §5.1.1 — 시리즈명은 "플레이오프") 추가.
- `tools/_dv_ceremony.ts`(신규 — §5.3.1): ①`recordChampion` 시점 불변(진입 시 적립 = 허브·결산 게이트 무영향)
  ②진행도 필드가 영속 3곳(스토어 기본값·partialize·saveMigration)에 등록 ③이탈→이어보기→완료 상태기계
  (0=처음부터·n=이어보기·−1=완료)와 그때의 일정 카드 문구/라우트 ④`endSeason` 후 리셋 ⑤구세이브(필드 누락) 기본 0.
  A/B: "진입 시 완료 처리"(구 동작) 뮤턴트에서 ③이 FAIL.

### ★ 플레이오프 검증 (2026-07-07) — 검증·실측=Fable 5 / 가드=Opus 에이전트

**포맷 요약**: 정규 1위 챔프전 직행(bye) / 2위(hi) vs 3위(lo) **준PO 3전2선승**(`PO_TARGET=2`) /
챔프전 1위(hi) vs PO 승자 **5전3선승**(`FINAL_TARGET=3`) / 상위시드 어드밴티지 **`HI_EDGE=1.03`**(능력 승수, OVR가산 아님) /
결정론 시드 PO=`90000+season*17`·결승=`95000+season*17`. 진출 3팀 = `computeStandings(MAX)` 상위 3팀.

**방법(고정 시드 위 몬테카를로)**: `resetLeagueBase()` 뒤 정규 상위 3팀은 불변 — `buildPlayoffs(s)`의 season
인덱스는 오직 시리즈 RNG만 바꾸므로, **같은 3팀을 두고 season=0..499 서로 다른 시드로 N=500회** 돌리는 몬테카를로.
매 판 불변식을 검사하고 상위시드 승률·챔피언 분포·시리즈 길이를 집계.

| 지표 | 실측 (N=500 · `data/playoffs.ts`·`engine/playoffs.ts` · **2026-07-08 재측정** — 이후 엔진 커밋 드리프트로 갱신, 구 2026-07-07 수치 취소선) |
|---|---|
| 불변식 위반 | **0/500** (seeds=top3 · po=2v3 · final.hi=1위 · champion∈seeds=final승자 · 시리즈 target 도달) |
| 상위시드 승률 | PO 2위(hi) **80.6%**(~~83.8%~~) · 챔프전 1위(hi) **90.0%**(~~85.2%~~) (둘 다 >50%) |
| 챔피언 분포 | 1위 **90.0%**(~~85.2%~~) · 2위 **10.0%**(~~13.8%~~) · 3위 **0.0%**(~~1.0%~~) (상위시드 우세) |
| 시리즈 길이 | PO 2게임=305(~~312~~) / 3게임=195(~~188~~) · 결승 3=214 / 4=181(~~172~~) / 5=105(~~114~~) (유효 best-of-3/5, 풀5차 결승 발생) |
| 결정론 | `buildPlayoffs(7)` 2회 → championId·시리즈 게임 완전 동일 |

> **재측정(2026-07-08, STATS_PROTOCOL — "은퇴 재정비 후 재측정")**: 2026-07-07 표는 그 이후 엔진 커밋으로
> 시드 유니버스가 바뀌어 분포가 드리프트했다. 가드 단언은 방향성(>50% · 1위>2위>3위)이라 계속 PASS — 표만 현재 값으로 갱신.

**상비 가드 `tools/_dv_playoffs.ts`**(exit 0/1): 위 8검사 + **A/B 자가검증**(오염 Playoffs — championId를 시드 밖
팀으로·po.hiId를 3시드로 → 검사기가 4건 위반으로 잡음, 실제 데이터는 0 위반 → 오라클 이빨 증명, 허위 오라클 방지).
`npx tsx tools/_dv_playoffs.ts` ~수초.

> **시상식 검증**은 별도 상비 가드가 커버(중복 안 함): `_dv_docs_awards`(신인상=데뷔 시즌·챔프MVP↔우승팀·archive 보존
> + A/B 방향성) · `_ev_matchmvp`(경기 MVP = 이긴 팀 최고 생산자 == 독립 오라클·승자측·points>0·결정론).

## 5.5 시즌 결산 (app/season-recap.tsx) — 2026-06-30 신설 (독립 리뷰 거침)

> **왜**: AWARDS_SYSTEM §0이 시상식을 "1년에 한 번 멈춰 음미하는 순간"으로 규정했는데, 시상(MVP·베스트7)이
> 기록 탭 텍스트 배열로만 묻혀 유저가 *뉴스 기사로* "누가 MVP였지"를 확인하는 미달 구현이었다(사용자 피드백).
> 결산은 신규 스코프가 아니라 **이미 내려진 결정의 이행** — 관전형 1순위(연출=1순위 투자처)에 정면 부합.

- **위치(2026-07-08 달력 편입 후)**: 결승 종료 → 일정 화면 "시상식 보러가기" → `champion-ceremony`(우승팀) →
  `awards-ceremony`(리그 시상) → **일정 화면 복귀 후 "시즌 결산"** → **[시즌 결산]** → 외국인 트라이아웃(§5.3 체인).
  `endSeason` **이전**이라 이번 시즌 시상은 아직
  archive에 안 구워짐 → **`seasonSnapshot(season, season, currentDay)`(=`currentSeasonAwards`+`computeStandings`)
  + `leagueProduction(leagueDisplayDay)`로 그 자리 재계산**(tryout 잠정 시상·records 탭과 동일 경로). 우승팀은
  포스트시즌 `recordChampion`이 박은 `archive.find(a=>a.season===season)?.championId`로 읽음. **새 영속 필드 0**.
- **연출 규율(리뷰)**: **강제 도착·선택 정독·단일 한 장**(스크롤 1장 + 하단 "외국인 트라이아웃 →" 버튼 하나).
  🚫 **다단계 캐러셀/"탭하여 계속 n/총" 순차 공개 금지**(그 순간 "손이 가는 게임"=관전형 위반). 결산은 정적 표지.
- **카드 요약 + 상세 보기 drill-down(2026-07-08, 사용자 결정 — "한 장" 규율의 보완, 정정 아님)**: 내용이 많아지면 본문은
  **섹션별 카드의 요약(1~3줄)** 만 두고, 더 있으면 **"상세 보기 ›"** 로 심화.
  기준: **"단장이 3초 안에 시즌을 파악"할 수치는 요약**에(순위·연승·순익·수상 개수), **명단·부문별 나열은 상세**로(수상자 전체·숙제 명단·생산 전 선수).
  ✅ **캐러셀과 충돌 없음**: 캐러셀=강제 순차 공개, 상세 보기=선택 정독(안 펼치면 여전히 한 장 표지). ①포스트시즌 여정만 헤드라인
  고정(카드/확장 아님 — 시즌 결말은 즉시 보여야).
  - ~~**인라인 확장(아코디언, 화면 이탈 없음 — guide.tsx 패턴). 컴포넌트 = `season-recap.tsx` 로컬 `ExpandCard`(요약 children + 선택 detail). 상세=생산 2~3위 등 소량.**~~
    → **정정(2026-07-08, 사용자 피드백 "보여줄 게 너무 적음 — 마이페이지처럼 카드로 만들고 상세 페이지에서 전부").** 아코디언은 담을 양이 적어
    "결산이 시즌 결말을 못 말한다"는 피드백을 못 풀었다. **인라인 아코디언 → 별도 상세 스택 화면으로 격상**(records-archive 마이페이지 패턴):
    - 결산 본문(`season-recap.tsx`)은 **요약 카드**만(3초 파악) — 각 카드에 **"상세 보기 ›"가 `router.push('/season-recap-detail/[section]')`** (인라인 확장 아님, 화면 이탈 후 뒤로가기로 복귀).
    - 상세 화면(`app/season-recap-detail/[section].tsx`, 신규 · 단일 동적 라우트 4섹션 `awards|squad|story|tasks`)은 **내용 대폭 확대**. 모두 **재계산 파생**(신규 영속 0):
      · **awards** — 리그 전체 시상 요약본: 정규MVP·챔프MVP·신인·기량발전 카드 + 부문 기록왕 7종 + 베스트7 코트(`Best7Court` 재사용). **내 팀 선수 강조**(`isMine`→accent). 경로 = `seasonSnapshot(season).awards`(=`currentSeasonAwards`, finalsMvp는 poDay 게이트). champion-ceremony·awards-ceremony와 중복이 아니라 그 **요약본**(캐러셀 없는 정적 열람).
      · **squad** — 우리 팀 **전 선수** 시즌 생산 정렬 목록(경기·득점·스/블/서·세트·디그). 명단=`rosterIdsOnDay(my,day)`(영입 포함·방출 제외), 생산=`leagueProduction(day)`.
      · **story** — 최종 순위표(전 구단, 내 팀·우승 강조) + 최다 연승/연패(`seasonStreaks(day)[my]`) + 재정 상세(`lastFinance`: 후원·보너스·입장·굿즈·인건비·순익·평균관중) + **주요 사건**(`milestones` 중 이번 시즌·내 팀 — 실데이터, 없으면 생략).
      · **tasks** — 다음 시즌 숙제 **전 명단**: `recapBriefing`의 faSoon/expiring/retireSoon를 이름·나이·포지션·잔여계약까지, 우선순위 색(FA 🔥 > 만료 ⚠ > 정년 ℹ). 요약과 동일 정본 셀렉터(가드 `_dv_recap` [B]가 덮음).
    - **스포일러 게이트(상세도 이중 가드)**: 상세 화면 진입도 `archive[season].championId` 존재 확인 → 없으면(결승 전 딥링크) awards의 우승/챔프MVP·story의 우승 표기 **비노출**(결산 진입 자체가 championId 게이트지만 상세는 독립 라우트라 자체 가드). finalsMvp는 `currentSeasonAwards` poDay 게이트로 자동 미노출.
    - **성능**: 상세도 `leagueProduction` 재계산이 무거움 → `useDeferredReady`+`<Loading variant="list">`. 결산 첫 화면은 요약만이라 가볍게 유지(무거운 나열은 상세로 미룸).
- ~~**내용 한정**(과부하 방지 — 깊은 건 기록 탭 drill-down): ① 우리 팀 헤드라인 한 줄(최종 순위·W/L·우승/PO)
  ② 우리 선수 하이라이트(내 수상자 + 내 팀 생산 상위 1~3 = 단장 결정의 성적표) ③ 리그 시상 3종(MVP·신인·기량발전,
  이름+팀+한 줄 스탯) ④ **베스트7 코트**(아래). + (선택, 하단 한 줄) 재정·팬덤.~~
  → **정정(2026-07-08, 사용자 피드백 "보여줄 게 이거밖에 없어?" — 포스트시즌 달력 편입 후 결산이 시즌 결말을 말해야).**
  ③ 리그 시상 3종·④ 베스트7 코트는 이미 시상식 화면(champion-ceremony·awards-ceremony)으로 이관됨(삼중 표시 방지, code 주석·AWARDS §7).
  결산 **내용 한정(갱신)** — 여전히 한 장(스크롤 + 버튼 하나), 각 섹션은 **실데이터 없으면 생략**(빈 껍데기 금지):
  - ① **포스트시즌 여정 헤드라인(최우선)** — 내 팀의 시즌 결말을 첫 줄로: **통합 우승 🏆**(정규 1위+챔프 우승) / **우승 🏆**(하위 시드 챔프) /
    **챔피언결정전 준우승 (2-3)** / **플레이오프 탈락 (1-2)** / **포스트시즌 진출 실패 · N위**. 시리즈 게임 스코어(내 팀 시점) 포함.
    데이터 = `buildPlayoffs(season)`(seeds·po·final·championId) + `Matchup.series.hiWins/loWins`. **스포일러 게이트**: 결산은
    `archive[season].championId` 존재(= champion-ceremony 통과) 후에만 진입 → `championRevealed`=true, 플옵 전부 공개 상태. 섹션 렌더도 championId≠null로 이중 가드.
  - ② **우리 팀 수상 종합** — 정규 MVP·베스트7 외 **챔프MVP·기록왕(부문별)·신인상·기량발전상** 중 내 팀 선수 수상 전부.
    경로 = `seasonSnapshot(season).awards`(= `currentSeasonAwards(season, displayCutoff=164, poDay=raw currentDay)`) — finalsMvp는 poDay 게이트로 결승 확정 후에만. **요약 카드**=내 첫 수상+개수(내 수상 0이면 카드 생략), **상세(`/season-recap-detail/awards`)**=리그 전체 시상 요약본(내 팀 강조).
  - ③ **시즌 스토리 수치** — 최다 연승(`seasonStreaks(day)[my][0]`, 정규 결과 파생) · 팬심 현재값 · 전 시즌 순익(`lastFinance.net`) · 평균 관중(`lastFinance.attendance`).
    **파생 가능한 실데이터만**(가짜 수치 금지). 팬심 히스토리 미보존이라 "전 시즌 대비 증감"은 lastFinance(직전 정산) 문맥으로 대체.
  - ④ **다음 시즌 숙제 브리핑(단장 프리뷰)** — ⓐFA 자격 도래 예정(`willBeFA(p)` = 경력+1≥6 & 잔여≤1) ⓑ계약 만료 임박(잔여≤1, FA 예정 아닌 자만 — ⓐ와 중복 제거)
    ⓒ정년 임박(현재 39세 = `RETIRE_AGE−1`, 이번 롤오버에 40세 도달). 각 2~4명 요약(이름·나이·포지션), 없으면 생략.
    🚫 **은퇴 확정자 예측 금지**(롤오버 전 미확정 — 39세 정년만 확정 사실). ⓒ는 "정년 임박"이지 "은퇴 확정" 아님.
    - **산출 기준(정본 일치, 2026-07-08 전수조사 수정 — `data/recapBriefing.ts` `recapBriefing()`)**: 예측 명단·계약은 반드시 **endSeason이 실제로 쓰는 최종 상태**와 일치해야 한다(어긋나면 재계약한 선수가 🔥FA로, 방출 선수가 잔존, 영입 선수가 누락).
      · **명단 = 시즌 중 이동 반영** — `rosterIdsOnDay(my, day)`(영입 포함·방출 제외) + `evolveOnDay`(로스터 밖 신규 영입도 진화). ~~`teamPlayerIds`(base 시즌초 명단)~~ **금지**(시즌 중 재계약/방출/영입 무지).
      · **계약 = `contractOverrides` 합성** — `activeRoster(evolved, overrides, released)`로 시즌 중 재계약(잔여 갱신)을 반영해 `willBeFA`/`remaining` 판정. base 계약(override 무시) 금지.
      · **정년(39세=`RETIRE_AGE−1`) 확정자는 ⓒ 정년 줄에만** — ⓐ FA 자격 줄에서 제외(`willBeFA(p) && p.age < RETIRE_AGE−1`). 중복 계상 금지("39세 정년만 확정 사실").
      · 상비 가드 `tools/_dv_recap.ts` [B] ⑤⑥⑦: `recapBriefing` 예측 ⊆ 실제 `buildOffseason`(FA 풀 진입자 ⊆ faSoon∪expiring·faSoon∩실제잔류=∅) + 39세 전원 은퇴·FA 줄 미등장 + A/B 뮤턴트(override·시즌이동 무시→위반 검출).
  - ⑤ **우리 선수 활약**(단장 결정의 성적표) + 재정·팬덤(③에 흡수). **요약 카드**=최고 생산 1명, **상세(`/season-recap-detail/squad`)**=우리 팀 전 선수 생산 정렬.
    - **명단 = `rosterIdsOnDay(my, day)`**(④와 동일 — 시즌 중 영입 포함·방출 제외). ~~`teamPlayerIds`~~ 금지(전수조사 수정, 2026-07-08).
  🚫 제외(유지): 리그 전체 순위표 풀버전·기록왕 전체(내 선수가 왕일 때만 강조)·라운드MVP·박스스코어·다단계 캐러셀.
- **베스트7 코트(`components/Best7Court.tsx`, 재사용)**: 베스트7(S·OH·OH·OP·MB·MB·L)을 코트 포메이션 7마커
  (이름·팀·포지션)로. **구단색 틴트(teamColors) + 우리 팀 선수 border 강조.** `SeasonAwards` 입력만 받아
  현재 시즌(잠정)·과거 시즌(`archive[].awards`) 공용 → 기록 탭 시상식에도 동일 컴포넌트(AwardIllustration 패턴).
  🚫 **가짜 드라마 금지**: 7명은 서로 다른 팀 올스타지 *함께 뛴 라인업 아님* → "최강 라인업/드림팀" 라벨·랠리
  애니메이션 금지. **정적 명예 포메이션**("시즌 베스트7")으로만(실제 수상자 배치=사실 나열).
- **성능**: `leagueProduction` 풀시즌 재계산이 무거움 → `useDeferredReady`+`<Loading variant="list">`(tryout 패턴).
- **검토 반영(2026-07-08, 사용자+GPT — UI만)**: ⓐ **다음 시즌 숙제 요약 = 우선순위 3줄 스택** — 🔥 FA 자격(`theme.bad`) >
  ⚠ 계약 만료(`theme.warn`) > ℹ 정년 임박(`theme.muted`). 색+아이콘으로 "다음 오프시즌에 뭘 먼저 해야 하나" 시선 유도,
  해당 없는 줄 생략(기존 규칙), 상세 명단도 동일 순서·색. ⓑ **하단 안내 문구 제거**(~~"한 시즌이 끝났습니다. 통산 기록·연표는
  마이페이지 → 기록에서."~~) — 다른 메뉴 이동 유도 대신 시즌의 여운 유지, 하단엔 ~~[오프시즌 · 외국인 트라이아웃 →]~~
  → **정정(2026-07-24, §5.6 허브 전환)**: **[오프시즌 준비로 →]**(다음 단계 push가 아니라 **일정 허브 복귀**) 버튼만.
- **📋 출시 후 업데이트(백로그 — 기록만, 미구현 2026-07-08)**:
  1. **시즌 한 줄 요약** — 조건 기반 서사 한 줄("창단 첫 우승" / "2년 만의 우승" / "플레이오프 첫 진출" / "지난 시즌보다
     한 단계 상승" / "아쉬운 준우승"). AI 생성 아님 — `archive` 실데이터(역대 championId·standings) 조건 분기.
     목적: 숫자가 아니라 "이번 시즌의 이야기"를 기억하게.
  2. **시즌 스토리 맥락 강화** — 수치가 **구단 역대 기록일 때만** 한 줄 설명("창단 이후 최다 연승" / "역대 최고 평균 관중" /
     "최고 흑자 시즌" / "팬심 최고 기록"). **실데이터로 증명 가능한 경우에만 표시, 임의 문구 생성 금지**(가짜 드라마 금지 기둥과
     동일 원칙). 연승은 `archive.streaks`로 즉시 가능, 관중·순익·팬심은 히스토리 미보존이라 보존 범위 검토 선행.

### 5.5 D 시즌 시작 로딩 (app/season-start.tsx) — 2026-06-30 신설

> **왜**: 드래프트 끝 "시즌 시작하기"를 누르면 `store.endSeason`(§6, 오프시즌 단일 합성 — buildDraftContext·
> resolveDraft·fillRosters·leagueProduction 다회·HOF)이 **무거운 동기 작업**이라 JS 스레드를 길게(실기기 ~15s)
> 막아 화면이 멈춘 듯 보였다(사용자 보고 2026-06-30). 기다림을 유의미하게 — 전용 로딩 화면(`<Loading variant="brand">`
> 워드마크 "배구명가" + **원형 스피너(회전 링)**)으로 가린다. 관전형 1순위(연출=투자처)에 부합.

- **흐름**: 드래프트(`onFinish`) → `showSeasonStartAd()`(MONETIZATION §3, 첫 시즌 외 광고 — 항상 resolve) →
  `router.replace('/season-start')` → 로딩 표시 → `endSeason()` → ~~`router.replace('/enshrine')` → (헌액 0명이면 통과) 탭.~~
  → **정정(2026-07-08 사용자 결정 — 오프시즌 꼬리 순서 변경)**: `endSeason()` 후
  **`enshrine`(헌액=지난 시즌 마무리) → `training-camp?chain=1`(전지훈련=새 시즌 준비) → `season-opening`(개막 브리지) → 탭(홈)**.
  과거(은퇴 레전드 기림)를 먼저 마무리하고 미래(선수 강화)를 준비한 뒤 개막하는 서사. ~~구 순서: 전지훈련 → 헌액 → 탭~~
  (구현상 season-start가 `enshrine`으로 replace, 각 화면이 다음 단계로 `router.replace` 체인, beforeRemove가 GO_BACK/POP 차단·REPLACE/POP_TO_TOP 통과 — UI-28).
- **⚠ 진입점 3개(2026-07-24, §5.6 허브)**: `endSeason`으로 가는 문(광고 → `/season-start`)은 이제 **드래프트 센터·라이브 드래프트·일정 허브 카드** 셋이다.
  화면 로컬 `useRef` 래치는 화면이 다르면 공유되지 않아 광고 이중 노출을 못 막는다 → **공용 훅 `lib/seasonStart.ts` `useSeasonStartEntry()`**(모듈 레벨 래치)로 통일.
  최종 방어선은 여전히 `store.endSeason`의 `planNextAction(...).kind !== 'seasonOver'` 즉시-return(§6 진행 게이트) — 광고가 두 번 떠도 롤오버는 1회.
- **⚠ 스택 리셋(`navigation.reset`) 유지**: `season-start.tsx`의 오프시즌 스택 정리(#113, 102.8→23.2s)는 허브 전환 후에도 **지우지 않는다**.
  허브 경로에선 스택이 얕아 no-op처럼 보이지만, 결산→…→드래프트를 push로 훑고 온 세션·구세이브 경로에선 여전히 병목을 제거한다(UI-50 ⑧).
- **체인 두 안내 화면(2026-07-08 사용자 결정 — 스킵 방지)**:
  ① **헌액자 0명 안내**(`app/enshrine.tsx`) — 자동 통과하지 않고 "이번 시즌 헌액자는 없습니다." 조용한 한 장(명전 톤) + "새 시즌 준비로 →". 강제 대기·타이머 없이 탭 한 번.
  ② **개막 브리지**(`app/season-opening.tsx`, 신규) — 전지훈련 종료 → 홈 사이 "시즌이 시작됩니다."를 시즌 연도(`seasonYear(season)`)와 함께 미니멀하게. "개막전으로 →" 탭 한 번으로 `dismissAll`+`replace('/(tabs)')`(소비된 오프시즌 스택 정리). 과한 애니메이션 금지(사용자가 시상식 UI·BGM 별도 작업 예정).
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

## 5.6 오프시즌 "완전 허브" IA (2026-07-24 신설 — 사용자 승인 + 독립 리뷰 반영)

> **왜(사고 기록)**: 2026-07-24 에뮬 E2E에서 FA 센터가 render throw(P0, `a04c0bc`로 수정)하자
> **오프시즌에서 영구히 빠져나갈 수 없는 소프트락**이 됐다. 근본 원인은 크래시 자체가 아니라 **전진 경로가 단일 사슬**이라
> 한 화면이 죽으면 우회로가 없다는 **구조**다. 사슬을 허브로 바꾼다(A′ + B = 잠금·완료마커 없는 허브 + ErrorBoundary 병행).

### 5.6.1 구 체인(해체 대상) → 신 허브

```
[구] 시상식 --dismissAll--> 일정
     season-recap --push--> tryout --push--> asian-tryout --push--> fa --push--> draft
       --push--> draft-live --replace--> season-start --replace--> enshrine
       --replace--> training-camp(chain=1) --replace--> season-opening --> 개막

[신] 일정 탭(허브) ──┬─ season-recap ──┐
                     ├─ tryout ────────┤
                     ├─ asian-tryout ──┼─ 각 화면 종료 = dismissAll + replace('/(tabs)/schedule')
                     ├─ fa ────────────┤   (시상식 복귀 패턴 재사용)
                     ├─ draft ─────────┤
                     └─ draft-live ────┘
        └─ [새 시즌 시작하기] → 광고 → season-start → endSeason
             → enshrine → training-camp(chain=1) → season-opening → 개막   ※뒷단 사슬은 유지(UI-28)
```

- 이미 허브 패턴이 2곳 있었다: 시상식 복귀(`app/(tabs)/schedule.tsx` 우승 카드), 전지훈련 게이트 카드. 그 문법을 전 단계로 확장한 것.
- **앞단(pre-rollover)만 허브**다. `endSeason` 이후 뒷단(헌액·전지훈련·개막 브리지)은 롤오버가 끝난 뒤라 되돌아가면
  상태가 누수되므로 **UI-28 잠금 유지**.

### 5.6.2 두 위상 — 카드 목록이 다르다

| 위상 | 판정 | 허브 카드 목록 | 최종 버튼 |
|---|---|---|---|
| **앞단** | `planNextAction(...).kind==='seasonOver'` (`currentDay≈183`, season=S) | 1 시즌 결산 · 2 외국인 트라이아웃 · 3 아시아쿼터 · 4 FA 센터 · 5 신인 드래프트 | **새 시즌 시작하기**(광고 → `/season-start` → `endSeason`) |
| **뒷단** | `currentDay===0 && campDoneSeason!==season` (season=S+1) | 1 명예의전당 헌액 · 2 전지훈련 | **개막전으로**(`finishCamp` → 일정) |

두 위상은 일정 탭에서 서로 다른 분기로 렌더된다(포스트시즌 브라켓 분기 vs `offseason` 게이트 분기) — **하나의 카드로 그리지 않는다**.

### 5.6.3 규칙 (전부 UI-50과 동치)

1. **잠금·완료마커 없음** — 진입 차단 0. ✅/🔒 3상태 금지(앞단 6단계는 전부 미리보기라 "완료"가 데이터에 없고,
   아무것도 안 하고 나오는 게 정상 완주다). **데이터로 진짜 판정되는 것만** 체크 표시: 전지훈련(`campDoneSeason===season`)·
   시상식(`archive[season].championId`).
2. **최종 버튼 상시 노출** — 완료 게이트를 걸면 그게 새 소프트락. 안 본 단계가 있으면 카드 안내 한 줄 +
   `showAlert` 확인(새 Modal 금지 — iOS 모달 레이스 #129).
3. **신규 영속 필드 0** — 진행 중 세이브 그대로 호환. 진행도는 전부 기존 상태 파생.
4. **`draftSelections` 무효화 대칭(실버그 수정)** — 허브에선 "드래프트 확정 → FA/외인 재방문"이 상시 가능해진다.
   - (a) 확정 픽이 있는 상태에서 상류 레버를 만지면 **무경고 전삭제**였다 → **경고 후 삭제**(`components/draftPickGuard.ts`
     `confirmDraftPickReset`). 확정 픽 0건이면 조용히 통과(소음 금지).
   - (b) `toggleTryoutWish`/`toggleAsianWish`/`setKeepForeign`/`setKeepAsian`은 **무효화가 빠져 있었다** →
     같은 취급으로 통일. 근거: 외인/아시아쿼터 영입은 전 구단 로스터 인원을 바꿔 AI 지명/패스 판정(`engine/draft.ts`
     `neededPositions`·계약 상한)을 바꾸므로 확정 픽의 전제가 달라진다.
5. **ErrorBoundary 병행(원인 봉인)** — 허브만으론 증상 우회다. 화면 throw = 앱 사망(EC-UI-04)을 route-level
   `export const ErrorBoundary`(expo-router 6)로 막고, 폴백은 **일정으로 나가는 버튼**을 반드시 제공하며 에러를
   `diag`(#44)에 남긴다. 루트 `app/_layout.tsx`에도 전역 폴백.
6. **미리보기 신뢰(D 위험)** — "FA에서 영입 예상 2명 확인 → 나옴 → 외인 재계약 변경 → 개막"이면 자금이 줄어 FA가
   조용히 실패한다(`data/offseason.ts` `cashAfterImports`). 일정 탭에서 무거운 프리뷰를 돌리는 건 비용 폭증이라
   **비권장** → **FA 카드 정적 주의 문구** + 외인/아시아쿼터 화면의 "FA 예산이 달라집니다" 안내로 처리.
7. **라이브 드래프트 첫 픽 전 이탈** — `confirmedMyCount===0`이면 fast-forward가 안 걸려 처음부터 재생된다.
   허브에선 이탈이 흔하므로 **재개 선택("이어서 보기 / 처음부터")** 을 제공한다.

### 5.6.4 상비 가드

- **`tools/_dv_hub.ts`(신규)**: ①앞단·뒷단 각 단계에서 **일정 탭으로 나가는 출구가 존재**(체인 push 잔재 0 —
  앞단 화면에 다음 단계 `router.push` 없음) ②**개막 경로 상시 도달**(최종 버튼이 완료 조건에 게이트되지 않음)
  ③허브 카드 목록 = 위 표(위상별 라우트·순서) ④`draftSelections` 무효화 대칭(외인/아시아 레버 4종 포함 전 레버가 clear)
  ⑤ErrorBoundary가 오프시즌 라우트 전체 + 루트에 존재 ⑥경고 게이트가 확정 픽 0건일 땐 조용히 통과.
  **A/B 자가검증**: 구조를 되돌린 뮤턴트(체인 push 복원 / 최종 버튼 게이트 / 무효화 누락 / ErrorBoundary 제거)에서 전부 FAIL.

## 6. 오프시즌 오케스트레이션 (store.endSeason)

> **진행 게이트(2026-06-27 cache-persist 전환 · 정정 발견 모드 감사 2026-07-15)**: `endSeason`은 정규시즌이 **실제로 끝났을 때만**
> (~~전 경기 results 완비~~ → **내 팀 전 경기 완료** = `planNextAction(...).kind === 'seasonOver'`) 진행하고, 아니면 **즉시 return**(no-op).
> `planNextAction(schedule, teamId, …)`은 **내 팀 픽스처만 필터**(`homeTeamId===teamId || awayTeamId===teamId`, `engine/advance.ts:17`)하므로 게이트는 "리그 전체"가 아니라 "내 팀 잔여 경기 0". 확정 버튼 연타로 인한
> 시즌 2전진(더블탭)도 이 게이트가 차단(롤오버 후 results가 비워져 planNextAction이 다시 'match'를 돌려줌).
> → `setDay(164)`만으론 진행 안 됨(results를 채워야). 테스트 하네스도 전 경기 `recordResult` 후 endSeason해야(`_gt_derived` 2026-06-29 교정).

시즌 종료 → 다음 시즌 base를 만드는 **단일 합성 함수**. 단계(2026-06 갱신):

```
0)   시상식·마일스톤: currentSeasonAwards → archive에 영구 보존(AWARDS_SYSTEM),
     detectSeasonMilestones → milestones 적립(~~big 영구+일반 300건~~ → **티어드 롤링 캡**: league 500·club 1000·career-big 2000·비-big 최근 300건, 총 ~3800건 유계 — MILESTONE_SYSTEM §1.2, 발견 모드 감사 2026-07-15: big 영구보존이 시즌² 초선형 폭증을 유발해 2026-07-14 봉인됨),
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
