# 시즌 중 이동 시장 (In-season Transactions) — 설계 문서

> 방출 → FA 풀, 그리고 포지션 구멍(부상·방출)을 FA로 긴급 수혈. 전 구단(AI 포함).
> 부상(Phase 4)에 의미를 더함: 에이스 시즌아웃 → 백업 부족 → 긴급 영입.

## 0. 확정 결정 (2026-06-10)
- **AI 영입 트리거**: 포지션 구멍날 때만(부상/방출로 healthy 가용 < 필요). 시장 안정.
- **FA 풀**: 이번 시즌 방출자 + 오프시즌 미계약 FA 잔류분.
- **샐러리캡**: 시즌 중 영입도 `LEAGUE_CAP` 적용. 로스터 크기 ≤ 18 버퍼(AI 방출 불필요).
- **정원 하한(2026-06-11)**: `ROSTER_MIN = 10`(선발 7 + 동시부상 상한 3 여유) 밑으로 방출 불가 —
  스토어 `release()` 게이트가 차단(UI 알림). 이중 방어: 게이트를 우회한 비정상 세이브라도
  `buildLineup`이 빈 로스터를 명시적 거부, dynamics 전진 패스는 빈 명단 팀의 부상 굴림만 생략(크래시 없음).
- **포스트시즌 동결 게이트(2026-07-08 · SEASON_SYSTEM §5.0)**: `currentDay > SEASON_DAYS`(플옵 165~183)이면
  시즌 중 이동 액션 **전부 차단**(`release`·`signInSeason`·`replaceForeign`·`replaceAsian` → 모두 `false`).
  플옵 엔트리는 정규 종료(164)로 동결이라 새 선수는 0경기 뛰는데 위약금·영입비·시즌1회 교체권만 소모되는 유해 no-op이기 때문.
  `app/transactions.tsx`는 플옵 기간 안내 카드 + 영입/교체 버튼 비활성(사유 노출). 가드 `_dv_postseason` ⑦(4종 차단 + day164 성공 A/B).
- **배신 웃돈(2026-06-11)**: 내가 이번 시즌 방출한 선수의 FA 재영입은 몸값 **×1.5**
  (`BETRAYAL_PREMIUM`). 방출당한 선수는 배신감이 남는다 — 당일 철회(unrelease)는 무료(실수 정정),
  그 이후엔 돈으로 마음을 달래야 돌아온다. 방출↔재영입 무한 반복(churn) 악용도 자연 차단.
  타 팀이 데려갈 땐 웃돈 없음(새 출발). AI는 방출을 안 하므로 해당 없음.
- **엣지 가드 일괄(2026-06-11)**: ① `signInSeason`은 FA 풀 멤버십 검증(풀 밖 id 영입 → 한 선수
  두 명단 차단) ② standings/production 캐시 키에 거래버전 포함(시즌 중 방출/영입 즉시 반영)
  ③ 경기 보드도 `availableTeamPlayers`(그날 출전 명단) 사용 — 결장 선수가 코트에 안 보임
  ④ AI는 부상 중 FA 영입 안 함 ⑤ 방출 철회(unrelease)는 **당일만** — 이후 철회는 과거 경기 소급
  변경(리플레이)이라 금지, 재영입은 FA 시장으로. 검증: `tools/simTxEdge.ts`(5절 배터리).
  ⑥ **AI는 자기 팀이 이번 시즌 방출한 선수를 재영입 안 함**(2026-07-02, EC-TX-05) — 방출로 만든 구멍을
  그 선수로 되메꾸는 무의미 churn + "유저는 배신 웃돈 ×1.5(위 13행), AI는 공짜" 비대칭 차단(타팀 영입은 자유).
  현재 AI는 스스로 방출하지 않아 실전 경로는 좁지만(주입·미래 AI 방출 대비) 계약("방출⇒옛 팀 재등장 없음",
  `simTxDup` 불변식4)을 구조로 보장. `data/dynamics.ts releasedByTeam`. 잠재 공백이 6/21~7/1 구성 변화(아시아쿼터
  전환 등)로 표면화된 케이스 — 21건 위반이 j21(6/21) 0건과 A/B 대조. dyn 재생 변경이라 `ENGINE_VERSION 3` 승격.

