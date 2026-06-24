# 설계 문서 색인 (docs/)

> 백년배구(가칭) 시스템별 설계 문서 모음. 최상위 단일 기준 문서는 루트 `CLAUDE.md`.
> **일관성 검증은 각 문서 상단의 "★ 구현 현황" 표를 기준으로 한다**(설계 vs 실제 코드 간극 명시).
> 모든 수치 계수는 placeholder이며 밸런싱 단계에서 튜닝한다.

---

## 문서 목록

| 문서 | 범위 | 핵심 엔진 파일 |
|---|---|---|
| [MATCH_SYSTEM](./MATCH_SYSTEM.md) | 경기 시뮬(로테이션·서브타입·랠리·블로킹3축·찬스볼·체력·기세·타임아웃·감독) | `engine/match.ts`·`rally.ts`·`lineup.ts`·`rotation.ts`(풀 랠리 체인 v2) |
| [BOARD_RULES](./BOARD_RULES.md) | 관전 연출 검증 기준(사용자 주의사항 ↔ 감사 룰 A~P, `/verify-board` 스킬) | `components/courtPath.ts`·`courtDirector.ts`, `tools/auditBoard.ts` |
| [UI_RULES](./UI_RULES.md) | **UI 상호작용 규칙**(버튼·로딩·비활성·빈상태 — 무거운 작업 로딩+비활성 등). `verify-board`(UI 검수기)가 대조 | `sim-web/main.ts`(runHeavy)·`components/Screen.tsx`(Loading) |
| [COURT_POSITIONING](./COURT_POSITIONING.md) | **수비/리시브 포지셔닝 모델**(역할→위치 자동화 SPEC, 세터 후위/전위 × 서브/리시브). 확정 후 구현 | `components/courtLayout.ts`·`courtDirector.ts` |
| [ROTATION_MORALE](./ROTATION_MORALE_SYSTEM.md) | **선발 휴식(순위 기반 로드매니지먼트) + 벤치 사유 인지 + 감정=f(사유,성격) + 누적→FA**. ✅ 구현(2026-06-22) | `engine/lineup.ts`(pickRest)·`data/rotation.ts`·`engine/owner.ts`·`data/owner.ts`, `tools/simMood·simStarters·_ev_rest` |
| [STATS_PROTOCOL](./STATS_PROTOCOL.md) | 통계 3원칙 — 표본 1만+·N/엔진커밋 명기·로직 변경 시 무효 처리 | 모든 `tools/sim*.ts` |
| [EDGE_CASES](./EDGE_CASES.md) | 영입·오프시즌 정상/엣지 케이스 레지스트리(회귀 체크리스트, `analyze-cases`/`verify-cases` 스킬) | `data/acquisitionAudit.ts`, `tools/simAudit·simFaDup·simStaffDup·simMoneyOnly.ts` |
| [SIM_CONSOLE](./SIM_CONSOLE.md) | **엔진 테스트 콘솔(웹)** — PC 브라우저에서 엔진 직접 실행·검증(백엔드 없음, 14탭). `npm run sim:web` → :5051 | `sim-web/`(build.cjs·main.ts·index.html) |
| [TEST_METHODOLOGY](./TEST_METHODOLOGY.md) | 오류를 **새로** 찾는 방법론(악질/원숭이 퍼징·독립검증·A/B자가검증·결과배선강제·값→표현매핑·변이·결함주입·속성·5렌즈) + 버그 발견 후 5단계 프로토콜(`fuzz-game` 스킬·`independent-verifier` 에이전트) | `tools/_gt_*.ts`·`_dv_*.ts` |
| [DOC_DISCIPLINE](./DOC_DISCIPLINE.md) | 문서 작업법 — 결정 先문서·취소선 정정 보존·`*_SYSTEM.md`·색인 유지·날짜/통계 절대화·새 시스템 체크리스트 | (전 docs) |
| [TRAINING_SYSTEM](./TRAINING_SYSTEM.md) | 훈련·성장·노쇠·재능·경기경험 성장 | `engine/training.ts`, `aging.ts`, `experience.ts`, `progression.ts` |
| [SALARY_SYSTEM](./SALARY_SYSTEM.md) | 개인 생산 귀속·시장가치·계약 고착·루키스케일 | `engine/salary.ts`, `production.ts`, `data/production.ts` |
| [FA_SYSTEM](./FA_SYSTEM.md) | FA(등급·보상·보호명단·프랜차이즈)·드래프트·세대교체·캡·AI GM | `engine/faMarket.ts`, `compensation.ts`, `cap.ts`, `draft.ts`, `aiGM.ts`, `rollover.ts`, `retire.ts` |
| [SEASON_SYSTEM](./SEASON_SYSTEM.md) | 시즌 진행·일정·순위·포스트시즌·오프시즌 오케스트레이션 | `engine/season.ts`, `playoffs.ts`, `data/standings.ts`, `store/useGameStore.ts` |
| [STAFF_SYSTEM](./STAFF_SYSTEM.md) | 스태프 계약(감독·전문코치·스카우터)·예산·훈련부스트·드래프트 안개 | `engine/staff.ts`, `data/league.ts`, `app/staff.tsx`, `app/draft.tsx` |
| [AWARDS_SYSTEM](./AWARDS_SYSTEM.md) | 시상식(MVP·신인상·기량발전상·기록왕·베스트7·라운드MVP) | `engine/awards.ts`, `data/awards.ts` |
| [MILESTONE_SYSTEM](./MILESTONE_SYSTEM.md) | 기록 경신(개인 통산·구단·레전드 추월) | `engine/milestones.ts`, `data/milestones.ts` |
| [ACHIEVEMENT_SYSTEM](./ACHIEVEMENT_SYSTEM.md) | 플레이어 업적(우승·시상·레전드·기록·운영, 누적 데이터 파생) | `engine/achievements.ts`, `app/achievements.tsx` |
| [TRAIT_SYSTEM](./TRAIT_SYSTEM.md) | 선수 특성(긍정+부정, 결정론 부여, 소폭 엔진영향) | `engine/traits.ts` |
| [INJURY_SYSTEM](./INJURY_SYSTEM.md) | 부상(시즌 계층 격리·출전결장·만성) | `engine/injury.ts`, `data/injury.ts` |
| [NEWS_SYSTEM](./NEWS_SYSTEM.md) | 뉴스 피드(1~4 종합 파생, 캡스톤) | `data/news.ts` |
| [BROADCAST_SYSTEM](./BROADCAST_SYSTEM.md) | 중계 현수막(기록·PO확정, 보드 하단 lower-third, 스포일러 정책) | ✅ Phase1 — `data/broadcast.ts`·`components/BroadcastBanner.tsx`·`app/match/[id]`(finished 게이트). 우승 현수막·실시간 기록은 추후 |
| [TRANSACTION_SYSTEM](./TRANSACTION_SYSTEM.md) | 시즌 중 이동(방출→FA·구멍 영입, 전 구단 AI, 날짜 인지 명단) | `engine/transactions.ts`, `data/dynamics.ts`, `app/transactions.tsx` |
| [OWNER_SYSTEM](./OWNER_SYSTEM.md) | 구단주 레이어: 선수 면담·감독 벤치 건의·팬심 | `engine/owner.ts`·`data/owner.ts` (뉴스 연동만 보류) |
| [FORM_SYSTEM](./FORM_SYSTEM.md) | 경기감각: 결장 누적 → 체감 하락, 출전 이력 파생 | `engine/form.ts`·`data/dynamics.ts` |
| [FOREIGN_SYSTEM](./FOREIGN_SYSTEM.md) | 용병 트라이아웃: 1년 계약·연봉 고정·추첨 지명·시즌 중 교체 | engine/foreign.ts, data/tryout.ts, app/tryout.tsx |
| [FINANCE_SYSTEM](./FINANCE_SYSTEM.md) | 구단 재정: 모기업(성적 보너스·긴축)+직관+굿즈, 캡과 별개 지갑 | `engine/finance.ts`, store, `tools/simFinance.ts` |
| [CLUB_IDENTITY_SYSTEM](./CLUB_IDENTITY_SYSTEM.md) | 구단 정체성(명문·신흥강호·황혼·만년약체·신생팀): 선택 화면 서사 + 선수단 생성 연동(고정 배정) | `data/clubIdentity.ts`, `data/seed.ts`, `app/select-team.tsx`, `app/team/[id].tsx`, `tools/clubIdentity.ts` |

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
| **구단 재정**(모기업·직관·굿즈, 캡 별개 지갑·자금 게이트) | ✅ (FINANCE_SYSTEM) |
| **용병 트라이아웃**(1년 계약·매년 풀 유입 — 멸종 해결, 국내 평균 이상 보장) | ✅ (FOREIGN_SYSTEM) |
| **사건·사고**(음주운전 등 출장정지, ~0.4건/시즌) | ✅ (OWNER_SYSTEM 4.6) |
| 명예의전당·영구결번 | ✅ (기존) |
| **기록 화면 개편**(시즌별 이동·통산 리더보드 현역+은퇴 TOP100·팀별 TOP50·6카테고리·세그먼트 탭) | ✅ `data/records.ts`·`app/records.tsx`·`app/(tabs)/history.tsx` (HofEntry에 spikes/aces/assists 추가) |
| **작전 교체 코트 가시화**(엔진 subEvents 연출 로그 → 보드가 실제 코트 6인 재생·투입 강조) | ✅ `engine/simMatch.ts`(SubEvent)·`engine/match.ts`·`components/MatchCourt.tsx` (BOARD_RULES 30) |
| **온보딩/튜토리얼·설정·서포터팩(비소모성 후원)·크레딧** | ✅ `app/onboarding.tsx`·`settings.tsx`·`supporter.tsx`·`credits.tsx` (출시 시 실제 IAP 연결) |
| **로딩 화면**(시작 복원 게이트 + 무거운 생성/재계산 7화면) | ✅ 1차 — `components/Screen.tsx`(`Loading`·`useDeferredReady`)·`(tabs)/_layout.tsx`·news/history/records/draft/fa/tryout/asian-tryout. **UI 개선 예정**(스켈레톤·브랜드 연출, EDGE_CASES §5) |
| 감독 훈련선호 커스터마이즈 / 라인업·경기 직접 개입 | ❌ 자동 완성 후 "오버라이드"로 개방 예정 |

