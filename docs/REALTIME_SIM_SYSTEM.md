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
- **Phase 3 — 마이그레이션·정리(G4·G6)**: SAVE_VERSION 범프·백필·가드·무제한 배열 점검.

## 4. 검증 (각 Phase 통과 조건)
- Phase 0: `_gt_determinism` in-process 2회 동일 + A/B 이빨 복구. 풀 배터리(run-all-tests) 0건.
- Phase 1: 저장값 == 재생값(드리프트 0, 전환 검증) · 1만 시즌 세이브 크기 상한 가드 · KOVO 분포 불변.
- Phase 2: 저장 스코어 == 보드 재생(엔진 동일 시 100%, 재튜닝 시 정책대로).
- Phase 3: `_dv_migrate_e2e` 구→신 세이브 무손실.

> 추정 금지·A/B 필수(STATS_PROTOCOL). 각 Phase는 통과 전 다음 Phase 착수 금지.
