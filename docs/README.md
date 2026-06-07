# 설계 문서 색인 (docs/)

> 백년배구(가칭) 시스템별 설계 문서 모음. 최상위 단일 기준 문서는 루트 `CLAUDE.md`.
> **일관성 검증은 각 문서 상단의 "★ 구현 현황" 표를 기준으로 한다**(설계 vs 실제 코드 간극 명시).
> 모든 수치 계수는 placeholder이며 밸런싱 단계에서 튜닝한다.

---

## 문서 목록

| 문서 | 범위 | 핵심 엔진 파일 |
|---|---|---|
| [MATCH_SYSTEM](./MATCH_SYSTEM.md) | 경기 시뮬(로테이션·서브·랠리·블로킹·기세·감독) | `engine/simMatch.ts`(현행 간이), `rotation.ts` / `rally.ts`·`match.ts`(스텁) |
| [TRAINING_SYSTEM](./TRAINING_SYSTEM.md) | 훈련·성장·노쇠·재능·경기경험 성장 | `engine/training.ts`, `aging.ts`, `experience.ts`, `progression.ts` |
| [SALARY_SYSTEM](./SALARY_SYSTEM.md) | 개인 생산 귀속·시장가치·계약 고착·루키스케일 | `engine/salary.ts`, `production.ts`, `data/production.ts` |
| [FA_SYSTEM](./FA_SYSTEM.md) | FA(등급·보상·보호명단·프랜차이즈)·드래프트·세대교체·캡·AI GM | `engine/faMarket.ts`, `compensation.ts`, `cap.ts`, `draft.ts`, `aiGM.ts`, `rollover.ts`, `retire.ts` |
| [SEASON_SYSTEM](./SEASON_SYSTEM.md) | 시즌 진행·일정·순위·포스트시즌·오프시즌 오케스트레이션 | `engine/season.ts`, `playoffs.ts`, `data/standings.ts`, `store/useGameStore.ts` |

---

## 전체 구현 현황 요약 (2026-06)

| 시스템 | 상태 |
|---|---|
| 경기 시뮬(OVR 간이) + 시즌 자동 진행 | ✅ |
| 훈련·노쇠·재능 성장 (전 구단, 일자별 리플레이) | ✅ |
| 경기 출전·생산 → 성장 경험치 | ✅ |
| 개인 생산 귀속(선발 라인업) + 시장가치·계약 | ✅ |
| FA(경쟁 입찰+수락)·보상선수·보호명단·샐러리캡·프랜차이즈 | ✅ |
| 신인 드래프트(로터리·니즈 기반 AI) | ✅ |
| 롤오버·은퇴·유망주 충원(세대교체) | ✅ |
| 순위표·개인 리더보드·경기 상세·대시보드 | ✅ |
| 포스트시즌 + 역대 우승 아카이브 | ✅ |
| 풀 랠리 체인 경기 엔진(MATCH_SYSTEM 전체) | ❌ 목표안(simMatch로 대체 중) |
| 트레이드 | ❌ 미구현 |
| MVP·개인 타이틀·명예의전당·영구결번 | ❌ 미구현 |
| 감독 훈련선호 커스터마이즈 / 라인업·경기 직접 개입 | ❌ 자동 완성 후 "오버라이드"로 개방 예정 |

> **자동/수동 정책:** 현재 전 구단(사용자 팀 포함) 자동. AI 팀은 영구히 자동.
> 시스템 완성 후 사용자 조작을 **오버라이드(자동이 기본, 입력 있으면 우선)** 로 개방.
> 이미 오버라이드 패턴인 부분: FA 영입/잔류/보호명단, 드래프트 위시리스트, 재계약/방출.

---

## 검증 루틴

```
npx tsc --noEmit                          # 앱 타입체크
npx tsc --noEmit -p tsconfig.test.json    # 테스트 타입체크
npm test                                  # node --test (현재 62 통과)
npx expo export --platform android        # 번들 확인 후 dist 삭제
```

## 아키텍처 원칙 (CLAUDE.md 11장)

- 의존 방향: UI(`app/`) → 셀렉터(`data/`) → 엔진(`engine/`). 역방향 금지.
- 엔진은 React/Expo 무의존 순수 함수 + 시드 결정론.
- 엔진끼리는 구현이 아니라 **출력 타입**(`SimResult`/`ProdLine` 등)에만 의존 → 시스템 교체 가능.
- 새 설계 결정은 코드보다 먼저 해당 문서(+ 본 색인)에 반영한다.
