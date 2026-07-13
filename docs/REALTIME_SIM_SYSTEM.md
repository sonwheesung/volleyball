# REALTIME_SIM_SYSTEM — 전진 시뮬 + 결과 저장 전환 (B안)

> **결정(2026-06-27)**: 경기 파생상태(순위·생산)를 **켤 때마다 씨앗에서 재시뮬(게으른 재생)** 하던 방식에서,
> **시즌을 앞으로 한 번 치르고 결과를 저장 → 화면은 읽기만** 하는 방식으로 전환한다("실시간 + 저장").
> 동기(사용자): ① 재시뮬 **로딩(~1.8초)** 제거 ② 재생 과정 **버그 클래스** 제거.
>
> **이 결정은 `CLAUDE.md` 8·11장의 "무저장 결정론(재생 재계산)" 기둥을 부분 전환**한다(취소선 정정). 단,
> 재생 엔진은 **삭제하지 않는다**(아래 함정 G2) — 저장 위에 한 겹 얹는 구조다.

## 1. 독립 리뷰 결과 (review-plan, 2026-06-27) — 보존

리뷰어 권고는 **C(파생 캐시를 세이브에 영속) + 누수 버그 루트커즈**였다. 근거: ① 로딩은 이미 있는
인메모리 캐시(`baseVersion:txVersion`)를 세이브에 얹으면(=C) 더 싸게 해결 ② 버그는 아키텍처가 아니라
**모듈 전역 오염**이라 어느 안이든 루트커즈 필수, B는 오히려 *틀린 순위를 박제*할 위험 ③ B는 재생엔진을
못 지워 결국 C로 수렴 ④ "엔진 재튜닝 상실"은 과장(밸런싱은 `tools/sim*`가 세이브 안 읽음).

**사용자 결정: B 채택**(리뷰 권고 C를 기각). 기각 사유 기록(DOC_DISCIPLINE): 사용자는 "파생을 매번
재계산하는 모델 자체"를 줄이고 **저장된 사실을 진실로 다루는** 방향(누적 서사 철학에 부합)을 선호.
→ **단, 리뷰가 옳게 짚은 함정 7개를 B 구현의 하드 게이트로 강제**해 B의 위험(박제·폭주·불일치)을 차단한다.

## 2. 함정 게이트 (리뷰 ④ — 통과 못 하면 머지 금지)

- **G0 (최우선·선결) 모듈 전역 누수 루트커즈**: 시즌 종료가 변이하는 모듈 전역(선수진화 캐시·시상점수·관계
  컨텍스트·`commitPlayerBase` 등)이 in-process 재계산/새 게임에 잔존 → **저장 전에 반드시 수리.** 안 고치면
  틀린 값을 세이브에 박제(B가 A보다 나빠지는 지점). Phase 0.
- **G1 박스 폐기 강제**: per-match 박스/개인 생산은 시즌말 `accrueCareer`로 접고 **구조가 강제로 폐기**.
  규율 의존 금지 → **1만 시즌 세이브 크기 상한 가드**로 증명(bounded).
- **G2 재생엔진 유지**: 구 세이브(저장 순위 없음) 로드·새 시즌 첫 진입·**과거 경기 보드 재생**은 씨앗 재생 필요.
  삭제 불가 — 저장은 그 위 캐시 한 겹.
- **G3 보드 ↔ 저장 스코어 일관성**: 엔진 재튜닝 후 저장 3-1 vs 씨앗 재생 보드 3-2 불일치 → **엔진버전 태깅**,
  미스매치 시 재계산·덮어쓰기(또는 보드를 저장 박스로 재구성).
- **G4 마이그레이션**: `SAVE_VERSION+1` + 구 세이브 백필 단계 + `_dv_migrate`/`_dv_migrate_e2e` 케이스 추가.
- **G5 명시적 league-advance**: `currentDay` 진행과 동기해 **타팀 경기일을 굴리는 지점**을 명시(지금은 재생이 암묵 처리).
- **G6 archive.standings 등 무제한 점검**: 1만 시즌 × 팀ID 배열 latent — 이 기회에 bounded 정책 점검.

## 3. 단계 플랜

- **Phase 0 — 누수 루트커즈(G0)** ✅ **완료(2026-06-27)**: 근본원인 = **스태프 객체 in-place 변이 누수.**
  `hireAssistant`(`a.teamId=teamId`)·`assignCoach`(`c.teamId=...`)가 공유 객체(`LEAGUE.coaches/assistants`)를 변이하는데,
  `resetLeagueBase`가 `[...LEAGUE.x]`(얕은 복사=변이된 참조)로 복원 → teamId 안 돌아옴 → 다음 게임 영입 가드(`a.teamId!==null`)에
  걸려 **스타팅 코치 0** + 그 코치 효과 없어 **진화(수비 스킬) 비결정**(콜드 첫 게임만 코치 받음). **수정**: 시드 pristine
  스냅샷(`seedCoaches/Assistants/Scouts`)에서 매 복원 시 새 클론(`data/league.ts` resetLeagueBase·reseedLeague). 부수효과로
  **실제 게임플레이 버그도 해결**(새 게임이 스타팅 스태프 없이 시작하던 것). `_gt_determinism` 허위 A/B(setState merge + rosters는
  재구성가능한 나쁜 표적)도 복구(resetSave-clean 출발 + currentDay 표적). **검증**: `_gt_determinism` same-seed-twice=true·A/B=true·exit0,
  유닛 205·auditBoard 0·생산귀속 ALL PASS·스태프/시즌 가드 무회귀.
  - 진단 경로(추정 배제): base 변이 NO → 감독 동일 → myTeamStaff NO → "콜드 첫호출만 다름"(5792 vs 5789, 수비스킬) → 스타팅코치 콜드 ac7/웜 0 → in-place teamId 누수.
- **Phase 1 — 순위·생산 저장(G1·G2·G5)** ✅ **완료(2026-06-27)**: 계산된 시즌 결과(순위 ResultRow + 생산 ProdRow)를
  세이브에 저장→재로드 시 **재계산(로딩) 제거**. 구현: 모듈 캐시(`baseVersion:txVersion` 키)를 `data/simCache.ts`로
  캡처/복원 — partialize에 `simCache`(워밍된 것만, stale 저장 금지), rehydrate **맨 끝**(commit들이 카운터 bump한 뒤)에
  `restoreSimCache`로 카운터+캐시 복원→키 일치→히트. **재생 엔진 유지(G2)**: 상태 변경 시 키 불일치→자동 재계산.
  **G1**: 저장은 *현 시즌 계산결과*뿐(통산은 기존 careerTotals/archive) → 시즌 단위 bounded. saveMigration `simCache` 필드는
  폐기 가능(검증 실패/구세이브=null→재계산 폴백, 하드 마이그레이션 불요). 검증 `_dv_simcache`(재로드 재계산0·무stale(캐시==재계산)·
  A/B 실제사용) + 유닛205·_dv_migrate(_e2e) ALL PASS·결정론 OK·simAudit·auditBoard 무회귀.
- **Phase 2 — 보드 일관성(G3)** ✅ **완료(2026-06-27)**: `engine/match.ts ENGINE_VERSION` 상수 도입(경기 결과 바꾸는
  변경 시 +1). simCache가 버전 태깅 + 재로드 시 게이트 — **엔진 재튜닝(앱 업데이트) 후 버전 불일치면 캐시 폐기→새 엔진으로
  재계산**. 그래서 저장 순위·생산이 옛 엔진에 박제되지 않고, 과거 경기 보드 재생(항상 현 엔진)과 **같은 엔진 버전으로 일관**.
  구세이브(버전 없음)도 폐기→재계산(안전). 검증 `_dv_simcache` [6](버전 불일치+조작 캐시 폐기→재계산 원복).
