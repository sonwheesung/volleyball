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
  뒤 경기를 깎음)라 접미 재사용이 byte-동일을 보장 못 한다. 게다가 tx-only bump에선 dyn 재계산이 **이미 싸다**
  (11ms warm — evoOneCache가 baseVersion 불변이라 데워짐). 0.6s의 실체는 **순위·생산의 경기 시뮬 루프**였고
  그건 스플라이스가 죽인다. dyn은 전체 재계산이 정답(단순·안전).
- **진화 메모(`evoOneCache`) 날짜범위 무효화 = 유보(deferred).** 유혹: 훈련방침 변경(base++)은 fromDay 이전
  진화가 불변이라 `day < fromDay` 메모 엔트리를 살릴 수 있다. **그러나** `evoOneCache`의 세대 키가
  **baseVersion에 결합**돼 있어(`evoOneKey !== _baseVersion`이면 통째 clear) 날짜범위 부분 무효화를 하려면
  세대키를 baseVersion에서 **분리**해야 하고, 그 변경은 evolveOnDay의 결정론 핵심을 건드려 침습적·고위험이다.
  반면 실익은 **훈련방침 변경(base++) 케이스 한정** — 그마저도 dyn의 전체 forward-pass(1,308ms cold evo)가
  지배해 메모 스플라이스만으로는 못 줄인다. **주력 목표(0.6s tx-only)는 순위·생산 스플라이스로 완전 해결**(dyn은
  tx-only에서 warm)되므로, evo 스플라이스는 유보하고 문서화한다. 훈련방침 변경에서도 순위·생산은 `day ≥ fromDay`만
  evolveOnDay를 호출하므로 부분 이득은 있다(과거 행 재사용 → 그 날들의 진화 조회 생략).

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

### 7.4 검증
- `tools/_dv_splice.ts`: ①byte-상등 프로퍼티(≥40 랜덤열, 매 액션 후 splice==force-full deep-equal, 순위+생산)
  ②결정론 ×2 ③타이밍(늦은 시즌 벤치 add에서 splice ms ≤ ~20% full) ④off-by-one minDay 변이 → FAIL(민감도)
  ⑤프리뷰 상등(split-path == 옛 monolithic) + 토글 재실행 << 스냅샷 빌드 타이밍.
- 풀 배터리(run-all-tests): tsc·유닛·auditBoard·`_dv_batch_*`·`_dv_bench(2)`·`_dv_displaycutoff`·`_dv_focus`·
  `_ev_suggest_defer`·checkSubs·`_dv_campoutbox`·`_dv_migrate_e2e`·simNews·`_dv_drift_kovo`·`_gt_determinism` 무회귀.

## 4. 검증 (각 Phase 통과 조건)
- Phase 0: `_gt_determinism` in-process 2회 동일 + A/B 이빨 복구. 풀 배터리(run-all-tests) 0건.
- Phase 1: 저장값 == 재생값(드리프트 0, 전환 검증) · 1만 시즌 세이브 크기 상한 가드 · KOVO 분포 불변.
- Phase 2: 저장 스코어 == 보드 재생(엔진 동일 시 100%, 재튜닝 시 정책대로).
- Phase 3: `_dv_migrate_e2e` 구→신 세이브 무손실.

> 추정 금지·A/B 필수(STATS_PROTOCOL). 각 Phase는 통과 전 다음 Phase 착수 금지.