## 0.5 방출의 무게 (2026-06-25 — 사용자 보고 "구단주가 너무 정 없이 방출한다")
> **문제**: 방출에 걸린 건 전부 *막는* 제약(정원 하한·외인 차단·재영입 웃돈)뿐, **무게(대가)가 0**이라
> 스타도 노장도 클릭 한 번에 "정 없이" 떨어진다. 특히 **`OWNER_SYSTEM §3.2`는 "스타 방출 → 팬심 하락"을
> 이미 명시**했는데 엔진 `fanScore`엔 그 항이 빠져 있었다(설계-코드 드리프트). 4겹의 무게를 더한다.

### ① 금전 위약금 (구현 — 재정 무게)
- 방출 시 **잔여 보장액의 일부를 정산금으로 즉시 지불** → 운영 자금(`cash`) 차감. `severanceFee(contract) =
  round(salary × remaining × SEVERANCE_RATE)`(`engine/transactions.ts`, `SEVERANCE_RATE=0.4` placeholder).
- 게이트: `cash < severance`면 방출 불가(스토어 `release()`가 false, UI가 사유 표시). 정원 하한과 별개의 둘째 관문.
- 결정론: `cash`는 저장 지갑(FA 영입비와 동일 패턴, 즉시 차감). 리플레이 재계산 대상 아님 — 안전.

### ② 작별 서사 + 확인 회고 (구현 — 감정 무게 "정")
- 방출 확인 다이얼로그가 **함께한 시즌·통산 생산·수상·프랜차이즈 여부 + 위약금**을 회고로 띄운다.
  "가벼운 클릭"을 "무게 있는 결정"으로(노장/프랜차이즈일수록 문구 강화). UI: `app/contracts.tsx` `doRelease`.
- (추후) 주목 방출(프랜차이즈·노장)은 **작별 뉴스**(NEWS `release` 강화)로 연대기에 남긴다.

### ③ 팬심·예산 타격 (구현 — 평판 무게, OWNER_SYSTEM §3.2 구현)
- **방출 *시점*에 분노 적립**(`store.releaseAnger` 누적, endSeason서 `fanScore` angerSum에 합산·리셋). 방출 후
  production 제외로 시즌 기여가 사라지는 역설을 피하려 release/unrelease 순간에 계산(철회는 환불).
- 분노 = `releaseAngerPenalty(stature)`. **stature = 안정 명성**(career·수상·근속 기반 인기, **시즌 production 제외**) —
  `leagueProduction`은 호출 순서에 민감해 분노가 흔들렸다(측정서 9↔16) → 휘발항 빼고 결정론화. 구간: <30→0·<45→5·<60→10·≥60→16.
- 스타·레전드 방출은 팬심↓ → 다음 시즌 예산(`fanBudgetFactor`)·관중↓. 무명은 0(인기 게이트).
- **측정(`_dv_releasefan`, N=8 · 거울 빌드업)**: 스타(명성 63) 방출 → 분노 정확히 16·철회 0·무명(명성 0) → 0(게이트)·
  팬심 방향성 42→27. releaseAnger가 비교란 직접 오라클(fanScore 절대낙폭은 winRate 약결합이라 방향만).

### ④ 팀 사기 — 남은 선수 동요 (구현 — 라커룸 무게, 호감도 경로 재사용)
- **결정(사용자 2026-06-25)**: *팀 사기→경기력* 시스템은 없으므로(grep 확인) 새 매치 변수 대신 **기존 호감도 경로 재사용**
  (밸런스 안전). 사용자가 그린 "경기력 소폭↓"이 아니라 "재계약 거부·이탈 위험↑"으로 구현.