- **Phase 3 — 마이그레이션·정리(G4·G6)** ✅ **완료(2026-06-27)**:
  - **G4 마이그레이션**: simCache는 **추가 필드 + 재생성 가능**(검증 실패/구세이브=null→재계산 폴백)이라 SAVE_VERSION 하드
    범프 불요. `saveMigration` 정규화기가 구세이브에 `simCache:null` 채움 → `_dv_migrate`·`_dv_migrate_e2e` ALL PASS.
  - **G6 무제한 배열(코드 검사 — 헤드리스 endSeason 구동 불가라 정적 분석)**: churn 데이터는 **이미 바운딩**
    (readNews 1500·interviews 200·milestones big+300·retirements 200·transfers 200). 무제한은 `archive`(시즌당 1)·
    `hallOfFame`(레전드당 1)뿐인데 **이 둘이 누적 서사 기둥(연표) 그 자체** — 엔트리당 작고(archive ~0.5KB/시즌·HOF
    ~0.1KB/레전드, 1만시즌 ~2000레전드) 1만 시즌 ≈ 저-MB(AsyncStorage 허용). **바운딩=기둥 위반이라 WAI(의도적 무제한).**
    simCache(Phase1)는 현 시즌만이라 bounded — **B가 세이브 폭주를 도입하지 않음.** (시도했던 `_dv_savesize`는
    store.endSeason 가드(planNextAction seasonOver)를 헤드리스로 못 넘겨 season=0 → 허위 오라클로 삭제, 자가검증으로 포착.)

---

## 5. 전환 완료 요약 (2026-06-27)

Phase 0~3 전부 ✅. **"진짜 실시간"(B안) 달성** — 게으른 씨앗 재계산 → 계산 결과 저장·재로드 시 읽기:
- Phase 0: 결정론 누수 근본수정(스태프 in-place 변이) + 새게임 스타팅스태프 버그 + 가드 A/B 복구.
- Phase 1: 계산된 시즌 결과(순위·생산) 세이브 저장 → **재로드 재계산(로딩) 제거**(재생 엔진은 변경 시 폴백 유지).
- Phase 2: 엔진버전 게이트(G3) — 재튜닝 후 옛-엔진 결과 폐기·보드 일관성.
- Phase 3: 마이그레이션 안전(추가/재생성 가능)·세이브 폭주 없음(churn 바운딩·연표는 의도적 무제한·작음).
검증 도구: `_gt_determinism`·`_dv_simcache`(+유닛205·_dv_migrate(_e2e)·simAudit·auditBoard 무회귀).

## 6. 후속 버그 — 시즌 시작 전 불필요한 콜드 재생 (2026-06-28)

**증상(사용자)**: 구단 선택 > 구단 정보 > 선수 클릭 = 폰에서 ~15초, 로딩도 없음. "실시간으로 바꾼 거 아니었냐?"

**근본원인**: B안은 *재로드 시 재계산 제거*(저장 결과 읽기)다. 하지만 **첫 콜드 계산 1회는 여전히 씨드 재생**(G2
폴백)이고, 구단 선택 플로우는 **세이브 없는 새 게임 + day0(경기 0개)**. 그 화면이 day0인데도 **세 갈래 전 시즌
재생**을 콜드로 돌렸다 — ① `getPlayerProduction`→`allProdRows`(전 경기 시뮬) ② `availableTeamPlayers`→`dyn()`(부상/거래
전 시즌 재생) ③ `popularityNow`의 `leagueProduction(day>0?day:**MAX**)` + `seasonScandals()`→`dyn()`. 셋이 겹쳐 ~15s.
"실시간 전환"과 모순 아님 — 전환은 재로드 비용을 없앤 것이고, 이건 **집계할 경기가 0인데 전 시즌을 시뮬한** 낭비.

**수정(시작 전엔 재생을 아예 안 탄다 — 셀렉터 가드)**:
- `data/production.ts leagueProductionRange`: 구간에 경기 0개(예: `leagueDisplayDay(0)=−1` → range[0,−1])면 `allProdRows()`
  호출 없이 즉시 빈 결과.
- `data/dynamics.ts`: `injuredOnDay/suspendedOnDay/rosterIdsOnDay/formFactorOnDay/teamInjuriesOn`에 `day<0` 가드(시작 전
  부상·정지·거래·출전이력 전무) → `dyn()` 회피.
- `data/owner.ts popularityNow`: 폴백 `:MAX`→`:−1`(시작 전 현시즌 생산 0=통산·수상만), 사건·사고 `seasonScandals()`는
  `day>0`일 때만(시작 전 0). → 콜드 시뮬 제거 + 안 치른 경기 스포일러 제거.
- `app/player/[id].tsx`: 시즌 파생(생산·role·정지·부상) 조회를 raw `currentDay`→`leagueDisplayDay(currentDay)`로
  (대시보드·기록과 동일 컷오프 + day0→−1로 위 가드 발동).

**결과**: day0 선수 화면 콜드 ~4200ms(데스크탑·폰 15s) → **~2ms**. 로딩 불필요(즉시).
**블라인드스폿(왜 못 잡았나)**: "실시간 저장하면 재계산은 끝"이라 여겨 **세이브 없는 시작 플로우의 콜드 1회**와
**day0에서 MAX로 폴백하는 인기/사건 경로**를 측정 안 함. 가드: `tools/_dv_preseason_cold.ts`(day0<500ms + A/B 중반 콜드>500ms).

### 6.1 dyn(부상/거래) 영속 — Phase1의 빠진 조각 (전수조사 발견, 2026-06-28)

전수조사 결과 **Phase1이 순위·생산만 영속하고 `dyn()`(부상·거래·출전이력 forward-pass)은 영속 안 함**을 발견.
→ **앱 콜드 스타트/리로드 후** `availableTeamPlayers`/`teamInjuriesOn`/`availableFAsOnDay`를 처음 부르는 화면
(대시보드·일정·선수단·이적)이 dyn을 **콜드 재생**(~1.4s·폰 ~7s)했다. 화면엔 로딩 게이트도 없어 그대로 멈춤.
(team 선택 세션은 `computeStandings(MAX)` 워밍이 dyn도 데워 안 보였고, **리로드 경로에서만** 콜드 — 그래서 늦게 발견.)

**수정**: `simCache`에 dyn도 영속(순위·생산과 동일 패턴). dyn은 Map 2개(played·teamDays)를 품어 JSON이 안 되므로
`data/simCache.ts`에서 **Map↔엔트리로 직렬화**(`serializeDyn`/`deserializeDyn`), `data/dynamics.ts`에 `getDynCacheRaw`/
`setDynCacheRaw` 추가. capture는 키 일치 시만(stale 금지), restore는 played/teamDays 둘 다 배열일 때만(구세이브/손상=폴백
재계산). `saveMigration` simCache 케이스에 dyn 모양 검증 추가. **G2/G3 불변**(키 불일치·엔진버전 불일치 시 폐기→재계산).
검증: `_dv_simcache`[7] dyn 영속(복원히트·재로드==원본·무stale·A/B·재계산복구) + `_gt_determinism`·`_dv_migrate(_e2e)` 무회귀.

> **이로써 리로드 후 대시보드/일정/선수단/이적의 콜드 dyn 재생이 사라진다 — 한 영속으로 네 화면 동시 해결.**

### 6.2 production 캐시 직렬화 누락 — "iterator method is not callable" 크래시 (Phase1 잠복 버그, 2026-06-28)

**증상(사용자)**: 대시보드 진입 시 Render Error `iterator method is not callable` — 스택 `buildNewsFeed`(news.ts) → `for (const [id,l] of mp.lines)`.

**근본원인**: `ProdRow`는 `homeIds: Set` · `lines: Map` · `starters: Set`를 품는데, **Phase1이 이걸 직렬화 없이 raw로 세이브에
저장**했다. `JSON.stringify`가 Set/Map을 **`{}`로 죽이고**, 재로드 시 `lines`가 빈 객체가 돼 `for..of mp.lines`가 터졌다.
(dyn은 6.1에서 Map을 직렬화했지만 production은 Phase1 때부터 누락 — 워밍된 production이 세이브에 박혀 재로드될 때만 발현.)

