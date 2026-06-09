# 스태프 계약 시스템 (STAFF_SYSTEM)

> 단장이 **감독·전문 코치·스카우터**를 스태프 예산 안에서 영입/방출한다. (2026-06-09 신설)
> 결정론 유지: 모든 효과는 순수 함수, 풀은 시드 생성, 계약 상태만 세이브.

## 1. 역할과 효과

| 역할 | 효과 | 통합 지점 |
|---|---|---|
| **감독(head)** | 성향(공격/수비/밸런스)·카리스마(타임아웃 기세폭)·훈련선호(어떤 스탯이 크는지) | `coachInfoOf`(경기)·`teamFocus`(훈련) — 영입 시 시드 감독 대체 |
| **전문 코치(assistant)** | 분야 훈련 성장 부스트(역량 100=+40%). 같은 분야 중첩은 **최고 1명만** 적용 | `engine/staff.ts trainingBoosts` → `applyTrainingDay`/`evolvePlayer` |
| **스카우터(scout)** | 드래프트 유망주 능력 **공개도↑**(없으면 OVR 범위·포텐셜 흐림) | `teamScoutReveal` → `app/draft.tsx` 안개 |

**전문 코치 분야 → 훈련(12종) 매핑** (`SPECIALTY_TRAININGS`):
- 공격코치 → 공격(4)·서브(5) / 수비코치 → 리시브(6)·디그(7)·블로킹(8)
- 체력코치 → 근력(1)·컨디셔닝(2)·순발력(3) / 세터코치 → 세팅(9)·콤비(10)·전술(11) / 멘탈코치 → 멘탈(12)

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
