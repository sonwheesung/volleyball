---
name: backend-verify
description: Verify the server (backend) surface against the canonical BACKEND_SYSTEM docs clause-by-clause and seal each system with a permanent live guard. Invoke when the user says "서버 검증", "백엔드 검증", "공지/쿠폰/결제/업적 검증", or after adding any admin CRUD / new server route / lib change. Runs the "server 5 lenses" (auth attribution · proj scope · cap unit · date-only timezone · observability money-path) that engine/board/app methodology (기법 A~K) does not cover. Companion to run-all-tests (which now includes the server guard battery) and TEST_METHODOLOGY 기법 L.
---

# backend-verify — 서버 표면을 문서 조항과 대조하고 라이브 가드로 봉인

> **상위 방법론 = `spec-audit`(기법 M, 명세 대조 발견 7기법)**. backend-verify는 그 발견 프로토콜을
> **서버 라우트에 특화한 인스턴스**다(서버 5렌즈 = M을 인증 귀속·proj 격리·타임존·머니패스에 겨눔).
> 보드·엔진·클라·가드 자신 등 서버 밖 표면을 발견 모드로 감사하려면 `spec-audit`을 쓴다.

> **왜**: 2026-07-06 백엔드 4라운드 검증에서 **14건**(결제 afterSafe 1·공지 6·쿠폰 4·업적 3)이
> *전부 기존 테스트 장치를 통과한 채 잠복*했다. 뿌리: ① `run-all-tests`가 서버 가드를 안 돌렸고(있던
> `_dv_purchase`조차 afterSafe 회귀로 이틀 깨진 채) ② `TEST_METHODOLOGY` 기법 A~K가 전부 엔진·보드·앱
> 지향이라 **서버 표면(인증 귀속·proj 스코프·상한 단위·타임존·관찰 채널)을 보는 렌즈가 없었고**
> ③ 백엔드 검증 스킬이 0개였으며 ④ 라이브 E2E를 "검증 후 삭제"하는 정책이 회귀·엣지를 무방비로 뒀다.
> 이 스킬은 그 4라운드에서 검증된 파이프라인을 **명문화**한다. (진단·검증=Fable 5 / 스킬 작성=Opus 에이전트)

---

## 1. 파이프라인 (역할 분리 포함)

서버 시스템(결제·지갑·공지·쿠폰·업적·인증·관리자 등)을 검증할 때 아래 7단계를 밟는다.

1. **정본 조항 추출** — `docs/BACKEND_SYSTEM.md`의 해당 §(예: §13.14 쿠폰·§13.13 공지·§13.18 결제·
   §13.12 업적/지갑·§13.17 P0-5 인증)에서 그 시스템이 **주장하는 동작(조항)** 을 목록으로 뽑는다.
   "무토큰은 401" "상한은 평생합" "endsAt은 KST 23:59:59" "삭제도 proj 스코프" 같은 **동작 주장 한 줄**들.
2. **표면 전수 열람** — 그 조항을 구현하는 표면을 빠짐없이 읽는다: 서버 라우트(`server/app/api/**`)
   + lib(`server/lib/**`) + 스키마(`server/db/schema.ts`) + **클라 호출부**(`lib/server.ts`·앱 화면)
   + 관리자 콘솔 UI. 한쪽만 보면 배선 불일치(문서≠코드≠클라)가 샌다.
3. **서버 5렌즈 대조** — §2의 5렌즈를 순서대로 조항에 겨눈다.
4. **오류 심각도 표** — 발견을 `증상 → 조항 → 렌즈 → 심각도(P0 머니패스/격리 · P1 사용자경험 · P2 표시)` 표로.
5. **수정·문서는 Agent(model:"opus")에 위임** — 메인 세션은 **검증·지시만** 한다(추정 금지·귀속 규율
   [[verification-model-attribution]]). 위임 프롬프트에 조항·표면 경로·재현 로그를 담아 넘긴다.