**수정**: `data/simCache.ts`에서 production도 **Set/Map↔배열 직렬화**(`serializeProd`/`deserializeProd`, dyn과 동일 패턴).
복원은 **신 포맷(lines=배열)일 때만**(`isSerializedProd`) — 구 손상 세이브(lines=`{}`)는 건너뛰어 **재계산 폴백**(크래시 차단).
SAVE_VERSION 하드 범프 불요(재생성 가능 — Phase3 정책).

**블라인드스폿(왜 검증이 못 잡았나)**: ① tsc — 타입은 `Map`(iterable)이라 통과, **런타임 JSON 손상은 정적분석 불가**.
② `simNews` 등 헤드리스 — **새로 계산한 production(진짜 Map)**으로 돌아 세이브→JSON→복원 경로를 안 탐. ③ `_dv_simcache` —
순위(평범 배열)만 sig로 검증하고 **production.lines를 복원 후 반복하는 검사가 없었다**(직렬화 라운드트립 사각). →
가드 추가: `_dv_simcache`[8] = production을 JSON 라운드트립 후 `lines` 반복(무크래시 + 재로드==원본). 형제: dyn(6.1)도 같은 검사 보유.

## 7. minAffectedDay 캐시 스플라이스 (Phase 4, 2026-07-08) — 파생 캐시 부분 무효화

**문제**: 파생 캐시(순위 `data/standings.ts allResults` · 생산 `data/production.ts allProdRows` · 부상/거래
`data/dynamics.ts dyn`)는 전부 `${baseVersion}:${txVersion}` 단일 키다. **어떤 bump(벤치 건의·시즌 중
이동·훈련방침 변경·스태프)든 키가 바뀌면 캐시 전체를 버리고 전 시즌을 재시뮬**한다(데스크탑 ~0.6s tx-only,
진화 재빌드 동반 시 ~2s / 폰 3~10×). 그런데 이 액션들은 **전부 forward-only** — 바꾼 날(fromDay/txDay)
이전의 경기 결과는 byte 불변인데 그 과거 행까지 통째로 다시 계산했다.

**핵심 불변식(감사 증명 2026-07-08)**: 각 무효화 액션의 영향 구간은 **접미(suffix) `[minDay, ∞)`**.
- 벤치 ADD = `fromDay`(`fromDay ≥ playedThroughDay+1` 강제 — A2/A3). 언벤치 = `toDay+1`(과거 보존, `toDay` 이후만 복귀).
- 시즌 중 이동(방출/영입/외인·아시아 교체) = `txDay`(= 그 시점 `currentDay`). 방출 취소 = 취소되는 tx의 `day`.
- 훈련방침 변경 = 새 세그먼트 `fromDay`(그 이전 진화·경기 byte 불변 — A4 forward-only).
- 스태프 선임/경질·commitPlayerBase·commitRosters·전지훈련·endSeason·reset·reseed = **0**(소급/전체 — 스플라이스 불가).

여러 bump가 재계산 전에 쌓이면 **MIN**(접미들의 합집합 = 최소 시작일부터의 접미)을 쓴다.

**스플라이스 오라클(절대 기준)**: 스플라이스 결과는 **전체 재계산과 byte(deep) 동일해야 한다.** 이게 안 되는
어떤 것도 스플라이스하지 않는다. 가드 `tools/_dv_splice.ts`가 ≥40 랜덤 액션열 × 시즌 진행 지점에서 매 액션 후
스플라이스 경로 == 강제 전체 재계산을 deep-equal 대조(+off-by-one minDay 변이 A/B로 도구 민감도 증명).

### 7.1 메커니즘
- **bump가 minAffectedDay를 나른다**: `data/spliceLog.ts`가 전역 단조 시퀀스(`seq`)와 bump 로그를 유지.
  `recordBump(minDay)` — minDay=0이면 로그를 절단(이전 bump는 전체 무효화에 포섭 → 메모리 바운드).
  `minAffectedDaySince(fromSeq)` = 그 seq 이후 bump들의 min. 각 캐시 엔트리는 계산 시점 `seq`를 저장.
  bump 지점(dynamics `setOwnerContext`/`setTxContext`/what-if, league `setFocusTimeline`/`invalidateStaff`/
  `commitPlayerBase`/`commitRosters`/reset·reseed·restore)이 각자 minDay로 `recordBump` 호출. 스토어 콜러가
  날(fromDay/txDay)을 넘긴다(이미 계산한 값) — 안 넘기면 기본 0(=현행 전체 재계산, 안전 폴백).
- **allResults/allProdRows 스플라이스**: 재계산 시 이전 세대 캐시가 있고 `0 < minDay < ∞`면 —
  `dayIndex < minDay` 행은 **그대로 재사용**, `dayIndex ≥ minDay`만 재시뮬. 최종 정렬·순서는 전체 경로와 동일.
- **러닝 상태 재구성(핵심)**: `allResults`의 하루 시뮬은 **러닝 순위**(로드매니지먼트 휴식이 day−1까지의 실제
  순위에 의존)를 날짜에 걸쳐 실어 나른다. 스플라이스는 이 상태를 **재사용 행에서 재구성**(재시뮬 아님) — 재사용
  행의 homeSets/awaySets로 `running[team]={wins,played}`를 다시 쌓아 minDay 진입 시점 상태를 복원한 뒤 이어 돈다.
  생산(`allProdRows`)은 러닝 상태를 자체로 나르지 않고 `restedOnDay`(→`teamClinch`→순위 캐시)에 의존하므로,
  순위 스플라이스가 byte-동일하면 생산의 재시뮬 구간도 올바른 휴식을 본다(캐시 자가치유 — 순서 무관).
- **영속 호환**: 스플라이스는 bump 사이의 **인메모리 최적화**다. `simCache` 영속 모양은 불변(seq는 비직렬화 —
  복원 시 현재 `spliceSeq()` 주입). `restoreSimCache`/`captureSimCache` 스키마 무변경.

### 7.2 스플라이스 안 한 것 (그리고 이유)
- **dyn(부상/거래) forward-pass = 전체 유지.** 부상은 그날 라인업의 RNG로 굴려 **미래로 캐스케이드**(span이
  뒤 경기를 깎음)라 접미 재사용이 byte-동일을 보장 못 한다. **그러나 dyn 재계산 비용의 지배항(evolveOnDay
  86%)은 아래 축1 콘텐츠 시그니처로 죽였다** — baseVersion bump 시 dyn 전체 forward-pass는 여전히 돌지만,
  그 안의 evolveOnDay가 안 바뀐 6팀 선수를 재사용하므로 콜드 비용이 급감(측정 §7.5). dyn 자체의 접미 스플라이스는
  여전히 미채택(캐스케이드 때문). 정답: dyn 전체 forward-pass는 유지하되 그 안의 진화를 시그니처로 재사용.

### 7.2.1 축1 — evoOneCache 콘텐츠 시그니처 캐싱 (2026-07-11, §7.2 "evo 메모 유보" 해제·정정)
> **정정**: 아래 "유보" 판단은 **날짜범위 분리**를 전제로 위험을 봤다. 실제 채택한 건 **팀/콘텐츠 분리**(키
> 정밀도만 상향, 날짜범위 미변)라 evolveOnDay 순수함수·결정론 핵심을 안 건드린다. 유보를 해제하고 구현했다.

- **문제**: 구 `evoOneCache`는 `baseVersion` 단일 세대키였다 — 어떤 bump(감독 영입·훈련방침·거래)든 baseVersion이
  오르면 **캐시 전체를 clear**. 그런데 evolveOnDay(base++)는 **완전 팀 분할**(그 선수 소속팀 focus/effects에만
  의존)이라 6/7팀은 입력 불변인데도 헛계산했다(폰 ~11s의 86% — 측정 `_ms_axis13`).
