---
name: analyze-cases
description: Analyze an engine/selector module and author or update its normal-case + edge-case registry document (default docs/EDGE_CASES.md for the acquisition/offseason systems). Reads the code, derives the golden-path expectations and invariants, catalogs known bugs with their root cause + catching tool, and proposes new edge cases worth guarding. Invoke when the user asks to "케이스 분석", "정상/엣지 케이스 문서 작성", "엔진 분석해서 케이스 정리", "엣지 케이스 목록 만들어", or after adding a new system that needs a case registry. The companion verification skill is verify-cases.
---

# analyze-cases — 엔진 분석 → 정상/엣지 케이스 문서화

대상 엔진/셀렉터를 읽고 **정상 케이스(골든 패스)** 와 **엣지 케이스(불변식 위반 가능 지점)** 를
하나의 레지스트리 문서로 정리한다. 기본 대상 문서는 영입·오프시즌 계열의
[`docs/EDGE_CASES.md`](../../../docs/EDGE_CASES.md). 다른 시스템이면 같은 구조로 새 문서를 만든다.

> **검증은 하지 않는다** — 이 스킬은 *문서를 쓴다*. 시뮬·수정은 `verify-cases`가 한다.
> 경기 보드는 `BOARD_RULES`(verify-board), 장기 균형은 `sim-league`가 따로 관장.

## 실행 순서

1. **범위 확정**: 사용자가 지목한 엔진/시스템(예: FA 보상, 감독 생애주기, 외인). 없으면 영입·오프시즌
   전체(`engine/compensation·faMarket·cap·draft·staff·staffLifecycle·foreign·transactions·finance`,
   `data/offseason·draftSetup·dynamics·tryout·league·financeProjection`).
2. **코드 정독**: 대상 모듈의 입력·출력 타입, 분기, 가드(`if … continue/return`), 상수를 읽는다.
   특히 **돈·계약·소속을 바꾸는 지점**과 **루프에서 후보를 제외하는 조건**을 찾는다(불변식의 자리).
3. **불변식 도출**: "한 사람=한 팀", "돈 낸 선수는 내 팀", "캡·자금 게이트", "공급 고갈 없음",
   "만료=명단 이탈", "결정론" 중 이 시스템에 해당하는 것을 코드 근거와 함께 명시.
4. **정상 케이스 작성**: 시스템이 정상일 때 나와야 하는 결과를 구체적으로(수치·규칙 포함).
5. **엣지 케이스 도출**: 불변식이 깨질 수 있는 입력(경계·동시·고갈·중복·자금 0·거부·은퇴)을 나열.
   - 이미 수정된 버그는 `git log --oneline | grep`으로 커밋을 찾아 **증상→원인→수정(커밋)→잡는 도구**로 기록.
   - 아직 도구가 없는 잠재 엣지는 "감시 대상"으로 §5에 적고 verify-cases가 도구를 만들 수 있게 남긴다.
6. **도구 대조표 갱신**: 각 케이스를 잡는 `tools/sim*.ts`/단위 테스트를 §1 표에 매핑. 없으면 "도구 필요" 표시.
7. **문서 기입 + 색인**: `docs/EDGE_CASES.md`(또는 새 문서)에 반영하고, 새 문서면 `docs/README.md` 목록에 추가.

## 작성 원칙

- **코드가 진실** — 추측 금지. 가드/상수는 `파일:심볼`로 근거를 단다. 모르면 Read로 확인 후 적는다.
- **WAI 구분** — 정상 동작(예: 드래프트 직후 캡 일시 초과는 신인 의무 수급)은 버그가 아니라고 명시해
  verify-cases가 헛고치지 않게 한다.
- **재현 가능하게** — 각 엣지 케이스는 어떤 시드/시즌/입력에서 재현되는지, 어느 도구가 잡는지 적는다.
- 문서 변경은 코드보다 먼저(CLAUDE.md 11장). 새 설계 결정이 끼면 해당 `*_SYSTEM.md`에도 반영.

## 끝맺음

요약 보고: 추가/수정한 정상 케이스 n건, 엣지 케이스 m건(수정됨/감시대상 분리), 도구 매핑 공백 목록.
"이제 `verify-cases`로 돌려 검증하면 됩니다"로 인계.
