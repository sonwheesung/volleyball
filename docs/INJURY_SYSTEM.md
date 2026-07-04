# 부상 (Injuries) — 설계/구현 문서

> 시즌은 계획대로 안 흐른다. 에이스가 몇 경기를 빠지고, 그 공백을 누가 메우느냐가
> 단장의 시험(③현실 밸런스 + 라인업 뎁스에 의미).

## 0. ★ 결정론·격리 원칙 (최우선)
부상은 **simMatch 안에 넣지 않는다.** "그날 출전 가능 명단"을 결정론으로 깎는 **시즌 계층**(`data/injury.ts`)에서 소비.
- 엔진 골든 테스트 보존(simMatch는 받은 선수만 굴림 — 합성 테스트 무영향).
- 부상은 **매치 결과가 아니라 "선발 출전"에만 의존** → simMatch와 무순환(forward-pass).
- production·standings·playoffs 가 **동일한** `availableTeamPlayers`를 사용 → 프리뷰=결과 일치.

## 1. 모델 (경미 위주 + 드물게 중상)
- 발생: 선발 1인·1경기 `injuryRisk(나이↑·체력↓·유리몸↑)`, 기저 0.9%. 팀당 ~1.7건/시즌
  (시즌 계층 측정 · 엔진 9abe01e · 2026-06-10 — 발생식은 경기 엔진 무관, 입력 스탯만 사용).
- 심각도: 경미(1~2경기) 65% · 중기(3~6) 25% · 중상(7~15) 8.5% · 시즌아웃 1.5%.
- 동시부상 상한 3(뎁스 붕괴·라인업 파탄 방지). 라인업 빌더가 결손 시 방어 충원.
- 결장 = 통산기록·성장 손실("잃어버린 시즌"). 백업이 출전·성장 기회 획득.
- 플옵도 부상 반영(에이스 결장 드라마).

## 2. 만성 (약)
큰 부상(7경기↑ 결장) 선수는 다음 시즌 **점프력 영구 -1**(store.endSeason).
staminaMax는 건드리지 않음 — 부상위험 피드백 스파이럴 차단.

## 3. 결정론 시드
`injury:{playerId}:{age}:{day}` — 시즌 내 고정(나이 불변), 시즌 간 탈상관(나이↑), **baseVersion 무의존**(중간 recompute해도 동일 타임라인 → 일관성).

## 4. 밸런스 회귀 (검증)
다중 유니버스(25시즌×N): parityStd 2.4~3.3(기대균등 5.7 이하·건강), 6/7 우승, 반등O.
지속성 r은 유니버스마다 -0.78~0.42로 출렁(단일 시드 노이즈) → 부상이 균형을 깨지 않음.

## 5. 방치형 (no-push)
[[idle-definition]] — 푸시 없음. 자동으로 백업 출전 → 강제 개입 없음.
- **표시 위치(2026-07-04 사용자 결정)**: ~~대시보드 "부상자 명단" 위젯~~ → **대시보드엔 표시 안 함**(순위 줄 `🩹 N` 뱃지 제거 — 순위와 부상은 무관하고, 그 뱃지는 순위표로 연결돼 부상 정보와 안 맞았음).
  부상은 **① 선수단 탭 `부상` 마커**(포지션 태그 같은 빨간 라벨 pill — 정지는 `정지`. 그날 출전 명단 외. ~~🚑~~→~~✚~~→라벨 pill 2026-07-04 사용자 요청 "포지션처럼 마커로")로, **② 리그 뉴스 단신**(아래)으로 조용히 surface. "부상 소식을 뉴스 한 곳에서 다 본다".
- **뉴스 노출(2026-07-04)**: ~~중상·시즌아웃만~~ → **경미 포함 전 심각도**를 단신으로(`data/news.ts` 4). 시즌아웃만 big(★). 선수당 시즌 1건(`season:inj:playerId` dedup)이라 도배 방지. 미래 부상은 리그 진행 컷오프 제외.

## 6. 코드 맵
- `engine/injury.ts` — 순수 `injuryRisk`/`rollSeverity`/상수(`CONCURRENT_CAP`).
- `data/dynamics.ts` — **부상+시즌 중 이동 통합 forward-pass**(TRANSACTION_SYSTEM과 공유) — `availableTeamPlayers`/`injuredOnDay`/`teamInjuriesOn`/`seasonInjuryDays`/`rosterIdsOnDay`.
- `data/injury.ts` — dynamics 재노출(기존 import 경로 호환용 셸).
- `data/production.ts`·`standings.ts`·`playoffs.ts` — 출전 가능 명단으로 전환.
- `store` — 만성 노쇠가속.
- `app/(tabs)/index.tsx` — 부상자 명단 카드.
- `engine/injury.test.ts` + `tools/simInjuries.ts`.