- **구현**: 엔트리마다 **선수별 진화 입력 서명**을 저장한다 — `{ base(참조동일), fsig(팀 focus 서명), esig(팀
  effects 서명), player }`. 조회 시 셋이 현재와 일치하면 재사용, 불일치만 evolvePlayer 재계산. baseVersion이 올라도
  **입력 불변 선수는 자동 재사용**(self-healing) → 6/7 헛계산 제거. `base`는 참조동일(commitPlayerBase가 새 객체로
  교체하면 자동 무효), fsig/esig는 `rebuildFocus`에서 팀별로 계산해 소속 선수에 배포(`teamFocusSig`: focusTimeline
  세그먼트 + 감독 타임라인의 그날 기본 focus). 로스터 밖(FA)은 센티넬 서명(focusOf=()=>DEFAULT_FOCUS 대응).
- **메모리 바운드**: 세대키 clear가 사라졌으므로 시즌 경계(commitPlayerBase/commitRosters/reset/reseed/restore)에서
  `clearEvoOne()`으로 비운다 — 시즌 중 액션(영입·훈련·거래·벤치)은 안 비워 재사용 유지, 크기 ≈ 선수수 × 조회날짜(1시즌분).
- **결정론 불변 증명**: `_dv_evosig`(신설) — (a) 감독/훈련 변경 후 캐시 경로 == clean 전체 재계산 **byte-동일**,
  (b) 팀 분할 변이(한 팀만 바꾸면 그 팀 선수만 변하고 나머지 6팀 byte 불변), (c) 재로드 forward-only 보존. 자가검증(A/B) 4/4.

### 7.2.2 축3 — 감독 효과 forward-only 날짜 splice (2026-07-11, 사용자 승인)
- **동기**: 시즌 중 감독 영입은 구 `invalidateStaff(true)→recordBump(0)`으로 **전체 소급 재계산**(126경기 재시뮬,
  폰 ~9s)이었다. 감독 효과(coachDefaultFocus·coachInfoOf)는 **날짜 무관=소급**이라 부임 이전 경기·성장까지 바꿨다.
- **구현**: `coachInfoOf`를 `coachInfoOf(teamId, day)` **day-aware**로, `coachDefaultFocus`를 부임일 기준
  **타임라인화**(`headCoachTimeline: teamId→{fromDay,coachId}[]`). 감독 부임일(hireDay) 이전 경기·성장은 **이전 감독**으로.
  `hireHeadCoach(teamId, coachId, hireDay)`가 부임일 세그먼트를 쌓고 `invalidateStaff(true, hireDay)`→`recordBump(hireDay)`
  → 순위·생산이 **자동 접미 스플라이스**(훈련방침과 동일 경로, day<hireDay 재사용). 소급/전체 이벤트(assignCoach·fireCoach·
  offseason reconcileStaff·reset·reseed)는 타임라인을 붕괴(day0=현재 감독) = 소급 유지(byte 불변).
  - **핵심 버그(가드가 잡음)**: 부임 baseline 세그먼트를 `coachId:null`(시드-잔류 폴백 의존)로 두면, 영입 시 시드 감독이
    `teamId=null`로 분리돼 폴백이 깨져 부임 이전이 DEFAULT_FOCUS로 샜다 → **부임 전 감독 id를 명시 캡처**로 수정
    (`pushCoachSeg`, `_dv_splice` G가 splice≠full로 검출).
- **세이브(가법·비파괴)**: `staffHeadTimeline`(partialize가 라이브 `getCoachTimeline()` 읽음, SAVE_DEFAULTS+KIND 등재).
  구세이브=필드 없음 → **commitStaff 빈 타임라인 = 소급**(=day0 백필 = 과거 byte 불변). 신세이브는 타임라인 복원 →
  재로드 후에도 forward-only 유지(`_dv_evosig` (c) + A/B가 영속 필드 실효 증명). SAVE_VERSION 하드범프 불요(가법 필드).
- **검증**: `_dv_splice` §G(신설) — 감독 영입(여러 부임일)·assignCoach·시퀀스(MIN)에서 splice==force-full **byte-동일** +
  forward-only 불변식(부임 이전 경기 byte 불변) + A/B(소급 day0은 과거 변화 → day-aware 실효). **정상게임(감독 영입 없음)은
  byte 불변**(30시즌 sim + 프레시시즌 순위·생산 sha256 before==after).

### 7.2.3 축2 — 팀 필터 경기 재시뮬 = 기각(결정론 불가)
- **로드매니지먼트 크로스팀 커플링**(`standings.ts` clinchStatus→pickRest): 굳은 순위 팀의 주전 휴식이 **팀 경계를 넘어**
  경기 결과를 커플한다(A팀 결과가 B팀 clinch를 바꿔 B팀 휴식이 바뀜). 팀 단위로 경기를 걸러 재시뮬하면 이 커플이 깨져
  **결정론(byte-동일) 불가** → 기각. 대체: 날짜 splice(전팀 [minDay,종료] 재시뮬 + 러닝순위 재구성, §7.1)가 안전하고
  축3가 감독 케이스를 그 경로로 흡수. (구 유보 문단은 아래 보존.)

<details><summary>구 유보 판단 보존(2026-07-08 — 정정 전 원문)</summary>

- **진화 메모(`evoOneCache`) 날짜범위 무효화 = 유보(deferred).** 유혹: 훈련방침 변경(base++)은 fromDay 이전
  진화가 불변이라 `day < fromDay` 메모 엔트리를 살릴 수 있다. **그러나** `evoOneCache`의 세대 키가
  **baseVersion에 결합**돼 있어(`evoOneKey !== _baseVersion`이면 통째 clear) 날짜범위 부분 무효화를 하려면
  세대키를 baseVersion에서 **분리**해야 하고, 그 변경은 evolveOnDay의 결정론 핵심을 건드려 침습적·고위험이다.
  반면 실익은 **훈련방침 변경(base++) 케이스 한정** — 그마저도 dyn의 전체 forward-pass(1,308ms cold evo)가
  지배해 메모 스플라이스만으로는 못 줄인다.
  → **해제(2026-07-11, §7.2.1)**: 날짜범위 분리가 아니라 **콘텐츠 서명**(팀/입력 분리)로 구현 — 세대키를 날짜로 안 쪼개고
  입력 동일성만 판정하므로 evolveOnDay 순수함수 미변. 유보 사유(침습성)가 해소됨.

</details>

### 7.5 축1+축3 성능 A/B (측정 `tools/_ms_axis13.ts`, 데스크탑 콜드·중앙값3, 2026-07-11)
같은 코드에서 OLD(전체 재시뮬 = 옛 감독영입 recordBump0 + evoOneCache 전체 clear) vs NEW(스플라이스+시그니처 재사용):

| 액션 | 진행 | OLD(full) | NEW(opt) | 절감 | 폰추정(×5) |
|---|---|---|---|---|---|
| 감독 영입 mid-season | 초반 d40 | 3919ms | 1324ms | 66% | 19.6s→6.6s |
| 감독 영입 mid-season | 중반 d110 | 4329ms | 939ms | 78% | 21.6s→4.7s |
| 감독 영입 mid-season | 종반 d160 | 4098ms | 414ms | 90% | 20.5s→2.1s |
| 훈련방침 mid-season | 종반 d160 | 3670ms | 454ms | 88% | 18.4s→2.3s |

목표(폰 20~30s→한자릿수) 달성. 늦은 시즌일수록 재사용 커 절감 큼(부임일 접미 = 과거 대부분 재사용).

### 7.3 오프시즌 프리뷰 메모 분리 (탭당 ~2s 근본 수정)
**문제(UI 진단)**: 외인/아시아 트라이아웃·FA 센터에서 위시/보호/영입 **토글 한 번**마다 `buildDraftContext`/
`faMarketPreview` useMemo가 통째 재실행 → **리그 전 선수 롤오버+은퇴 스냅샷**(`buildOffseason`, 무거움)을 매번
재빌드. 그 스냅샷은 토글과 **무관**(안정 deps: my·season·resignDecisions·contractOverrides·ownerFx)하고, 정작
토글이 바꾸는 건 **가벼운 해결**(트라이아웃 지명·FA 경쟁 resolve)뿐이었다.

