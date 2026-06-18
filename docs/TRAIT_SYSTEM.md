# 선수 특성 (Traits) — 설계/구현 문서

> 같은 OVR이라도 다르게 느껴지는 선수 — 숫자 뒤의 성격(②서사 + ④단장결정).
> "큰 경기에 강함 / 유리몸 / 대기만성"이 영입을 *도박*으로 만든다.

## 0. ★ 결정론 원칙 (최우선)
**엔진은 `player.traits`(명시적 데이터)만 읽는다. id로 추론하지 않는다.**
특성은 생성 시점(seed/rookies)에 `rollTraits(id)`로 부여되고 엔진은 그 필드를 읽을 뿐.
→ traits 없는 합성 테스트 선수는 무영향 → **기존 결정론 골든 테스트 100% 보존**(검증됨).
구세이브: `commitPlayerBase`에서 없으면 id 시드로 보정.

## 1. 특성 (긍정+부정, 희소가 특별)
대부분 0개 · 가끔 1개 · 드물게 2개(rollTraits 분포). 좋은 특성이 흔하고 부정은 드물게(도박 성립).

| 분류 | 특성 | 효과(소폭) |
|---|---|---|
| 멘탈 | 클러치/큰경기형/**새가슴** | 듀스·세트포인트(crunch)에 focus 보정 ± |
| 성장 | 대기만성/**짧은전성기** | 노쇠율 ×0.8 / ×1.25 |
| 성장 | 노력형 | 훈련 성장 ×1.12 |
| 내구 | 철강/**유리몸** | 부상 확률 ×0.55 / ×1.7 (P4 부상에서 소비) |
| 플레이 | 서브머신 | 서브 공격성 +0.06(상시) |
| 플레이 | 리더 | (서사 라벨 — 효과 추후) |

## 2. 엔진 영향 = 소폭 (밸런스 안전)
- 능력치를 압도하지 않음 — "같은 값이면 특성이 가른다" 수준.
- clutch는 **crunch 상황(세트포인트 -4 이내·2점차 이내)에서만** 적용(match.ts가 playRally에 플래그).
- 회귀검증: 40시즌 sim-league parity 표준편차 4.9(기대균등 5.7), 7팀 전원 우승, 반등 정상 → 균형 유지.

## 3. 스카우트 연동 (가시성)
좋은 스카우터일수록 드래프트 유망주 특성이 보임(드래프트 화면, 추후 P 후속). 스카우트 시스템에 새 가치.

## 4. 코드 맵
- `engine/traits.ts` — `rollTraits(id)`(결정론) + 효과 접근자(agingTraitMult/trainTraitMult/injuryTraitMult/clutchFocusAdj/serveAggrAdj). `Trait` 타입은 `types`.
- `engine/aging.ts`·`training.ts`·`rally.ts`·`match.ts` — 접근자 소폭 배선(p.traits, 기본 무효과).
- `data/seed.ts` — 생성 시 부여. `data/league.ts` commitPlayerBase 보정.
- `app/player/[id].tsx` — 특성 뱃지(▲좋음/▼나쁨 + 설명).
- `engine/traits.test.ts` — 결정론·분포·접근자 8케이스.