6. **메인이 가드 직접 재실행 + diff 검수 후 커밋** — 위임 결과를 그대로 믿지 않고 메인이 상설 가드를
   **직접 재실행**(exit 0 확인)하고 diff를 읽은 뒤 커밋. 검증 안 된 수정은 되돌린다.
7. **사각을 `TEST_METHODOLOGY §4`에 등재** — "왜 기존 장치가 못 잡았나"를 한 행으로. 케이스(무엇)는
   BACKEND_SYSTEM/EDGE_CASES, 방법(어떻게 못 잡았나)은 TEST_METHODOLOGY로 분리([[bug-discovery-protocol]]).

---

## 2. 서버 5렌즈 (기법 L — TEST_METHODOLOGY §1.L)

기법 B(독립 문서기반)가 **엔진 수치** 지향이라면, 이 5렌즈는 **서버 라우트/보안 불변식** 지향이다.
각 렌즈는 2026-07-06 실제로 잡은 버그를 예시로 든다.

### ⑴ 인증 귀속 (auth attribution)
서버엔 두 헬퍼가 있다: `resolveUserId`(무토큰이면 **익명 dev 폴백**)·`requireUserId`(유효 Bearer
없으면 **null→401**). 라우트별로 **"특정 유저에 귀속돼야 하는가"** 를 판정하고, 귀속 라우트가
`resolveUserId`(폴백)를 쓰면 **버그** — 무토큰 요청이 성공 응답을 받되 익명 버킷(`dev-user-1`)에
적립되고 본인 지갑은 불변.
- **실적**: 쿠폰 C1 — redeem이 익명 폴백이라 무토큰 성공+본인 지갑 불변. 수정: 귀속 라우트는
  `requireUserId` 기본(익명 폴백 금지, §13.17 P0-5).
- **가드 방법**: 무토큰으로 라우트를 때려 **401** 이거나, 익명 유저 지갑/원장이 **불변**인지 라이브 대조.

### ⑵ proj 스코프 4메서드 전수 (multi-game isolation)
멀티게임 격리(`proj_code` FK, §13.2)는 **POST/GET/PATCH/DELETE 전 메서드**가 스코프돼야 한다.
한 메서드만 `where(proj_code=...)` 를 빠뜨려도 다른 게임의 레코드가 새거나 지워진다. **라우트별
개별 검사가 아니라 메서드 전수 대조.**
- **실적**: 공지 F1 — DELETE만 proj 미스코프 + 허위 `{ok:true}`(타 proj 공지를 지웠다고 성공 응답).
- **가드 방법**: 타 proj로 만든 레코드를 현재 proj 라우트로 GET/PATCH/DELETE 시도 → **못 보고/못 고치고/
  못 지워야**(404 대칭). 새 admin CRUD 라우트는 4메서드 전부 이 가드에 등록.

### ⑶ 상한의 단위 (cap unit)
문서의 캡 문구는 **호출당 / 일일 / 평생** 중 무엇인지 명시돼야 하고 구현이 그 단위와 일치해야 한다.
`Math.min(a, 5000)`(호출당 클램프)와 "평생합 5000"(원장 sum 강제)은 **같은 코드처럼 보여도 다른 축**이다.
추가로 **보상 테이블 총합 ↔ 캡 정합**을 대조한다(카탈로그 정당 총합 > 캡이면 정당 유저가 손실).
- **실적**: 업적 A1 — "평생합 상한 5000"이 실제론 호출당 클램프뿐(원장 sum 백스톱 0). A2 — 카탈로그
  정당 총합 16,220 > 5000이라 문서대로 강제됐으면 정당 유저 11,220 손실. 수정: 호출당 1000 + 평생합
  20,000(원장 sum 강제) + `ACHIEVEMENTS.reduce(achReward) ≤ ACH_LIFETIME_CAP` 드리프트 가드.
- **가드 방법**: 평생합 경계(예: 19,900→+100 클램프)를 **원장 sum으로** 라이브 검증 + 초과 시 **409 cap**
  + 카탈로그 총합≤캡 순수 가드. A/B로 백스톱 없으면 통과함을 대조(오라클 민감도).