**수정 — 스냅샷/해결 2단계 분리**(`data/offseason.ts`):
- `buildOffseasonBase(my, resignDecisions, overrides, nextSeason, ownerFx)` = 무거운 안정부 → `buildOffseason`
  결과 + prevTeamOf/prevForeignOf/prevAsianOf + prestige. **메모 가능**(안정 deps).
- `resolvePreDraftFrom(base, …토글)` · `faMarketPreviewFrom(base, …토글)` · `buildDraftContextFrom(base, …토글)`
  = 가벼운 해결부. **base의 snapshot/rosters를 clone 후** 트라이아웃/FA를 굴린다(트라이아웃·FA가 snapshot/rosters를
  **변이**하므로 메모된 base 보호 — 이 clone이 유일한 차이, 값은 byte-동일).
- 기존 `resolvePreDraft`/`faMarketPreview`/`buildDraftContext`는 `base 빌드 + …From`의 합성으로 **시그니처·결과
  불변**(byte-동일, 가드 `_dv_splice` §3 프리뷰 상등으로 증명).
- 앱(`app/tryout.tsx`·`app/asian-tryout.tsx`·`app/fa.tsx`)은 useMemo를 둘로 쪼갬 — base 메모(안정 deps) + resolve
  메모(base + 토글). 토글은 resolve만 재실행(싼 쪽). `app/draft.tsx`/`draft-live.tsx`는 이미 안정 deps 메모(조정 C) — 무변경.

### 7.6 경기 개입 스냅샷 정책 (계획 2026-07-12, 정본 `docs/MATCH_INTERVENTION_SYSTEM.md` §2)
아직 **미구현(설계만)**. B안 방향("계산 결과를 세이브에 저장하고 재로드 시 읽기", 2026-06-27)의 자연 연장.
- **개입 경기 결과 박제**: 구단주가 개입한 내 팀 경기는 **최종 세트스코어 + 박스(BoxSink)를 세이브에 스냅샷**한다.
  순위(`standings.ts`)·생산(`production.ts`)·시상이 그 스냅샷을 **읽고 재시뮬하지 않는다** → ENGINE_VERSION 재튜닝
  드리프트 면역("내가 본 결과 ≠ 재시뮬 결과" 방지). production 캐시가 이미 전 리그 박스를 영속하므로 저장 증가 미미.
- **캐시 무효화 축 등록**: 개입 로그(`interventions`) 변경 시 `setOwnerContext` 동형으로 **`txVersion++` +
  `recordBump(fixture.dayIndex)`**. 개입은 항상 관전 중(=currentDay) 경기라 minAffectedDay=그 경기일 →
  **forward-only 접미 bump**로 §7.1 스플라이스 불변식과 정합(과거 소급 없음). 안 하면 캐시 키가 안 변해 순위 스테일.
- **재관전 재생**: 개입 보드는 개입 로그를 재생(프리픽스 불변, MATCH_INTERVENTION_SYSTEM §3). 결과는 스냅샷이 진실.

> **정정(2026-07-13, 구현)**: ~~스냅샷 박제~~는 구현 시 **순수 로그**로 대체됨(MATCH_INTERVENTION_SYSTEM §2.2). 개입 로그를
> 모든 sim 호출부(관전·순위·생산)에 동일하게 실어 split-brain을 원천 차단(`_dv_intervention_consistency` 증명). **캐시
> 무효화 축 등록(위)은 그대로 구현**(`data/dynamics.ts setInterventionContext` = txVersion++·recordBump). 스냅샷 동결은 출시 후 하드닝으로 유보.

### 7.7 currentDay high-water cap — 시즌초/콜드 지연 최적화 (설계 2026-07-13, 독립 리뷰 검증)
**문제**: `data/standings.ts allResults()`·`data/production.ts allProdRows()`는 인자 없이 **전 시즌 126경기(미래 포함)를 시뮬**한 뒤
`seasonResults(uptoDay)`가 사후 필터링만 한다. 대시보드 표시는 이미 `displayCutoff`(currentDay 바운드)인데, **인트로 워밍
`app/_layout.tsx warmCachesForIntro`가 `computeStandings(MAX)`+`leagueProduction(MAX)`로 전 시즌을 콜드 시뮬**해 시즌초(day0=0경기인데도)·엔진버전 범프 후 첫 콜드에 지연을 만든다. (사용자 관찰 2026-07-13.)

**cap 축(§7.1 스플라이스와 다른 축)**:
- **스플라이스 = 후방 무효화**(`dayIndex<minDay` 재사용, `≥minDay` 재계산).
- **cap = 전방 확장**(`≤computedUpto` 재사용, `(computedUpto, 요청cap]` 신규). day 루프가 **인과적**(day D는 day<D만 참조 —
  `running`·`clinch(day-1)`·`pickRest(seed rest:team:day)`·`interventionsFor` 전부 그날/과거 국소, 미래 참조 0개)이라
  cap 이하 행은 풀 시즌 계산과 **byte-동일**(독립 리뷰 무조건 성립 판정).
- **합성**: 캐시가 K까지 계산 → tx bump로 minDay<K 무효화 → K'>K 요청. `reuse` 필터가 `minDay`(splice)∩`cap` 동시 존중,
  조기반환(`standings.ts:61`)을 `key 일치 && computedUpto≥cap`으로 일반화. **computedUpto 워터마크는 in-memory 명시 필드**(비영속 —
  행의 max dayIndex 유도 가능하나 경기 없는 gap 재시도 회피). 세이브 스키마 변경 없음.

**~~축2 팀 필터~~는 여전히 기각**(§7.2.3, 로드매니지먼트 크로스팀 커플로 "두 팀만 독립" 결정론 불가). cap은 "currentDay까지 순차"라 안전.

**워밍 콜러 전환**: `app/_layout.tsx`·`app/team/[id].tsx`·`app/training-policy.tsx`의 MAX → `displayCutoff(currentDay, results, teamId)`.
시즌말/오프시즌 MAX 콜러(endSeason·offseason·draft·playoffs·financeProjection·rosterTarget)는 그때 currentDay≈SEASON_DAYS라 무해.
**단 "워밍 인자만 바꾸고 cap 없으면 무효"**(seasonResults가 여전히 allResults() 풀 계산 후 필터) — **cap이 핵심 프리미티브**.

**개입 정합**: 개입 로그는 played 경기(≤playedThroughDay≤cap)에만 있어 잘리지 않음.

**신규 가드(필수, 커밋 전 0건)**: ①부분요청 K → 확장 K' == fresh 풀-후-필터 byte-동일 ②cap∘splice 합성(K→minDay<K bump→K'') == fresh
③day0/시즌경계 cap. `_dv_splice`(MAX만 커버)는 유지.

**구현 순서**: (1) cap 파라미터+워터마크 코어 → (2) 새 가드 작성 후 현행 GREEN(오라클 신뢰) → (3) 조기반환/reuse 합성 일반화 →
(4) 가드로 cap∘splice byte-동일 A/B → (5) 워밍 3곳 전환 → (6) 콜드 벤치 절감 실측 + 풀 배터리 0건 → 커밋.

**구현 완료(2026-07-13)**: `data/standings.ts allResults(uptoDay?)`·`data/production.ts allProdRows(uptoDay?)`에 cap 파라미터 +
`computedUpto` 인메모리 워터마크. 조기반환을 `key 일치 && computedUpto≥cap`으로 일반화, 재계산 시작일
`reuseThreshold = min(minDay, prev.computedUpto+1)`로 **splice(후방)∩cap(전방)을 한 경로에서 합성**(clamp가 gap 누락 방지).
`seasonResults`/`leagueProductionRange`/`seasonMatchProds`가 자기 cutoff를 cap으로 전달. 워밍 3곳(`_layout.tsx`·`team/[id].tsx`·
`training-policy.tsx`)을 MAX→`displayCutoff`로 전환(시즌말/오프시즌 MAX 콜러는 무변경 — currentDay≈SEASON_DAYS라 무해).
computedUpto는 비영속 — `set*CacheRaw`가 복원 시 행의 max dayIndex로 유도(안전 하한). 가드 `tools/_dv_cap.ts`(①확장등가 ②cap∘splice
합성 ③day0/시즌경계, 16/16 PASS) + `_dv_splice`·`_dv_intervention_consistency`·`_dv_displaycutoff` 무회귀. 측정 `tools/_ms_cap.ts`.

