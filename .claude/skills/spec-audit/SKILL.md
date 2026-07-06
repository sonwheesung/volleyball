---
name: spec-audit
description: Audit ANY system (server·board·engine·client·a guard itself) in DISCOVERY MODE — derive expectations fresh from the canonical docs every time and drive them against code+live, instead of re-confirming already-encoded invariants. This is the execution procedure for TEST_METHODOLOGY 기법 M (명세 대조 발견 7기법). Use when the regression battery is all-green but you're uneasy, when the user says "명세 감사"·"스펙 감사"·"발견 모드로 검증"·"배터리는 초록인데 불안"·"spec audit", or as a periodic sweep ~2 weeks after a new system ships. backend-verify is the server-specialized instance; run-all-tests is the regression battery this complements.
---

# spec-audit — 시스템을 정본 문서와 조항 단위로 대조하는 발견 감사

> **왜**: 회귀 배터리(유닛·sim·auditBoard·`_ev_*`·`_dv_*`)는 **이미 인코딩된 불변식**만 재확인한다 —
> 불변식에 없는 버그는 구조적으로 못 본다. 그래서 같은 배터리를 반복 실행하면 0건인 게 당연하다("올그린
> = 무버그"가 아니다). 새 버그는 성격이 다른 활동인 **발견(discovery)** 으로 나온다: 기대치를 코드가
> 아니라 **정본 문서에서 매번 새로 도출**해 코드·라이브에 들이대는 것. 2026-07-06 하루 6라운드에서 기존
> 배터리 0건일 때 20건(지갑 stale·결제 afterSafe·공지 6·쿠폰 4·업적 3·보드가드 3)이 이렇게 나왔다.
> 이 스킬은 그 발견을 **임의 시스템에** 재현 가능한 절차로 명문화한다. 정본 방법론은
> `docs/TEST_METHODOLOGY.md` **§1.M(명세 대조 발견 7기법)** + **§0(회귀 배터리 vs 발견)**.
> (평가·기법 추출=Fable 5 / 스킬 작성=Opus 에이전트)

---

## 언제 쓰나 (회귀 배터리와의 분업)

- **회귀 배터리(`run-all-tests`)**: 이미 아는 버그의 재발을 막는다 — 매 커밋/릴리즈 전.
- **spec-audit(이 스킬)**: **모르는 버그**를 캔다 — 배터리가 0건일 때가 오히려 신호. 신규 시스템 출시
  ~2주 후 정기, 또는 "초록인데 불안"할 때.
- **서버 표면이면 `backend-verify`**(spec-audit의 서버 인스턴스 — 서버 5렌즈로 특화). 이 스킬은 그보다
  넓어 보드·엔진·클라·**가드 자신**까지 발견 모드로 감사한다.

---

## 파이프라인 (역할 분리 포함)

임의 시스템(서버·보드·엔진·클라·가드)을 발견 모드로 감사할 때 아래 7단계를 밟는다.

1. **정본 조항 전수 추출** — 대상 시스템의 `docs/*_SYSTEM.md`(또는 `CLAUDE.md`·`BOARD_RULES`·`UI_RULES`)
   해당 §에서 그 시스템이 **주장하는 것**을 목록으로 뽑는다. 두 종류를 나눈다:
   - **동작 주장**("무토큰은 401" · "역교체도 코트에 배지로 뜬다" · "삭제도 proj 스코프").
   - **수치 주장**("평생합 캡 5000" · "리시버 일치 100%" · "킬 ~56%"). 수치는 **가설로** 적어 둔다(②에서 잰다).
2. **표면 전수 열람** — 그 조항을 구현하는 표면을 **빠짐없이**: 구현 모듈 + **호출부**(화면이 함수에
   무엇을 넘기나) + UI + **가드 자신**(그 조항을 검사한다는 가드의 출력·exit). 한쪽만 보면 배선 불일치
   (문서≠구현≠호출부)가 샌다.
3. **7기법 순차 적용**(기법 M) — 특히 **②재측정·③대칭 격자·⑥가드 감사**가 광맥이 굵다:
   - **① 조항 추출→실측** 코드→코드 자기일관 아닌 **문서→코드**.
   - **② 주장 수치 재측정** 문서의 숫자·%는 사실이 아니라 **가설** — 다시 잰다(N 충분, STATS_PROTOCOL).
   - **③ 대칭 격자 전수** 같은 클래스 표면을 격자로 놓고 한 속성을 전수 대조 — **하나만 빠진 게** 버그(아래 예).
   - **④ 단위·의미 정독** 단위·시점·조건을 문자 그대로("평생합"≠호출당, "매 부팅"≠활성-있을-때만).
   - **⑤ 중간 상태 낀 경계 재현** 멱등 재시도를 *중간 거래 낀 상태*로, 캡을 *경계 직전까지 채우고*.
   - **⑥ 가드 감사(verify the verifier)** exit만 믿지 말고 가드 **출력의 판정줄·수치**를 문서와 대조, ✅/❌↔exit 일치.
   - **⑦ 작성자≠검증자** 구현 컨텍스트 없이 정본 문서만 들고 대조(공유 가정 차단).
4. **발견 심각도 표** — `증상 → 조항 → 기법 → 심각도(P0 머니패스/격리·데이터손상 · P1 사용자경험 · P2 표시)`.
5. **수정·문서는 Agent(model:"opus")에 위임** — 메인 세션은 **검증·지시만** 한다(추정 금지·귀속 규율
   [[verification-model-attribution]]). 위임 프롬프트에 조항·표면 경로·재현 로그를 담아 넘긴다.
6. **메인이 가드 직접 재실행 + diff 검수 후 커밋** — 위임 결과를 그대로 믿지 않고 메인이 상설 가드를
   **직접 재실행**(exit 0 확인)하고 diff를 읽은 뒤 커밋. 검증 안 된 수정은 되돌린다.
7. **사각 등재 + 상설 가드 봉인** — `TEST_METHODOLOGY §4`에 "왜 기존 장치가 못 잡았나" 한 행 + **신규
   상설 가드**를 만든다. 신규 가드 완료 조건: **exit 0/1 배선** + **의도적 FAIL을 배터리에서 1회 재현**
   (A/B의 가드판 — 깬 입력이 exit 1을 내는지 실증) + `docs/README.md` 검증 루틴/서버 배터리 등록.
   케이스(무엇)는 EDGE_CASES/BOARD_RULES/BACKEND_SYSTEM, 방법(왜 못 잡았나)은 TEST_METHODOLOGY로 분리.

---

## 대칭 격자 만들기 (기법 ③ — 가장 굵은 광맥)

같은 클래스의 표면을 **행**으로, 문서가 요구하는 **속성**을 열로 놓고 채운다. **빈칸이 버그**다 —
"POST/GET/PATCH는 스코프됐는데 DELETE만 누락"처럼 하나만 빠진 걸 눈으로 잡는다.

| 표면(행) | proj 스코프 | 인증 함수 | 누적 백스톱 | exit 배선 |
|---|---|---|---|---|
| POST /announce | ✅ | requireAdmin | — | — |
| GET /announce | ✅ | resolve | — | — |
| PATCH /announce | ✅ | requireAdmin | — | — |
| **DELETE /announce** | **❌ ← 버그(F1)** | requireAdmin | — | — |
| coupon redeem | ✅ | **resolve ← 버그(C1, 귀속인데 폴백)** | — | — |
| ad earn | — | requireUserId | ✅ countReasonToday | — |
| **achievement earn** | — | requireUserId | **❌ ← 버그(A1, 평생합 백스톱 없음)** | — |
| `_ev_recvmatch` 가드 | — | — | — | **❌ ← 버그(R1, ✅/❌만 출력·exit 없음)** |

> 만드는 법: ① 클래스의 표면을 전수 열거(라우트 4메서드·earn reason 전종·가드 파일 전종). ② 문서가
> 그 클래스에 요구하는 불변식을 열로. ③ 한 칸씩 코드/라이브로 확인해 채운다. ④ **빈칸/❌를 발견으로**.
> 격자를 "같은 파일"이 아니라 **같은 입력 형태**(예: date-only를 받는 전 라우트)로 넓혀야 형제가 안 샌다.

---

## 트리거

- **"명세 감사" · "스펙 감사" · "발견 모드로 검증" · "배터리는 초록인데 불안" · "spec audit"**.
- **신규 시스템 구현 ~2주 후 정기 발견 스윕**(회귀 배터리만 쌓이고 발견을 안 돈 구간).
- `run-all-tests`가 **전부 PASS인데** 최근 변경 폭이 컸을 때(올그린이 무버그를 뜻하지 않음).

## 상호 포인터

- **기법 M**: `docs/TEST_METHODOLOGY.md` §1.M(7기법 정의·앵커)·§0(회귀 vs 발견). 이 스킬은 M의 실행 절차.
- **`backend-verify`**: 서버 표면 특화(서버 5렌즈) — spec-audit의 서버 인스턴스. 서버를 건드렸으면 그쪽.
- **`run-all-tests`**: 회귀 배터리(이미 아는 것의 재확인). spec-audit는 그 배터리가 0건일 때 쓰는 발견 축.
- **`independent-verify` / `engine-verify`**: ⑦ 작성자≠검증자를 신선한 세션(또는 100+ 스웜)으로 확장.

## 끝나면

- 발견 심각도 표(증상→조항→기법→심각도)를 보고. 발견이 있으면 §5~7 처리 내역(위임·재실행·가드 봉인)을,
  없으면 "발견 0 — 감사한 조항 목록 + 각 기법 적용 결과"를 적는다(발견 0도 조항 커버리지를 남긴다).
- 새 상설 가드를 만들었으면 exit 배선 + 의도적 FAIL 재현 + README 등록 3요건 충족을 함께 보고.
