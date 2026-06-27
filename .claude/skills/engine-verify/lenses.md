# area × lens 카탈로그 (진화하는 정본 — engine-verify + edge-swarm 공유)

> 두 스웜 스킬이 100+ 세션에 배정하는 **area(검증/발굴 표면)** 와 **lens(각도)** 의 **공유 목록**:
> [`engine-verify`](./SKILL.md)(검증 — A/B로 실버그 확인)와 [`edge-swarm`](../edge-swarm/SKILL.md)(발굴 — 신규 엣지 도출).
> 매 run의 자기보강 단계가 **사각을 만든 누락 렌즈/under-covered area를 아래 "run 환류"에 append**한다.
> 강력한 렌즈(한 세션만 잡았으나 실버그/희귀 엣지를 잡은)는 표준 렌즈로 승격. → 두 스킬이 run마다 같이 똑똑해진다.

## area (검증 표면 — 실제 모듈에서 가져옴, 지어내지 말 것)

분산 시 각 area를 **서로 다른 렌즈/seed 세션 ≥3개**가 겹쳐 보게 한다(검출 매트릭스 표본).

### 경기 엔진 (코트)
- `rally` 랠리 체인·서브/리시브/세트/공격/디그 루프 · `rotation` 로테이션/오버랩 · `match`·`simMatch` 세트/경기 진행
- `lineup` 라인업·리베로·교체 · `court`·`spatial` 좌표 · `ratings`·`overall` 종합스탯 산출
- (보드 연출은 `BOARD_RULES`/verify-board 소관 — 여기선 엔진 수치/귀속만)

### 성장·장기
- `aging`·`training`·`experience`·`progression` 성장/노쇠 · `production` 생산 귀속 · `salary`·`cap` 연봉/캡
- `retire`·`rollover` 은퇴/세대교체 · `traits` 특성 · `injury` 부상 · `form` 경기감각 · `jersey` 헌액번호

### 영입·오프시즌
- `faMarket`·`compensation`·`draft`·`aiGM` FA/보상/드래프트 · `foreign` 용병 · `transactions` 시즌중이동
- `staff`·`staffLifecycle` 스태프 · `finance` 재정 · `owner` 구단주 · `relationships` 관계망 · `scandal` 사건사고

### 시즌 오케스트레이션·셀렉터
- `season`·`advance`·`calendar`·`clinch`·`playoffs` 진행 · `awards`·`milestones`·`achievements` 서사
- 데이터 셀렉터: `standings`·`production`·`offseason`·`acquisitionAudit`·`news`·`records`·`legends`·`matchBox`·`rivalry`·`clubIdentity`
- 토대: `rng` 시드 결정론 · `seed` 초기 생성

## lens (검증 각도 — 같은 area도 렌즈가 다르면 다른 버그가 보인다)

| lens | 무엇을 보나 | 깨지면 |
|---|---|---|
| **불변식** | 한사람=한팀·정원·돈≥0·캡·만료=이탈·라인업 구성가능 | 구조 붕괴 |
| **분포** | 출력이 현실 밴드(KOVO 킬56%·에이스6% 등)·치우침 없음 (N≥10,000) | 밸런스 |
| **결정론** | 같은 시드=같은 결과·재실행·리하이드레이트 불변 | 리플레이/세이브 |
| **문서↔코드 drift** | `*_SYSTEM.md`·README 수치/규칙 ↔ 실제 코드 일치 | 문서 거짓 |
| **경계/극단** | 0명·정원 하한/상한·자금 0·전원은퇴·동시부상 상한·시즌1/말 | 엣지 크래시 |
| **동시성/순서** | 같은 틱 다중 사건·순서 꼬기·선후 의존 | 경합 |
| **장기누적** | 100·300·1000시즌 누적이 폭주/고갈/인플레 안 하나(맵 바운드·평균회귀) | 장기 붕괴 |
| **단위정합** | 상수 손복제 drift(시즌길이·임계)·만원↔억·세트당↔경기당 | 은밀한 오차 |
| **교차계층 귀속** | 보드가 보여준 선수 == 박스 귀속(스코어박스 충실도) | 표시 거짓 |
| **A/B 오라클** | 모든 측정이 깬 입력에 무너지나(허위 오라클 차단) | 검증 자체 거짓 |

## run 환류 (자기보강 누적 — 매 run의 6단계가 append)

> 형식: `(YYYY-MM-DD·run N세션) [추가렌즈/area 또는 승격] — 어느 실버그를 어느 세션만 잡았고, 다른 세션이 왜 놓쳤나(사각).`

- **(2026-06-27 · engine-verify run 100세션)** finding 106건(high 1클래스·med 16·low 88). 렌즈별 수율:
  **문서_drift 38 · 경계극단 23 · 분포 18 · 불변식 15 · 결정론 12**.
  - **[승격] 문서_drift = 최고 수율 렌즈(38)** — 코드↔문서 상수/공식이 광범위하게 벌어짐(momFactor 문서 ±15% vs 코드 ±4%·
    포지션폴트 0.015+situationFactor 미구현·FINANCE/TRAINING stale 검증통계·stuffProb 0.46 vs 0.55 등). 출력은 대부분 정상이라
    *엔진 버그가 아니라 DOC_DISCIPLINE 위반*. → **표준 렌즈로 항상 포함 + 별도 "문서 동기화 패스" 권고**.
  - **[추가 서브렌즈] 결정론 → "in-process resetSave 재플레이(앱 내 새 게임)"** — HIGH(파이프라인 결정론: 같은 시드 2회
    resetSave → computeStandings 91↔83)를 **단 1세션(lineup:결정론)만** 잡음. 사각: 다른 결정론 세션들은 각자 area의
    *단발 시드 재현*만 봐 surveyed에 '결정론 OK'를 적었지만, **연속 resetSave(프로세스 재사용=앱 내 새게임) 경로**를 아무도
    안 봄 → 그 각도를 명시 서브렌즈로 추가. (실세이브 partialize+rehydrate는 결정론 ✓ — 누수는 in-process 모듈 상태.)
  - **[사각] 경계극단(23)이 잡은 latent 갭은 대개 "정상 파이프라인 도달 불가, 적대 store 입력만 도달"**(composition-blind
    lineup·empty-six)이라 fuzz-game(store 구동)과 겹침 → 경계극단 세션엔 "store 진입점 도달성까지 확인" 지시 보강.
  - **[가드결함]** `_gt_determinism`의 A/B 자가검증(partialize rosters 누락 검출)이 **안 묾(false)** = 허위 오라클 — 가드 자신 수정 필요.
