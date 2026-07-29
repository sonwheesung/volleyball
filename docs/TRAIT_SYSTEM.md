# 선수 특성 (Traits) — 설계/구현 문서

> 같은 OVR이라도 다르게 느껴지는 선수 — 숫자 뒤의 성격(②서사 + ④단장결정).
> "큰 경기에 강함 / 유리몸 / 대기만성"이 영입을 *도박*으로 만든다.

## 0. ★ 결정론 원칙 (최우선)
**엔진은 `player.traits`(명시적 데이터)만 읽는다. id로 추론하지 않는다.**
특성은 생성 시점(seed/rookies)에 `rollTraits(id)`로 부여되고 엔진은 그 필드를 읽을 뿐.
→ traits 없는 합성 테스트 선수는 무영향 → **기존 결정론 골든 테스트 100% 보존**(검증됨).
구세이브: `commitPlayerBase`에서 없으면 id 시드로 보정.

## 1. 특성 (긍정+부정, 희소가 특별)
~~대부분 0개 · 가끔 1개 · 드물게 2개(rollTraits 분포).~~ → **정정(2026-07-27, 사용자 결정): 무특성 폐지 — 전원 1~3개 보장(1개 60%·2개 30%·3개 10%). 상극(대립) 특성은 한 선수에 동시부여 금지(서로 상쇄돼 무의미).** 좋은 특성이 흔하고 부정은 드물게(도박 성립).
> **부정 가중 하향(2026-07-27, 사용자 결정)**: 무특성 폐지로 부정 보유율이 오르는 걸 상쇄 — POOL 부정 가중치 `choke·earlyDecline·glass`를 각각 `5·4·5 → 2·2·2`로 낮춰 **부정 특성 보유율 29%→14%(단점만 보유 11.7%→5.8%)** (실측 N=30,000). 완전 제거가 아니라 "드물게"로 유지 — 단점만 가진 선수도 드물게 존재(도박·서사).
> **부정 가중 재복원(2026-07-27, §6 상시형 6종 확장 직후)**: good 6종을 POOL에 추가(각 w=7·총 +42)하자 부정 보유율이 희석돼 ~~2·2·2 → 8.3%~~로 떨어짐 → 목표 유지 위해 `2·2·2 → 4·3·4`로 재상향, **부정 보유율 14.7%·단점만 6.1%** 복원(실측 N=30,000). good 특성 추가 시 부정 가중을 함께 재측정하는 것이 원칙(총가중 대비 부정 분율이 보유율을 결정).
> **Phase 2a 재측정(2026-07-27)**: 반응형 3종 추가(joker/bounce good w=5, fragile bad w=2) 후 **부정 보유율 15.8%·단점만 6.5%**(실측 N=30,000, 목표 ~15%대 유지). 계수는 placeholder — 밸런스는 simKovo 전 항목 밴드 내·engine-regression 곡선 정상으로 확인.
> **Phase 2b 재측정(2026-07-27)**: 반응형 4종 추가(pinchServer/clutchSub/aceStreak good w=4, coldStart bad w=2) 후 **부정 보유율 16.5%·단점만 6.7%**(실측 N=30,000, ~15~16%대). simKovo 전 항목 밴드 내(볼핸들링 범실 0.70은 baseline 0.71부터의 경계값 — 반응형 무관). 부정이 계속 누적 추세라 신규 부정 추가 시 재점검.
> **Phase 2d 재측정(2026-07-27)**: 경기 맥락 상시형 2종(homeTiger/awayWarrior — 둘 다 good w=5) 추가 후 **부정 보유율 15.3%·단점만 6.3%**(실측 N=30,000, good 순증으로 ~15%대 정착). simKovo 전 항목 밴드 내. ENGINE_VERSION 15→16.
> **Phase 3 재측정(2026-07-27, 상태형 5종)**: 상태형 5종 추가(closer/comeback/fastStart/tiebreaker good 각 w=4·thinIce bad w=2) 후 **부정 보유율 15.6%·단점만 6.3%**(실측 N=30,000, ~15%대 유지). simKovo 전 항목 밴드 내. ENGINE_VERSION 16→17, 골든 v17 재생성.

