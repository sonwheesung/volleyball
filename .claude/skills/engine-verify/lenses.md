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
| **기능 순효과(effect A/B)** | 배선·결정론·문서 ✅인 기능이 **실제로 효과가 있나** — with vs without(주전 vs 벤치·감독 공격형 vs 수비형·부스트 on/off)로 순효과≠0 확인. **다른 시스템(상한 선점·saturation)이 조용히 무력화하나?** | 죽은 기능(문서엔 ✅, 효과 0) |
| **도메인 규칙 정합** | 출력이 **실제 스포츠 규칙(FIVB/KOVO)** 을 지키나 — 교체(선수 세트당 1회 진입·선발 1왕복)·로테이션(시계방향)·오버랩(인접쌍)·리베로(후위전용·서브/공격/블록 불가). **구조·연출·결정론·net-zero가 다 통과해도 규칙 위반일 수 있다**(핑퐁 교체=일관+net-zero인데 불법). 횟수 ✅ ≠ 규칙 ✅ | 불법 플레이(현실 배구 아님) |

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
- **(2026-06-27 · edge-swarm run 100세션)** 엣지 383(high 16·med 143·low 224 · 신규 ~314). 합의 매트릭스:
  - **[표준 승격] "무캡 루프/공급 고갈"** — 클러스터 A(외인/아시아 풀 `while(overall<dom)` 무한루프=프리즈)를 **3개 렌즈
    (경계극단·장기누적·적대입력)가 같은 코드로 수렴** = 최고 합의 = 명백 실버그. 즉시 수정(EDGE_CASES §3.14). **"종료 보장
    안 되는 while/재시도 루프"를 모든 area에서 보는 표준 체크로 승격**(클램프 천장 vs 목표 불일치 패턴).
  - **[표준 승격] "손상/도핑 세이브 → NaN 전파"(적대입력)** — sanitize가 값(숫자/범위) 미검증이라 salary/bonds/potential
    NaN이 캡·affinity·성장으로 전파(클러스터 D 다수 세션). save-corruption 내성을 표준 렌즈로.
  - **[사각] cross-metric 정합** — 클러스터 B(clinch는 승수, standings는 승점)를 season 2세션만 잡음. 다른 season 세션은
    clinch의 *내부* wins 일관성만 봐 surveyed에 OK 기록 → **"같은 개념을 두 모듈이 다른 지표로 계산하나"** 각도가 사각이었음. 서브렌즈 추가.
- **(2026-07-01 · 도메인 규칙 정합 사각 발견 — 교체)** **교체 핑퐁**(같은 교체선수가 한 세트에 2~3회 투입, 200경기 1316건) — FIVB "교체선수 세트당 1회 진입·선발 1왕복" 규칙이 엔진에 미구현(예산 6만 세고 재진입 안 막음). `checkSubs`가 있었으나 **연출 충실도**(슬롯 일관·net-zero·점유자·발동)만 검사 → 핑퐁도 net-zero라 통과. `KOVO_RULES_COMPARISON`은 횟수(6)만 ✅.
  - **[신규 표준 렌즈 승격] 도메인 규칙 정합** — 어느 렌즈도 못 잡음(구조·결정론·net-zero 다 통과). 유일 검출각 = "출력이 FIVB/KOVO 규칙을 지키나". `checkSubs`에 규칙검사 추가(1316→0), `match.ts` usedSubIn/usedStarterOut 가드. **형제 후보: 로테이션 시계방향·오버랩 인접쌍·리베로(후위전용·서브/공격/블록 불가)·리베로 교체 무제한 — 전부 "구조는 ok, 규칙 legality 미검증" 의심 → 다음 run 배정.**
  - **[방법] "횟수/발동 ✅ ≠ 규칙 ✅"** — 기능이 "일어나고 일관되게 렌더된다"를 규칙 준수로 오인하지 말 것. 스포츠 규칙은 legality 불변식(누가/언제/몇 번 합법인가)을 별도 인코딩.
- **(2026-07-01 · 기능 순효과 사각 발견 — 성장)** **경기경험(`experience.applyMatchXp`)·감독선호(`training.coachShare`)가 둘 다 inert**(문서엔 §1.7 "✅ 구현", 실제 순효과 0): 주전 34경기 vs 벤치 0경기 성장 **+0**, 공격형 vs 수비형 감독 최종 OVR **차이 0**. 원인=훈련(POS_FLOOR 0.24 + BASE)이 **모든 스탯을 22세에 포텐까지 saturate** → 경기XP·감독선호가 얹힐 head 0, 게다가 감독핵심 0.25 ≈ POS_FLOOR 0.24라 선호가 속도조차 못 바꿈.
  - **[신규 표준 렌즈 승격] 기능 순효과(effect A/B)** — 이걸 **어느 렌즈도 못 잡았다**: 불변식·분포·결정론·문서drift·경계극단 전부 통과(코드는 배선·결정론·문서일치 ✅). 유일한 검출각 = "with vs without 순효과≠0". `experience.ts` 전용 가드가 **0개**였음(tools grep=transitive import뿐). → **모든 성장/부스트/보정/선호 입력에 effect A/B 가드 필수**. 형제: 케미(`chemistry`)·form·trait 보정도 순효과 미검증 의심 → 다음 run 배정.
  - **[방법] cross-system saturation** — "A 시스템이 천장을 먼저 선점하면 B 시스템이 문서상 존재해도 죽는다". 단일 시스템 테스트로 안 보임(상호작용). 성장처럼 **여러 입력이 같은 상한(포텐)을 공유**하는 곳은 항상 "각 입력의 marginal 기여" A/B.
- **(2026-06-29 · edge-swarm run 108세션)** 엣지 542(WAI 83·기지 88·신규고합의 38). 신규 실버그 2종(FINANCE 2.0)·기지 재확인([D]NaN·[E]가용<7).
  - **[표준 승격] "새 표면 우선 재스윕"** — 직전 run(06-27) 이후 추가된 FINANCE 2.0(sponsorStance·leagueHistory·AI입찰)에서 **신규 실버그 2종**(EC-FN-01 preview≠result·EC-FN-02 음수오퍼)을 10+세션이 수렴 발견. 기존 area는 대부분 기지/WAI 재확인. → **"기능 추가 직후 그 표면을 area로 명시 배정하고 재스윕"** 을 표준화(새 코드가 가장 버그 밀도 높음).
  - **[표준 승격] "형제 비대칭(parallel reconstruction)" = preview=result 최강 렌즈** — 같은 개념(stance)을 두 경로가 도출(내 팀 보너스=라이브 병합 ✓ / AI 입찰=archive-only ✗)하는데 **한쪽만 고쳐진** 비대칭을 cross-metric+동시성 세션이 수렴. preview=result는 **단일 시점이 아니라 "프리뷰 시점 vs 확정 시점의 컨텍스트(archive) 상태차"** 를 대조해야 보임 → 그 시점차 렌즈를 명시.
  - **[사각] 단발 high(38건 중 다수 count=1)** — preview=result/음수오퍼는 high지만 합의 count=1로도 나옴(area가 신규라 겹침 세션이 적었음). 신규 area는 **중복도(RED)를 높여** 합의 측정력 확보 필요(이번엔 RED=4였으나 신규 area에 4 부족).
