# 스태프 계약 시스템 (STAFF_SYSTEM)

> 단장이 **감독·전문 코치·스카우터**를 스태프 예산 안에서 영입/방출한다. (2026-06-09 신설)
> 결정론 유지: 모든 효과는 순수 함수, 풀은 시드 생성, 계약 상태만 세이브.

## 1. 역할과 효과 — 감독=방향, 코치=상한/수명, 스카우터=정보

| 역할 | 효과 | 통합 지점 |
|---|---|---|
| **감독(head)** | 성향(공/수/밸 → 경기)·카리스마(타임아웃 기세폭)·**훈련선호(어떤 스탯이 크는지=방향)** | `coachInfoOf`·`teamFocus` — 영입 시 시드 감독 대체 |
| **전문 코치(assistant)** | **분야별 다른 효과**(아래). 같은 분야 최고 1명만. **팀당 슬롯 `COACH_SLOTS=3`** | `engine/staff.ts staffEffects` → `evolvePlayer`(훈련·노쇠) |
| **스카우터(scout)** | 유망주 **공개도↑**(표시 안개) + **실제 지명 정확도↑**(공개도 낮으면 가치 오판, AI/단장) | `teamScoutReveal` → `draft.tsx`(표시)·`aiDraftPick`(픽 노이즈) |

**전문 코치 분야별 효과** (현실 코치진 — 더 빨리만이 아니라 더 높이/더 오래):

| 분야 | 효과 | 대상 |
|---|---|---|
| 공격/수비/세터(**기량**) | 해당 스탯 **숨은 포텐셜 상한 +α**(역량100=+5) + 성장 속도↑ | 공격→스파이크·서브 / 수비→리시브·디그·블록 / 세터→세팅·VQ |
| **체력** | **노쇠 하락 둔화**(역량100=−45%, 전성기 연장) + 피지컬 속도↑ | jump·staminaMax·staminaRegen |
| **멘탈** | 집중·기복 **포텐 상한↑** + 멘탈 속도↑ | focus·consistency |

> 포텐 상한 상향(`potBonus`)이 핵심 — 선수를 *진짜 더 잘하게* 만들어 경쟁에 반영(속도 가속만으론 약했음).

## 2. 예산(연봉 연동)

- 팀 **스태프 예산 `STAFF_BUDGET = 60000`만**. (감독 + 코치 + 스카우터) 연봉 합 ≤ 예산.
- 연봉(역량 비례): 감독 13.5k~18.5k · 코치 9.5k~13.1k · 스카우터 8k~11.2k.
- **최고급 풀세트는 예산 초과** → 어디에 투자할지 단장 의사결정(핵심 기둥 4).
- 영입은 `hireHeadCoach/hireAssistant/hireScout`가 예산·중복을 판정(초과면 false).

## 3. 데이터 흐름 (SOLID 준수)

```
UI(app/staff.tsx, draft.tsx) → 셀렉터(data/league.ts) → 엔진(engine/staff.ts)
```
- 풀 생성: `data/seed.ts generateLeague` → `League.{coaches(+프리), assistants, scouts}`.
- 계약 상태: `data/league.ts` `headCoachOverride·teamAssistantIds·teamScoutIds`.
- 영속화: `store/useGameStore.ts` `staffHead·staffAssistants·staffScouts`(persist) → 재수화 시 `commitStaff`.
- 캐시 무효화: 감독·코치 영입은 훈련/경기 영향 → `evoCache` 무효화 + `_baseVersion++`. 스카우터는 표시만.

## 4. 결정론·무손상

- `applyTrainingDay`/`evolvePlayer`의 `boosts`는 **선택적** — 미지정/`{}`이면 기존과 **바이트 동일**(테스트 `engine/staff.test.ts`).
- 스태프 없으면 `trainingBoosts([]) = {}` → 성장 불변 → `simLeague` 파리티·경기 결과 무손상.
- `reseed`/`resetLeagueBase`에서 계약 전부 초기화.

## 5. 미구현·후속

- AI 팀 스태프 영입(현재 AI는 시드 감독만, 코치·스카우터 미보유). 단장 우위 레버.
- 스태프 노쇠·은퇴·시즌 경계 재계약, 스태프 FA 경쟁.
- 스카우터의 AI 드래프트 품질 영향(현재는 단장 표시 공개도만).