- **구현**: `buildOwnerFx`가 `getTxContext()`의 이번 시즌 내 방출자 명성(career·근속, season·수상 제외 0~45)으로
  `releaseUnrestBias` 산출 → **만료(거부권) 선수 전원의 재계약 거부 확률에 팀 단위로 가산**. 구간 명성 ≥38/25/14 → +0.10/0.06/0.03, 상한 0.25.
  buildOwnerFx 내부 계산이라 6개 호출처(endSeason+미리보기 5) 자동 적용 — **미리보기=결과** 유지.
- **측정(`_dv_release_unrest`)**: 핵심(명성 45) 방출 → 만료 선수 거부확률에 +uCore 가산·무명(명성 0) → +0(게이트). 결정론·매치 밸런스 불변.
  - **가드 기대식 정정(2026-07-06 · 발견·검증=Fable 5 / 진단·수정=Opus 에이전트 · EC-REL-04, 미커밋)**: 이 항은 "unrest를 만료자 **전원에 가산**"만 보장하지, 방출 후 total refuse가 방출 전보다 항상 크다(단조)는 걸 보장하지 **않는다**. 방출은 만료자의 **출전 역할**도 바꾸기 때문 — 방출된 핵심과 **동포지션에서 밀려 있던(outclassed→출전불만) 만료자**는 핵심이 빠지면 **주전 승격 → 출전불만 base 소멸**(discontentNow가 라커룸과 별개 시스템으로 정당 반응) → unrest(+uCore)를 더해도 사라진 base를 못 되살려 total은 오히려 내려간다(엔진 WAI). 그래서 가드는 만료자를 **방출 전/후 discontent 지문으로 두 갈래**로 검증한다: `base 불변 → 정확히 +uCore(+친구 relTerm)` / `역할 변동 → 방출후 base(≥0)+uCore+relTerm 하한`. 구가드가 방출 전 refuse를 기준선으로 오용해 승격 만료자에서 허위 FAIL(d4_5 0.127<0.638)이 났던 것 — 엔진 무수정, 가드 모델만 정정.

> 순서: ①②(재정·감정) → ③(팬심) → ④(호감도) **전부 구현·측정 완료(2026-06-25)**. 각 단계 이 문서 갱신.

## 1. ★ 핵심 난제 — 리플레이 결정론
현재 `rosters`는 시즌 내내 고정 → standings/production이 전 경기를 같은 명단으로 재시뮬.
시즌 중 이동이 생기면 **명단이 날짜별로 달라져야** 한다(과거 경기는 그때 명단으로 고정).

### 해법: 날짜 인지 명단 + 통합 forward-pass
- **거래 로그** `Tx{day, teamId, playerId, kind:'sign'|'release'}`.
  - 플레이어 거래 = 저장(입력). AI 거래 = forward-pass에서 결정론 파생.
- `rosterIdsOnDay(team, d)` = 시작명단 ± (txDay ≤ d 인 거래).
- **부상 timeline과 한 forward-pass로 통합**(`data/dynamics.ts`):
  매치데이 순서로 — (a) 그날 효력 거래 적용, (b) 레그 경계면 AI가 구멍 포지션 FA 영입,
  (c) 그날 라인업(거래·부상 반영)으로 부상 판정. 경기 결과엔 무의존 → 순환 없음.
- `availableTeamPlayers(team, d)` = evolve(rosterIdsOnDay(team,d)) − injuredOnDay(d).
  production·standings·playoffs 공용(이미 사용) → 프리뷰=결과·과거 고정.

## 2. 영향 범위 최소화 (이중 경로)
- **시뮬 경로**(standings/production/playoffs/부상): 날짜 인지(`dynamics`).
- **UI "현재 명단"**(getEvolvedTeamPlayers static rosters): 플레이어 거래는 `rosters`에도 즉시 반영
  → 내 팀 currentDay 명단 = 시뮬과 일치. AI 시즌 중 영입은 시뮬에만, endSeason에 rosters로 커밋.

