# 설계 문서 색인 (docs/)

> 배구명가 시스템별 설계 문서 모음. 최상위 단일 기준 문서는 루트 `CLAUDE.md`.
> **일관성 검증은 각 문서 상단의 "★ 구현 현황" 표를 기준으로 한다**(설계 vs 실제 코드 간극 명시).
> 모든 수치 계수는 placeholder이며 밸런싱 단계에서 튜닝한다.

---

## 문서 목록

| 문서 | 범위 | 핵심 엔진 파일 |
|---|---|---|
| [MATCH_SYSTEM](./MATCH_SYSTEM.md) | 경기 시뮬(로테이션·서브타입·랠리·블로킹3축·찬스볼·체력·기세·타임아웃·감독) | `engine/match.ts`·`rally.ts`·`lineup.ts`·`rotation.ts`(풀 랠리 체인 v2) |
| [BOARD_RULES](./BOARD_RULES.md) | 관전 연출 검증 기준(사용자 주의사항 ↔ 감사 룰 A~P, `/verify-board` 스킬) | `components/courtPath.ts`·`courtDirector.ts`, `tools/auditBoard.ts` |
| [UI_RULES](./UI_RULES.md) | **UI 상호작용 규칙**(버튼·로딩·비활성·빈상태 — 무거운 작업 로딩+비활성 등). `verify-board`(UI 검수기)가 대조 | `sim-web/main.ts`(runHeavy)·`components/Screen.tsx`(Loading) |
| [EMULATOR_E2E](./EMULATOR_E2E.md) | **에뮬레이터 실기기 테스트 케이스 대본**(C1 온보딩 19스텝~C5 — 화면·확인포인트·탭 좌표/순서). `emulator-test` 스킬이 이 대본대로 see-and-tap | `data/tutorialSteps.ts`(TIPS), `.claude/skills/emulator-test/SKILL.md` |
| [COURT_POSITIONING](./COURT_POSITIONING.md) | **수비/리시브 포지셔닝 모델**(역할→위치 자동화 SPEC, 세터 후위/전위 × 서브/리시브). 확정 후 구현 | `components/courtLayout.ts`·`courtDirector.ts` |
| [ROTATION_MORALE](./ROTATION_MORALE_SYSTEM.md) | **선발 휴식(순위 기반 로드매니지먼트) + 벤치 사유 인지 + 감정=f(사유,성격) + 누적→FA**. ✅ 구현(2026-06-22) | `engine/lineup.ts`(pickRest)·`data/rotation.ts`·`engine/owner.ts`·`data/owner.ts`, `tools/simMood·simStarters·_ev_rest` |
| [STATS_PROTOCOL](./STATS_PROTOCOL.md) | 통계 3원칙 — 표본 1만+·N/엔진커밋 명기·로직 변경 시 무효 처리 | 모든 `tools/sim*.ts` |
| [EDGE_CASES](./EDGE_CASES.md) | 영입·오프시즌 정상/엣지 케이스 레지스트리(회귀 체크리스트, `analyze-cases`/`verify-cases` 스킬) | `data/acquisitionAudit.ts`, `tools/simAudit·simFaDup·simStaffDup·simMoneyOnly.ts` |
| [SIM_CONSOLE](./SIM_CONSOLE.md) | **엔진 테스트 콘솔(웹)** — PC 브라우저에서 엔진 직접 실행·검증(백엔드 없음, 16탭). `npm run sim:web` → :5051 | `sim-web/`(build.cjs·main.ts·index.html) |
| [TEST_METHODOLOGY](./TEST_METHODOLOGY.md) | 오류를 **새로** 찾는 방법론(악질/원숭이 퍼징·독립검증·A/B자가검증·결과배선강제·값→표현매핑·변이·결함주입·속성·5렌즈·**기법 M 명세대조발견 7기법**=회귀≠발견) + 버그 발견 후 5단계 프로토콜(`fuzz-game`·`spec-audit` 스킬·`independent-verifier` 에이전트) | `tools/_gt_*.ts`·`_dv_*.ts` |
| [DOC_DISCIPLINE](./DOC_DISCIPLINE.md) | 문서 작업법 — 결정 先문서·취소선 정정 보존·`*_SYSTEM.md`·색인 유지·날짜/통계 절대화·새 시스템 체크리스트 | (전 docs) |
| [TRAINING_SYSTEM](./TRAINING_SYSTEM.md) | 훈련·성장·노쇠·재능·경기경험 성장 | `engine/training.ts`, `aging.ts`, `experience.ts`, `progression.ts` |
| [SALARY_SYSTEM](./SALARY_SYSTEM.md) | 개인 생산 귀속·시장가치·계약 고착·루키스케일 | `engine/salary.ts`, `production.ts`, `data/production.ts` |
| [FA_SYSTEM](./FA_SYSTEM.md) | FA(등급·보상·보호명단·프랜차이즈)·드래프트·세대교체·캡·AI GM. **📋 설계 확정·미구현(2026-07-09)**: 가변 로스터(계약 상한 20·드래프트 예외, §1.5)·자동충원 floor≈12(§1.6)·attrition 강화(§1.7)·대체 FA 필러 안전망 4층(§2.9)·KOVO식 드래프트 전면 개정(유망주 발굴·4라운드·패스·순위역순 추첨 35/30/20/8/4/2/1, §3.0)·검증계획(§8.1) | `engine/faMarket.ts`, `compensation.ts`, `cap.ts`, `draft.ts`, `aiGM.ts`, `rollover.ts`, `retire.ts` |
| [SEASON_SYSTEM](./SEASON_SYSTEM.md) | 시즌 진행·일정·순위·포스트시즌·오프시즌 오케스트레이션 | `engine/season.ts`, `playoffs.ts`, `data/standings.ts`, `store/useGameStore.ts` |
| [STAFF_SYSTEM](./STAFF_SYSTEM.md) | 스태프 계약(감독·전문코치·스카우터)·예산·훈련부스트·드래프트 안개 | `engine/staff.ts`, `data/league.ts`, `app/staff.tsx`, `app/draft.tsx` |
| [AWARDS_SYSTEM](./AWARDS_SYSTEM.md) | 시상식(MVP·신인상·기량발전상·기록왕·베스트7·라운드MVP) | `engine/awards.ts`, `data/awards.ts` |
| [MILESTONE_SYSTEM](./MILESTONE_SYSTEM.md) | 기록 경신(개인 통산·구단·레전드 추월) | `engine/milestones.ts`, `data/milestones.ts` |
| [ACHIEVEMENT_SYSTEM](./ACHIEVEMENT_SYSTEM.md) | 플레이어 업적(우승·시상·레전드·기록·운영, 누적 데이터 파생) | `engine/achievements.ts`, `app/achievements.tsx` |
| [TRAIT_SYSTEM](./TRAIT_SYSTEM.md) | 선수 특성(긍정+부정, 결정론 부여, 소폭 엔진영향) | `engine/traits.ts` |
| [INJURY_SYSTEM](./INJURY_SYSTEM.md) | 부상(시즌 계층 격리·출전결장·만성) | `engine/injury.ts`, `data/injury.ts` |
| [NEWS_SYSTEM](./NEWS_SYSTEM.md) | 뉴스 피드(1~4 종합 파생, 캡스톤) | `data/news.ts` |
| [BROADCAST_SYSTEM](./BROADCAST_SYSTEM.md) | 중계 현수막(기록·PO확정·정규우승) + **경기 중 실시간(세트획득·연속·에이스/블록, Phase3)** + 우승 축하 화면 + **§8 헌액 연출·헌액 번호** | ✅ Phase1·3 — `data/broadcast.ts`·`components/courtDirector.buildLiveBanners`·`BroadcastBanner`·`ChampionCelebration`·`tools/_dv_livebanner`. §8 — `engine/jersey.ts`·`data/legends.ts`·`LegendIllustration` |
| [TRANSACTION_SYSTEM](./TRANSACTION_SYSTEM.md) | 시즌 중 이동(방출→FA·구멍 영입, 전 구단 AI, 날짜 인지 명단) | `engine/transactions.ts`, `data/dynamics.ts`, `app/transactions.tsx` |
| [OWNER_SYSTEM](./OWNER_SYSTEM.md) | 구단주 레이어: 선수 면담·감독 벤치 건의·팬심 | `engine/owner.ts`·`data/owner.ts` (뉴스 연동만 보류) |
| [FORM_SYSTEM](./FORM_SYSTEM.md) | 경기감각: 결장 누적 → 체감 하락, 출전 이력 파생 | `engine/form.ts`·`data/dynamics.ts` |
| [FOREIGN_SYSTEM](./FOREIGN_SYSTEM.md) | 용병 트라이아웃: 1년 계약·연봉 고정·추첨 지명·시즌 중 교체 | engine/foreign.ts, data/tryout.ts, app/tryout.tsx |
| [FINANCE_SYSTEM](./FINANCE_SYSTEM.md) | 구단 재정(모기업+직관+굿즈, 캡 별개 지갑) + **FINANCE 2.0**(모기업 기조 sponsorStance→AI FA 입찰·내 팀 1회성 보너스·예고 뉴스) | `engine/finance.ts`·`engine/sponsorStance.ts`·`data/leagueHistory.ts`, store, `tools/simFinance.ts` |
| [CLUB_IDENTITY_SYSTEM](./CLUB_IDENTITY_SYSTEM.md) | 구단 정체성(명문·신흥강호·황혼·만년약체·신생팀): 선택 화면 서사 + 선수단 생성 연동(고정 배정) | `data/clubIdentity.ts`, `data/seed.ts`, `app/select-team.tsx`, `app/team/[id].tsx`, `tools/clubIdentity.ts` |
| [RELATIONSHIP_SYSTEM](./RELATIONSHIP_SYSTEM.md) | **선수 인간관계망**(친구/라이벌 affinity → FA 영입·재계약·방출 ± 가중) — ✅ Phase 1a 구현 | `engine/relationships.ts`·`data/relationships.ts` |
| [WORLDCUP_SYSTEM](./WORLDCUP_SYSTEM.md) | **월드컵 참가 유료 DLC**(4년 비시즌 국가대표 차출→성장+사고면제+업적, **스카우팅 쇼케이스=차출선수 FA 영입**) — 📋 설계 완료·구현 추후. 100세션 재검증·현실일정 출처 반영 | `engine/nationalTeam.ts`·`engine/seasonBake.ts`·`data/worldCup.ts`(예정) |
| [SAVE_SYSTEM](./SAVE_SYSTEM.md) | **세이브·마이그레이션**(영속 53필드 스키마·version/migrate·정규화기·안전 복원) — 출시 후 구조 변경 안전 | `store/saveMigration.ts`·`store/useGameStore.ts`(persist) |
| [REALTIME_SIM_SYSTEM](./REALTIME_SIM_SYSTEM.md) | **전진 시뮬+결과 저장 전환(B안)** — 게으른 씨앗 재생 → 1회 치르고 저장(로딩·재생버그 제거). 독립리뷰·함정 7게이트·Phase0~3 | `store/useGameStore.ts`·`data/standings.ts`·`data/production.ts`(전환 중) |
| [MONETIZATION_SYSTEM](./MONETIZATION_SYSTEM.md) | **수익화**(무료+광고+다이아 IAP+DLC) — 다이아(소비성=전지훈련)·광고 쿨다운 카운트다운(A4 ✅ 2026-07-01)·광고="시즌 시작하기" 버튼. **온라인 전환(2026-07-01)**: 오프라인/RevenueCat 폐기→Vercel(BACKEND_SYSTEM). 📋 **추후 DLC 후보: 올림픽·올스타전(2026-07-07 아이디어, 미설계, §4.1)** | `engine/diamonds.ts`·`app/(tabs)/mypage.tsx`·`app/training-camp.tsx`·`lib/ads·iap·log` |
| [BACKEND_SYSTEM](./BACKEND_SYSTEM.md) | **온라인 백엔드(2026-07-01 신설)** — 소셜 로그인·online-first(관전/시뮬 캐시 오프라인·다이아/결제 온라인필수)·Vercel 단독 영수증검증+환불웹훅·다이아 지갑(append-only 원장·멱등)·로그(기기 롤링+서버)·문의+진단스냅샷·관리자+통계. **Supabase Postgres 연결·Vercel 배포 라이브(2026-07-02)**·**멀티게임 proj_code FK(§13.2)**·**보관기간 법정 조사(§13.9)**·**다이아 서버 진실화(§13.12)**·**공지 in-app(§13.13)·쿠폰(§13.14)·관리자 대시보드(§13.15)** · 📋 **설계·미구현(2026-07-07)**: 세이브 복구 채널(§13.23)·dev 환경 구축(§13.24) | `server/`(Next.js)·`lib/server.ts`·`server/db/schema.ts`(proj_info·users·wallet_ledger·coupons·announcements·server_setting) |
| [ANALYTICS_PLAN](./ANALYTICS_PLAN.md) | **운영/분석 스택(2026-07-03 신설)** — Firebase(Analytics·Crashlytics)·RevenueCat·GameAnalytics·BigQuery·Install Referrer·Discord·Vercel Observability·UptimeRobot(+Sentry/PostHog 추후). track() 래퍼·이벤트 taxonomy·KPI. 대부분 EAS 단계 | (계측 — 전 화면 걸침) |
| [PRE_LAUNCH_CHECKLIST](./PRE_LAUNCH_CHECKLIST.md) | **출시 전 수정사항(2026-07-03 신설)** — 비밀키 회전·EAS 실물전환(소셜로그인·IAP·AdMob)·결제환불(#43)·스토어 등록정보·법무/개인정보·QA. 스텁·플레이스홀더·노출키를 실물로 교체 | (전 시스템 걸침) |
| [SECURITY_AUDIT](./SECURITY_AUDIT.md) | **백엔드 보안 감사·발견·수정 체크리스트(2026-07-07 신설)** — 온라인 백엔드(`server/`) 방어 감사: 8개 발견(🔴 무한 다이아 발행·🔴 세션 fail-open/로그인 백도어·🟠 레이트리밋/스냅샷·🟡 멱등키/익명폴백/크론). 상태 체크리스트(⬜→✅)·견고한 것 확인 목록·OPEN QUESTIONS | `server/lib/{auth,wallet,econ,admin}.ts`·wallet routes(`earn`/`spend`) |
| [AUTH_SYSTEM](./AUTH_SYSTEM.md) | **인증(2026-07-02 신설)** — 하드 로그인 벽(M3 정정, 최초1회 온라인·이후 캐시세션 오프라인 진입)·마이페이지 로그아웃·자체 Bearer 세션. Expo Go 스텁→EAS 실물(구글/애플·SecureStore) | `store/useAuthStore.ts`·`app/login.tsx`·`app/_layout.tsx`(게이트)·`server/lib/auth.ts`·`/api/auth/login` |
| [DEVNOTES_SYSTEM](./DEVNOTES_SYSTEM.md) | **개발자 노트/패치노트**(관리자 에디터→서버 원격 콘텐츠, 앱 업데이트 없이 게시) — 구분 탭(패치노트|개발자 노트, 2026-07-08 사용자 결정)·안읽음 배지(로컬)·오프라인 캐시·무푸시. 공지(차단성)와 역할 구분. 📋 설계만(미구현, 2026-07-08) | `server/db/schema.ts`(devnotes)·`server/app/api/{devnotes,admin/devnote}/route.ts`·`server/app/ops-9f3a2c/page.tsx`·`app/devnotes.tsx`·`lib/server.ts`·`store/useAuthStore.ts`(예정) |
| [SOUND_SYSTEM](./SOUND_SYSTEM.md) | **오디오 레이어 정본** — 효과음(휘슬·스파이크·서브) + **배경음악(BGM 10곡 순환·경기 중 정지·볼륨 슬라이더)**. 상태모델(started/suppressed/backgrounded/volume→applyState)·오디오모드 단일화 | `audio/sfx.ts`·`audio/bgm.ts`·`app/_layout.tsx`·`app/match/[id].tsx`·`app/settings.tsx` |
| [ONBOARDING_SYSTEM](./ONBOARDING_SYSTEM.md) | 스포트라이트 튜토리얼(구단 선택부터 화면별 안내, **스텝 단위 영구 추적** → 신규 기능만 재안내)·플레이어 시작 기본 스태프 | `components/Spotlight.tsx`, `data/tutorialSteps.ts`, `store/useGameStore.ts`(seenTips), `data/league.ts`(grantStartingStaff) |

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
| **구단 재정**(모기업·직관·굿즈, 캡 별개 지갑·자금 게이트) + **FINANCE 2.0**(모기업 기조→AI FA 입찰·내 팀 보너스·예고 뉴스) | ✅ (FINANCE_SYSTEM) |
| **중계 현수막**(우승·기록·PO확정 + **경기 중 실시간**: 세트획득·연속·에이스/블록 누적) | ✅ Phase1·3 (BROADCAST_SYSTEM) |
| **선수 인간관계망**(affinity→FA ± 가중) | ✅ Phase 1a (RELATIONSHIP_SYSTEM) |
| **용병 트라이아웃**(1년 계약·매년 풀 유입 — 멸종 해결, 국내 평균 이상 보장) | ✅ (FOREIGN_SYSTEM) |
| **사건·사고**(음주운전 등 출장정지, ~0.4건/시즌) | ✅ (OWNER_SYSTEM 4.6) |
| 명예의전당·영구결번 | ✅ (기존) |
| **기록 화면 개편**(시즌별 이동·통산 리더보드 현역+은퇴 TOP100·팀별 TOP50·6카테고리·세그먼트 탭) | ✅ `data/records.ts`·`app/records.tsx`·`app/records-archive.tsx`(2026-06-30 기록 탭→마이페이지 허브로 이동, 구 `(tabs)/history.tsx`) (HofEntry에 spikes/aces/assists 추가) |
| **마이페이지 탭**(구 "기록" 탭 대체 — 기록·업적·설정·튜토리얼 허브) | ✅ `app/(tabs)/mypage.tsx`(2026-06-30 네비 개편). 기록 본문은 `/records-archive` 스택 분리 |
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
npx tsx tools/checkClubRanks.ts            # 구단 정체성 recentRanks 열별 순위=유효 순열(중복/결손 0)·strengthBias 합=0(2026-06-24 중복 버그 가드)
npx tsx tools/checkSubs.ts                 # 작전 교체 로그(재생 불변식·세트말 net-zero — 부상 교체는 kind:'injury' 영구스왑 예외)
npx tsx tools/_dv_injurysub.ts             # 경기 내 부상 교체(MATCH §1.3d, 발견·검증=Fable 5/구현·문서=Opus) — (a)결정론 400시드×2=0 (b)부상아웃 코트 재등장0 (c)FIVB 예외교체=예산·재진입(usedSubIn/usedStarterOut) 미소모+작전 net-zero 불변 (d)심각도 게이트 severe/injuries≈SEVERE_INJURY_FRAC(0.12·실측13.4%) (e)경기당 부상교체율 0.029 출력 + A/B(FRAC→1.0 mutant→게이트 FAIL 증명). exit 0/1
npx tsx tools/_gt_facontract.ts            # 재계약·FA 영입 시나리오 15케이스(reSign 게이트·캡·프랜차이즈·외인면제·FA 등급/endSeason 불변식, exit 0/1)
npx tsx tools/_gt_bench.ts                  # 주전·벤치 시나리오 9케이스(라인업·마지막리베로·7인가드·건의게이트·suggestStart 최약주전 EC-LU-02, exit 0/1)
npx tsx tools/_dv_bench2.ts                 # 독립검증 — EC-LU-02 옛버그(최강벤치) 재주입 A/B 88/88 검출·사유 우선순위 (독립 세션 산출)
# (_dv_bench.ts = 라인업·게이트·pickRest 독립검증 13체크, 무거움 — on-demand)
npx tsx tools/_dv_drift_posrate.ts 600      # 포지션 세트당 생산 vs box baseline 드리프트(STATS_PROTOCOL §3). baseline: OP톱 4.5(ENGINE_VERSION 4·2026-07-06 서브에이스 공식화 지분 +0.12)·MB블록 0.98·세터 12·리베로 4.7. 해석 분해 _dv_op_interp(on-demand)
npx tsx tools/_dv_drift2_agility.ts         # 노쇠 그룹 멤버십 가드(문서 enum ↔ engine DECAY_STATS) — agility 노쇠 실측 + A/B 대조군(반응·위치 Δ0). EDGE_CASES §3.7, exit 0/1
npx tsx tools/_dv_focus.ts                  # 훈련 방침 순효과 E2E(TRAINING §1.9, 검증·실측=Fable 5/가드·문서=Opus) — (a)W1 배선(초기 오버라이드0·기본=감독focus·toggle liveness·null복원) (b)씨앗 22세이하 쌍대조 jump 서열(공격파>수비파) (c)신인 30명 기술합 서열(기본기파>체력파) (d)완성선수 천장 불변식(헤드룸0 기술 Δ0) + A/B(coachShare≡0.02 mutant=빈방침 주입→(b)(c) FAIL 증명·복원). 쌍대조 원칙 = TEST_METHODOLOGY §4. exit 0/1
npx tsx tools/_dv_traits.ts                 # 선수 특성 엔드투엔드(TRAIT_SYSTEM §5, 발견·실측=Fable 5/가드=Opus) — ①보유율 25~55% ②서브머신 에이스·범실 ON>OFF+liveness>0 ④노쇠 서열 ⑤노력형 전스탯합 서열(⚠기술합 함정 대조) ⑥부상 배수 1.70·0.55 ±0.01 + A/B(injuryTraitMult≡1 mutant→⑥ FAIL 증명). ③클러치는 소폭·고분산이라 제외(measTraits N≥3000 별도). ~5초. exit 0/1
npx tsx tools/_dv_stats.ts                  # 선수 스탯 엔드투엔드 적용(MATCH §5.9, 검증·실측=Fable 5/가드=Opus) — 15스탯 동일시드 페어드 A/B(N=600): 딱 한 스탯만 boost한 A vs 미러 B의 박스 지표(킬%·에이스%·블록·디그·리시브범실%·공격범실%) 방향 정상 = 죽은 스탯 0. **cm-스케일 함정** 분리(height=cm/+8/210, 그 외 +20/99) + mutant(틀린 0~100 스케일이면 키 검사 ❌ 재현)·무boost 동률 자가검증. exit 0/1
npx tsx tools/_dv_fa_relations.ts           # FA 점수→확률+관계(FA §2.7) — relT ±·우승파강행/의리파기피·acceptProb S곡선·SIT_OUT·결정론. exit 0/1
npx tsx tools/_dv_relations.ts              # 인간관계망 모델(RELATIONSHIP_SYSTEM §8 Phase 1a) — affinity 결정론·대칭·innate분포·포지션라이벌·bond단조·외인0. exit 0/1
npx tsx tools/_dv_jersey.ts                 # 헌액 번호(BROADCAST §8) — jerseyNumber 1..99·결정론·동결스냅샷·균등분포 + numberLineage(같은팀·먼저은퇴·통산내림·본인/타팀/비레전드 제외). exit 0/1
npx tsx tools/_dv_lineage.ts 60             # 헌액 번호 계보 길이 실측(EDGE_CASES §3.12 감시①) — 실제 시즌 루프 N시즌 굴려 레전드(≥7500점) 누적, (팀·번호)별 최대 계보 길이 측정. 60→0·300→1(WAI 캡 불요). 측정 도구(판정 advisory)·무거움 on-demand
npx tsx tools/_dv_migrate.ts                # 세이브 마이그레이션 순수함수(SAVE_SYSTEM §6) — 손상/구버전 입력 정규화 무크래시·정상 멱등·A/B(정규화 없이 크래시 실증)·drift(키 일치). exit 0/1
npx tsx tools/_dv_migrate_e2e.ts            # 세이브 마이그레이션 E2E — 실 store에 손상/유효 세이브 넣고 persist.rehydrate() 끝까지(sanitize 로드·base 커밋·commit throw 시 fresh 리셋). exit 0/1
npx tsx tools/_dv_seasondays.ts             # 시즌 길이 단일상수(engine/calendar SEASON_DAYS) == 실제 일정 max dayIndex(164) — 상수 손복제 드리프트 차단. exit 0/1
npx tsx tools/_dv_snapshot_replay.ts        # 진단 재현키+로그강화(BACKEND §13.20) — ①captureReplaySave==partialize+version ②JSON왕복무손실 ③snapshotVersion=2+replay포함 ④확정사건 diag발화(방출·건의) ⑤A/B민감도. exit 0/1
npx tsx tools/_dv_savesize.ts               # 세이브(재현키) 크기 실측(BACKEND §13.20) — N시즌 partialize raw/gzip 바이트 + 필드분해 vs Vercel 4.5MB캡. 100시즌 744KB. 측정 도구(무거움, on-demand)
npx tsx tools/_dv_severance.ts              # 방출 위약금(TRANSACTION_SYSTEM 0.5①) — release가 cash서 severanceFee 차감·unrelease 환불·지갑부족 차단·잔여연수 단조성. exit 0/1
npx tsx tools/_dv_releasefan.ts 8           # 스타 방출→팬 분노(TRANSACTION_SYSTEM 0.5③) — releaseAnger==releaseAngerPenalty(명성)·철회 환불·무명 0(인기 게이트)·fanScore 방향성. 느림(빌드업 4회). exit 0/1
npx tsx tools/_dv_release_unrest.ts 8       # 핵심 방출→선수단 동요(TRANSACTION_SYSTEM 0.5④) — buildOwnerFx 만료 선수 refuseProb += releaseUnrestBias(명성)·무명 0(게이트)·순수함수 단조/상한. exit 0/1
npx tsx tools/_dv_firstserve.ts 24000       # 5세트 첫 서브=코인토스(MATCH_SYSTEM v2.1) 발생+보드반영 (N=24000 — (B)받는팀이점 z<-3 민감도가 8000선 과소표본 false-fail이라 상향, 2026-06-29 확인) — (A)엔진 setFirstServers 홈~50%·1~4세트 홀짝정확 (B)받는팀이점 민감도 (C)교차계층 엔진==독립오라클(recvId)==보드 reconstructRallies 0불일치(소스revert 1118/2146 teeth). exit 0/1
npx tsx tools/_dv_foreign_fa_leak.ts        # 외인 FA 풀 오염 가드 — release 후 외인 미포함·재영입 거부(signInSeason)·국내 대조군 + A/B(구 전부-add 검출). EDGE_CASES §3.8, exit 0/1
npx tsx tools/_dv_foreign_contract.ts       # 계약관리 외인 차단 — release/reSign(외인·아시아) 거부·국내 대조군·willBeFA 외인 false + A/B(가드 제거 시 release(외인)=true). EDGE_CASES §3.9, exit 0/1
npx tsx tools/_dv_tryout_pool.ts            # 트라이아웃 풀 생성 종료 가드(EDGE_CASES §3.14 — edge-swarm 클러스터A) — 정상 domesticAvg 바닥충족·고/극단 domesticAvg 종료(옛 무캡 while은 hang=A/B 이빨). exit 0/1
npx tsx tools/_dv_lottery.ts                # 추첨/드래프트 순번 분포(FA §3·FOREIGN §1, 검증·실측=Fable 5/가드=Opus) — 두 순번모델 POSITION 분포 N=20000: ①드래프트 1R lotteryRound1 **가중**(꼴찌 1픽률 25.0%≫1위 3.6%·평균 픽위치 1.88→4.79 단조) ②외인 tryoutOrder **균등**(성적무관 전 팀 평균 ≈3.00·1픽률 ≈14.3%=1/7·스프레드 0.063) + A/B 교차(균등→가중검사 FAIL·가중→균등검사 FAIL). exit 0/1
npx tsx tools/_dv_name_dedupe.ts            # 동명이인 방지(FOREIGN_SYSTEM §8, 2026-06-30) — 초기 리그·트라이아웃 풀·드래프트 클래스 부류별 표시 중복 0 + taken 회피 + A/B(충돌 배치 dedup 전>0→후 0=오라클 민감) + 결정론. exit 0/1
npx tsx tools/_dv_name_space.ts             # 절차적 이름 생성 공간(FOREIGN_SYSTEM §8 A', 2026-06-30) — 20k 생성 시 고유 이름 국내>5000·외인>1000·아시아>150+국적 전수(절차성=옛 수십리스트 압도, 고갈 없음)·결정론·육안 샘플. exit 0/1
npx tsx tools/_dv_diamonds.ts               # 다이아 이코노미(MONETIZATION §11) — 광고 30분쿨다운/하루8회·업적 1회수령(중복지급0)·전지훈련 구모델(+1/+1, 재적용 전용)+코스형(3스탯 +3/+3 대칭·H1 스탯구성·300💎 정액·cap99) + A/B(쿨다운 무력 검출). exit 0/1
npx tsx tools/_dv_version.ts                 # 버전 비교(BACKEND §13.11/§13.16) — cmpVersion 정수비교·belowVersion(강제 게이트)·needsSoftUpdate(소프트 배너: latest 미만·min 이상) + A/B(문자열 비교였다면 1.10<1.9 오답). exit 0/1
npx tsx tools/_dv_analytics.ts               # 분석 래퍼(ANALYTICS_PLAN) — track() throw-none(전 이벤트+이상params 무크래시)·taxonomy 중복0·계측대상 등록. SDK는 EAS(현재 no-op stub). exit 0/1
npx tsx tools/_dv_draftai.ts                 # AI 드래프트 평가(FA §3.3 3b-value) — 전지적 maxPot 제거·**reveal0 포텐 누출0(공정성)**·reveal 단조·특급률 10.7%(옛12% 근접)·결정론. exit 0/1
npx tsx tools/_dv_scoutreveal.ts             # 스카우터 부분 포텐 공개(FA §3.3 스카우팅2.0 3a) — 개수=reveal함수(0.2미만0·최고≤3=50%상한·단조)·포지션핵심 우선·범위→등급↑축소→최상급 정확·결정론·avg(AI입력). exit 0/1
npx tsx tools/_dv_potdist.ts                 # 현재↔포텐 분포(FA §3.3 스카우팅2.0 2단계) — corr(현재,미래OVR)∈[.45,.62](대체로 비례·역산불가) + 대기만성/반짝 이상치 존재(prospectArc 3%/3% 주입). N=2만. exit 0/1. ※밸런스 회귀는 simLeague 50×6 A/B(변경 전후 동등 확인)
npx tsx tools/_dv_amateur.ts                 # 아마추어 성적표(FA §3.3 스카우팅2.0 1단계) — 역산불가 corr(성적,현재)∈[.4,.6]·corr(성적,포텐)≤.35·R²<.35 + A/B(노이즈無 0.81→0.50)·특급빛남·결정론·스카우터무관. N=2만. exit 0/1
npx tsx tools/_dv_report.ts                  # 스카우트 리포트(FA §3.3 4a) — 두 하드룰: 숨은포텐 누출0(reveal0 불변)·성장주장⊆공개포텐·날조단어0 + reveal↑안갯속감소·A/B·결정론. N=2만. exit 0/1
npx tsx tools/_dv_draftpreview.ts            # 드래프트 클래스 프리뷰(FA §3.3 4c) — 누출0(reveal0 포텐무관)·최대어/풍년/기근·강약 헤드라인 민감도·결정론. exit 0/1
npx tsx tools/_dv_fogleak.ts                 # 스카우팅 안개 누출(EC-DR-03, 2026-07-07) — 공용 fogOvr(prospectScout): (a)120유망주×reveal 임계 아래=범위(정확치 0누출)·위=정확 + A/B(누출 변종=아래서 정확치 재현) (b)형제 정적 grep(draft.tsx·draft-live.tsx의 유망주 overallRaw 렌더가 reveal≥REVEAL_PRECISE/fogOvr 게이트 뒤에만, 우회 0). "내 지명 결과" 미리보기 안개 우회 회귀 차단. exit 0/1
npx tsx tools/_dv_arch.ts                    # 아키텍처 계층 경계 상설 가드(CLAUDE §8, 2026-07-07) — app/components/data/engine/store/lib/types/audio 정적 파싱해 금지 간선 0 단언: engine→{data,store,app,components,lib,audio,db}·data→{app,components,store}·lib/store→{app,components}·types→런타임값 + engine bare import 금지(react/expo/zustand)·Math.random 금지(결정론 계층, allowlist lib/iap·walletKeys·useAuthStore)·leagueDisplayDay=contracts.tsx만. `--selftest`=가짜 트리 A/B(정상 오탐0·뮤턴트 6종 탐지, 디스크 미변경). exit 0/1
npx tsx tools/_dv_arcretro.ts                # 커리어 유형 회고(FA §3.3 4d) — 날조0(비드래프티 아크 누출0)·드래프트출신 1:1·~6%·현역미노출 게이트·결정론. exit 0/1
npx tsx tools/_dv_foreignresume.ts           # 외국인 이력(FOREIGN §9 트라이아웃 2.0) — 포텐 미참조(누출0)·스카우터 정보량 티어 단조(C/A/S)·성적↔현재 상관·날조0·폼↔리포트 무모순·결정론. N=2만. exit 0/1
npx tsx tools/_dv_reset_preserve.ts          # 구단 초기화 계정필드 유지(BACKEND §13.19) — selectTeam/resetSave가 다이아·claimedAch·adState 유지·saveId만 새로·시즌 진행 리셋. 재화 farming 방어(서버측은 라이브 E2E). exit 0/1
npx tsx tools/_dv_refund.ts                  # 환불 음수허용 게이트(BACKEND §13.17) — allowsNegativeBalance가 refund만 true·나머지 reason 전부 false(머니크리티컬: 하나라도 새면 무한소비). exit 0/1. ※환불 grant/refund 왕복은 상설 라이브 _dv_purchase(서버 가드 배터리)가 실증 (구 "로컬 서버 라이브 E2E" 임시 검증은 폐기 — 상설 가드 원칙, 2026-07-06)
npx tsx tools/_dv_campeffect.ts 5 60        # 코스형 전지훈련 순효과(§11.2 H4, effect A/B) — 영건 with/without 5시즌 성장 ΔOVR 평균 ≥0.7(실측 ≈1.0 n≥100, 대칭 +3/+3 2026-07-08·분포 0~2)·음수 0·결정론·null-대조 0·소급 보존(구 엔트리 +2/+7 재현·게인 인자 관통 A/B). "유료인데 체감 0"(4번째 죽은기능) 재발 방지. exit 0/1
npx tsx tools/_dv_campoutbox.ts             # 전지훈련 아웃박스·campLog 재적용·게이트(BACKEND §13.12 P0-4·MONETIZATION §11.2, 발견·검증=Fable 5/가드=Opus) — 실 store 액션 구동+lib/server 제어형 스텁으로 ①정상(+3/+3·cur/pot 임베드) ②크래시복구(dup applied:false→적용·이중과금0) ③오프라인 pending유지 ④이미적용(spend 미호출·+6/+6 아님, A/B) ⑤campLog 시드 재적용(persist.rehydrate: 신 +3/+3·base존재 스킵·구 엔트리 소급 +2/+7) ⑥게이트(not-mine/maxed/not-offseason/already). exit 0/1
npx tsx tools/_dv_devicelog.ts              # 기기 진단 로그 버퍼 순수 헬퍼(BACKEND §13.6 #44) — prune 시즌경계(최근10)·하드상한·범위·시간순·미래제외 + A/B. exit 0/1
npx tsx tools/_dv_snapshot.ts 14            # 진단 스냅샷 생성기(BACKEND §13.6 #45) — 실 store 14시즌 후 스냅샷: 범위[max(0,cur-10)..cur]·미래제외·비어있지않음·뉴스/선수 시즌정합·로그필터·결정론. exit 0/1
npx tsx tools/_dv_setscore_dist.ts 3000     # 세트스코어 분포(독립) — 3-0/3-1/3-2 모두 출현·홈승률 밴드·풀세트 합리 + matchPoints 불변식(승자+패자=3) 0위반 + A/B(깨진 6종 거부). engine-verify 스웜 산물 승격. exit 0/1
npx tsx tools/_dv_sideout_deuce.ts 10000    # 사이드아웃·듀스율 분포 — 사이드아웃(받는팀 랠리획득) ~58%·듀스세트 ~12.5% + A/B 보존(serveWin+sideout==총점). v2 분포 재측정(2026-06-29). exit 0/1
npx tsx tools/_dv_drift_kovo.ts 3000        # KOVO 득점유형 분포(box 단일진실) — 킬~59·스터프~9.5·에이스~5.2·상대범실~26.3 vs 문서값 ±2%p 드리프트 + A/B(유형합==총점). exit 0/1
npx tsx tools/_dv_simcache.ts               # 시뮬 결과 캐시 영속(REALTIME_SIM Phase1+6.1) — 재로드 시 재계산 제거(순위·생산·**dyn** 복원)·무stale(캐시==재계산)·A/B(캐시 조작 반영=실제 사용)·G3 엔진버전 게이트. [7]=dyn(부상/거래) 영속(복원히트·무stale·A/B). [8]=production 직렬화 라운드트립(ProdRow Set/Map이 JSON 후 반복가능 — "iterator not callable" 크래시 가드). exit 0/1
npx tsx tools/_dv_preseason_cold.ts         # 시즌 시작 전(day0 구단선택) 선수/구단 화면 콜드 비용 가드(2026-06-28) — day0은 전 시즌 시드 재생(생산·dyn·인기/사건)을 안 타야(실측 ~2ms<500ms) + A/B(중반 콜드 leagueProduction는 >500ms로 무거움=측정 민감). 선수 화면 진입 15s 회귀 차단. exit 0/1
npx tsx tools/_dv_splice.ts                 # minAffectedDay 캐시 스플라이스(REALTIME_SIM §7) — A: splice==force-full **byte-등가**(44 랜덤 액션열: 벤치add/언벤치/tx/focus/full·러닝상태 재구성) B:결정론×2 C:타이밍(늦은시즌 splice ~7% of full) D:off-by-one minDay 변이→FAIL(민감도) E:오프시즌 프리뷰 분리 등가(…From(base)==fresh full — resolvePreDraft/faMarketPreview/buildDraftContext) F:토글 해결≪base 빌드. exit 0/1
npx tsx tools/_gt_determinism.ts            # 결정론+세이브(REALTIME_SIM Phase0) — 같은시드 in-process 2회 동일·실 partialize/rehydrate 동일·A/B(currentDay 누락 검출). exit 0/2
npx tsx tools/_gt_derived.ts 40             # 파생데이터 churn(HOF·archive·마일스톤·careerTotals) 무결성 — 실 store 40시즌 완주(전 경기 recordResult→endSeason): 중복0·미래참조0·유한비음수·단조·업적정합 + A/B(hofDup/totNaN/msFuture 검출). exit 0/2. ※2026-06-29 수정: setDay만으론 seasonOver 게이트 미충족 no-op(stale)이었음 → 전 경기 결과 기록으로 실제 churn 복원
npx tsx tools/_gt_achmid.ts                 # 통산 업적 시즌중 반영(ACHIEVEMENT, 2026-07-04 문의 12e03390) — 실 store 3경기 후 (A)저장 careerTotals 0으로 첫득점/첫승 잠김 재현 (B)achTotals(저장+진행분)로 열림 (C)시즌경계 이중계산0·승패 이음매 정합. exit 0/1
npx tsx tools/_gt_achedge.ts                # 업적/오프시즌 엣지(EC-ACH-01·EC-CAMP-01, 2026-07-04) — EC1 0경기 항등·EC2 achTotals 가법성·EC3 임계 크로싱(876+124=1000→points_1k, 단독 미달)·EC4 finishCamp 멱등·EC5 endSeason 후 campDoneSeason(옛)≠새시즌(게이트 재개). exit 0/1
npx tsx tools/_a8_verify.ts 14              # 선수 상세 데이터 흐름(A8, 2026-07-01) — 실 store 14시즌 구동 후 seasonLines(시즌별 소속팀·이적 이력 다팀 포함)·awardHistoryOf(수상 이력) 채워짐 검증. on-demand(무거움). ※부수효과: store import 경로가 RN을 안 끄는지(_gt_mock react-native 스텁) 스모크. exit 0/1
npx tsx tools/_ev_transfernews.ts 15        # 타팀 이적/방출 뉴스(NEWS 슬라이스4) — 거물 게이트 볼륨·매달린참조0·중복0·결정론·이동시점OVR. exit 0/1
npx tsx tools/_dv_releasenews.ts            # 방출 뉴스 인간관계 한 줄(RELATIONSHIP §6) — 합성 방출+잔류 각별한동료 "남기고 떠난다" 박힘 + A/B(친구없으면 줄 없음=허위오라클 차단)·조사교정. exit 0/1
npx tsx tools/_ev_draftpick.ts              # AI 드래프트 3티어(FA §3.1) — 특급 BPA·포지션 필요·OVR+성격 불변식 + 성격 A/B + 결정론. exit 0/1
npx tsx tools/_dv_draftlive.ts              # 라이브 인터랙티브 드래프트(FA §3.2.1) — resolveDraft(mySelections): (a)결정론 50시즌×2 (b)존중/소진폴백·풀무결 (c)재개 fast-forward 등가 (d)0내픽·총0 형태 (e)A/B(무시=폴백 재현). exit 0/1
npx tsx tools/_dv_ownerreject.ts            # 감독 건의 거절사유+Form 비대칭(OWNER §2.2) — 실감점량 랭킹(고정순위 아님)·p게이팅·benchP=accept임계·결정론·Form기전 실재. exit 0/1
npx tsx tools/_ev_airetain.ts 12            # AI 재계약 확률(aiRetainProb, FA §4) — 절벽해소(나이/OVR 그라데이션)·순잔류 50~62%밴드·단조·엘리트유지·연속. 구 aiKeepsFA 이진 A/B. 2026-07-02 상대 앵커(medianOvr) 전환 후 12시즌 56.9%·24시즌 54.2%(EC-FA-06 — 다지평 확인은 24 인자로). exit 0/1
npx tsx tools/_ev_promise.ts                # 면담 공약 파기(OWNER 1.3) — 주전약속+벤치=거부급등(0.95) vs 약속+출전=0 vs 전력보강+벤치=파기아님. A/B 4시나리오. exit 0/1
npx tsx tools/_ev_resign.ts                 # 재계약 협상 3택(FA 2.5c) — 후하게≥표준≥짧게·후하게≥시장가·캡내·나이적합 연수(어림5/노장2). exit 0/1
npx tsx tools/_dv_resignrollover.ts         # 인시즌 재계약 발효 규칙(FA §2.5c, 2026-07-08 이음매) — override는 다음 시즌부터 발효(최초 롤오버 선차감 생략): years=N→정확히 N시즌 재직(1년=1시즌, 구 버그는 0시즌 no-op) + 자동연장 경로 불변 + A/B(선차감 재도입 모사→재직 2시즌 검출). exit 0/1
npx tsx tools/_dv_capprecheck.ts            # 계약관리 재계약 사전체크==store 게이트(TRANSACTION §7, 2026-07-08) — pickOffer 사전체크가 capPayroll(inSeasonCost·배신웃돈·franchise 팀캡예외) = store reSign과 동일 판정(허위 여유 0=조용한 거부 제거) + A/B(구 사전체크는 시즌중 영입 보유 시 store와 flip=inSeasonCost load-bearing). exit 0/1
npx tsx tools/_dv_faown.ts                  # 내 원소속 FA 재영입 보상 면제(FA §2.2, 2026-07-08 이음매) — prevTeamOf===myTeam이면 compCash==0(보상금·차감·게이트 모두), 타 구단은 compensationMoney>0(가드 이빨). resolveFAMarket 직접 구동 A/B. exit 0/1
npx tsx tools/_dv_fafail.ts                 # FA 실패 사유 코드↔게이트 정합(FA §2.7.6, 2026-07-09) — faFail 코드(ROSTER/CAP/CASH/LOST/SIT_OUT)가 실제 게이트와 일치. (A)합성 CASH/CAP/ROSTER 강제+A/B 민감도(자금0→CASH, 게이트 우선이라 AI가 데려가도 '뺏김' 아님) (B)자연 40시즌 WON/LOST/SIT_OUT 최종로스터 교차검증. exit 0/1
npx tsx tools/_dv_retire.ts                 # 은퇴 재정비(FA §1.2·MONETIZATION §11.2, 2026-07-08) — ①40세+현역0(200시즌sim) ②HIGH(medOvr+δ7)이상 은퇴0·연속곡선(OVR 1점 항상 유효=절벽금지)·40정년=1 ③결정론+외인 은퇴루프 제외(rng 미소비=국내 스트림 불변) ④39세 전지훈련 차단(store reason=retiring, 38세 대조) ⑤계약연한 40−나이 초과0(capContractYears) ⑥수입선수 정년(importAgesOut: 외인·아시아쿼터 40세 리그 이탈·39세 마지막 시즌·A/B) + A/B 뮤턴트 이빨(하드월/HIGH0/캡 제거 모사→FAIL). exit 0/1
# (2026-06-25 독립 3세션 엣지 도구 = _dv_docs_*·_dv_code_*·_dv_drift_* — EDGE_CASES §3.6, 무거움 on-demand)
npx tsx tools/simStarters.ts               # 선발 검증(지시·OVR·징계·부상·폼·순위 + 리베로/suggestStart 가드 G1·G2)
npx tsx tools/simMood.ts                    # 선수 심리(벤치 사유 귀속·부상자 불만없음·성격/기대치별 기분 A/B·누적→FA·⑦실력밀림 주전급 성격갈림)
npx tsx tools/_ev_rest.ts                   # 로드매니지먼트(#3) — 굳은 순위 주전 휴식·관전==순위 일치(결정론)
# ── 교차 계층 귀속(보드가 보여준 선수 == 박스 귀속 선수) — 스코어박스 충실도 가드(TEST_METHODOLOGY §1.J) ──
npx tsx tools/_ev_box.ts                    # 박스 밸런스 무영향(box 유무 sim.points 바이트 동일)·타임라인 정합·오라클(atkAtt/atkKill) 일치. exit 0/1
npx tsx tools/_ev_box_audit.ts 200          # 박스 무결성(보존식) 0위반·KOVO 밴드·A/B 검출 민감도(허위 오라클 차단). exit 0/1
npx tsx tools/_ev_scorer.ts 200             # 보드 종결 스파이커 == 박스 byId 100%(팬텀 킬 0)·A/B shuffle 대조. exit 0/1
npx tsx tools/_ev_recvmatch.ts 300          # 보드 서브 리시버 == 박스 recvId: 클린 100%(교체반영=applySubsToSix)·노클린은 전부 ace(누수 0)·A/B(shuffle 모드→exit 1). exit 0/1
npx tsx tools/_ev_setmatch.ts 300           # 보드 종결 토서 == 박스 어시 세터(setId) 100.0%(touches·교체반영·세터 디그 시 비상세터 재귀속·잔여 7=OOS 스크램블)·A/B(shuffle). exit 0/1
npx tsx tools/_ev_digdist.ts 300            # 디그 귀속 현실 분산 가드(2026-06-24 재모델) — 개인 디그왕=리베로(15.6%)·디거≥10명·리베로<50%. 구 best-dig(87.7%·5명) 폐기
npx tsx tools/_ev_digmatch.ts 300           # 보드 디그 마커 == 엔진 디그 귀속(2b) 100.0%·A/B chance 10%·드리프트 0·분포 byte동일. auditBoard도 touches:true로 실제 렌더 감사. exit 0/1
npx tsx tools/_ev_touches.ts 200            # 랠리 터치 스크립트 1단계 — 엔진 touches 기록 코히런트(첫=서브·종결 atk==byId·ace serve==byId 100%, 가산·중립 sanity). exit 0/1
npx tsx tools/_ev_statsource.ts 2000        # 통계 단일화 가드 — 통합 prod(box 먹임)가 스코어박스와 선수별 0 분기(5카테고리)·레거시는 분기(도구 민감)·A/B(box vs box=0)
npx tsx tools/_ev_blockcomment.ts 200       # 스터프 중계가 byId 블로커를 호명 100%(블록=킬 수준 충실). exit 0/1
npx tsx tools/_ev_situation.ts 200          # 상황 인지 중계(BOARD_RULES 60) — 세트/매치포인트·듀스 검출 == 독립오라클 100%·합성경계 A/B. exit 0/1
npx tsx tools/_dv_livebanner.ts 40          # 경기 중 실시간 현수막(BROADCAST Phase3) — 세트획득·연속득점·에이스/블록 누적: ①스포일러 안전(배너 at은 rallies[0..at]로 재현·미래 미참조 + A/B 민감)·②세트승자/세트수 정합·③빈도 ~8/경기(스팸 아님)·④결정론. exit 0/1
npx tsx tools/_dv_todisplay.ts 400          # 타임아웃 표시 수 보존(EC-BD-01, 2026-07-07) — courtDirector.timeoutsAt(렌더·가드 공유 순수함수): 코치TO+테크니컬TO 같은 point 동시 발생 시 .find(첫건)이 아니라 전건 표시. point별 개수 동등·Σ==sim.timeouts.length 보존·동시 발생 표본>0 + A/B(.find 변종=동시 point 소실 재현). exit 0/1
npx tsx tools/_ev_matchmvp.ts 300           # 경기 MVP(AWARDS §1) — 이긴 팀 최고생산자 == 독립오라클 100%·승자측·points>0·결정론. exit 0/1
npx tsx tools/_dv_playoffs.ts               # 포스트시즌 브라켓(SEASON §5, 검증·실측=Fable 5/가드=Opus) — 고정 상위3시드 위 몬테카를로 N=500: 불변식 0/500(seeds=top3·2v3준PO·1위직행결승·champion∈seeds=final승자·시리즈 target도달)·상위시드 우세(PO 80.6%·결승 90.0%, 2026-07-08 재측정)·챔피언 90/10/0·시리즈길이(PO 2/3게임·결승 3/4/5)·결정론 + **보드재생 바이트동일**(buildPlayoffBox 세트스코어==series.games, 전 게임 스윕+준PO/결승 명시 케이스) + A/B(오염 Playoffs→검사기 4위반 검출). ~수초. exit 0/1
npx tsx tools/_dv_uictx.ts                  # 화면↔endSeason 오프시즌 인자 정합(EC-FA-09, 2026-07-08) — (A) offseasonArgs 조립 == endSeason 나열 24케이스(드래프트 3경로+FA 프리뷰, 토글 3종) (B) fa.tsx 등급 == 엔진 pre-FA 0불일치(옛 post-market 방식은 40.7% 불일치 = 이빨) (C) 꼬리 인자 5종 누락 뮤턴트 → 컨텍스트 발산 검출. exit 0/1
npx tsx tools/_dv_recap.ts 50               # 시즌 결산(SEASON §5.5) — [A] 포스트시즌 결말(myPostseasonOutcome): kind 분류·시즌당 분포 1/1/1/4·스코어=독립오라클·결정론·오염 3종 이빨 [B] 숙제 브리핑(recapBriefing, 2026-07-08): 풀 진입자⊆faSoon∪expiring·시즌중 재계약(override)/방출/영입 인지·39세 정년 확정자 FA줄 제외 + A/B(override·시즌이동 무시 뮤턴트 3건 검출). exit 0/1
npx tsx tools/_dv_postseason.ts             # 플옵 달력 편입(SEASON §5.0~5.3, 2026-07-08 — 구현=Opus/검증=Fable) — ①달력 슬롯(준PO 167·169·171/결승 175~183 격일)·조기종료 소멸 ②스포일러 0: postseasonReveal 컷오프(치른 경기만)·결승 확정 전 champion/finalsMvp/우승기사 비노출·playoff 기사 수==공개 게임 수·읽음키 append-only ③recordChampion=champion-ceremony 진입 시(결승 확정 후) ④세이브 A안(구세이브 championId 존재→시즌결산 직행) ⑤결정론 + A/B 이빨("전부 공개" 뮤턴트 검출). exit 0/1
npx tsx tools/_ev_retirenews.ts 20          # 은퇴 세리머니 뉴스(NEWS 슬라이스5) — 게이트(8시즌/HOF)·전원기사화·매달린0·중복0·결정론. exit 0/1
npx tsx tools/_ev_rival.ts 12               # 라이벌 구도(CLUB_IDENTITY 6) — 순위인접·접전 가중·임계·결정론·합성 A/B. exit 0/1
npx tsx tools/_ev_josa.ts 18                # 조사 자동교정(NEWS §4.5) — 실기사 잔여 병기 0·합성 경계 A/B(받침·괄호건너뜀·ㄹ예외). exit 0/1
npx tsx tools/_iv_scorebox.ts 600           # 실시간 점수판(boxTimeline) 독립 검증(2026-06-24, 독립 검증자) — 타임라인 1:1·단조·마지막==최종·byId 델타 100%·box중립. _ev_*와 다른 각도(박스 델타)
npx tsx tools/_iv_scorebox_ab.ts            # 위 정합 체크의 A/B 자가검증 — 깨뜨린 타임라인(스냅 swap·스탯 깎음)을 검출(허위 오라클 차단)
# ── 코트 포지셔닝 가드(서브 오버랩·서브리시브 라인·인플레이 공격/블록/수비 — COURT_POSITIONING) ──
npx tsx tools/_dv_overlap.ts 24             # 서브 컨택 오버랩 합법(받는팀 위반 0·세터 포함·서버 면제)·A/B 9/9 검출(독립 구현 오라클)
npx tsx tools/_dv_receive.ts                # 서브리시브 평평한 3인 라인(룰57) — 전위 패서 라인 합류(≥0.74)·비패서 네트(≤0.68) 0미스
npx tsx tools/_dv_position.ts 24            # 인플레이 포지션(2026-06-24) — 인시스템 대기 공격수 핀 100%·블록↔공격 0.000·페리미터 0.56·A/B(0.15 옮기면 잡힘)
# ── 시스템 건강·무결성 가드(밸런스 드리프트 — 불변식 가드가 못 보는 "느린 회귀"를 잡는다. 2026-06-27 루틴 등록: 누락→재정 회귀 늦게 발견 사고 재발 방지, TEST_METHODOLOGY §4) ──
npx tsx tools/simFinance.ts 120            # 재정 건강(잔고·모기업 보전 빈도·FA 자금게이트) — exit 0/1. ❌면 튜닝(2026-06-27 회귀 발견 도구). 2026-06-28 v2 체력 재조율 base 243000(FINANCE 2.0 Stage1). 2026-07-02 시대 앵커(EC-FA-07)로 성장 C 디플레 복원(보전 8%·좌절 16회)
npx tsx tools/_dv_cappressure.ts 15        # 캡 밀착 분포(EC-FA-07) — 팀 국내 페이롤/캡 중앙 ∈[69,80]·최대 ≥88·105%초과 0 + A/B(−11% 디플레 주입 거부). 연봉 디플레류 조용한 느슨화 재발 방지. exit 0/1
npx tsx tools/_dv_sponsorstance.ts         # 모기업 기조(FINANCE 2.0 Stage2) — sponsorStanceOf 도출: aggressive 빈도 5~13%·thrifty 4~10%·normal>75%·양 트리거(상위권/가뭄)·결정론·대칭(순수함수 myTeam/cash 의존0). 합성 archive. exit 0/1
npx tsx tools/_dv_fa_stance.ts 24 6        # 모기업 기조→AI FA 입찰(FINANCE 2.0 Stage3) — 매 오프시즌 stance on/off A/B: ①레버 효과(행선지 Δ>0)·②캡 불변(clamp 위반0)·③방향성(aggressive>normal>thrifty 팀당 FA)·④결정론/A/B민감도·⑤양 stance 발화. 실제 이력(advanceOffseason) 적립. exit 0/1
npx tsx tools/_dv_stance_bonus.ts 20 6   # 모기업 기조→내 팀 1회성 현금보너스(FINANCE 2.0 Stage4) — projectSettledCash on/off A/B: Δ==stanceCashBonus 정합·권한 무영향(thrifty/normal Δ0)·결정론·세 stance 관측. preview=result. exit 0/1
npx tsx tools/_dv_stance_preview.ts      # 모기업 기조 AI 입찰 preview=result(EC-FN-01) — archive에 막 끝난 시즌 유무만 바꿔 upcomingStances 동일(0)·옛 teamStanceOf는 차이(>0=오라클 이빨). edge-swarm 발견·수정. exit 0/1
# parity A/B(FINANCE 2.0 Stage3 필수): `npx tsx tools/simLeague.ts 40 24`(stance on) vs `$env:STANCE_OFF=1; npx tsx tools/simLeague.ts 40 24`(베이스라인=전팀 normal) — parityStd·최장왕조·지속성 r·1위 점유율·약팀반등 밴드 대조(부익부 재점화 감시). off arm == Stage3 이전 동작
# simNews 는 sponsor 예고(Stage2b) 사실 정합도 검증(톤 일치·최신시즌만·건수==sponsorStanceOf 도출)
npx tsx tools/simStatEffect.ts             # 스탯 유효성 — 전 16스탯이 올바른 방향으로 경기 작용(대조군 무편향·id편향 상쇄). exit 0/1
npx tsx tools/simEngineRegression.ts 1200 40 # 경기 엔진 회귀 A/B(48k, 결정론 합성팀) — 분포비율+ΔOVR 승률곡선+q대칭. 계수 변경 전후 diff로 밸런스 붕괴 감지. 스킬 `engine-regression`. 베이스라인 SKILL.md(2026-07-01). 절대 KOVO는 simKovo
npx tsx tools/simStamCurve.ts 3000         # 체력 곡선(MATCH 7.1, 2026-07-07 지표 재정의) — 선발6+리베로 생리 체력(stamProbe 계측훅, 코트구성 무관)으로 세트1→세트5 ≥8%p 하락·세트5 60~82% 밴드. 2차 단언: 피로 교체율(1.3e) 경기당 [0.05,0.5]. 옛 평탄~95%(체력 무의미)·기능사멸/폭주 회귀 차단. exit 0/1
npx tsx tools/simGrowthGap.ts              # 성장 effect-A/B(§1.8 C) — 경기경험 순효과(주전>벤치 격차합≥4·벤치 OVR≥65). 죽은기능(경기XP inert=주전=벤치) 재발 차단. 구 코드면 격차~0 FAIL. exit 0/1
npx tsx tools/simAudit.ts 60               # 영입 13체크(한선수=한팀·이중계약0·캡·자금게이트). exit 0/1
npx tsx tools/simBrokeSign.ts              # 현금 게이팅(돈 없는데 영입 0). exit 0/1
npx tsx tools/simTxDup.ts                  # 시즌중 거래 이중소속/FA 누수 0 + 방출 선수 옛팀 재등장 0(EC-TX-06 — AI 자기방출 재영입 금지, TRANSACTION 0장 ⑥). exit 0/1
npx tsx tools/simOwnerRefuse.ts            # 면담 거부 선수 풀 이동 정확. exit 0/1
npx tsx tools/simForeign.ts 40             # 외인 장기 건강(멸종0·바닥보장·캡·**정년 최고령<40** FOREIGN §1.6). parity(우승경험 6/7)는 표본<80 노이즈라 120시즌 arm에서만 판정(2026-07-02 브리틀 교정 — 40시즌 5/7·120시즌 7/7 실증). exit 0/1
npx tsx tools/simStaffLife.ts              # 스태프 풀 건강(고갈/폭발0·연령·순환) + **tier 붕괴 경고**(정상상태 상위코치 멸종 surface — TEST_METHODOLOGY §4 사각 교정). exit 0/1
npx tsx tools/_dv_staffscarcity.ts [시즌]  # 스태프 희소성/붕괴 게이트(STAFF §8.1 2.0) — 초기 tier 스냅샷 + N시즌 정상상태 tier + 수요 대비 + **붕괴 해소 게이트**(정상상태 코치 A≥1.5=소수시장, <1.5 멸종이면 exit1). exit 0/1
npx tsx tools/_dv_coachgrowth.ts           # 코치 성장·재생성(STAFF §8.1 phase②③) — 성장 상한92·성과차등(상위팀>하위팀)·수렴·엘리트 은퇴자→A급 유입·레전드보너스·결정론. exit 0/1
npx tsx tools/_dv_fitpick.ts               # AI 로스터적합 성향 픽(STAFF §8.1 phase④) — 팀 나이별 적합 성향(어린→육성·노장→즉전)·5종 다양(메타 아님)·나이극단 대조·결정론. exit 0/1
npx tsx tools/_e2e_twocycle.ts             # 2사이클 E2E(docs/E2E_TWOCYCLE_CHECKLIST) — 헤드리스 실store+engine, 서버 fetch스텁. 온보딩→전지훈련(다이아−900·3스탯↑·원자성)→감독/FA/외인→endSeason×2→업적→AI팀성장(OVR·감독카리스마↑). exit 0/1
npx tsx tools/_dv_coachtype.ts             # 코치 성향 직교성(STAFF §8.1 phase①a) — 육성형↔즉전형 나이타깃 교차(스칼라 지배 없음)·완성형 장기천장·노쇠억제형 노장보존·결정론·레거시 save-compat. exit 0/1
npx tsx tools/_dv_coachtype_dist.ts        # 코치 성향 배정(STAFF §8.1 phase①b) — 분야 균등(33/33/33·50/50)·결정론·시드풀+AI팀 전원 typed(허위오라클 방지). exit 0/1
npx tsx tools/simScandalEffect.ts          # 사건사고 정지출전 차단·영구퇴출 정합. exit 0/1
npx tsx tools/simStatRecord.ts             # 개인 귀속 결정론·팀 누수0·개인합=팀박스. exit 0/1
npx tsx tools/simNews.ts                   # 뉴스 무결성(빈헤드/본문·내용중복·매달린 teamId 0) + 변주 가드(§4.4 Step4: 고볼륨 kind 변주비율≥0.90·n-gram 최대겹침<0.90 — 해시 붕괴/셀렉터 축소 검출, A/B teeth) + 읽음키 유일성. exit 0/2
npx tsx tools/_dv_newsday0.ts              # 첫 경기 전 뉴스 스포일러 차단(EC-NEWS-01·NEWS §3.5, 2026-06-30) — leagueDay=-1 실시간 뉴스 0 + A/B(경계해제 시 재현=필터 민감). 미관전 데뷔·미래 부상/사건 노출 회귀 차단. exit 0/2
npx tsx tools/_dv_newsorder.ts             # 뉴스 2주 만료(NEWS §9, 2026-07-05 최신순) — freshNews: 요약(day없음) 유지·14일 경계 유지·15일+ 만료 + A/B(표시일 급증 시 인게임 전부 만료=요약만 잔존, 필터가 진짜 day로 거름). exit 0/1
npx tsx tools/_ev_offseasonnews.ts 32      # 오프시즌 결산 뉴스(NEWS §3.7 슬라이스6, 2026-07-08) — 32오프시즌: 내 팀 결산 종합 항상 1건(조용한 오프시즌 포함=리브니스)·드래프트 픽 전원 기사화·외인교체 로그정합(누락/날조0)·결정론·신인 OVR 누수0(안개) + A/B(팀없음→결산0·OVR정규식 teeth). exit 0/1
npx tsx tools/_dv_newskey.ts               # 뉴스 목록↔상세 안정키 배선(NEWS §3.6, F1 2026-07-07) — 만료 기사 있는 상태서 목록 인덱스 k의 newsKey == 상세가 그 키로 집는 기사(0 불일치)·읽음대상 정확 + A/B(인덱스 라우팅으로 되돌리면 어긋남 재현). exit 0/1
npx tsx tools/_dv_displaycutoff.ts         # 표시 컷오프 결과인지(SEASON §3.3, F2 2026-07-07) — 방금 기록 경기 포함·시즌말 리그 최종일 전체 공개(=아카이브/PO 수치 일치)·미관전 미래 누수 0 + A/B(leagueDisplayDay 단독으로 되돌리면 방금경기/시즌말 누락 재현). exit 0/1
npx tsx tools/_dv_batch_a123.ts             # day<0 빈구간 가드(A1)·기록경기 소급차단 fromDay(A2)·unbench 종결일(A3) — 콜드 타이밍 증명(-1 경로 0ms vs 풀시뮬 2s)·리플레이 first-changed-day 검증 (2026-07-08). exit 0/1
npx tsx tools/_dv_batch_a4.ts               # 훈련 방침 타임라인(TRAINING §1.9.1, 사용자 결정 2026-07-08 "바꾼 날부터") — 쌍대조 양방향(변경일 前 바이트동일 20/20·後 분기 20/20)·세이브 v1→v2 마이그레이션 바이트동일(60/60)·focusLog 시드/스킵. exit 0/1
npx tsx tools/_dv_batch_det.ts              # 방침 타임라인 결정론 — 세그먼트 무결성·evolved 로스터 300시드×2=0diff·데이터층 결정론. exit 0/1
npx tsx tools/_dv_legendnews.ts [시즌=60]  # 헌액 번호/계보 뉴스 실가드(BROADCAST §8.2·§8.3, 2026-07-07 관찰→실가드 승격) — ①레전드 전원 kind='hof'+본문 '헌액 번호 N번' ②합성 케이스(같은 팀·같은 번호 레전드 2명, 자연표본선 희귀)로 '같은 N번을 달았던 과거 레전드' 계보 문구 박힘 + A/B(LEGENDNEWS_POISON=1 기대문자열 오염→FAIL). exit 0/1
npx tsx tools/_dv_capdomestic.ts           # 샐러리캡=국내 전용(EC-CAP-01, 2026-06-30) — day0 전 구단 국내 페이롤 ≤ 캡(초과 0) + A/B(외인 포함 규칙은 ≥1팀 초과로 잡힘=필터 민감) + 인천 사례 국내<캡<전체. 대시보드·단장실·이동·FA 외인혼입 빨강/영입차단 회귀 차단. exit 0/2
npx tsx tools/_dv_seasonlabel.ts           # 시즌 연도 라벨(EC-REC-01 후속, 2026-07-04) — seasonYear: 1시즌=2025-26·3시즌=2027-28·배경 음수idx·100년 겹침0·세기경계·범위·A/B(YYYY-YY 형식). exit 0/1
npx tsx tools/_dv_careerseasons.ts 3       # 통산 기록 표시 분모(EC-REC-01, 2026-07-04 실기기 발견) — 실store 3시즌: 통산경기수==ΣseasonLines.matches(분모=seasonLines.length 정당)·career.seasons>seasonLines.length 재현(시드 백스토리)·음수갭0·A/B 최대갭. exit 0/1
npx tsx tools/_dv_keepall.ts               # 한글 어절 줄바꿈 keep-all(UI-24, 2026-07-04 에뮬 발견) — keepAllHangul가 인접 한글 사이에만 U+2060 삽입·공백/부호/이모지 불변·멱등 + A/B 민감도. exit 0/1
npx tsx tools/_dv_injury_daybasis.ts       # 부상/정지 표기 날짜기준 일치(EC-UI-03, 2026-07-04 사용자 발견) — 선수단 currentDay ↔ 상세 currentDay(수정 전 displayDay) 대조. 시드리그 7팀×166일 A/B: 구 basis 불일치 37건(선수단🚑·상세무 19 + stale 18) 재현 → 신 basis 0건. 상세 role·정지배너 회귀 차단. exit 0/1
npx tsx tools/_dv_growthgate.ts             # 성장 리포트 트리거 게이트(TRAINING §성장리포트, 2026-07-08) — 미완 경기 이탈(이어보기·결과 미기록·currentDay 전진)엔 모달 안 뜸(보류)·경기 완료(recordResult) 후 그 구간 표시·중복 방지·미초기화 catch-up 방지·결정론 + A/B(게이트 제거 모사→미완에서 뜸 검출). exit 0/1
npx tsx tools/_dv_growthreport.ts          # 성장 리포트 모달(TRAINING §성장리포트, 2026-07-04 사용자 요청) — growthReport가 카드 표시값(deriveRatings 정수) 변화를 정확히 diff. 구간 가드(0폭/역/음수)·시즌 성장 검출·오라클 자가대조(delta==재계산 diff)·결정론. exit 0/1
npx tsx tools/_dv_debut.ts                  # 입단 스냅샷 커리어 누적(TRAINING §성장리포트, 2026-07-06) — Player.debut 생성 시 캡처(OVR+15원본, 로스터 카드 정합)·전 변환 스프레드 보존·커리어 누적=현재−입단 + **A/B: debut 유무가 evolve 스탯 무변경(엔진 불간섭=결정론 무영향)**. exit 0/1
npx tsx tools/_dv_bgm.ts                    # BGM 자산·배선 정합(SOUND_SYSTEM §4) — assets/bgm .m4a 10개·명명(bgm_01..10)·bgm.ts TRACKS require 수 일치·bgmVolume 마이그레이션 키 3곳(SAVE_DEFAULTS/KIND/partialize). exit 0/1
npx tsx tools/_dv_face.ts                   # 선수 아바타 피처(AVATAR_SYSTEM, 2026-07-04 유대감) — faceFeatures 결정론(같은 id 동일) + 변형 분포(5스타일·5피부·7헤어·6배경 전부·편중<40%). exit 0/1
npx tsx tools/_dv_tips.ts                   # 스포트라이트 튜토리얼 커버리지(ONBOARDING §3, 2026-07-04) — 전 팁 anchor가 실제 SpotlightTarget id에 매칭(동적 team-card-0 포함)·오버레이 없는 화면 0·중복 id 0·고아 앵커 0 + A/B(가짜 anchor/화면/중복 주입 시 FAIL). exit 0/1
npx tsx tools/_dv_copylint.ts              # 유저 문구 정합(2026-06-30, 에뮬 발견 회귀 분석) — data/engine/app/components 소스에 남성형(사나이·그의/그가 경계인식)·배구 오용어(라켓·홈런·골키퍼) 0건 + A/B(더러운 문장 ≥3 적발·깨끗한 문장 "리그가/리그의" 오탐 0). exit 0/2
npx tsx tools/simSuggest.ts                # 건의 시스템(감독 성향이 수락/거절 가른다). exit 0/1
npx tsx tools/_ev_suggest_defer.ts         # 건의 반영 시점(OWNER 2.3, 2026-06-28) — 관전 중(이어보기 대기) 경기엔 미적용·다음 경기부터(fromDay=currentDay+1) + A/B(델타=1, 옛 미적용 검출). 시간차/stale-resume·리롤 차단. exit 0/1
npx tsx tools/_dv_foreign_archetype.ts     # 외국인 연고 성격 가드(EC-FG-03, 2026-06-28) — 외인 hometown 아키타입/preferredTeamId 0·국내 도달가능 대조군 + effectiveArchetypeOf·discontentNow 외인 게이트(A/B). "외인이 고향팀 그리움" 회귀 차단. exit 0/1
npx expo export --platform android        # 번들 확인 후 dist 삭제
npm run sim:web                            # 엔진 테스트 콘솔(웹) → localhost:5051 (16탭, SIM_CONSOLE)
```

### 서버 가드 배터리 (백엔드 변경 시 필수)

`server/` 하위(라우트·lib·스키마)가 바뀌면 **필수**, 안 바뀌었어도 전체 테스트 시 포함한다. 조항 단위
대조·서버 5렌즈(인증 귀속·proj 스코프·상한 단위·date-only 타임존·관찰 채널 머니패스)는 **`backend-verify`
스킬**(TEST_METHODOLOGY 기법 L). 전부 exit 0이어야 통과 — 순수 3(DB 불필요)·라이브 6(`server/.env.local`의
`DATABASE_URL`=dev Postgres 필요, 테스트 데이터는 프리픽스로 자동 정리).

> **상설 가드 원칙**: ~~쿠폰/환불 왕복은 로컬 서버 라이브 E2E(임시 스크립트, 검증 후 삭제)로 실증~~ →
> **폐기(2026-07-06)**: 임시 E2E를 검증 후 삭제하면 회귀 무방비 — **14건 잠복의 공통 뿌리**. 라이브 가드는
> **상설(`server/tools/_dv_*`) + 이 배터리 등록**이 완료 조건이다(그냥 존재만 하면 배터리 밖에서 인접 변경에
> 조용히 깨진다 — `_dv_purchase` afterSafe 이틀 잠복).

```
# ── 전체 배터리 복붙 체인(순수 3 + 라이브 6, 하나라도 실패 시 중단) ──
npx tsx tools/_dv_walletauth.ts && npx tsx tools/_dv_coupon.ts && (cd server && npx tsx tools/_dv_security.ts) && (cd server && npx tsx tools/_dv_ratelimit.ts) && (cd server && for t in _dv_purchase _dv_announce _dv_coupon_live _dv_achearn _dv_walletreplay walletConcurrency; do node_modules/.bin/tsx --env-file=.env.local tools/$t.ts || exit 1; done)

# ── 순수(repo 루트, DB 불필요) ──
npx tsx tools/_dv_walletauth.ts             # 다이아 서버 진실화(BACKEND §13.12) — 순수: 멱등키 빌더 전역유일(userId 포함)·세이브리셋 무료강화 차단(camp saveId 에폭)·업적 계정평생1회 비대칭·econ 금액권위(ad+50/camp−300 서버상수·업적 호출당1000 클램프)·카탈로그 총합(16220)≤평생합캡(20000) 드리프트 가드·reason 화이트리스트 + **engine↔server econ 미러 크로스가드(AD_REWARD/CAMP/AD_DAILY_CAP/WELCOME 4값, 2026-07-07)·다이아 팩 카탈로그(server products↔diamondTiers 6팩 id+수량)·엔타이틀먼트 SKU 클라(lib/iap 정규식)↔서버 정합** + A/B(옛 클라신뢰/무에폭 키/econ 51 변이 재현). exit 0/1. ※평생합 서버 왕복(원장 sum·경계·409 cap)은 라이브 _dv_achearn이 실증
npx tsx tools/_dv_coupon.ts                 # 쿠폰·관리자 순수(BACKEND §13.14/§13.15) — normalizeCode(대문자+trim)·requireAdmin fail-closed(토큰 미설정/<16자→거부·정확토큰 허용·길이가드). exit 0/1. ※발급·사용·이중지급0·타겟·만료는 상설 라이브 _dv_coupon_live가 실증
(cd server && npx tsx tools/_dv_security.ts) # 보안 수정 순수 가드(SECURITY_AUDIT #1·#2(a)·#4·#5, 2026-07-07, 구현=Opus/검증·커밋=Fable 5) — DB불필요: welcome 클라키무시 계정당상수·earn/spend 저장키 userId 서버바인딩(교차유저 선점차단)·세션시크릿 prod fail-closed(미설정/<32자/기본값→signToken throw·verifyToken null)+토큰만료(iat 180일)·스냅샷 256KB 상한 + A/B(강한시크릿 왕복·신선토큰 통과=만료 오탐 아님·변이 자가검증). exit 0/1. ※라이브 dedup(welcome varying-key·선점)은 dev DB walletConcurrency/_dv_walletreplay가 실증
(cd server && npx tsx tools/_dv_ratelimit.ts) # 레이트리밋 순수 가드(SECURITY_AUDIT #3, 2026-07-07, 구현=Opus/검증·커밋=Fable 5) — DB·Redis불필요: env(UPSTASH_*) 미설정 시 checkLimit 항상 허용(fail-open no-op, 세팅 전 커밋 안전 증명)·clientIp xff 첫 홉 파싱(폴백 unknown)·LIMITS 상수=의도 윈도(login10/60·coupon user8/60+IP20/600·ticket5/600·snapshot10/300 드리프트 가드)·엔드포인트별 프리픽스 구분 + 변이 자가검증. exit 0/1. ※라이브 429 차단은 Upstash env 주입 후 A/B(팔로우업)
# ── 라이브(server/, .env.local DATABASE_URL 필요 — dev Postgres) ──
(cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_purchase.ts)  # 결제 검증 머니패스(BACKEND §13.18 #43) — RC 웹훅 인증 fail-closed·샌드박스/엔타이틀먼트/미등록 무시·grant/refund·멱등 dedup·라우트 통합(401/+1000/재전송 dedup/−1000)·afterSafe(관찰 채널 throw가 응답 오염 안 함)·테스트유저 정리. exit 0/1
(cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_announce.ts)  # 공지 CRUD 가드(BACKEND §13.11·13.13·13.15, 2026-07-06) — 라이브 dev DB: 발행→bootstrap 노출·기간 필터(만료/미래)·pinned 정렬·PATCH/DELETE 404 대칭·proj 스코프 4메서드·date-only endsAt KST 정규화(14:59:59.999Z)·fail-closed 인증 8항목 + 만료 필터 A/B. _DV_ANN_ 자동정리. exit 0/1
(cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_coupon_live.ts)  # 쿠폰 발급·사용 라이브 가드(BACKEND §13.14·13.15·13.17 P0-5, 2026-07-06) — 라이브 dev DB: 발급→redeem(+reward DB대조)·이중사용 used·기간·개인타겟 은폐·무토큰 redeem 401+dev-user-1 무변화(C1 인증폴백)·date-only endsAt KST(C2)·미존재 targetUserId 400(C3)·중복 409·DELETE 409·무토큰 admin 401 12항목 + 이중사용 UNIQUE A/B. _DVCPN_ 자동정리. exit 0/1
(cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_achearn.ts)  # 업적 적립 라이브 가드(BACKEND §13.12 P0-2·H3, 2026-07-06 발견·검증=Fable 5/수정·문서=Opus) — 라이브 dev DB 실토큰: 정상 earn(+applied)·멱등 재호출(applied:false)·호출당 클램프(99999→1000)·평생합 경계(19,900→+100 클램프)·초과 409 cap·A/B(백스톱 없으면 통과 대조). _DVACH_ 자동정리. exit 0/1
(cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_walletreplay.ts)  # 지갑 멱등 재시도 잔액(BACKEND §4, 2026-07-06) — 라이브 dev DB: 지급+1000→지출−900→같은키 재시도 반환==현재잔액 100(스냅샷 1000 아님)·불변식 balance==Σledger + A/B(원장 balanceAfter=1000 대조군). 던지기 유저 자동 정리. exit 0/1
(cd server && node_modules/.bin/tsx --env-file=.env.local tools/walletConcurrency.ts)  # 동시 spend 이중지불 방지(BACKEND §13.4 H2) — 잔액 K에 N(>K) 동시 −1 → 정확히 K건만 성공·음수 0·원장 delta 합==적립−성공차감(FOR UPDATE 없으면 초과지출로 음수). conc-test-user 리셋. exit 0/1
# (on-demand) (cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_sentry_verify.ts)  # Sentry 서버 관측(BACKEND §13.21) — DSN 주입 시 이벤트 flush=true(대시보드 확인). DSN 없으면 no-op이라 배터리 제외
```

## 아키텍처 원칙 (CLAUDE.md 11장)

- 의존 방향: UI(`app/`) → 셀렉터(`data/`) → 엔진(`engine/`). 역방향 금지.
- 엔진은 React/Expo 무의존 순수 함수 + 시드 결정론.
- 엔진끼리는 구현이 아니라 **출력 타입**(`SimResult`/`ProdLine` 등)에만 의존 → 시스템 교체 가능.
- 새 설계 결정은 코드보다 먼저 해당 문서(+ 본 색인)에 반영한다.