### 7.8 endSeason 자기-무효화 제거 — 시즌 전환 로딩 117초 수정 (설계 2026-07-13, #111)

**문제(온디바이스 실측 — 에뮬 시즌3→4, [ESPERF] 블록 계측)**: 시즌 시작 로딩(`app/season-start.tsx`의 `endSeason()`)이
**117.5초**, 그중 **A블록(정산+끝난시즌 리플레이)이 111.5초(95%)**. B `buildDraftContext` 5.7s · C 드래프트+생산 0.2s · D 뉴스/HOF 0.05s.
(개막 브리지 ~20s는 **별도 조사** — 본 절 범위 밖.)

**원인(트레이스 확정)**: endSeason이 **끝난 시즌 리플레이 캐시를 스스로 무효화한 뒤 다시 읽는다**.
```
974  currentSeasonAwards(season)        ← 읽기(캐시 warm이면 저렴)
986  commitRosters(finalR)              ← _baseVersion++ + recordBump(0) = 소급 전체 무효화 ★자기-무효화
1004 buildPlayoffs → computeStandings(MAX)   ← COLD 풀 재시뮬 #1 (126경기)
1022 leagueProduction(MAX)              ← COLD 풀 재시뮬 #2 (별도 캐시, 또 126경기)
1038/1041/1096 동일 호출               ← #1·#2 뒤라 warm(무해)
```
standings·production은 **각자 simulateMatch 전 시즌 루프를 도는 독립 캐시**라 무효화 1회 = 풀시뮬 **2회**.
진입 시점에 이미 cold면(결산 화면 워밍이 안 살아있으면) awards에서 +2회 → **최대 4회**. 에뮬 JS(Hermes)에서 풀시뮬
1회 ≈ 수십 초(데스크탑 ~3.6s의 8~15배) → 111s와 정합.

~~**핵심 계약(수정의 전제, 검증 대상)**: `commitRosters(finalR)`는 **끝난 시즌의 리플레이 결과를 바꾸지 않는다**~~
→ **정정(2026-07-13, 독립 리뷰 — 실측으로 거짓 판정)**: 리뷰 세션이 실제 스토어를 구동해 검증한 결과(CASE0 tx0건
=byte-동일 sanity PASS · CASE1/2 시즌 중 방출/영입 주입 = **day4 첫 매치데이부터 불일치**), `commitRosters(finalR)` 후
`dynamics.compute()`가 `currentRosters()=finalR`에서 시작해 **시즌 중 이동이 day0부터 소급 반영**되고 기존 tx는
applyTx 소속 가드에 no-op이 된다(+`rebuildFocus()`가 이적자 훈련방침을 새 팀 day0부터 적용 → 진화까지 상이).
즉 커밋 뒤 리플레이는 "방출자가 첫날부터 없는 **다른 우주**"다.

**재프레임 — 이것은 성능 이슈이기 전에 잠복 정합 버그다(기둥2 직격)**: 현행 endSeason은 같은 archEntry 안에서
awards(974, 커밋 전=관전 우주)와 standings/record/streaks/playoffs(1004~, 커밋 후=재작성 우주)를 **섞는다**.
tx 시즌엔 **유저가 본 챔피언 세리머니 ≠ archive championId** 가능, `seasonInjuryDays`(1003)도 커밋 후라 유저가
본 시즌에 없던 부상으로 점프력 영구 하락 가능. 따라서 이 수정은 "byte-동일 성능 리팩터"가 아니라
**"관전 우주 복원(버그 수정) + 성능"**이다 — tx 시즌에선 산출물이 (옳게) 달라진다.

**리뷰 추가 발견 — 최소 재정렬은 성능 목표 미달**: bump는 986뿐이 맞지만, `upcomingStanceOf`(1076)와
**B블록 `buildDraftContext` 내부**(`importPerfCtx`→leagueProduction(MAX)·`teamPrestige`→computeStandings+buildPlayoffs·
`upcomingStances`·`standingsWorstFirst`)가 전부 **커밋 뒤에 끝난 시즌을 읽는다**. B가 5.7s였던 건 A블록(1004/1022)이
커밋-후 캐시를 데워놨기 때문 — 읽기만 앞으로 올리면 **콜드 풀시뮬 1쌍이 B블록으로 이사**해 순 이득 ≈ 0.
부수: B가 재작성 우주를 읽는 것 자체가 "미리보기(커밋 전)=결과" 약속의 tx 시즌 잠복 위반.

**수정안(리뷰 채택 — 2단계)**:
- **1단계 (a′) 커밋 한 줄 이동**: 읽기를 올리는 대신 **`commitRosters(986)`를 `buildDraftContext` 직전(~1080)으로
  내린다**. 974~1076의 상대 순서가 전부 자동 보존(순서 함정 원천 차단), A블록 풀시뮬 0회, 정합 버그(챔피언·부상·archive
  혼합 우주) 수정. 단 하나 얽히는 읽기 **1023 `currentRosters()[my]` → `finalR[my]`로 명시 치환**(현행 의미 보존.
  1065 myPayroll은 이미 finalR[my] ✓). 988~998 외인 캡처 getPlayer는 playerMap 읽기라 무관 ✓.
- **2단계 (a″) B블록 입력 주입**: endSeason 로컬(생산 map·최종 순위·championId·stances)을
  `buildOffseasonBase`/`resolveFAMarket`에 **옵션 파라미터(ctx 객체)**로 전달(기본값=현행 라이브 읽기 → FA/드래프트
  프리뷰 호출부 무변경). **풀시뮬 0회 달성 + 전 구간 관전 우주로 기준 통일 + "미리보기=결과"가 tx 시즌에도 성립.**
- 기대 효과: warm 진입 endSeason 풀시뮬 **0회**(1단계만으론 B에 1쌍 잔존 — 2단계까지 해야 목표). 1096 seasonProd는
  캡처 const 재사용. 111s → 수 초(실측 확정). 캐시 프리미티브(§7.1·7.7)·세이브 스키마 무변경.

**비채택 대안(리뷰 판정)**: ①산출물 세이브 영속 — (a″) 후 콜드 진입도 simCache 영속 복원으로 warm이라 필요성 급감,
Phase2 보류 유지. ②endSeason 청크화 — 낭비 자체를 안 없앰(§5.5 D와 별개). ③**recordBump 조건부 완화(기각)** —
"재계산하면 다른 값이 나올 캐시를 정답으로 선언"이라 §7.1 스플라이스의 byte-동일 계약을 의도적으로 깨는 선례.

**신규 가드(리뷰 재설계안 채택, 커밋 전 0건)**: `_dv_endseason_order.ts` —
(a) **tx 0건 시즌**: 수정 전/후 산출물 byte-동일(무해성) (b) **tx 주입 시즌**: 산출물 == **커밋 전 캡처값(관전 오라클)**
+ 구 경로와 **다름 확인**(수정의 teeth — 리뷰 도구 CASE1/2 골격 이식) (c) 변이: 읽기 하나를 커밋 뒤로 되돌리면 FAIL
(d) **simulateMatch 호출 카운터** — warm 진입 endSeason 내 풀시뮬 0회 단언(byte 가드가 못 잡는 "느리지만 맞는" 회귀용)
(e) tx 시즌 **챔피언 세리머니 id == archive championId**(유저 가시 불변식) (f) tx 시즌 **FA 프리뷰 ctx == endSeason ctx**
(미리보기=결과). ~~finalR 가짜 이동 주입 변이~~(불필요 — 진짜 이동이 이미 차이를 만든다, 리뷰 판정).
기존 배터리(`_gt_determinism`·`_dv_splice`·`_dv_cap`·`_dv_intervention_consistency`·`_ev_endseason_guard`) 무회귀.