### ⑷ date-only 타임존 (KST endsAt)
운영자 입력 `endsAt`이 date-only(`'YYYY-MM-DD'`)로 들어오는 라우트는 **`normalizeEndsAt`
(`server/lib/dates.ts`)** 를 반드시 거쳐야 한다 — `new Date('YYYY-MM-DD')`는 UTC 자정 = KST 오전 9시라
운영자 기대(그날 밤까지)보다 **9시간 일찍 만료**된다. 형제 사냥은 "같은 파일"이 아니라 **같은 입력
형태(date-only)를 받는 전 라우트**로 넓힌다.
- **실적**: 공지 F5(KST 9시간 함정) → 형제 C2(쿠폰이 동일 `new Date('YYYY-MM-DD')` 패턴). 공지만 고치고
  쿠폰을 놓칠 뻔 — 형제 사냥을 공지 라우트로 제한했던 게 원인.
- **가드 방법**: date-only endsAt이 `T14:59:59.999Z`(KST 23:59:59.999)로 저장되는지 라이브 대조 +
  만료 필터 A/B(경계 시각에 노출/은폐가 뒤집히는지).

### ⑸ 관찰 채널의 머니패스 오염 (observability poisons money-path)
알림(디스코드)·로그·flush 등 **관찰 사이드채널**은 **머니패스 catch 밖**에서, throw 없이 실행돼야
한다(`afterSafe` 헬퍼). 지갑 반영 후 응답을 바꾸는 관찰 코드가 요청 밖에서 throw하면 **돈은 이동했는데
응답만 500** 이 된다 — 클라는 실패로 오인해 재시도/불일치.
- **실적**: 결제 afterSafe — 웹훅 지급/환불은 반영됐는데 `after()` 알림 throw가 라우트 catch에 걸려
  응답 500(`_dv_purchase` 2 FAIL). 실 Vercel에서만 검증하고 머니패스 가드를 재실행 안 한 게 뿌리.
- **가드 방법**: 라우트에 관찰 채널(알림·로그·flush)을 추가하면 **해당 머니패스 가드(`_dv_purchase`)를
  즉시 재실행**. 관찰은 공용 `afterSafe`로 통일(요청 밖이면 즉시 실행, throw 삼킴).

---

## 3. 상설 가드 원칙 (라이브 E2E "검증 후 삭제" 금지)

> **핵심 교훈(2026-07-06 14건의 공통 뿌리)**: 라이브 E2E를 happy-path 1회 보고 **삭제**하면 회귀·엣지가
> 무방비다. 가드는 **상설**이어야 하고 **배터리에 등록**돼야 완료다(그냥 존재만 하면 인접 변경이
> 깨뜨려도 무감지 — `_dv_purchase`가 배터리 밖이라 afterSafe 회귀로 이틀 잠복).

시스템마다 `server/tools/_dv_*.ts` **상설 가드**를 둔다. 요건:
- 라우트 핸들러/lib를 **직접 호출**(라이브 dev DB 왕복).
- 실행: `node_modules/.bin/tsx --env-file=.env.local tools/X.ts`(`.env.local`의 `DATABASE_URL`).
- **테스트 데이터 프리픽스**(`_DV_ANN_`·`_DVCPN_`·`_DVACH_` 등) 생성 → `finally`에서 정리.
- **A/B 자가검증**(백스톱/필터를 임시로 깬 상태에선 반드시 실패 — 허위 오라클 차단).
- `docs/README.md` "서버 가드 배터리"에 한 줄 등록(안 하면 다음 "전체 테스트"에서 또 샌다).

