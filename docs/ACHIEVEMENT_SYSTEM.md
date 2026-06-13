# ACHIEVEMENT_SYSTEM — 플레이어 업적 (구단주의 발자취)

> 게임 속 선수 기록(시상·마일스톤·HOF)과 별개로, **플레이어(구단주) 본인의 장기 성취**를
> 트로피로 보여주는 메타 레이어. 관전형은 "당장 할 일"이 적어서, 장기 목표를 눈앞에 깔아주는
> 척추가 중요하다 — 업적이 그 역할(자발적 목표: "이번엔 3연패 노려볼까").
>
> 설계 원칙: 마일스톤과 동일하게 **새 시뮬 없이 기존 누적 산출물을 읽어 판정**한다.
> 달성 여부는 저장하지 않고 세이브 상태(archive/hof/milestones/cash/fanScore)에서 **재계산**한다
> (결정론·세이브 다이어트 — 프로젝트 철학과 정합).

## 데이터 출처 (전부 이미 영속됨)

| 입력 | 출처 | 쓰는 업적 |
|---|---|---|
| `archive: {season, championId, awards}[]` | 시즌 경계 적립 | 우승·시상·시즌수 |
| `hallOfFame: HofEntry[]` | 은퇴 enshrine | 레전드 배출 |
| `milestones: Milestone[]` | 기록 경신 감지 | 리그 기록 |
| `cash` / `fanScore` | 재정·팬심 | 운영 |
| `selectedTeamId` | 내 팀 | 전부(귀속 판정) |

## 판정 (engine/achievements.ts — 순수 함수)

- `ACHIEVEMENTS: Achievement[]` — 카탈로그(id·제목·설명·카테고리·목표치).
- `evalAchievements(input): AchievementStatus[]` — 각 업적의 `unlocked`(달성) + `progress {cur, target}`.
- 입력은 평범한 객체(스토어가 조립해 전달). 엔진은 React/스토어 무의존.

## 카테고리·카탈로그 (v1)

- **우승**: 첫 우승 · 백투백(2연패) · 왕조(3연패) · 명문(통산 5회) · 불멸의 명가(통산 10회)
- **시상**: MVP 배출 · 신인상 배출 · 기량발전상 배출 · 기록왕 5회 · 한 시즌 베스트7 3인
- **레전드**: HOF 선수 배출 · 영구결번(legend) 배출 · HOF 5명
- **기록**: 리그 역대 기록(league milestone) · 역사를 넘어(big milestone)
- **운영**: 운영자금 20억 · 국민 구단(팬심 90+) · 한 세대(10시즌) · 백년 구단(50시즌)

> 귀속 주의: HOF `teamId`는 "마지막 소속"이라 내 팀 배출 판정은 근사(현실적 한계 명시).
> 베스트7 3인은 시즌별 검사(한 시즌 동시 3명), 나머지 통산은 전 시즌 누적.

## 화면 (app/achievements.tsx)

- 헤더: 달성 N / 전체 M.
- 카테고리별 그룹. 달성=강조+체크, 미달성=흐리게+진행바(`cur/target`).
- 숨김(hidden) 업적 없음(v1) — 전부 목표를 보여줘 자발적 목표 설정을 돕는다.

## 이후(보류)

- 달성 순간 토스트/뉴스 연동(NEWS_SYSTEM) — "seen" 집합(UI 영속 상태) 필요, v2.
- worst-to-first 등 순위 이력 기반 — archive에 시즌별 최종 순위가 없어 v2(아카이브 확장 시).