> **자동/수동 정책:** 현재 전 구단(사용자 팀 포함) 자동. AI 팀은 영구히 자동.
> 시스템 완성 후 사용자 조작을 **오버라이드(자동이 기본, 입력 있으면 우선)** 로 개방.
> 이미 오버라이드 패턴인 부분: FA 영입/잔류/보호명단, 드래프트 위시리스트, 재계약/방출.

---

## 검증 루틴

```
npx tsc --noEmit                          # 앱 타입체크
npx tsc --noEmit -p tsconfig.test.json    # 테스트 타입체크
npm test                                  # node --test (현재 205 통과)
npx tsx tools/auditBoard.ts 6              # 보드 안무 프레임 감사(기하 원리 룰 A~Q + 사용자보고 18~37 + ASCII 덤프)
npx tsx tools/checkBoardFixes.ts           # 보드 타깃 측정(패서 깊이·터치아웃·서브전환 — "의도대로 바뀌었나")
npx tsx tools/checkBlockerCross.ts         # 블로커 좌우 교차(프레임 정확 — 실제 애니메이션 위치)
npx tsx tools/checkRecords.ts              # 통산 리더보드 셀렉터(병합·정렬·팀필터)
npx tsx tools/checkSubs.ts                 # 작전 교체 로그(재생 불변식·세트말 net-zero)
npx tsx tools/simStarters.ts               # 선발 검증(지시·OVR·징계·부상·폼·순위 + 리베로/suggestStart 가드 G1·G2)
npx tsx tools/simMood.ts                    # 선수 심리(벤치 사유 귀속·부상자 불만없음·성격/기대치별 기분 A/B·누적→FA)
npx tsx tools/_ev_rest.ts                   # 로드매니지먼트(#3) — 굳은 순위 주전 휴식·관전==순위 일치(결정론)
# ── 교차 계층 귀속(보드가 보여준 선수 == 박스 귀속 선수) — 스코어박스 충실도 가드(TEST_METHODOLOGY §1.J) ──
npx tsx tools/_ev_box.ts                    # 박스 밸런스 무영향(box 유무 sim.points 바이트 동일)·타임라인 정합·오라클(atkAtt/atkKill) 일치
npx tsx tools/_ev_box_audit.ts 200          # 박스 무결성(보존식) 0위반·KOVO 밴드·A/B 검출 민감도(허위 오라클 차단)
npx tsx tools/_ev_scorer.ts 200             # 보드 종결 스파이커 == 박스 byId 100%(팬텀 킬 0)·A/B shuffle 대조
npx tsx tools/_ev_recvmatch.ts 300          # 보드 서브 리시버 == 박스 recvId: 클린 100%·노클린은 전부 ace(누수 0)·A/B(shuffle 모드)
npx tsx tools/_ev_setmatch.ts 300           # 보드 종결 토서 == 박스 어시 세터(setId) 100.0%(touches·교체반영·세터 디그 시 비상세터 재귀속)·A/B(shuffle)
npx tsx tools/_ev_digdist.ts 300            # 디그 귀속 현실 분산 가드(2026-06-24 재모델) — 개인 디그왕=리베로(15.6%)·디거≥10명·리베로<50%. 구 best-dig(87.7%·5명) 폐기
npx tsx tools/_ev_digmatch.ts 300           # 보드 디그 마커 == 엔진 디그 귀속(2b) 100.0%·A/B chance 10%·드리프트 0·분포 byte동일. auditBoard도 touches:true로 실제 렌더 감사
npx tsx tools/_ev_touches.ts 200            # 랠리 터치 스크립트 1단계 — 엔진 touches 기록 코히런트(첫=서브·종결 atk==byId·ace serve==byId 100%, 가산·중립 sanity)
npx tsx tools/_ev_statsource.ts 2000        # 통계 단일화 가드 — 통합 prod(box 먹임)가 스코어박스와 선수별 0 분기(5카테고리)·레거시는 분기(도구 민감)·A/B(box vs box=0)
npx tsx tools/_ev_blockcomment.ts 200       # 스터프 중계가 byId 블로커를 호명 100%(블록=킬 수준 충실)
npx expo export --platform android        # 번들 확인 후 dist 삭제
npm run sim:web                            # 엔진 테스트 콘솔(웹) → localhost:5051 (14탭, SIM_CONSOLE)
```

## 아키텍처 원칙 (CLAUDE.md 11장)

- 의존 방향: UI(`app/`) → 셀렉터(`data/`) → 엔진(`engine/`). 역방향 금지.
- 엔진은 React/Expo 무의존 순수 함수 + 시드 결정론.
- 엔진끼리는 구현이 아니라 **출력 타입**(`SimResult`/`ProdLine` 등)에만 의존 → 시스템 교체 가능.
- 새 설계 결정은 코드보다 먼저 해당 문서(+ 본 색인)에 반영한다.
