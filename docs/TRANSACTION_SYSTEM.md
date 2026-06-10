# 시즌 중 이동 시장 (In-season Transactions) — 설계 문서

> 방출 → FA 풀, 그리고 포지션 구멍(부상·방출)을 FA로 긴급 수혈. 전 구단(AI 포함).
> 부상(Phase 4)에 의미를 더함: 에이스 시즌아웃 → 백업 부족 → 긴급 영입.

## 0. 확정 결정 (2026-06-10)
- **AI 영입 트리거**: 포지션 구멍날 때만(부상/방출로 healthy 가용 < 필요). 시장 안정.
- **FA 풀**: 이번 시즌 방출자 + 오프시즌 미계약 FA 잔류분.
- **샐러리캡**: 시즌 중 영입도 `LEAGUE_CAP` 적용. 로스터 크기 ≤ 18 버퍼(AI 방출 불필요).

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
- `engine/transactions.ts` — 순수 AI 영입 판정(positionShortage, pickSigning).
- `data/dynamics.ts` — 통합 forward-pass(injury+tx) → injuredOnDay·rosterIdsOnDay·txLog. `data/injury.ts`는 재노출.
- `data/league.ts` — `evolvedByIdOnDay`(FA 포함 임의 선수 진화), 날짜 인지 availableTeamPlayers.
- `store` — 플레이어 release/sign(day) + 거래 영속, endSeason에서 txLog 커밋.
- `app` — in-season FA 시장 화면.

## 6. 검증
- 결정론: 같은 세이브·거래 = 같은 시즌(골든 테스트 보존, 합성 무영향).
- sim-league parity 회귀(전 구단 AI 영입 후 균형 유지).
- 무결성: 로스터 ≤ 18·캡 준수·과거 결과 고정.
