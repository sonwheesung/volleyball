---
name: run-all-tests
description: Run the project's FULL documented verification suite (docs/README.md 검증 루틴 — typechecks, unit tests, board audit, sim guards, cross-layer attribution guards) and report a pass/fail table. Then, if a NEW test case or guard arises during the run, register it into the relevant test doc AND back into the suite. Invoke when the user says "전체 테스트 진행", "모든 테스트 돌려", "테스트 다 돌려", "전체 검증", "run all tests", "full test suite", or asks to verify everything before a commit/release.
---

# run-all-tests — 문서 기준 전체 검증 + 신규 테케 문서화

> **왜**: "전체 테스트 진행"이라고 하면 매번 같은 전체 묶음을 빠짐없이 돌려야 하고, 그 과정에서 **새로 생긴
> 테스트 케이스/가드가 문서와 회귀 묶음에서 새는** 일이 반복됐다. 이 스킬은 (1) `docs/README.md`의 "검증 루틴"을
> **단일 진실**로 삼아 거기 적힌 걸 전부 돌리고, (2) 실행 중 새 테케가 나오면 **관련 테스트 문서에 기입 + 검증 루틴에 추가**까지 한다.

## 1. 무엇을 돌리나 — README가 정본 (하드코딩 금지)

**먼저 `docs/README.md`의 "## 검증 루틴" 코드블록을 읽어** 거기 나열된 명령을 그대로 돌린다. 목록은 시간이
지나며 늘어나므로 이 스킬에 베껴두지 않는다 — README가 기준. 현재(2026-06-23) 묶음의 모양:

- **타입체크**: `npx tsc --noEmit` (앱) · `npx tsc --noEmit -p tsconfig.test.json` (테스트)
- **유닛**: `npm test` (node --test, 현재 205)
- **보드 안무 감사**: `npx tsx tools/auditBoard.ts <N>` (이상 0건이어야 — N은 200+ 권장, 문서 예시는 6)
- **보드 타깃 측정**: `checkBoardFixes` · `checkBlockerCross`
- **셀렉터/교체**: `checkRecords` · `checkSubs`
- **시즌/심리/휴식**: `simStarters` · `simMood` · `_ev_rest`
- **교차 계층 귀속 가드(스코어박스 충실도)**: `_ev_box` · `_ev_box_audit` · `_ev_scorer` · `_ev_recvmatch` · `_ev_setmatch` · `_ev_blockcomment`
- (옵션) `npx expo export --platform android` 번들 확인 · `npm run sim:web`(수동 콘솔, 상시 실행은 생략)

> 무거운 도구가 많다 → **백그라운드 병렬**로 띄우고(run_in_background) 결과 파일을 모아 표로 정리한다.
> auditBoard는 코트 ASCII를 쏟으니 판정 줄(`이상 … 0건` / `❌ 이상 N건`)만 grep해 확인한다.

### 1.5 서버 가드 배터리 (백엔드 표면 — 2026-07-06 신설)

README "검증 루틴"에 흩어져 있던 **서버 가드**를 하나의 배터리로 묶는다. **`server/` 하위(라우트·lib·
스키마)가 바뀌면 필수, 안 바뀌었어도 "전체 테스트"엔 포함**한다. 배경: 2026-07-06 백엔드 14건이 전부
기존 장치를 통과한 채 잠복 — 뿌리 하나가 **`run-all-tests`가 서버 가드를 안 돌려 `_dv_purchase`가
배터리 밖에서 afterSafe 회귀로 이틀 잠복**한 것(엔진 배터리와 같은 밀도로 상설·등록해야 안 샌다).

- **순수 2**(repo 루트, DB 불필요):
  - `npx tsx tools/_dv_walletauth.ts` — 지갑 순수(멱등키·econ 금액·카탈로그 총합≤평생합캡 드리프트 + A/B)
  - `npx tsx tools/_dv_coupon.ts` — 쿠폰 순수(normalizeCode·requireAdmin fail-closed)
