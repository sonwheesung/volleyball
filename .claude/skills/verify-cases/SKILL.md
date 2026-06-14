---
name: verify-cases
description: Read the normal-case + edge-case registry (default docs/EDGE_CASES.md for acquisition/offseason systems), run the simulation battery it lists, check results against the documented invariants, and FIX any anomaly at its root (engine/selector, never by loosening the check). New bugs found get appended to the registry and a permanent guard added to the catching tool. Invoke when the user asks to "케이스 검증", "엣지 케이스 시뮬", "회귀 검증", "버그 재확인", "로직 고쳤으니 검증", or after ANY change to acquisition/offseason engines or selectors. The companion authoring skill is analyze-cases.
---

# verify-cases — 케이스 문서 읽고 시뮬·검증·수정

기준 문서(기본 [`docs/EDGE_CASES.md`](../../../docs/EDGE_CASES.md))를 읽고, 거기 적힌 **시뮬 배터리**를
돌려 **정상 케이스가 정상으로 나오는지 + 옛 엣지 케이스가 되살아나지 않았는지**를 대조한다.
위반이 나오면 **느슨하게 풀지 말고 근본(엔진/셀렉터)을 고친다**. 새 버그는 문서에 등록 + 도구에 가드.

## 실행 순서

1. **문서 Read**: `docs/EDGE_CASES.md`의 §0 불변식 · §1 도구 대조표 · §2 정상 케이스 · §3 엣지 레지스트리 ·
   §4 회귀 프로토콜을 기억한다. 어떤 변경이었는지 보고 **건드린 영역의 도구**를 고른다.
2. **풀 배터리 실행** (수정 후 처음부터, `resetLeagueBase` 격리). 오래 걸리면 `run_in_background`:
   ```
   npx tsc --noEmit
   npx tsx --test engine/*.test.ts          # 단위(현재 159)
   npx tsx tools/simAudit.ts 60             # 종합 13체크
   npx tsx tools/simFaDup.ts 100
   npx tsx tools/simStaffDup.ts 60
   npx tsx tools/simMoneyOnly.ts 200
   # 영역별: simTxDup · simBrokeSign · simCareerTrace · simOwnerRefuse
   ```
3. **문서 대조 보고**: §3 레지스트리 순서대로 각 EC가 ① 어느 도구로 검사됐고 ② 위반 0인지 표로 보고.
   §2 정상 케이스도 도구 출력(영입 건수·보상금·순위 등)이 "정상 범위"인지 짚는다.
4. **위반이 나오면 (= 회귀 또는 새 버그)**:
   - **근본 원인 추적** — 어느 시드/시즌에서, 어느 모듈의 어떤 분기 때문인지 좁힌다(도구 로그·`--dump`류).
   - **엔진/셀렉터 수정** — 불변식이 기준. 도구의 임계를 풀어 통과시키지 않는다.
   - **WAI 확인** — 문서가 정상이라 명시한 동작(드래프트 후 캡 일시 초과 등)이면 고치지 말고 보고만.
   - **새 클래스면 등록** — `docs/EDGE_CASES.md §3`에 EC 행 추가(증상→원인→수정 커밋→잡는 도구) +
     그걸 잡는 감사/도구에 **상설 가드** 추가. 가능하면 옛 버그를 임시 재주입해 가드가 잡는지 확인 후 원복.
5. **0건 → 커밋·푸시**: 코드+문서를 함께. `YYMMDD :: 한국어 요약`. 문서 갱신을 코드보다 먼저.

## 판정 기준

- **위반 0건**이 통과 조건. 1건이라도 있으면 실패로 보고하고 §4 절차로 처리한다.
- 엔진(`engine/`) 분포를 건드렸다면 이 스킬만으론 부족 — `tools/simKovo.ts`(KOVO 분포)·
  `/sim-league`(parity)·STATS_PROTOCOL 재측정까지 본다(STAFF_SYSTEM §7 사례처럼).
- 표본 규약: 분포·확률 결론은 N≥10,000, 불변식 검증은 시즌 수 명기(STATS_PROTOCOL).

## 새 시스템을 검증하려는데 문서가 없으면

`analyze-cases`를 먼저 돌려 정상/엣지 케이스 문서를 만든 뒤 이 스킬로 검증한다(작성=analyze, 검증=verify).