**현재 상설 가드**:
| 가드 | 시스템 | 위치 |
|---|---|---|
| `_dv_purchase` | 결제 머니패스(RC 웹훅·grant/refund·멱등·afterSafe) | `server/tools/` (라이브) |
| `_dv_announce` | 공지 CRUD(기간·정렬·proj 스코프·404 대칭·타임존) | `server/tools/` (라이브) |
| `_dv_coupon_live` | 쿠폰 발급·사용(인증폴백 C1·이중사용·기간·타겟·타임존 C2) | `server/tools/` (라이브) |
| `_dv_achearn` | 업적 적립(멱등·호출당·평생합 경계·409 cap) | `server/tools/` (라이브) |
| `_dv_walletreplay` | 지갑 멱등 재시도 잔액(stale 방지) | `server/tools/` (라이브) |
| `walletConcurrency` | 동시 spend 이중지불 방지(FOR UPDATE) | `server/tools/` (라이브) |
| `_dv_walletauth` | 지갑 순수(멱등키·econ 금액·카탈로그 총합≤캡 드리프트) | `tools/` (순수) |
| `_dv_coupon` | 쿠폰 순수(normalizeCode·requireAdmin fail-closed) | `tools/` (순수) |

> `_dv_sentry_verify`(관측 flush, DSN 주입 시만)는 on-demand — DSN 없으면 no-op이라 배터리에 안 넣는다.

---

## 4. 서버 가드 배터리 실행 블록 (복붙)

전부 exit 0이어야 통과. **순수 2**(repo 루트)는 DB 불필요, **라이브 6**(`server/`)은 `.env.local`의
`DATABASE_URL` 필요(dev Postgres). 하나라도 FAIL이면 §1 파이프라인으로 넘긴다.

```bash
# ── 순수(repo 루트, DB 불필요) ──
npx tsx tools/_dv_walletauth.ts        # 지갑 순수: 멱등키·econ 금액·카탈로그 총합≤평생합캡 드리프트 + A/B
npx tsx tools/_dv_coupon.ts            # 쿠폰 순수: normalizeCode·requireAdmin fail-closed

# ── 라이브(server/, .env.local DATABASE_URL 필요) ──
cd server
node_modules/.bin/tsx --env-file=.env.local tools/_dv_purchase.ts      # 결제 머니패스(afterSafe·grant/refund·멱등)
node_modules/.bin/tsx --env-file=.env.local tools/_dv_announce.ts      # 공지 CRUD(기간·정렬·proj 스코프·404·KST)
node_modules/.bin/tsx --env-file=.env.local tools/_dv_coupon_live.ts   # 쿠폰(인증폴백 C1·이중사용·기간·타겟·KST C2)
node_modules/.bin/tsx --env-file=.env.local tools/_dv_achearn.ts       # 업적(멱등·호출당·평생합 경계·409 cap)
node_modules/.bin/tsx --env-file=.env.local tools/_dv_walletreplay.ts  # 지갑 멱등 재시도 현재잔액(stale 방지)
node_modules/.bin/tsx --env-file=.env.local tools/walletConcurrency.ts # 동시 spend 이중지불 방지(FOR UPDATE)
```

> 라이브 6종은 각자 테스트 데이터를 프리픽스로 만들고 `finally`에서 정리하므로 dev DB에 잔여를 안 남긴다.
> DB 연결 실패는 exit≠0으로 드러난다(dev Postgres가 살아있어야 라이브가 돈다).

---

## 트리거 메모

호출 트리거: **"서버 검증" · "백엔드 검증" · "공지/쿠폰/결제/업적 검증"**, 그리고
**새 admin CRUD 라우트·새 `server/app/api/**` 라우트·`server/lib/**` 변경** 시. 서버 표면을 건드렸으면
이 스킬(또는 최소한 §4 배터리)을 돌린다. 전체 검증은 `run-all-tests`가 이 배터리를 포함해 부른다.

## 끝나면

- 배터리 판정 표(가드 → exit → 핵심 확인)를 보고. FAIL이 있으면 §1 파이프라인 처리 내역을,
  새 가드를 만들었으면 §3 요건 충족(A/B·정리·README 등록) + `TEST_METHODOLOGY §4` 사각 등재 내역을 함께 적는다.