- **라이브 6**(`server/`, `.env.local`의 `DATABASE_URL` 필요 — dev Postgres):
  - `cd server && node_modules/.bin/tsx --env-file=.env.local tools/_dv_purchase.ts` — 결제 머니패스(afterSafe·grant/refund·멱등)
  - `… tools/_dv_announce.ts` — 공지 CRUD(기간·정렬·proj 스코프·404 대칭·KST 타임존)
  - `… tools/_dv_coupon_live.ts` — 쿠폰 발급·사용(인증폴백 C1·이중사용·기간·타겟·KST C2)
  - `… tools/_dv_achearn.ts` — 업적 적립(멱등·호출당·평생합 경계·409 cap)
  - `… tools/_dv_walletreplay.ts` — 지갑 멱등 재시도 현재잔액(stale 방지)
  - `… tools/walletConcurrency.ts` — 동시 spend 이중지불 방지(FOR UPDATE)

> 전부 exit 0이어야 통과. 라이브 6은 테스트 데이터를 프리픽스(`_DV_ANN_`·`_DVCPN_`·`_DVACH_` 등)로
> 만들고 `finally`에서 정리한다. 서버 표면 조항 단위 대조가 필요하면 **`backend-verify` 스킬**(서버
> 5렌즈·파이프라인) — 이 배터리는 그 스킬 §4와 동일 명령이다.

## 2. 어떻게 판정하나

- 각 명령의 **판정 줄**(PASS/FAIL/✅/❌/`# pass`·`# fail`/`이상 … 0건`)을 뽑아 **한 표**로 보고한다.
- A/B 자가검증이 있는 가드(`_ev_*`)는 **실측 高 · shuffle 低**가 같이 떠야 신뢰(허위 오라클 차단). 실측만 보지 말 것.
- 하나라도 FAIL이면 **머지/커밋 금지**. 원인을 §3로 넘긴다.

## 3. 실행 중 새 테스트 케이스가 나오면 — 문서에 기입까지 (이 스킬의 핵심)

전체 테스트를 돌리다 **새 케이스**가 생기는 경로는 둘:

**(A) 기존 테스트가 FAIL** → 버그 발견. `reload-docs` 스킬의 "버그를 발견하면" 3종 문서 + `docs/TEST_METHODOLOGY.md §2`(발견 후 5단계)를 집행한다:
1. **현재 오류 등록** — 케이스를 레지스트리(`docs/EDGE_CASES.md`/`BOARD_RULES.md`/`UI_RULES.md` 중 해당)에 한 행 추가 + 재현/가드.
2. **왜 이전 검증이 못 잡았나** — `TEST_METHODOLOGY.md §4` 사각 표에 한 행.
3. **형제오류 사냥** — 같은 클래스 다른 사례를 측정 도구로 훑는다.

**(B) 새 가드/측정 도구를 만들었다**(전수조사·형제 사냥 중 `tools/_ev_*`·`_dv_*` 신설) → 만든 즉시:
1. **A/B 자가검증** 통과를 확인(실측 100%면 shuffle/변형 입력에선 무너져야 — `STATS_PROTOCOL.md` 0장).
2. **관련 테스트 문서에 케이스 기입** — 보드 연출이면 `BOARD_RULES.md`(번호 룰 + 충실도 표), 영입/오프시즌이면
   `EDGE_CASES.md`, 방법론이면 `TEST_METHODOLOGY.md`. 측정치는 `(N·엔진커밋·날짜)`를 붙인다(`DOC_DISCIPLINE`).
3. **검증 루틴에 명령 추가** — `docs/README.md`의 "검증 루틴" 코드블록에 그 도구 한 줄을 더한다. **이게 빠지면
   다음 "전체 테스트"에서 또 샌다**(과거 `_ev_*` 누락 사고의 재발 방지).

> 측정치가 문서의 기존 수치와 다르면(예: 엔진 변경 후 stale) **재측정값으로 교정**하고 구값은 취소선/무효 표기(`STATS_PROTOCOL`).

## 끝나면

- **판정 표**(명령 → PASS/FAIL/핵심 수치)를 보고하고, FAIL이 있으면 §3(A)로 처리한 내역을, 새 가드를 만들었으면 §3(B)로 문서화한 내역을 함께 적는다.
- 전부 PASS면 그대로 보고. 커밋이 목적이었다면 `.mutation.lock` 부재 확인 후 진행(`auto-push-on-feature` 메모리).
