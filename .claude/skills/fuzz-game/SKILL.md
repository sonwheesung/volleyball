---
name: fuzz-game
description: Adversarial/monkey robustness fuzzing of the whole game (player management, FA, draft, foreign/asian, release, season/offseason, save-load) by driving the REAL zustand store + data layer with thousands of random and adversarial action sequences, checking invariants every step with A/B self-validated oracles. Finds crashes, single-ownership breaks, roster-bound violations, cash leaks, soft-locks, exploits — the bugs that case-tests miss. Invoke when the user asks to "악질 테스트", "원숭이 테스트", "퍼징", "전체 게임 테스트", "말도 안되게 진행", "robustness test", or after changing store actions / acquisition / roster logic. Records findings via analyze-cases into docs/EDGE_CASES.md and the discovery method into docs/TEST_METHODOLOGY.md. Companion: verify-cases (case battery), analyze-cases (registry authoring).
---

# fuzz-game — 악질/원숭이 전체게임 퍼징

케이스 테스트가 못 잡는 **모르는 버그**를, 실제 사용자 진입점(store 액션)을 무작위·적대적으로 난사해
찾는다. 방법론 전체는 [`TEST_METHODOLOGY`](../../../docs/TEST_METHODOLOGY.md), 케이스는
[`EDGE_CASES`](../../../docs/EDGE_CASES.md).

## 왜 (케이스 테스트의 사각)

케이스/감사(simAudit·simTxDup 등)는 보통 ① **데이터·리플레이층만** 검사(store 게이트 우회) ②
**단일 국면만** ③ **valid 입력만** 본다. 퍼징은 이 셋을 전부 친다: store를 직접 구동 + 장기 교차국면 +
적대 입력. 실제로 EC-TX-03(팬텀 방출)·EC-RM-01(정원 19)이 이 방법으로만 나왔다.

## 실행

1. **불변식 확정**(EDGE_CASES §0 + 코드): 한 사람=한 팀 · 정원 10~18 · 방출은 내 소속만 · 돈≥0 ·
   캡·자금 게이트 · 결정론 · NaN/Inf 없음 · 라인업 구성가능.
2. **하네스 준비/재사용**(`tools/`):
   - `import './_gt_mock'` **먼저**(AsyncStorage 인메모리 모킹 — Node에서 store import 가능하게).
   - `_gt_monkey.ts [steps] [seed] [clean]` — store 무작위 난사(매 스텝 `_gt_invariants` 검사).
   - `_gt_adversarial.ts` — 데이터층 적대 입력(가짜 id·음수/NaN 자금·전원영입·소크).
   - `_gt_seqbreak.ts` — 순서 꼬기. `_gt_determinism.ts` — 결정론+세이브/리하이드레이트.
   - 새 적대 시나리오가 필요하면 같은 패턴으로 추가(시드 결정론·재현 가능).
3. **여러 시드·길게**: `_gt_monkey 3000 <seed>` 와 `... <seed> clean`을 여러 시드로. clean=내 로스터만
   방출(비방출 버그 격리). full=타팀 방출 허용(소유권 버그 노출).
4. **A/B 자가검증 필수**(TEST_METHODOLOGY §C): 새 불변식 체크는 **일부러 깬 상태에서 반드시 실패**하는지
   증명한 것만 신뢰. 항상 통과하는 체크는 허위 오라클로 간주, 폐기.

## 버그를 찾으면 (TEST_METHODOLOGY §2 프로토콜)

고치고 끝내지 말 것:
1. 최소 재현 하네스 남기기(`_gt_repro_*`).
2. **왜 이전 테스트가 못 잡았나** 규명(사각 분류 = TEST_METHODOLOGY §4) → 레지스트리에 기입.
3. EDGE_CASES §3에 `증상→원인→수정→잡는 도구` 행 + 상설 가드(A/B 검증).
4. **동종 버그 사냥**: 그 버그의 렌즈를 코드 전체에 적용(예: "store 액션이 id를 멤버십 검증 없이 변이"
   → 전 액션 색출). 잔존 0까지.
5. 발견 **방법**을 TEST_METHODOLOGY §1에 (없으면) 추가.

## 원칙
- **추정 금지** — 깨지는지 실제로 돌려서 확인(수천+ 시퀀스). **소스는 보고만, 수정은 사람이.**
- 위반이 나오면 도구를 느슨하게 풀지 않는다 — 엔진/스토어를 고친다(불변식이 기준).
- 하네스 보존(상시 재실행) + git 함부로 금지(다른 세션 공유).

## 끝맺음
요약: 돌린 시나리오·표본, 발견 결함(재현 시드+심각도+file:line), 견뎌낸 적대 케이스(견고성 증거),
A/B 자가검증 결과. "EDGE_CASES/TEST_METHODOLOGY에 기입했고, verify-cases로 회귀 배터리 돌리면 됩니다"로 인계.
