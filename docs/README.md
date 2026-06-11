# 설계 문서 색인 (docs/)

> 백년배구(가칭) 시스템별 설계 문서 모음. 최상위 단일 기준 문서는 루트 `CLAUDE.md`.
> **일관성 검증은 각 문서 상단의 "★ 구현 현황" 표를 기준으로 한다**(설계 vs 실제 코드 간극 명시).
> 모든 수치 계수는 placeholder이며 밸런싱 단계에서 튜닝한다.

---

## 문서 목록

| 문서 | 범위 | 핵심 엔진 파일 |
|---|---|---|
| [MATCH_SYSTEM](./MATCH_SYSTEM.md) | 경기 시뮬(로테이션·서브타입·랠리·블로킹3축·찬스볼·체력·기세·타임아웃·감독) | `engine/match.ts`·`rally.ts`·`lineup.ts`·`rotation.ts`(풀 랠리 체인 v2) |
| [TRAINING_SYSTEM](./TRAINING_SYSTEM.md) | 훈련·성장·노쇠·재능·경기경험 성장 | `engine/training.ts`, `aging.ts`, `experience.ts`, `progression.ts` |
| [SALARY_SYSTEM](./SALARY_SYSTEM.md) | 개인 생산 귀속·시장가치·계약 고착·루키스케일 | `engine/salary.ts`, `production.ts`, `data/production.ts` |
| [FA_SYSTEM](./FA_SYSTEM.md) | FA(등급·보상·보호명단·프랜차이즈)·드래프트·세대교체·캡·AI GM | `engine/faMarket.ts`, `compensation.ts`, `cap.ts`, `draft.ts`, `aiGM.ts`, `rollover.ts`, `retire.ts` |
| [SEASON_SYSTEM](./SEASON_SYSTEM.md) | 시즌 진행·일정·순위·포스트시즌·오프시즌 오케스트레이션 | `engine/season.ts`, `playoffs.ts`, `data/standings.ts`, `store/useGameStore.ts` |
| [STAFF_SYSTEM](./STAFF_SYSTEM.md) | 스태프 계약(감독·전문코치·스카우터)·예산·훈련부스트·드래프트 안개 | `engine/staff.ts`, `data/league.ts`, `app/staff.tsx`, `app/draft.tsx` |
| [AWARDS_SYSTEM](./AWARDS_SYSTEM.md) | 시상식(MVP·신인상·기량발전상·기록왕·베스트7·라운드MVP) | `engine/awards.ts`, `data/awards.ts` |
| [MILESTONE_SYSTEM](./MILESTONE_SYSTEM.md) | 기록 경신(개인 통산·구단·레전드 추월) | `engine/milestones.ts`, `data/milestones.ts` |
| [TRAIT_SYSTEM](./TRAIT_SYSTEM.md) | 선수 특성(긍정+부정, 결정론 부여, 소폭 엔진영향) | `engine/traits.ts` |
| [INJURY_SYSTEM](./INJURY_SYSTEM.md) | 부상(시즌 계층 격리·출전결장·만성) | `engine/injury.ts`, `data/injury.ts` |
| [NEWS_SYSTEM](./NEWS_SYSTEM.md) | 뉴스 피드(1~4 종합 파생, 캡스톤) | `data/news.ts` |
| [TRANSACTION_SYSTEM](./TRANSACTION_SYSTEM.md) | 시즌 중 이동(방출→FA·구멍 영입, 전 구단 AI, 날짜 인지 명단) | `engine/transactions.ts`, `data/dynamics.ts`, `app/transactions.tsx` |
| [OWNER_SYSTEM](./OWNER_SYSTEM.md) | 구단주 레이어: 선수 면담·감독 벤치 건의·팬심(설계) | (구현 예정) `engine/owner.ts` |
| [FORM_SYSTEM](./FORM_SYSTEM.md) | 경기감각: 결장 누적 → 체감 하락, 출전 이력 파생(설계) | (구현 예정) `engine/form.ts` |

---

## 전체 구현 현황 요약 (2026-06)