## 3. AI 규칙 (레그 경계 6회/시즌, 결정론)
- 팀 순서 고정. 포지션 p의 healthy 가용 < `ON_COURT[p]` 이면 구멍.
- FA 풀(포지션 p)에서 OVR 최고 + (payroll+salary ≤ CAP) + (로스터 < 18) → 영입.
- 영입가 = `marketValue`. 동시 여러 구멍이면 OVR 높은 자리부터.

## 4. 플레이어
- 방출: `release(playerId)` → 즉시 FA 풀(현 시점 이후), payroll 차감, rosters 즉시 갱신.
- 영입: in-season FA 시장에서 sign(faId) → 현 시점 이후 합류(CAP·18 제약).
- 둘 다 거래 로그에 day=currentDay로 기록.

## 5. 코드 맵 (예정)
- `engine/transactions.ts` — 순수 AI 영입 판정(shortagePositions, pickSigning).
- `data/dynamics.ts` — 통합 forward-pass(injury+tx) → injuredOnDay·rosterIdsOnDay·txLog. `data/injury.ts`는 재노출.
- `data/league.ts` — `evolvedByIdOnDay`(FA 포함 임의 선수 진화), 날짜 인지 availableTeamPlayers.
- `store` — 플레이어 release/sign(day) + 거래 영속, endSeason에서 txLog 커밋.
- `app` — in-season FA 시장 화면.

## 5b. FA 풀의 실제 동작 (v1)
- 오프시즌 FA 시장이 거의 청산(구멍≈FA)되어 **잔류 FA는 대개 0**. → 시즌 중 풀은 **방출이 만든다**(웨이버).
- 방출자는 그 시즌 풀에 즉시 등록(타팀·AI 영입 가능). **미영입 방출자는 시즌말 정리(cut)**.
- AI 트리거가 보수적(healthy<선발필요)이라 단순 방출만으론 잘 안 뜨고, **방출+부상이 겹쳐 진짜 구멍**일 때 영입.
- 검증: `tools/simTxSeason.ts`(방출 주입 30시즌) — AI 영입 발생·로스터 ≤18·결정론 ✅.

## 6. 검증
- 결정론: 같은 세이브·거래 = 같은 시즌(골든 테스트 보존, 합성 무영향).
- sim-league parity 회귀(전 구단 AI 영입 후 균형 유지).
- 무결성: 로스터 ≤ 18·캡 준수·과거 결과 고정.

## 7. 캡 계산 단일화 — `capPayroll` (2026-07-07, ~~5~~ **6**-사이트 정합)
> **문제**: "캡에 잡히는 국내 연봉 합"을 다섯 곳이 **서로 다르게** 셈했다 — ① `reSign` 게이트(override 반영·시즌중
> 영입 무시) ② `signInSeason` 게이트(override 미반영·시즌중 영입은 `inSeasonCost`) ③ `transactions.tsx` capLeft 표시
> (override 미반영·시즌중 영입을 base 연봉으로) ④ 대시보드 총연봉(override 반영·시즌중 영입 무시·정적 명단) ⑤
> `data/roster.ts domesticPayroll`(base 연봉 원시 합). ③이 `②` 게이트보다 느슨해 **"캡 여유 있다" 표시 후 영입이 캡초과로
> 거부**되는 불일치가 났고, ①④가 시즌중 영입비를 캡에 안 실어 **게이트가 셌다가 약했다가** 했다.
>
> **정정(2026-07-08, ⑥ 추가)**: `app/contracts.tsx` **`pickOffer`(재계약 오퍼 사전체크)** 가 위 5-사이트 단일화에서
> **누락**돼 있었다 — `canAfford(payroll(getEvolvedTeamPlayers) − p.salary, offer)` 로 셈해 `getEvolvedTeamPlayers`(시즌초
> 커밋 명단)의 base 합만 봤고 **시즌 중 영입 선수의 취득가(`inSeasonCost`)를 빠뜨렸다**. 그래서 ① `reSign` 게이트(cd3d99a에서
> `capPayroll`+franchise 예외+`ReSignResult` 반환으로 강화됨)보다 **느슨** → 캡 근접 + 시즌 중 영입 보유 시 UI는 "여유 있음"으로
> 통과시키고 store가 **조용히 거부**(③과 같은 결의 허위 여유). → ⑥ `pickOffer` 도 store와 **동일한 `capPayroll` 경로**
> (`rosterIdsOnDay` 명단 · `inSeasonCost` · 배신 웃돈 · 개인 상한 `maxSalaryFor` · **프랜차이즈 팀캡 예외**)로 교체해 6번째
> 사이트로 편입. 더해 `pickOffer→reSign` 호출부가 `ReSignResult({ok,reason})` 를 확인해 실패 시 사유를 커스텀 모달
> (`showAlert`, UI-21)로 노출 — **조용한 거부 완전 제거**. 가드 `tools/_dv_capprecheck.ts`(새 사전체크==store 게이트 ·
> 구 사전체크와 flip A/B).