| 분류 | 특성 | 효과(소폭) |
|---|---|---|
| 멘탈 | 클러치/큰경기형/**새가슴** | 듀스·세트포인트(crunch)에 focus 보정 ± |
| 성장 | 대기만성/**짧은전성기** | 노쇠율 ×0.8 / ×1.25 |
| 성장 | 노력형 | 훈련 성장 ×1.12 |
| 내구 | 철강/**유리몸** | 부상 확률 ×0.55 / ×1.7 (P4 부상에서 소비) |
| 플레이 | 서브머신 | 서브 공격성 +0.06(상시) |
| 플레이 | 리더 | (서사 라벨 — 효과 추후) |
| **플레이** | **폭격기(bomber)** | **스파이크 ×1.05 + 공격 범실 ×1.15(양날, 상시)** — §6 |
| **플레이** | **수비벽(digWall)** | **디그 성공 ×1.06(상시)** — §6 |
| **멘탈** | **꾀돌이(smart)** | **VQ ×1.05(상시)** — §6 |
| **내구** | **지구력(endurance)** | **체력재생 ×1.12(상시)** — §6 |
| **내구** | **강철체력(tank)** | **최대 체력 ×1.08(상시, drain 소모↓)** — §6 |
| **플레이** | **황금손(maestro)** | **세팅 승수 ×1.05(세터에 유효, 상시)** — §6 |

> **상시형 6종 확장(2026-07-27, Phase 1 구현)**: 위 굵은 6종은 모두 **상시형(static)** — 경기 내내 고정 배수, `player.traits`만 읽는 접근자 패턴(기존 서브머신·부상과 동일 아키텍처). 전부 good, POOL 가중 `w=7`. 설계·계수·검증은 **§6**. 반응형(경기 중 사건→임시 버프)은 **Phase 2 설계 확정·미구현**(§6).

**상극(대립)쌍 — 한 선수에 동시부여 금지**(서로 상쇄돼 무의미, `ANTAGONISTS` 정본). `rollTraits`가 뽑을 때마다 상극을 배제 집합에 추가해 원천 차단, 가드 `_dv_traits` ①이 상극쌍 0건을 봉인.

| 분류 | 상극쌍 |
|---|---|
| 멘탈 | 클러치 / 큰경기형 ↔ 새가슴 |
| 성장 | 대기만성 ↔ 짧은전성기 |
| 내구 | 철강 ↔ 유리몸 |

> **기존 세이브 영향**: ~~`data/league.ts:590`(`commitPlayerBase`)은 `p.traits`(빈배열 포함 truthy)가 있으면 그대로 유지하므로 **이미 저장된 선수는 기존 특성을 유지**하고, **새 게임·새로 생성되는 선수부터 새 규칙(1~3개·상극 없음)이 적용**된다(결정론 id 시드). 별도 마이그레이션 없음.~~
> → **정정(2026-07-27, 사용자 결정)**: 특성 20종 확장 전에 만든 세이브의 선수는 옛 규칙 특성(무특성 0개 포함·반응형 없음)을 그대로 유지해 신규 특성 기능이 안 보였다(실기기 확인). **v4→v5 자동 마이그레이션**(`store/saveMigration.ts`)으로 **구세이브 base 선수 전원의 `traits`를 `rollTraits(id)`로 재부여**(새 규칙 — 전원 1~3개·상극 없음·반응형 포함)한다. `version < 5` 게이트로 **일회성**, `traits` 필드만 교체, **과거 아카이브(HOF/시즌기록/통산기록)는 무접촉으로 보존**. 상세는 `docs/SAVE_SYSTEM.md` §3.1 v4→v5. 가드 `tools/_dv_trait_migrate.ts`.

> **★ 설명 표기 원칙(2026-07-11, 야구천재 유저 건의)**: 선수 상세 특성 뱃지 설명(`TRAITS[t].desc`)에 **실제 계수를
> 수치로 병기**한다(예: "노력형 — 훈련 효율이 높아 더 빨리 성장한다 (+12%)"). 계수는 `engine/traits.ts`의 **단일 소스
> `TRAIT_FX`** 에서 문자열로 합성(하드코딩 복제 금지) — 배수는 1.0 기준 증감%(×1.12→+12%·×0.8→20% 느림·×1.7→+70%),
> 가감 보정은 ×100 %p(+0.08→+8%). 접근자 함수도 같은 `TRAIT_FX`만 참조해 **문구와 엔진 산출이 절대 어긋나지 않는다**.
> 리더는 무효과라 "경기 효과는 없음". 가드 `tools/_dv_traitcopy.ts`가 desc 수치==계수를 A/B 자가검증으로 봉인.

## 2. 엔진 영향 = 소폭 (밸런스 안전)
- 능력치를 압도하지 않음 — "같은 값이면 특성이 가른다" 수준.
- clutch는 **crunch 상황(세트포인트 -4 이내·2점차 이내)에서만** 적용(match.ts가 playRally에 플래그).
- 회귀검증: 40시즌 sim-league parity 표준편차 4.9(기대균등 5.7), 7팀 전원 우승, 반등 정상 → 균형 유지.

## 3. 스카우트 연동 (가시성)
좋은 스카우터일수록 드래프트 유망주 특성이 보임(드래프트 화면, 추후 P 후속). 스카우트 시스템에 새 가치.

## 4. 코드 맵
- `engine/traits.ts` — `rollTraits(id)`(결정론) + 효과 접근자. 기존: agingTraitMult/trainTraitMult/injuryTraitMult/clutchFocusAdj/serveAggrAdj.
  상시형 6종(2026-07-27): **spikeTraitMult·attackErrTraitMult·digTraitMult·vqTraitMult·staminaRegenTraitMult·staminaMaxTraitMult·setTraitMult**(미부여=1배).
  경기 맥락 상시형(Phase 2d): **venueSkillMult(traits, isHome)**. 상태형(Phase 3): **stateSkillMult(traits, ctx, isHome)**·`StateCtx`(현재 세트 점수·setNo 조건부, 연출 없음). `Trait` 타입은 `types`.
- `engine/aging.ts`·`training.ts`·`rally.ts`·`match.ts` — 접근자 소폭 배선(p.traits, 기본 무효과). 상시형 6종 배선점:
  - 폭격기: `rally.ts` attackPower(`spikeTraitMult(attacker)`) + errP2(`attackErrTraitMult(attacker)`)
  - 수비벽: `rally.ts` digP(`digTraitMult(dg0)` — 최고 디거 앵커, dg0를 digP 앞으로 이동·rng 스트림 불변)
  - 꾀돌이: `rally.ts` teamVQ(`vqTraitMult(p)` — 포지션 폴트/판단)
  - 지구력: `match.ts` recover(`staminaRegenTraitMult(p)` — 랠리/세트 사이 회복)
  - 강철체력: `rally.ts` drain 분모(`staminaMaxTraitMult(p)` — 소모율↓)
  - 황금손: `rally.ts` setMul(`setTraitMult(setter)` — 팀 공격 승수)
- `data/seed.ts` — 생성 시 부여. `data/league.ts` commitPlayerBase 보정.
- `app/player/[id].tsx` — 특성 뱃지(▲좋음/▼나쁨 + 설명).
- `engine/traits.test.ts` — 결정론·분포·접근자 8케이스.

## 5. ★ 구현 현황/검증 (엔드투엔드 실측)
접근자 배선(§4)은 아래 배선 격자 5종에서 전부 연결 확인 —
`aging.ts:39`·`injury.ts:16`·`rally.ts:169,353,529`·`training.ts:124` 접근자 호출, `match.ts:233`이
crunch→playRally clutch 플래그 전달, `dynamics.ts:211`이 `p.traits`를 injuryRisk에 전달.
**배선+결정론+문서화 ≠ 효과 있음** — 아래는 엔진이 실제로 traits를 읽어 산출이 바뀌는지 **동일 시드 A/B**로
확정한 실측이다(검증·실측=Fable 5, 2026-07-07 · 가드=`tools/_dv_traits.ts`).

| # | 항목 | 조건(N) | 실측 결과 | 판정 |
|---|---|---|---|---|
| ① | traits 보유율 | 실전 선수 112명(경기 입장 객체) | ~~45/112 = **40.2%**~~ → 정정(2026-07-27): 전원 1~3개 보장으로 보유율 **100%·무특성 0·상극쌍 0**(구 40.2%는 무특성 폐지 전 값) | 가드 `_dv_traits` ①이 무특성 0/상극쌍 0/검사기 A/B로 봉인 |
| ② | 서브머신 | 팀 전원 토글·동일시드 1500경기 | 에이스 9.20→**10.29%** · 범실 8.71→**9.86%** · liveness 1498/1500 | 공격적 서브 → 에이스·범실 동반↑(방향 정상, 리스크 내재) |
| ③ | 클러치/큰경기/새가슴 | 3암 동일시드(N=4000) + 접전상대(N=3000) | 승률 80.1/79.6/**79.3%** · 접전상대 78.2/77.6/77.3% (2회 단조 서열) | **소폭 +0.5~0.9%p** — "능력치 압도 금지"(§2) 설계 부합 |
| ④ | 대기만성/짧은전성기 | 30세+ 25명·2년 노쇠 | 신체합 Δ 대기만성 **−19.04** > 무특성 −24.48 > 짧은전성기 **−32.04** | 노쇠율 ×0.8/×1.25 방향 정상 |
| ⑤ | 노력형 | 23세 이하·1년 훈련 | **전스탯합** +39.75 vs +37.17(**+7%**) | ×1.12 훈련 가속. ⚠ 지표 함정(아래) |
| ⑥ | 유리몸/철강 | 실선수·소비층(dynamics:211) 입력 재현 | 배수 **1.70·0.55**(문서값 일치) | 부상 확률 ×1.7/×0.55 정확 |

- **③ 클러치는 소폭(+0.5~0.9%p)이 설계 의도** — §2 "능력치를 압도하지 않음, 같은 값이면 특성이 가른다"에
  부합. 고분산이라 상비 배터리(`_dv_traits`)에선 제외하고, 무거운 단조 서열 검증은 measTraits 방식
  (N≥3000·접전상대 필터, 2회 이상 단조)으로 별도 수행한다.
- **⑤ 지표 함정(1차 오판 원인, 반드시 전스탯합으로 측정)**: 감독 포커스가 웨이트·컨디셔닝 등 **비기술
  스탯**을 키우면, 노력형 효과가 신체·공통·멘탈 스탯에 얹혀 **기술 6종(sk\*) 부분합만 보면 Δ0으로 위음성**이
  된다. 지표를 **전스탯합(신체+공통+멘탈+기술 15종)** 또는 XP 레이어로 잡아야 ×1.12가 검출된다.
  가드가 두 지표를 나란히 대조해 함정을 박제한다.
- **리더** = 무효과(서사 라벨 — §1 표 명시). 효과 접근자 없음.
- 상비 가드 `tools/_dv_traits.ts`: ①전원1개+상극0+검사기A/B ②에이스·범실 ON>OFF+liveness>0 ④노쇠 서열
  ⑤전스탯합 서열(기술합 함정 대조) ⑥배수 ±0.01 + **A/B 자가검증**(injuryTraitMult≡1 mutant 재현 시 ⑥ FAIL 증명).
  **상시형 6종 방향검증(2026-07-27)**: ⑦폭격기(동일시드 N=300 킬%↑+공격범실%↑+liveness>0 + **무효과세계 OFF/OFF 재현으로 ⑦ 오라클 FAIL 증명**)
  ⑧수비벽(디그 성공↑) ⑨황금손(팀 킬%↑) ⑩꾀돌이(vqTraitMult 보유>무·무==1) ⑪강철체력(유효 최대체력 보유>무) ⑫지구력(recover 후 체력 보유>무). exit 0/1.
- **상시형 6종 실측(2026-07-27, N=300 동일시드 A/B · 엔진 ENGINE_VERSION 13)**: 폭격기 킬 42.16→42.77%·공격범실 5.79→6.55%(양날) · 수비벽 디그 18054→18595 · 황금손 팀킬% 41.41→42.16% — 전부 방향 정상·소폭(§2 "능력치 압도 금지" 부합). 계수는 placeholder(방향만 확정, 크기 튜닝은 메인).

---

## 6. 특성 버킷 2종 & 대폭 확장 (2026-07-27, 독립 리뷰 반영 확정 설계)

특성을 아키텍처로 **2개 버킷**으로 나눈다 — 기존 특성은 전부 상시형이고, 확장은 상시형(즉시)과 반응형(신규 레이어)으로 갈린다.

### 6.1 버킷 정의
- **상시형(static)**: 경기 내내 **고정 배수**. 기존 접근자 패턴(`player.traits`만 읽음, 미부여=1배 → 결정론 골든 보존).
  신규 엔진 상태 없음. ← **Phase 1(이번 구현)은 전부 여기.**
- **반응형(reactive)**: 경기 중 **사건→임시 버프→N랠리/타임아웃/스트릭끊김에 해제**. 신규 엔진 레이어(활성 버프 상태 보유).
  ← **Phase 2(설계 확정·이번 미구현).**

### 6.2 상시형 신규 6종 (Phase 1 — 구현 완료 2026-07-27)

| id | 한글명 | 효과 | good | cat | 계수(TRAIT_FX) | 배선점 |
|---|---|---|---|---|---|---|
| bomber | 폭격기 | 스파이크↑ + 공격 범실↑(양날) | ✅ | 플레이 | bomberSpike 1.05 · bomberErr 1.15 | rally attackPower·errP2 |
| digWall | 수비벽 | 디그 성공↑ | ✅ | 플레이 | digWallDig 1.06 | rally digP(최고 디거 앵커) |
| smart | 꾀돌이 | VQ↑ | ✅ | 멘탈 | smartVq 1.05 | rally teamVQ(포지션 폴트/판단) |
| endurance | 지구력 | 체력재생(staminaRegen)↑ | ✅ | 내구 | enduranceRegen 1.12 | match recover |
| tank | 강철체력 | 최대 체력(staminaMax)↑ | ✅ | 내구 | tankStaminaMax 1.08 | rally drain 분모(소모↓) |
| maestro | 황금손 | 세팅 승수↑(세터 유효) | ✅ | 플레이 | maestroSet 1.05 | rally setMul |

- 전부 good·POOL `w=7`. 부정 특성(choke/earlyDecline/glass 2/2/2)은 **불변**(부정 보유율은 메인이 재측정·튜닝).
- 계수는 **소폭 placeholder** — 방향만 확정, 크기는 메인이 sim 후 튜닝. `desc`는 `TRAIT_FX`에서 문자열 합성(§표기 원칙, 가드 `_dv_traitcopy`).
- 미부여 선수 무영향(접근자 1배) → 기존 결정론 골든(unit 218/218)·rng 스트림 불변 실측.

### 6.3 반응형 설계 (Phase 2a ✅ 조커/유리멘탈/오뚝이 · Phase 2b ✅ 낯가림/핀치서버/대타승부사/에이스기세 · UI 연출=2c ✅ — 전부 2026-07-27 구현)

순간형 반응형을 **신규 엔진 레이어**로 도입: 조커·유리멘탈·오뚝이(**Phase 2a 구현**) + 낯가림·핀치서버·대타승부사·에이스기세(**Phase 2b 구현 2026-07-27** — 2a 레이어[activeBuffs·reactiveSkillMult·±10%캡·트리거·reactiveEvents] 그대로 재사용, 연출[현수막·마커]은 2c가 reactiveEvents 기반이라 자동 적용).
- 골격: `{ 방아쇠 · 효과(소폭±) · 지속(5랠리) · 해제(타임아웃/세트끝) · 현수막 · 마커 테두리색 }`.
- **아키텍처(구현 확정)**:
  - `RallyTeam.activeBuffs: Map<playerId, ~~ActiveBuff[]~~ → **ActiveBuff**>` **필드**로 전달 — `playRally` 인자로 넘기지 않는다(이미 인자 ~18개). momentum/stam/injured 이웃의 경기중 임시상태. 정정(2026-07-27 구현): **선수당 최대 1개**라 배열이 아닌 **단일 ActiveBuff**(Map 덮어쓰기로 강제 — 배열이면 스택 회계가 필요없는데 복잡).
  - 방아쇠 판정 = `match.ts`(교체 투입=조커·`subIn`, 블로킹 당함=stuff/범실=atkErr → 유리멘탈/오뚝이·랠리 종료 후 `RallyOutcome.atkerId` 읽기), 효과 적용 = `rally.ts`가 필드 읽기, 지속/해제 = `match.ts` 랠리/타임아웃/세트 루프.
  - ~~**`effStat(t, p, skill)` 헬퍼 선도입** — 정적 배수 + 반응 버프 + 하드캡을 한 곳에서 합성(현재 흩어진 접근자 통합 리팩터가 선결).~~ → 정정(2026-07-27 구현): effStat 통합 리팩터는 **하지 않았다**(맥락 의존 안방호랑이/원정형이 없는 2a에선 불필요). 대신 기존 정적 접근자 배선(spikeTraitMult 등) 지점에 **`reactiveSkillMult(buff, skill)` 곱셈 한 겹**을 추가(spike/serve/dig/block/set/receive)하고, 집중 계열은 clutchFocusAdj 옆에 `reactiveFocusAdj(buff)` 가산. 맥락 의존 상시형(§6.5)을 붙일 때 effStat 재검토.
  - **선수당 반응형 동시 발동 1개 + 스킬 유효배수 하드캡 ±10%(reactiveSkillMult ∈ [0.90,1.10]) · 집중 보정 ±0.10**(스노볼 방지, `reactiveClampSkill`/`reactiveClampFocus`).
- **구현 7종(effStat 없이 접근자 곱셈·미부여=1배/0 → 결정론 골든 보존)**:

| id | 한글명 | good | 방아쇠 | 효과(소폭 placeholder) | 지속 | Phase |
|---|---|---|---|---|---|---|
| joker | 조커 | ✅ | 교체로 코트 투입(작전 교체 in, `subIn`) | 전 스킬 ×1.04(reactiveSkillMult 전스킬) | 5랠리 | 2a |
| fragile | 유리멘탈 | ✗ | 내 공격이 블로킹 당함(stuff) | 스파이크 ×0.97 + 집중 −0.05(공격/서브 정확도↓) | 5랠리 | 2a |
| bounce | 오뚝이 | ✅ | 블로킹 당함(stuff) or 내 범실(atkErr) | 집중 +0.05 | 5랠리 | 2a |
| coldStart | 낯가림 | ✗ | 교체로 코트 투입(조커와 동일 트리거, `subIn`) | 전 스킬 ×0.96(reactiveSkillMult 전스킬 · debuff) | 5랠리 | 2b |
| pinchServer | 핀치서버 | ✅ | 교체 IN이 서브 로테이션 슬롯에 서고 그 팀 서브 차례(`subIn`, `side===serving && slot===serverIndex`) | 서브 ×1.05 | 5랠리 | 2b |
| clutchSub | 대타승부사 | ✅ | 교체 투입 후 **첫 공격**(`RallyTeam.clutchArmed` 플래그 → rally.ts 첫 스윙 소비) | 스파이크 ×1.08 | **1랠리(첫 공격)** | 2b |
| aceStreak | 에이스기세 | ✅ | 서브 에이스 성공(`how==='ace'`, 서버=`byId`) | 서브 ×1.05 | 5랠리 | 2b |

  - 계수는 `TRAIT_FX.reactive*`(단일 소스, desc 합성·가드 `_dv_traitcopy` 대조). **소폭 placeholder** — 방향만 확정, 크기는 메인이 sim 후 튜닝.
  - POOL 가중: joker/bounce w=5·pinchServer/clutchSub/aceStreak w=4(good), fragile/coldStart w=2(bad). 부정 보유율은 메인이 재측정(good 다수 추가로 희석 → 재상향 필요할 수 있음).
  - **ANTAGONISTS**: fragile↔bounce(막히면 흔들림 ↔ 막혀도 다시 집중 = 상쇄) · **joker↔coldStart**(교체 투입 시 살아남[buff] ↔ 적응 못 함[debuff] = 같은 트리거의 정반대라 상쇄).
  - **대타승부사(clutchSub) 아키텍처(예외)**: 다른 6종은 `activeBuffs`(선수당 1개 Map·5랠리 tick)를 쓰지만, clutchSub는 "첫 공격 1랠리"라 `RallyTeam.clutchArmed: Set`(arming 플래그)로 분리. `subIn`이 arming만 하고(카운트/이벤트 없음), `rally.ts`가 그 선수의 첫 공격 스윙에서 1랠리 clutchSub 버프를 합성(스파이크 ×1.08)하고 즉시 `clutchArmed.delete`. `match.ts`가 랠리 전후 `clutchArmed` 스냅샷 비교로 발동을 감지해 카운트+reactiveEvents(1랠리 창)를 기록. 타임아웃/세트끝엔 미발동 arming도 조용히 clear(발동 전이라 이벤트/카운터 없음). 서브 버프 2종(핀치서버=`subIn`, 에이스기세=`how==='ace'` push 직후)은 표준 activeBuffs 경로.
- **지속·해제 규칙(구현)**:
  - 각 랠리 종료 후 `tickReactiveBuffs`로 `left--`, 0이면 제거(발동 랠리 포함 5랠리 활성).
  - **타임아웃**(감독 자동·개입·테크니컬 TTO) 발생 시 양 팀 `activeBuffs` 전체 clear.
  - **세트 종료** 시 양 팀 clear(다음 세트 누수 0).
  - **선수당 1개**: 같은 id에 서로 다른 트리거가 와도 Map.set 덮어쓰기 → 단일 유지(마지막 트리거 승). fragile↔bounce는 ANTAGONISTS로 한 선수 동시부여 원천 차단 + 발동 시엔 Map 단일이라 이중 안전.
- **연출 스펙(확정 — 아티팩트 사용자 승인, UI 배선=Phase 2c ✅ 구현 2026-07-27 — §6.10)**: 발동 시 **현수막 1회** + **마커 테두리색 tint 변경**(~~테두리 점등~~ → ~~펄스 글로우 헤일로(#136)~~ → **마커 보더 tint**(재정정 2026-07-29 테스터, §6.10) — 별도 레이어 없이 마커 테두리색 자체를 tint로)(버프=금·에메랄드 / 디버프=적). **지속 텍스트/카운트다운 없음**(관전 소음 방지). 5랠리·타임아웃 해제·선수당 1개. 상태형(§6.4)은 여전히 연출 없이 조용히.
- **결정론(구현 확정)**: 반응형 특성 미부여 선수는 `activeBuffs`에 엔트리 없음·`clutchArmed` 빈 집합 → `reactiveSkillMult`=1·`reactiveFocusAdj`=0 → **완전 무영향**(무보유 리그 바이트 동일 — 가드 `_dv_reactive` (a) 실측 activations=0·maxBuffs=0·동일시드 재현). 단 **POOL에 반응형 추가로 시드 리그 선수의 rollTraits 분포가 바뀌어 seeded-league 결과가 변동 → `ENGINE_VERSION` 범프**(2a: 13→14 · **2b: 14→15**, 이벤트 발동형 4종 POOL 추가). REALTIME_SIM 결과캐시 게이트가 옛-엔진 저장 순위 폐기·재계산. **골든 재생성**(`_dv_golden --update`)·KOVO 분포/parity 재수렴·부정 보유율 재측정은 **메인**이 판단(반응형은 시드 결과를 바꾸므로 임의 골든 갱신 금지).
- **상비 가드 `tools/_dv_reactive.ts`**: (a)무해성(미부여 activations 0·바이트 동일)+민감도(de-confounded 조커 sub 결과 변동) (b)7종 발동(조커/유리멘탈/오뚝이 + 낯가림[교체 투입]/핀치서버[서브슬롯 교체]/대타승부사[첫 공격]/에이스기세[서브 에이스], 각 control/strip=0) (c)5랠리 만료·타임아웃 clear·세트끝 clear(expires/clears 카운터로 격리) (d)선수당 1개(Map 단일) (e)하드캡 극단값 clamp (f)방향 A/B(직접 playRally 하네스 — 조커·대타승부사 킬%↑·유리멘탈·낯가림 킬%↓·핀치서버·에이스기세 홈 서브에이스%↑ + OFF/OFF 자가검증 2종). 관측은 `debugReactive`(debugSimCalls 패턴, rng 무영향). 실측(N=400, ENGINE_VERSION 15): 킬% NONE 42.08 → 조커 44.08·대타승부사 44.26·유리멘탈 40.87·낯가림 40.40 · 서브에이스% NONE 4.15 → 핀치서버·에이스기세 각 4.58.

### 6.4 상태형 (state-based) 5종 (Phase 3 ✅ 구현 2026-07-27) — 조건부 상시·연출 없음
반응형(§6.3)과 달리 **사건→임시 버프가 아니라 clutch처럼 현재 랠리의 경기 국면**(현재 세트 home/away 점수·setNo)이
조건을 만족하는 **동안만** 고정 배수를 곱한다. 상시형이지만 배수가 `player.traits`뿐 아니라 **경기 국면**에도 의존
(venue가 홈/원정에 의존하는 것과 같은 결). **연출 없음**(현수막·마커 X·`reactiveEvents` 미발행 — 조용한 국면 보정,
관전 소음 방지). 사용자 확정("조용히 수치만").

| id | 한글명 | 조건(active while) | 효과 | good | cat | 상극 |
|---|---|---|---|---|---|---|
| **closer** | 뒷심 | 현재 세트 최고 점수 ≥ 20 (세트 후반) | 전 스킬 ×1.03 | true | 멘탈 | fastStart |
| **fastStart** | 초반집중 | 현재 세트 최고 점수 ≤ 10 (세트 초반) | 전 스킬 ×1.03 | true | 멘탈 | closer |
| **comeback** | 역전의명수 | 그 선수 팀이 현재 세트 뒤지는 중(내 점수 < 상대) | 전 스킬 ×1.03 | true | 멘탈 | thinIce |
| **thinIce** | 살얼음 | 그 선수 팀이 뒤지는 중(내 점수 < 상대) | 전 스킬 ×0.97 | false(양날) | 멘탈 | comeback |
| **tiebreaker** | 5세트의 여왕 (2026-07-28 순화, ~~사나이~~ — 여자부 남성어 제거, `_dv_copylint`) | 현재 세트 == 5세트 | 전 스킬 ×1.03 | true | 멘탈 | — |

- **계수**: `TRAIT_FX.{closer,fastStart,comeback,thinIce,tiebreaker}Mul`(±3% placeholder — 방향만 확정, 크기 튜닝은 메인).
  desc는 이 상수에서 합성(조건 문구 명시, 가드 `_dv_traitcopy` 대조). 상극쌍 `ANTAGONISTS`(양방향): closer↔fastStart(반대 국면)·comeback↔thinIce(같은 국면 정반대).
- **POOL 가중**: good 4종(closer/comeback/fastStart/tiebreaker) 각 `w=4`, bad(thinIce) `w=2`. 부정 보유율은 메인 재측정(§1).
- **배선(rally.ts)**: `stateSkillMult(traits, ctx, isHome)`(ctx={homeScore, awayScore, setNo})를 venue·reactive와 **같은 층에
  한 겹** 곱 — serve(svPow)·receive(strength)·set(setMul)·spike(attackPower)·block(blockEval)·dig(digP). `match.ts`가 랠리 직전
  점수(h,a,setNo)로 StateCtx를 만들어 `playRally(..., state)`에 넘긴다. isHome=`RallyTeam.isHome`(comeback/thinIce의 "내 점수" 선택).
  직접 playRally 하네스가 state 미전달 시 기본값 `NEUTRAL_STATE`(15:15·1세트 — 어느 조건도 미충족 → 완전 무영향).
- **연출 없음**: `reactiveEvents`에 상태형이 안 실린다 — 상태형만 부여된 리그도 reactiveEvents는 반응형 7종만(보드 배너·마커 무변화). 뱃지 설명만.
- **결정론**: ctx는 경기 입력(점수/세트) 파생 → **rng 무소비**(스트림 순서·횟수 불변). 미부여·조건 미충족 선수 완전 무영향
  (stateSkillMult=1배 → 바이트 동일). 단 POOL에 5종 추가로 시드 리그 rollTraits 분포가 바뀌어 seeded-league 골든 변동 →
  **ENGINE_VERSION 16→17 범프**(골든 재생성·KOVO 분포/parity 재수렴은 메인 — 임의 `--update` 금지).
- **스택 상한**: 선수당 최대 3특성(rollTraits)이라 곱 레이어 ≤3(정적×venue×state 등) + 상극(closer↔fastStart·comeback↔thinIce)으로
  같은 방향 이중 곱 차단. 계수 소폭(±3%) 유지.
- **상비 가드 `tools/_dv_traits.ts` ⑮**: ⑮-1 stateSkillMult 단위(충족=계수·미충족/미부여=1·comeback/thinIce는 **뒤지는 팀만**
  isHome 선택) + ⑮-2 방향(직접 playRally 하네스, N=500·국면 ctx 고정) — **충족 국면에서만** 뒷심/초반집중/역전/5세트 킬%↑·살얼음↓,
  **미충족 국면 효과 0**(조건 게이팅) + 자가검증(미충족 국면 특성 보유 == 무보유 = stateSkillMult≡1 세계 바이트 동일 → 방향 오라클 이빨).
  실측(N=500·동일시드): 충족 킬% 40.96→42.59(뒷심/초반집중/역전/5세트)·40.96→40.32(살얼음), 미충족 40.96=off(효과 0).

### 6.5 경기 맥락 상시형 (Phase 2d ✅ 구현 2026-07-27) — 홈/원정 조건부 고정 배수
반응형(§6.3)과 달리 **사건 발동이 아니라 홈/원정에 따라 경기 내내 고정** 보정이다. 상시형이지만 배수가
`player.traits`뿐 아니라 **경기 맥락(side)** 에도 의존한다(홈이냐 원정이냐). `effStat` 도입을 기다리지 않고
per-player 정적 배수 헬퍼 `venueSkillMult(traits, isHome)`로 바로 구현(반응형 `reactiveSkillMult`과 같은 층에 한 겹 곱).

| id | 한글명 | 효과 | good | cat | 상극 |
|---|---|---|---|---|---|
| **homeTiger** | 안방 호랑이 | 홈경기면 전 스킬 ×1.03 / 원정이면 ×0.97 | true(양날) | 멘탈 | awayWarrior |
| **awayWarrior** | 원정형 | 원정이면 전 스킬 ×1.03 / 홈이면 ×0.97 | true(양날) | homeTiger |

- **계수**: `TRAIT_FX.venueBonus=1.03`·`venuePenalty=0.97`(두 특성 공유, ±3% placeholder). desc는 이 상수에서 합성
  ("홈에서 강하다 — 홈 전 능력 +3%·원정 −3%" 식 양쪽 병기, 가드 `_dv_traitcopy` 대조). 상극쌍 `ANTAGONISTS`(양방향).
- **POOL 가중**: 각 `w=5`(둘 다 good). 추가 후 부정 보유율 영향은 미미(둘 다 good) — 재측정은 메인.
- **배선점(rally.ts)**: `reactiveSkillMult`을 곱하는 그 지점들에 `× venueSkillMult(p.traits, isHome)` 한 겹 더 —
  serve(svPow)·receive(strength 'receive')·set(setMul)·spike(attackPower)·block(blockEval)·dig(digP). `isHome`은 해당
  `RallyTeam.isHome`(=fixture 홈팀이면 true). **미부여=1배(무영향 → 결정론 골든 보존)**.
- **⚠ 배선 확인(리뷰 지적)**: `simulateMatch(seed, homePlayers, awayPlayers)`의 `homePlayers`가 항상 fixture 홈팀이고
  match.ts가 그 팀으로 `home: RallyTeam{isHome:true}`을 만든다(grep 확인). playRally는 `home`을 늘 `home` 인자로 넘긴다 →
  `home` RallyTeam은 항상 fixture 홈. 기존 홈 어드밴티지 `edge`(팀 전체 승수)와 **방향은 같으나 별개 레이어**다 —
  `edge`는 팀 단위, `homeTiger`는 per-player 소폭(±3%). 크기가 소폭이라 **이중계산 겹침 허용**(설계상 명기).
- **연출 없음**: 상시형이므로 현수막·마커 연출을 붙이지 않는다(반응형 §6.3만 연출). 뱃지 설명만.
- **결정론**: home/away는 경기 입력에서 결정(rng 무소비). 미부여 선수 무영향 → 골든 변동은 POOL 추가로 인한 rollTraits
  분포 이동분만(그래서 **ENGINE_VERSION 15→16 범프** — 골든 재생성은 메인).

### 6.6 보류
- **맞수 본능 = 보류**. 엔진에 라이벌 데이터 모델이 없다 → 없는 인과를 지어내는 건 **가짜 드라마 금지** 위반.
  실데이터 라이벌(구단 라이벌·상대 전적)이 생기면 재검토.

### 6.7 명명·연출 정책
- **지속 단위 = "N랠리"**(랠리포인트제 = 랠리 1번 = 1점). "N포인트" 아님.
- **연출**: 순간형 반응형만 현수막·마커 ~~테두리색~~ ~~펄스 글로우 헤일로(#136)~~ **테두리 tint**(재정정 2026-07-29 테스터, §6.10 — 별도 헤일로 폐기, 마커 보더색 자체 변경). **상태형은 조용히**(수치만). 상시형은 뱃지 설명만(연출 없음).

### 6.8 Phase 계획
| Phase | 범위 | 상태 |
|---|---|---|
| **P1** | 상시형 6종(bomber/digWall/smart/endurance/tank/maestro) | ✅ 구현 완료(2026-07-27) |
| **P2a** | 반응형 3종(조커/유리멘탈/오뚝이) + `RallyTeam.activeBuffs`(선수당 1개) + `reactiveSkillMult`/`reactiveFocusAdj`(±10%/±0.10 캡) + ENGINE_VERSION 13→14 범프 + 가드 `_dv_reactive` | ✅ 구현 완료(2026-07-27, 엔진 레이어. UI 연출=2c) |
| **P2b** | 반응형 이벤트 발동형 4종(낯가림/핀치서버/대타승부사/에이스기세) — 2a 레이어 재사용(activeBuffs·reactiveSkillMult·±10%캡·reactiveEvents 자동 연출) + `RallyTeam.clutchArmed`(대타승부사 첫 공격 플래그) + joker↔coldStart 상극 + ENGINE_VERSION 14→15 범프 | ✅ 구현 완료(2026-07-27). 안방호랑이/원정형(맥락 의존 → `effStat`)은 P2 후반으로 이월 |
| **P2c** | 반응형 UI 연출(현수막 발동 1회 + 마커 테두리색 tint, 지속 텍스트 없음 — §6.3 연출 스펙·§6.10). ~~정적 링~~→~~펄스 글로우 헤일로(#136)~~→**마커 보더 tint**(재정정 2026-07-29 테스터) | ✅ 구현 완료(2026-07-27, 연출 재정정 2026-07-29) |
| **P2d** | 경기 맥락 상시형 2종(안방호랑이/원정형) — `venueSkillMult(traits, isHome)`(홈/원정 고정 ±3% per-player, `reactiveSkillMult`과 같은 층에 한 겹) + `RallyTeam.isHome`(fixture 홈=true) + homeTiger↔awayWarrior 상극 + ENGINE_VERSION 15→16 범프. 상시형이라 **연출 없음**(§6.5) | ✅ 구현 완료(2026-07-27) |
| **P3** | 상태형 5종(closer/fastStart/comeback/thinIce/tiebreaker) — `stateSkillMult(traits, ctx, isHome)`(현재 세트 점수·setNo 조건부 상시 ±3%, venue와 같은 층에 한 겹) + StateCtx를 match.ts가 랠리 직전 점수로 만들어 playRally에 전달 + closer↔fastStart·comeback↔thinIce 상극 + ENGINE_VERSION 16→17 범프. **연출 없음**(§6.4·§6.7 — reactiveEvents 미발행) | ✅ 구현 완료(2026-07-27) |
| **P4** | 밸런스 튜닝(부정 보유율 재측정·simKovo 밴드·계수 확정) | 설계 |

### 6.10 반응형 연출 배선 (Phase 2c ✅ 구현 2026-07-27)

엔진에서 이미 도는 반응형 특성(§6.3, 현재 7종)을 **경기 보드에 노출**한다. 순수 표현 배선 — 경기 결과·rng 스트림 불변.
> **Phase 2b 4종 자동 연출(2026-07-27)**: 낯가림/핀치서버/대타승부사/에이스기세는 `reactiveEvents`에 실려 **추가 UI 작업 없이** 배너·마커가 붙는다 — 배너 라벨 `TRAITS[trait].name`(일반 파생), 마커 보더 tint `reactiveTint` **폴백**(buff=금·debuff=적, 낯가림=적/나머지 3종=금), 배너 아이콘은 폴백 `alert-circle`(joker=flash·bounce=refresh 외). 전용 색/아이콘 세분은 필요 시 후속.

- **엔진 출력 추가(결과 불변)**: `SimResult.reactiveEvents: ReactiveEvent[]`(정본 `engine/simMatch.ts`).
  `{ pointIndex, playerId, trait, kind:'buff'|'debuff', startPoint, endPoint }` — **발동 시점 + 활성 창**(point 인덱스 = 랠리 인덱스).
  이미 계산되는 `activeBuffs` 발동/만료/해제에서 **파생만**(새 rng 소비 0). `match.ts`가 버프 set 지점에서 `openReactive`,
  tick 만료·타임아웃/세트끝 clear 지점에서 `closeReactive(endPoint = points.length−1)`로 창을 닫는다.
  - `pointIndex` = 트리거 게임사건 랠리(조커=교체 투입 랠리 = startPoint · 유리멘탈/오뚝이=블로킹 당함/범실 랠리 = startPoint−1) — 보드 배너 1회 표출 키.
  - `startPoint` = 버프가 처음 영향 주는 랠리(= 버프 set 시점 `points.length`) · `endPoint` = 마지막 영향 랠리(해제 시점 `points.length−1`, 즉시 해제면 < startPoint = 무영향 창).
  - 미부여 경기는 **빈 배열**(활성 0). 반응형 미부여 리그면 바이트 동일.
- **★ 골든 무영향(표현 출력)**: `_dv_golden serializeMatch`는 `reactiveEvents`를 **읽지 않는다**(코어 결과=세트/스코어/scorer/how/byId/recvId/box 집계만 해시). 따라서 이 필드 추가로 골든 해시 불변 → **골든 PASS 유지·ENGINE_VERSION 범프 불필요**(코어 결과 바이트 불변).
- **보드 배선**(순수 표현, 재생 축 = 엔진 트레이스 소비):
  - **현수막 1회**: `app/match/[id].tsx`가 `reactiveEvents`를 라이브 배너 소스에 합류 — 재생 위치(`score.ptIdx`)가 `pointIndex`에 도달하면 기존 라이브 배너 큐(`BroadcastBanner`)에 "○○○ · 조커 발동" 1회 push(스포일러 정책상 실시간 연출은 관전 중 노출 OK, 기존 `pushedBanners` dedup·`initialPtIdx` 재개 가드 공유).
  - **마커 테두리 tint**: `MatchCourt`가 현재 재생 랠리(`idx`)가 `[startPoint, endPoint]` 창 안이면 그 `playerId` 마커의 **테두리색 자체를 tint로 변경**(버프=금[조커]/에메랄드[오뚝이] · 디버프=적[유리멘탈]) + 발동 가시성용 테두리 굵기↑(2.5→3.2) + 옅은 tint 글로우 shadow. 창 밖이면 기존 POS_COLOR 실선으로 복귀. **지속 텍스트/카운트다운 없음**.
    - ~~**정정(2026-07-27, #136 — 정적 링 → 펄스 글로우 헤일로)**: 마커 바깥 정적 색 링(`styles.reactiveRing`, borderColor/shadow=tint)은 포지션 마커 링 색과 겹쳐 반응형 발동이 시각적으로 안 구분됐다(에뮬 실기기 확인). → 펄스 글로우 헤일로(`styles.reactiveHalo`)로 교체: 마커 바깥 별도 레이어(포지션 실선보다 큰 반경 +7px) + 옅은 글로우 채움 + 맥동 펄스(scale 1.0↔1.12 · opacity 0.55↔1.0, ~1.8s 왕복 루프). 성능: 단일 공유 Animated.Value(pulse) 하나로 마운트 시 1회 Animated.loop.~~
    - **재정정(2026-07-29, 테스터 — 별도 헤일로 레이어 → 마커 보더 tint)**: 테스터가 "별도 링 말고 **마커 자체 테두리 색**을 바꿔 달라"(오뚝이 등 버프 켜진 게 마커 테두리로 보이게) 요청. #136에서 "포지션색 겹침" 우려로 halo를 택했으나, **포지션 구분은 마커 밑 이름표(`{position} {name}`, POS_COLOR)에 이미 있어** 보더색을 tint로 바꿔도 포지션 식별이 유지된다(사용자 확인). → **별도 `reactiveHalo` 레이어(맥동 펄스 글로우) 제거**(styles.reactiveHalo·공유 `pulse` Animated.Value·loop·haloScale/haloOpacity 정리). 대신 `m.reactive`면 마커 `borderColor = m.reactive.tint`·`borderWidth 3.2`(미발동 2.5)·tint shadow 글로우(정적). **맥동 애니 제거**(관전형 무마찰 + 항상 도는 loop 제거로 발열 #122 완화 — 색+굵기+글로우로 발동 충분히 구분). 교체/서브/브레이스 등 다른 마커 상태는 보더 불변(reactive만 tint) — 기존 정책 유지.
  - 색·활성창 판정은 순수 셀렉터 `courtDirector.reactiveActiveAt(sim, ptIdx)`·`reactiveTint(trait,kind)`(단일 소스 — 보드가 독립 재계산 안 함, 엔진 산출 그대로 소비 → 개입/재생 3경로 정합).
- **상비 가드 `tools/_dv_reactive.ts` (g)**: reactiveEvents 결정론(동일 시드 = 동일 이벤트) + 활성 창이 실제 버프 지속과 정합(startPoint/endPoint가 `debugReactive` 발동/만료 카운트와 일치) + 미부여 리그 빈 배열 + 골든 무영향(serializeMatch 해시 불변) A/B.

### 6.9 독립 리뷰 결론 (2026-07-27)
후보 17종을 리뷰해 **채택/축소**: 17종을 그대로 넣지 않고 → **순간형 반응형 소수(7종)만 신규 레이어**로,
**상태형은 조용히(연출 없이 수치만)**. **뺀 것**: ① **맞수 본능**(엔진에 라이벌 인과 없음 = 가짜 드라마) ②
**상태형의 현수막·마커 연출**(관전 소음 — 조용한 국면 보정으로 격하). 아키텍처 교훈: 반응형은 인자 폭발을 피해
`RallyTeam` 필드 + `effStat` 통합 헬퍼로, 스노볼은 동시 1개·하드캡 ×1.10으로 봉인.