**구현 순서**: (1) 가드 작성 — tx0건 GREEN + tx 시즌은 **현행이 관전 오라클과 다름을 먼저 기록**(버그 재현 고정) →
(2) 1단계 커밋 이동+1023 치환 → 가드 (a)(b)(c)(e) GREEN → (3) 2단계 ctx 주입 → (d)(f) GREEN + 풀 배터리 0건 →
(4) 온디바이스 [ESPERF] 재계측(117s → 목표 <10s) → 커밋. **검증 없인 커밋 금지**(STATS_PROTOCOL 0장).

**B블록 재계측(온디바이스 시즌5→6, 2026-07-13, [ESPERF-B]/[ESPERF-B2] 세부 계측)**: 2단계 ctx 주입 후에도
`buildOffseason` 초입이 **106,972ms / buildOffseason 107,080ms(≈99.9%)** — 원인 = 커밋 후 `seasonScandals()`→`dyn.compute()`
**콜드**(전 시즌 매치데이 전진 패스, 데스크톱 1,466ms / buildOffseason 1,586ms = 92%). 커밋(commitRosters)이 baseVersion을
범프해 dyn 캐시(`${baseVersion}:${txVersion}`)를 무효화한 직후 buildOffseason이 lostDays/repMap용으로 dyn을 처음
건드려 재시뮬을 튕긴다. 정합 관점에서도 버그: 커밋 후 dyn은 finalR(시즌 중 이적 반영) day-0 기준으로 사고 롤을 다시
굴려 유저가 본 스캔들과 다른 우주가 된다(FA 영입자가 관측 우주에 없던 day-0 사고를 받을 수 있음).
**수정 = `SeasonCloseCtx.scandals`(커밋 전 `seasonScandals()` 캡처) 주입**(기존 prod·standings·championId·stances와 동일
§7.8 패턴) — 커밋 후 dyn 콜드 재계산 회피 + 관측 우주 스캔들 정합. 미제공=라이브 폴백(프리뷰 화면 경로 byte-동일).
커밋 후 `scandalRepMap()`/`seasonScandals()`(=dyn 셀렉터) 호출자 전수조사(측정 확인 — [ESPERF-B2] 콜드 로그 관찰): **두 곳**
`buildOffseason`(초입 lostDays/repMap)과 `resolveFAMarket`(:220 repMap) 뿐 — **양쪽 다 `scandalRepMap(close?.scandals)`로 주입**해야
콜드가 사라진다(`buildOffseason`만 고치면 커밋 후 첫 dyn 트리거가 `resolveFAMarket`으로 **이주**해 1,422ms 콜드가 그대로
재발 — 실측 확인). tryout·draftClass·rosterTarget·endSeason D블록은 dyn(스캔들) 무호출. 수정 후 `_dv_endseason_order` 재실행:
buildOffseason 이후 `dyn.compute COLD(baseVersion+1:*)` 0회(이전엔 1,422ms 1회) + 15/15 가드 PASS(결정론·관측우주 정합 불변).

**최종 온디바이스 확증(동일 에뮬 Hermes, 2026-07-14, [ESPERF] 블록 계측 — 이후 임시 계측 전면 제거)**:
- **수정 전(시즌 5→6)**: endSeason 총 **110,882ms** — A(정산+시즌 리플레이) 3,630 / B(buildDraftContext) 107,080
  {그중 buildOffseason 106,972 = `seasonScandals()`→`dyn.compute()` **콜드** 재계산} / D(드래프트·HOF·감독·뉴스) 171.
- **수정 후(시즌 6→7, 동일 기기)**: 총 **13,014ms (8.5배 개선)** — A 5,593 / B 6,939{scandals **0ms**·rolloverLeague 6,427·
  트라이아웃 192·FA 97·드래프트 클래스 113} / D 451. dyn 콜드 재계산 **소멸**.
- 잔여 비용은 `rolloverLeague`(전 선수 풀시즌 진화 — 캐시 불가한 고유 연산)와 A블록(정산 리플레이)이며, §7.8이 겨눈
  **자기-무효화 콜드 풀시뮬(A블록 표준시뮬 2~4회 + dyn 콜드)은 전부 제거**됐다.
- 검증: §7.8 가드 `_dv_endseason_order` **15/15** · 풀 배터리 6종 PASS · tsc 클린(기존 3건 `_dv_focus`×2·`keyFaces` sharp 외 무증가) ·
  데스크톱 `buildDraftContext`(주입) **1,599→99ms**. 이 확증 후 `[ESPERF]`/`[ESPERF-B]`/`[ESPERF-B2]` 임시 계측은
  전 소스에서 제거(영구 검증 훅 `engine/match.ts debugSimCalls`는 가드 `_dv_endseason_order`가 쓰므로 존치).

### 7.9 진화 점진 캐시(c1) — evolveOnDay 콜드 준이차 제거 (설계 2026-07-14, #113, 독립 리뷰 채택)

**문제(§7.8 후속 실측)**: §7.8로 endSeason 내 자기-무효화 콜드 풀시뮬·dyn 콜드는 제거됐으나, **시즌 전환 로딩 잔여
79.8초**는 endSeason `set()` 이후 **새 시즌 첫 렌더의 `data/dynamics.ts compute()` 콜드**다. compute()는 전 매치데이를
전진 패스하며 매일·매팀 가용선수마다 `evolveOnDay(id, d)`를 부르는데(§dynamics 216행), 각 콜드 호출이 **base(day0)부터
재계산 O(day)** 라 시즌 합계가 **준이차(≈O(day²))**. 데스크톱 §7.8 dyn 콜드 1,466ms의 **92%가 이 진화 전진 패스**.

**은닉 상태 분석(수정의 결정론 전제, 리뷰가 코드로 검증)**: `engine/progression.ts evolvePlayer`는 일 단위 폴드다 —
per-player RNG 스트림(`createRng(playerSeed(id))`)을 소비하며 day 0..days를 진행. 은닉 상태는 **정확히 2개**뿐:
(1) `Player`(p.xp 성장/노쇠 바 포함 — 스냅샷에 다 있음), (2) **RNG 스트림 위치**(uint32). `engine/rng.ts`의 mulberry32는
상태가 단일 uint32 `s`라 `rng.state()`로 직렬화·`createRng(state)`로 **byte-동일 재개** 가능. 이 둘을 체크포인트에
저장하면 임의 지점에서 이어달릴 수 있고 base-콜드와 byte-동일이 보장된다. (age는 일 루프 중 불변 — `ageOneSeason`은
시즌 경계에서만 적용되므로 span 내 aging rate 상수. training은 매일 rng 소비, aging은 peakAge 이후에만 소비 —
소비량은 선수 포지션·나이로 결정론.)

**채택 설계(2요소)**:
1. **`engine/progression.ts evolveSpan(p, rngState, focus, effects, skip, fromDay, toDay) → { player, rngState }`**:
   기존 evolvePlayer 일 루프를 **절대일(fromDay..toDay−1)** 기준으로 분리. `focusAt(d)`에 **절대일 전달**(상대 오프셋 금지 —
   시즌 중 방침/감독 변경 타임라인 desync 방지, 리뷰 R3). `skip`(출장정지 프런트로드 경계)도 절대일 `d >= skip`로 판정 →
   체크포인트가 skip 구간 안에 걸쳐도 정확(리뷰 R5). `evolvePlayer(base, focus, days, effects, lostDays)` 공개 시그니처
   **불변** = 얇은 래퍼(`evolveSpan(base, initialEvoRngState(base.id), …, skip, 0, days).player`) → 기존 호출부·회귀 byte-동일.
