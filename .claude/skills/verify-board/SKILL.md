---
name: verify-board
description: Verify the match-board choreography against documented user cautions (docs/BOARD_RULES.md) by running the headless frame-by-frame audit (tools/auditBoard.ts), type check, and unit tests, then reporting per-caution compliance. ALSO the project UI inspector (UI 검수기) — verifies general UI interaction rules in docs/UI_RULES.md (loading/disable on heavy ops, etc.). Invoke when the user asks to "검증", "보드 검증", "UI 검수", "시뮬 돌리고 검증", "연출 확인", "어색한 장면 찾아", or after ANY change to components/courtPath.ts, courtDirector.ts, courtLayout.ts, courtCommentary.ts, MatchCourt.tsx, or sim-web/ console / app UI handlers. Also invoke to ADD a new caution (board → BOARD_RULES, UI 상호작용 → UI_RULES) when the user reports a new awkward scene or UI issue.
---

# verify-board — 관전 연출 검증기

**기준 문서: `docs/BOARD_RULES.md`** — 사용자가 경기를 보다가 잡아낸 주의사항 17+건과
그것을 자동 검사하는 감사 룰(A~P)의 대응표. 검증은 항상 이 문서와 **대조하며** 진행한다.

## 실행 순서

1. `docs/BOARD_RULES.md`를 Read — 주의사항 목록과 수치 기준을 기억한다.
2. 배터리 실행:
   ```
   npx tsc --noEmit
   npx tsx tools/auditBoard.ts 10        # 경기수 인자(기본 6). 정밀 검증은 10+
   npm test
   ```
   auditBoard는 렌더와 동일한 순수 모듈(courtPath/courtDirector)을 40ms 프레임으로 재생하므로
   "화면에 보이는 위치 = 검사하는 위치"다. 수 분 걸리면 `run_in_background`로.
3. **문서 대조 보고**: BOARD_RULES의 대응표 순서대로, 각 주의사항이 ① 어느 룰로 검사됐고
   ② 위반 0건인지 표로 보고한다. 수치 기준(분포·속도·수비 홀·중계 줄수)도 리포트에서 읽어 짚는다.
4. 위반이 나오면: `npx tsx tools/auditBoard.ts 6 --dump`로 ASCII 코트 덤프를 보고 원인 모듈을
   좁힌다(연출=courtPath, 전 마커 목표=courtDirector, 자리 계산=courtLayout). **룰을 느슨하게
   풀어서 통과시키지 않는다** — 연출을 고친다.

## 새 주의사항이 들어왔을 때 (사용자가 새 어색한 장면을 보고)

처리 순서를 반드시 지킨다 (문서 먼저 — CLAUDE.md 11장):

1. `docs/BOARD_RULES.md` 대응표에 행 추가 (사용자 발화 요지 + 날짜).
2. 연출 수정 (courtPath 등).
3. **상설 감사 룰 추가** (auditBoard — 같은 클래스 재발 방지). 룰 문자는 알파벳 순서로 다음 것.
4. 회귀 검증: 가능하면 옛 버그를 임시 재주입해 룰이 잡는지 확인 후 `git checkout`으로 원복.
5. 풀배터리 0건 → 커밋(`YYMMDD :: 한국어 요약`) → push.

## UI 상호작용 룰 검수 (`docs/UI_RULES.md`)

보드 연출(BOARD_RULES) 외에 **일반 UI 상호작용**(버튼·로딩·비활성·빈상태)도 이 스킬이 검수한다.
sim-web 콘솔(`sim-web/`)이나 앱 화면의 *조작* 관련 변경이면:

1. `docs/UI_RULES.md`를 Read — 규칙(UI-1 등)과 구현/검증법을 기억한다.
2. 각 규칙을 대조 보고. 자동 감사 도구가 없는 규칙(상호작용)은 **코드/실행으로 직접 확인**:
   - **UI-1(무거운 작업 로딩+비활성)**: 무거운 핸들러(N회 반복 시뮬·무거운 셀렉터)가 `runHeavy`/`maybeHeavy`
     (sim-web) 또는 `Loading`/`useDeferredReady`(앱)로 감싸였는지 grep + 가능하면 브라우저로 N=5000 실행해
     버튼 `disabled`·로딩 표시·완료 후 복구 확인. sim-web 변경이면 `npm run sim:web:check`(타입체크)도.
3. **새 UI 주의사항**이 들어오면 BOARD_RULES와 같은 절차: ① `docs/UI_RULES.md` 대응표에 행 추가 →
   ② 화면 수정 → ③ 검증(grep/실행) → ④ 풀배터리 0건 → 커밋. (보드 장면이면 BOARD_RULES, 상호작용이면 UI_RULES)

## 판정 기준

- **이상 장면 0건**이 머지 조건. 1건이라도 있으면 실패로 보고한다.
- 종결 분포가 엔진 분포와 크게 어긋나면(보드가 결과를 지어냄) 실패 — 엔진 분포 자체의 KOVO
  정렬은 `tools/simKovo.ts`(엔진 검증) 소관이지 이 스킬 소관이 아니다.
- 엔진(`engine/`)을 건드린 변경이면 이 스킬로는 부족 — simKovo(KOVO 분포)·시즌 시뮬(`/sim-league`)·
  **스탯 유효성**(`npx tsx tools/simStatEffect.ts` — 16개 스탯 각각을 고/저 통제 실험으로 승률 측정,
  무효/역효과 스탯 검출)·**동작 스탯 추적**(`npx tsx tools/simActionTrace.ts` — 모든 서브/리시브/세트/
  공격/디그가 "그 선수의 현재(체력·부상 반영) 스탯"에서 나왔는지: 기본 스탯 재계산 정합, 세트별 피로
  곡선, 실효 스탯 3분위 성공률 단조)까지 풀배터리를 돌린다. 스탯 산식을 바꿨다면 둘 다 필수.