- **정본 규칙(`data/roster.ts capPayroll`)** — 국내 선수만(외인은 1년 트라이아웃 별개 지갑, 캡 제외 — FOREIGN_SYSTEM 2장):
  - **시즌 중 영입 선수**(내 팀 `inSeasonTx.kind==='sign'`): **`inSeasonCost(marketVal, betrayed)`** (배신 웃돈 ×1.5 포함 —
    실제 캡에 실리는 취득가. `signInSeason` 게이트가 이미 쓰던 권위값).
  - **그 외**: **재계약 override 연봉이 있으면 그 값, 없으면 base `contract.salary`** (재계약으로 오른 연봉이 캡에 반영).
  - 명단 = 그날 유효 로스터(시즌 중 영입 포함·방출 제외) — 호출부가 제공(store는 `currentRosters()±myRosterDelta`,
    app 화면은 `rosterIdsOnDay`). `capPayroll`은 진화된 `Player[]`+override+시즌영입 집합+배신판정을 받아 **평가 규칙만** 단일화(순수).
- **⑤ `domesticPayroll`은 base 연봉 원시 합 프리미티브로 유지**(offseason 등 캡 무관 합산이 계속 사용) — `capPayroll`은
  그 위의 캡 인지 상위 함수.
- **게이트 방향 변화(전부 강화 — 약화 0)**:
  - ① `reSign`: 이제 시즌 중 영입분도 캡에 합산(과거엔 무시 → 저평가) → **더 엄격**.
  - ② `signInSeason`: 기존 로스터를 override 인지로(과거 base 연봉) → 재계약으로 오른 연봉이 잡혀 **더 엄격**.
  - ③ `transactions.tsx` capLeft: 시즌 영입을 `inSeasonCost`+override로(과거 base·override미반영) → **② 게이트와 정확히 일치**(허위 여유 제거).
  - ④ 대시보드 총연봉: 그날 명단(시즌 영입 `inSeasonCost` 포함)으로 → **실제 캡 부담을 진실되게** 표시.
  - ⑥ `contracts.tsx` `pickOffer`: 시즌 영입비(`inSeasonCost`)+override+프랜차이즈 예외를 반영 → **① `reSign` 게이트와 정확히 일치**(허위 여유·조용한 거부 제거).
- **검증**: 동일 입력에서 ~~네~~ **여섯** 사이트가 같은 값 반환(임시 리프로) + 결정론·sim-league parity 불변. 게이트 강화는 캡 초과
  영입/재계약을 더 막을 뿐 정당 케이스는 불변. ⑥은 `tools/_dv_capprecheck.ts`(사전체크==게이트 불변식 + 구/신 flip A/B).