2. **`data/league.ts evolveOnDay` 체크포인트 재개**: per-id 체크포인트 `{ day, player, rngState, base, fsig, esig }`
   (가장 먼 day 하나만 유지 — 리뷰 R4). 요청 `day ≥ checkpoint.day` **&** base 참조동일 **&** fsig/esig 동일 →
   `evolveSpan(checkpoint→day)`로 O(Δday) 재개 후 체크포인트 전진. `day < checkpoint.day` 또는 서명 불일치 →
   기존처럼 base-콜드(폴백, 리뷰 R2), 서명 일치 시 체크포인트는 max-day 유지. 기존 `evoOneCache((id,day)→Player)`는
   **정확일치 fast-path로 병존**(반환값 byte-동일), `clearEvoOne()`(시즌 경계)에서 체크포인트도 함께 클리어. `evolveOnDay`
   경로는 `skip=0`(출장정지 프런트로드 없음)이라 R5 비대상 — evolveSpan에 skip=0 전달(주석 명시). A/B 레버
   `NO_EVORESUME` env → 재개 무력화(콜드 폴백, 측정·회귀 방어).

**기각 대안(리뷰 판정)**: ①**게이트 플래그(콜드만 캐시)** — 준이차 자체를 안 없앰(여전히 매 콜 O(day)). ②**호출 스택
정리(compute 내 evolveOnDay 병합)** — 리팩터 위험 크고 dyn 외 호출부(FA 프리뷰·화면)엔 무효. ③**청킹(레그 단위
분할)** — 경계마다 여전히 base 재계산, O(day²) 상수만 낮춤.

**결정론 논거**: 은닉 변수는 Player+RNG 위치뿐이며 mulberry32 상태는 단일 uint32라 완전 직렬화. `evolveSpan(0→d1)`
→`(d1→d2)` 합성이 `evolvePlayer(0→d2)`와 전 스탯·xp·rngState까지 byte-동일(가드 오라클). 서명(fsig/esig)은 축1(§7.2.1)의
콘텐츠 서명 재사용 — focus/effects 입력이 바뀌면 재개 무효화. 캐시 프리미티브(§7.1·7.7·7.8)·세이브 스키마 무변경.

**신규 가드**: `tools/_dv_evoresume.ts`(이빨 필수) — (1) **합성 오라클**(N≥10,000, 선수×d1<d2): 어린 선수(peakAge 이전,
노쇠 롤 0회)·노장(4+회)·시즌 중 방침 세그먼트 경계·스태프 효과·FA 센티넬·skip>0 전부에서
`evolveSpan∘evolveSpan == 풀 evolveSpan == evolvePlayer`(player+xp+rngState deep-equal). (2) **이빨 A/B**: "순진 재시드"
(재개 시 rng 새 시작)와 "상대일 focus"(R3) 변이가 오라클을 **FAIL시킴**을 증명(허위 오라클 차단). (3) **evolveOnDay
시퀀스**: 오름차순+중간 내림차순 섞인 day 질의가 전부 base-콜드와 byte-동일(체크포인트 재개·역행 폴백 실증).
측정: `tools/_ms_evoresume.ts`(dyn 콜드 A/B, NO_EVORESUME 토글).

### 7.4 검증
- `tools/_dv_splice.ts`: ①byte-상등 프로퍼티(≥40 랜덤열, 매 액션 후 splice==force-full deep-equal, 순위+생산)
  ②결정론 ×2 ③타이밍(늦은 시즌 벤치 add에서 splice ms ≤ ~20% full) ④off-by-one minDay 변이 → FAIL(민감도)
  ⑤프리뷰 상등(split-path == 옛 monolithic) + 토글 재실행 << 스냅샷 빌드 타이밍
  ⑥**§G 감독 스플라이스(축3, 2026-07-11)**: 감독 영입(여러 부임일)·assignCoach·시퀀스(MIN)에서 splice==force-full byte-동일 +
    forward-only 불변식(부임 이전 경기 byte 불변) + A/B(소급 day0은 과거 변화 → day-aware 실효).
- `tools/_dv_evosig.ts`(신설, 축1): (a)시그니처 캐시 재사용 == clean 재계산 byte-동일 (b)팀 분할 변이(한 팀만 바꾸면 그 팀만 변함)
  (c)감독 forward-only 재로드 보존 + 각 A/B 민감도(4/4). `tools/_ms_axis13.ts`(측정, 축1+축3 A/B 콜드 ms).
- `tools/_dv_cap.ts`(신설, §7.7 cap): ①부분(K)→확장(K') byte-등가 ②cap∘splice 합성(minDay<K bump→K'') == fresh
  ③day0/시즌경계(-1=∅·0→SEASON_DAYS·SEASON_DAYS==MAX). computedUpto 워터마크 진행 진단 포함(16/16 PASS). `tools/_ms_cap.ts`(측정, 콜드 워밍 절감 A/B).
- 풀 배터리(run-all-tests): tsc·유닛·auditBoard·`_dv_batch_*`·`_dv_bench(2)`·`_dv_displaycutoff`·`_dv_focus`·
  `_ev_suggest_defer`·checkSubs·`_dv_campoutbox`·`_dv_migrate_e2e`·simNews·`_dv_drift_kovo`·`_gt_determinism`·
  `_dv_splice`(§G)·`_dv_evosig` 무회귀. **정상게임 byte 불변 증명**: 30시즌 sim + 프레시시즌 순위·생산 sha256 before==after.

## 4. 검증 (각 Phase 통과 조건)
- Phase 0: `_gt_determinism` in-process 2회 동일 + A/B 이빨 복구. 풀 배터리(run-all-tests) 0건.
- Phase 1: 저장값 == 재생값(드리프트 0, 전환 검증) · 1만 시즌 세이브 크기 상한 가드 · KOVO 분포 불변.
- Phase 2: 저장 스코어 == 보드 재생(엔진 동일 시 100%, 재튜닝 시 정책대로).
- Phase 3: `_dv_migrate_e2e` 구→신 세이브 무손실.

> 추정 금지·A/B 필수(STATS_PROTOCOL). 각 Phase는 통과 전 다음 Phase 착수 금지.

## 5. EAS 릴리즈 성능 측정 (측정 후 최적화 — 추측 수정 금지)

> **원칙(2026-07-10 등재)**: 성능 최적화는 **실기기 릴리즈 빌드에서 측정한 뒤에만** 한다. **dev(Expo Go)의 60~70초류 대기는 판단 기준이 아니다** —
> Metro 번들 미압축·인라인 requires·Hermes 미최적화·dev 브리지 오버헤드가 섞여 릴리즈와 배수로 다르다. 추측으로 코드를 바꾸지 말고, 아래 6항목을 EAS 릴리즈(또는 `--variant release`) 빌드로 재보고 병목이 확인된 곳만 손댄다(CLAUDE §11 추정 금지).

**측정 6항목(각 콜드·워밍 구분 — 캐시되는 계산은 첫 콜드가 진실, MEMORY `cold-measure-perf-fixes`):**
1. **앱 실행**(스플래시→첫 상호작용 가능)
2. **홈 진입**(대시보드 첫 페인트 — 재정·순위·팬덤 카드)
3. **시즌 시작 계산**(개막 직전 롤오버/스냅샷 빌드)
4. **오프시즌 계산**(정산→FA/드래프트 프리뷰 재해소 — `resolveFAPreviewFor`류)
5. **경기 시작**(보드 진입→코트 첫 렌더)
6. **경기 종료→결과 진입**(생산 집계→matchresult 페인트)

**측정 로그 방법(제안)**: 각 경계에 `const t0 = Date.now()` … `if (__DEV__ || SHOW_PERF) console.log('[perf] offseason', Date.now()-t0, 'ms')` 한 줄 계측(개발 화면 게이팅 `DEV_TOOLS`와 같은 결 — 릴리즈 자동 숨김)으로 실기기 logcat에서 수집. 목표치는 측정 분포를 보고 정한다(선 목표 후 추측 금지).
