# 기록 경신 마일스톤 (Milestones) — 설계/구현 문서

> 통산 숫자가 박물관 유물이라면, 마일스톤은 그 유물이 *태어나는 순간*이다.
> "통산 5,000득점"이 데이터라면 "오늘 5,000을 넘었다 — 역대 3번째"는 이야기다(②데이터 누적 서사).

## 0. 범위 (확정: 개인+구단+리그)
| 종류 | 내용 | big |
|---|---|---|
| **개인 통산** | 득점·블로킹·디그·에이스·출전 임계 돌파, 장수(10·15·20·25시즌) | 최상위 임계만 |
| **구단** | 프랜차이즈 통산 1위 등극(득점/블로킹/디그, floor 이상) | 항상 |
| **리그** | 명예의전당 레전드(영구결번급) 통산 추월 | 항상 |

## 1. 작동 (결정론)
- `endSeason` 에서 **before(시즌 시작 base.career) vs after(이번 시즌 생산 누적, seasons+1)** 비교.
- 개인: `personalMilestones` — `CAREER_THRESHOLDS` 임계 교차.
- 구단: 활성 명단+해당 구단 HOF 중 자신 제외 최대(clubMaxOther)를 넘고 floor 이상이 되는 순간. floor(득2000·블700·디2000)로 inaugural 남발 차단.
- 리그: `passedValues` 로 영구결번급 HOF 통산을 추월.

## 2. 영속 바운딩 (방치형 장기)
big(역대·구단·레전드)은 **영구 보존**, 일반 통산 임계는 **최근 300건**만(`store.milestones`). 100년 운영에서도 저장 폭주 없음.

## 3. 한계 / 추후
- 구단 기록은 "현 명단+HOF 기준 통산 최다" — 은퇴 비-HOF 선수 기록은 추적 누락(근사). 프랜차이즈 영구 최대를 별도 보존하면 정밀해짐.
- 단일시즌 신기록·연속 수상 경신은 추후.
- 동명이인은 이름풀 재사용으로 발생(playerId 기준 식별은 정확).

## 4. 코드 맵
- `engine/milestones.ts` — 순수 임계 감지(`crossedThresholds`/`personalMilestones`/`passedValues`).
- `data/milestones.ts` — `detectSeasonMilestones(season, hof)` 로 Milestone[] (개인+구단+리그, 한국어 문구).
- `store` — endSeason 적립 + 바운딩.
- `app/(tabs)/history.tsx` — 마일스톤 타임라인(최근 30, big 강조).
- `tools/simMilestones.ts` — 통산 누적 포함 N시즌 sanity.
