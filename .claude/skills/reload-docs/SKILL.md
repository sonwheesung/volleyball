---
name: reload-docs
description: Re-read the project's design docs (CLAUDE.md spine + docs/ system documents) to restore design context — especially after a context compaction, when the detailed docs/ content read earlier is gone from context. Invoke when the user asks to "문서 다시 읽어", "문서 리로드", "설계 문서 읽어", "컴팩트 후 문서", "reload docs", or right after a /compact. A SessionStart(compact) hook reminds the assistant to run this automatically after compaction.
---

# reload-docs — 설계 문서 재적재

> **왜**: 이 프로젝트는 단일 기준 문서(`CLAUDE.md`) + 시스템별 `docs/*_SYSTEM.md` 30여 개에
> 모든 설계 결정·제외 결정·검증 루틴이 박혀 있다(DOC_DISCIPLINE). **컴팩트가 일어나면 앞서
> 읽어둔 docs/ 본문이 컨텍스트에서 사라져** 설계 근거 없이 결정하게 될 위험이 생긴다.
> 이 스킬은 그 docs/ 컨텍스트를 다시 채운다.
>
> 참고: `CLAUDE.md`와 메모리(`MEMORY.md`)는 매 세션 자동 주입돼 컴팩트 후에도 남는다 →
> **실제 공백은 `docs/`**. 그래서 README 색인 + 시스템 문서를 다시 읽는 게 핵심이다.

## 실행 순서

1. **척추 먼저 (필수)** — 한 번에 전체 지형을 잡는다:
   - `docs/README.md` — 색인. 시스템별 문서 목록 + **전체 구현 현황표** + **검증 루틴**(타입체크·
     테스트·감사·시뮬 명령) + 아키텍처 원칙. 이거 하나로 "무엇이 있고 무엇을 만지면 무엇이 도는지"가 잡힌다.
   - `CLAUDE.md` — 기둥(관전형 1순위·데이터 서사·안티과금·단장 결정)·권한표·작업 원칙(추정 금지 등).
     자동 주입돼 있더라도 결정 직전이면 한 번 더 짚는다.

2. **규율·검증 문서 (작업이 코드/연출/통계에 닿으면)**:
   - `docs/DOC_DISCIPLINE.md` — 문서 작업법(결정 先문서·취소선 정정·색인 유지·날짜/통계 절대화).
   - `docs/STATS_PROTOCOL.md` — 추정 금지 0장 + 표본 N≥10,000 + `(N·엔진커밋·날짜)` 메타 + 로직 변경 시 무효.
   - `docs/TEST_METHODOLOGY.md` — 새 버그 발견 기법(퍼징·독립검증·A/B 자가검증·변이·5렌즈) + 발견 후 5단계.
   - `docs/EDGE_CASES.md` · `docs/BOARD_RULES.md` · `docs/UI_RULES.md` — 케이스/연출/UI 검수 레지스트리.

3. **건드리는 시스템의 `*_SYSTEM.md`** — README 색인 표에서 작업 영역에 해당하는 문서를 골라 읽는다.
   전 시스템(경기·훈련·노쇠·연봉·FA·시즌·시상·마일스톤·뉴스·부상·외인·재정·구단주·폼·정체성·트랜잭션·
   스태프·트레이트·로테이션모럴·코트포지셔닝·중계·KOVO비교)을 다 읽으려면 `docs/*.md` 전부.

> **컴팩트 직후 사용자 지시가 "전부 다 읽어"라면** → 위 1·2 + `docs/` 전체를 읽는다.
> 특정 작업을 이어가는 중이면 → 1·2 + 그 작업 영역의 `*_SYSTEM.md`만으로 충분(컨텍스트 절약).

## 버그를 발견하면 — 문서 작업을 빼먹지 마라 (컴팩트 후 특히 잊기 쉬움)

> **왜 여기 적나**: 검증·전수조사 도중 버그를 찾으면 고치고 끝내버리고, **"현재 오류 등록"과
> "이전 검증은 왜 못 찾았나(사각 분석)" 문서 작업을 빠뜨리는 일이 컴팩트 직후 반복됐다.**
> 컴팩트로 직전 맥락이 날아간 상태라 "고쳤으니 됐다"로 흐르기 쉽다. 발견 = 고침 + **3종 문서**가 끝나야 완료다.

버그(엔진 수치·연출·박스 불일치·계층 귀속 어긋남 등)를 하나라도 발견하면, 고치기 전·직후에
`docs/TEST_METHODOLOGY.md §2`(발견 후 5단계)를 그대로 집행한다. **반드시 남길 3종 문서**:

1. **현재 오류 등록** — 무엇이 틀렸나. 케이스를 레지스트리에(`docs/EDGE_CASES.md`/`BOARD_RULES.md`/
   `UI_RULES.md` 중 해당) 추가하고, 재현/가드(측정 도구·테스트)를 건다. 가드는 **A/B 자가검증**으로
   민감도를 증명한다(허위 오라클 금지 — 실측 100%면 변형 입력에선 무너져야 한다).
2. **왜 이전 검증이 못 찾았나 (사각 분석)** — `docs/TEST_METHODOLOGY.md §4` 사각(blind-spot) 표에
   "어떤 가정/렌즈가 이걸 가렸나"를 한 행 추가한다. (예: "보드·박스가 같은 행동에 선수를 각자 골라도
   둘을 **대조하는** 검사가 없었다 = 교차 계층 귀속 사각".) 이게 빠지면 형제오류가 또 샌다.
3. **형제오류 사냥 (sibling hunt)** — 같은 클래스의 다른 사례를 능동적으로 뒤진다(측정 도구로).
   하나 고치고 끝내지 말고 "이 사각이 가린 다른 칸/단계"를 다 훑어 같은 수술을 한다.

> 측정 도구(오라클)도 검증 없이 믿지 않는다 — 새로 만든 도구는 sanity-check + 수정 전후 A/B를
> 통과해야 신뢰한다(`STATS_PROTOCOL.md` 0장 · `no-guessing-run-stats` 메모리).

## 끝나면

- 무엇을 다시 읽었는지 한 줄로 보고하고, 중단됐던 작업을 이어간다(요약 재설명은 생략).
- 읽은 내용 중 **현재 작업과 충돌하는 설계 결정/제외 결정**이 있으면 먼저 짚는다(추정으로 덮어쓰지 않는다).
- 이번 세션에 버그를 발견했다면 위 **"버그를 발견하면" 3종 문서**가 다 남았는지 자가 점검한다.

## 자동 트리거 (훅)

`.claude/settings.local.json`의 `SessionStart`(matcher `compact`) 훅이 컴팩트 완료 후
"reload-docs 스킬을 실행하라"는 안내를 컨텍스트에 주입한다 → 그걸 보면 이 스킬을 호출한다.
훅을 끄려면 그 항목을 지우면 되고, 이 스킬은 수동(`/reload-docs`)으로도 언제든 실행 가능하다.
