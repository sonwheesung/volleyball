---
name: verify-board
description: Verify the match-board choreography against the documented user cautions (docs/BOARD_RULES.md) by running the headless frame-by-frame audit (tools/auditBoard.ts), type check, and unit tests, then reporting per-caution compliance. Invoke when the user asks to "검증", "보드 검증", "시뮬 돌리고 검증", "연출 확인", "어색한 장면 찾아", or after ANY change to components/courtPath.ts, courtDirector.ts, courtLayout.ts, courtCommentary.ts, or MatchCourt.tsx. Also invoke to ADD a new caution when the user reports a new awkward scene while watching a match.
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

## 판정 기준

- **이상 장면 0건**이 머지 조건. 1건이라도 있으면 실패로 보고한다.
- 종결 분포가 엔진 분포와 크게 어긋나면(보드가 결과를 지어냄) 실패 — 엔진 분포 자체의 KOVO
  정렬은 `tools/simKovo.ts`(엔진 검증) 소관이지 이 스킬 소관이 아니다.
- 엔진(`engine/`)을 건드린 변경이면 이 스킬로는 부족 — simKovo(KOVO 분포)·시즌 시뮬(`/sim-league`)·
  **스탯 유효성**(`npx tsx tools/simStatEffect.ts` — 16개 스탯 각각을 고/저 통제 실험으로 승률 측정,
  무효/역효과 스탯 검출)·**동작 스탯 추적**(`npx tsx tools/simActionTrace.ts` — 모든 서브/리시브/세트/
  공격/디그가 "그 선수의 현재(체력·부상 반영) 스탯"에서 나왔는지: 기본 스탯 재계산 정합, 세트별 피로
  곡선, 실효 스탯 3분위 성공률 단조)까지 풀배터리를 돌린다. 스탯 산식을 바꿨다면 둘 다 필수.