| 시스템 | 상태 |
|---|---|
| 풀 랠리 체인 경기 엔진(v1: 로테이션·서브·랠리루프·블록/디그·기세·VQ폴트) | ✅ |
| 시즌 자동 진행(엔진 적용, 관전==순위==생산 일치) | ✅ |
| 훈련·노쇠·재능 성장 (전 구단, 일자별 리플레이) | ✅ |
| 경기 출전·생산 → 성장 경험치 | ✅ |
| 개인 생산 귀속(선발 라인업) + 시장가치·계약 | ✅ |
| FA(경쟁 입찰+수락)·보상선수·보호명단·샐러리캡·프랜차이즈 | ✅ |
| 신인 드래프트(로터리·니즈 기반 AI) | ✅ |
| 롤오버·은퇴·유망주 충원(세대교체) | ✅ |
| 순위표·개인 리더보드·경기 상세·대시보드 | ✅ |
| 포스트시즌 + 역대 우승 아카이브 | ✅ |
| 경기 엔진 v2: 서브타입(2장)·공격종류(4장)·블로킹3축/블록아웃(5장)·찬스볼(6장)·체력/타임아웃(7장)·감독성향(8장)·케미/부상(9장) | ✅ |
| 경기 엔진 잔여: 개별 모듈 분리(10장)·스위칭(1.5) | ❌ 보류 |
| 트레이드 | 🚫 제외(2026-06 설계 결정) — 방치형과 결 약함·AI 거래 밸런스 난해. 수급은 드래프트/FA/용병 |
| **시상식**(MVP·신인상·기량발전상·기록왕·베스트7·라운드MVP) | ✅ (백년야구 공백 P1) |
| **기록 경신 마일스톤**(개인 통산·구단·레전드 추월) | ✅ (P2) |
| **선수 특성**(클러치·대기만성·유리몸 등 긍정+부정) | ✅ (P3) |
| **부상**(출전 결장·만성·시즌 계층 격리) | ✅ (P4) |
| **뉴스 피드**(1~4 종합) | ✅ (P5, 캡스톤) |
| **시즌 중 이동**(방출→FA·구멍 영입·전 구단 AI·날짜 인지 명단) | ✅ (TRANSACTION_SYSTEM) |
| **구단주 레이어**(선수 면담·감독 벤치 건의·팬심→예산) | ✅ (OWNER_SYSTEM — 뉴스 연동만 보류) |
| **경기감각**(결장 누적 체감 −7%, 출전 이력 파생, ● 컨디션) | ✅ (FORM_SYSTEM) |
| 명예의전당·영구결번 | ✅ (기존) |
| 감독 훈련선호 커스터마이즈 / 라인업·경기 직접 개입 | ❌ 자동 완성 후 "오버라이드"로 개방 예정 |

> **자동/수동 정책:** 현재 전 구단(사용자 팀 포함) 자동. AI 팀은 영구히 자동.
> 시스템 완성 후 사용자 조작을 **오버라이드(자동이 기본, 입력 있으면 우선)** 로 개방.
> 이미 오버라이드 패턴인 부분: FA 영입/잔류/보호명단, 드래프트 위시리스트, 재계약/방출.

---

## 검증 루틴

```
npx tsc --noEmit                          # 앱 타입체크
npx tsc --noEmit -p tsconfig.test.json    # 테스트 타입체크
npm test                                  # node --test (현재 104 통과)
npx tsx tools/auditBoard.ts 6              # 보드 안무 프레임 감사(기하 원리 8종 + ASCII 덤프)
npx tsx tools/checkRallyChain.ts           # 랠리 3터치 체인·공격 적격 검증
npx tsx tools/checkCourtBoard.ts           # 대형·동적 위치 전수 검사
npx expo export --platform android        # 번들 확인 후 dist 삭제
```

## 아키텍처 원칙 (CLAUDE.md 11장)

- 의존 방향: UI(`app/`) → 셀렉터(`data/`) → 엔진(`engine/`). 역방향 금지.
- 엔진은 React/Expo 무의존 순수 함수 + 시드 결정론.
- 엔진끼리는 구현이 아니라 **출력 타입**(`SimResult`/`ProdLine` 등)에만 의존 → 시스템 교체 가능.
- 새 설계 결정은 코드보다 먼저 해당 문서(+ 본 색인)에 반영한다.
