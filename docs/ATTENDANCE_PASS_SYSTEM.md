# 다이아 출석 패스 + 월 1+1 프로모션 (ATTENDANCE_PASS_SYSTEM)

> 신규 수익화 프로모션 **2종**의 설계 정본. **설계 확정 2026-07-23**(사용자 기획 락 — 아래 §0). **상태: 설계 문서 단계 · 코드 미착수**(사용자 지시로 문서 먼저).
> **개정 2026-07-23 (UX 리서치 반영)**: 수령 방식 = 탭 → **자동 지급 + 비차단 토스트**(§2.3), 리셋 KST 04:00·구매당일 즉시 지급(§2.1), 미수령 유예 Q5·리셋시각 Q6 신설, 환불 (A) 호요 선례로 확신도↑(§4.3), UI/UX 화면 흐름(§UI)·엣지 후보 7건(§10.1)·출처(§10.2) 편입. 리서치 원본 `scratchpad/pass-ux-research.md`.
> **최종 개정 2026-07-23 (독립 리뷰 반영)**: 블로커 4건 명문화 — **B1 환불 순서역전 tombstone**(§4.3.1)·**B2 클로백 트랜잭션 순서**(§4.3.2)·**B3 만료 후 유예 정의**(§2.3.1)·**B4 day-0 grant 시점 지급**(§2.1). Q1~Q6 판정 확정(잔여 미결=Q4만, §11 확정표). 권고 R2(payer 집계 §2.5)·R3/R4(샌드박스·월귀속 §3.1)·R5(자동갱신 없음 고지)·R6(계정삭제 §2.4/§8)·R7(리셋경계 재시도 UI.2)·R8(관측 플래그 §11) 반영. 별도 발견: BACKEND §13.12 `camp=−300`→−200 드리프트 정정.
> 두 기능은 함께 상신·구현되므로 한 문서에 담되 명확히 분리한다 — **§A 출석 패스**(신규 상품), **§B 월 1+1**(기존 팩 구매 흐름 확장).
>
> **정합 정본(이 문서가 종속·정합해야 할 상위)**
> - `docs/MONETIZATION_SYSTEM.md` §11(다이아 이코노미·팩 6종·전지훈련·광고), §4.1(엔타이틀먼트 카탈로그), §11.7(음수 잔액 UX), §14(출시 컴플라이언스).
> - `docs/BACKEND_SYSTEM.md` §13.12(다이아 서버 진실·earn/spend·멱등·금액권위), §13.17(환불·음수 balance·부채상환), §13.18(RC 게이트웨이·웹훅/confirm 이중경로·`purchase:`/`refund:` 멱등키·샌드박스 필터·매출 롤업), §13.19(어뷰징 방어).
> - `docs/PAYMENT_LAUNCH_RUNBOOK.md`(상품 카탈로그 기준표 — 신규 SKU 편입).
> - 컴플라이언스 레퍼런스: 유저 레벨 스킬 `payment-security-compliance`(한국 게임법·IAP 보안).
>
> **한 줄 구조(외우고 시작)**: 두 기능 다 **서버 재화 레이어**다. 시드/리플레이/세이브 **무접촉**. 패스·1+1 보너스·일일 수령·환불 회수 **전부 `wallet_ledger`(append-only)와 신규 `attendance_passes` 테이블이 서버 진실**. RC는 검증·웹훅 게이트웨이일 뿐(RC Virtual Currency 금지 — §13.18 불변).

---

## 0. 확정 기획 (사용자 락 2026-07-23 — 바꾸지 말 것)

### A. 다이아 출석 패스
- **₩9,900 · 28일 · 매일 100💎 수령**(28일 전부 수령 시 최대 **2,800💎**).
- **일반 무료 출석은 보류** — 지금은 **유료 패스만 존재**(무료 데일리 보상 없음).

### B. 월 1회 1+1
- 기존 다이아 팩 **6종 전부**(100/500/1,000/2,500/5,000/10,000) 대상.
- 각 팩마다 **월 1회, 그 달 첫 구매 시 2배 지급**. **매월(KST 캘린더월) 초기화.**

> 두 항목의 수치·대상은 **확정**이다. 아래 설계는 이 락을 구현하는 방법(멱등·타임존·환불·게이팅)을 정하며, 그 부분에서만 판단 여지가 있다(각 지점에 근거·미결 표시).

---

## 1. 설계 원칙 (이 문서가 지키는 것)

1. **재화는 서버 진실**([[server-authoritative-currency]] · §13.12) — 패스 소유·일일 수령·1+1 보너스·환불 회수는 **서버 확정 후에만** 반영. 클라 잔액은 표시 캐시. 적립/구매/차감은 온라인 필수.
2. **멱등·append-only 원장** — 모든 재화 이동은 `wallet_ledger` 불변 엔트리 + 자연 멱등키. `balance == Σledger` 불변식(§13.4). 음수 허용은 **환불만**(§13.17 P0-1).
3. **결정론 격리** — 시드·리플레이·세이브에 **절대 미접근**. 다이아는 이미 §11(전지훈련)에서 P2W 재화로 편입돼 있고, 본 2종은 그 다이아의 **획득 경로 추가**일 뿐 엔진 파급 0(§6).
4. **관전형·무푸시 유지** — 패스 일일 수령은 **접속해서 탭**하는 opt-in(푸시 없음). 미수령은 그날 소멸(리텐션 훅) — 강제 관람·nag 아님(§6장 관전형 정의). 단 소멸은 **표시의무**로 명확히 고지(§8).
5. **안티과금 반전 계열(P2W)** — 다이아=전력(§11 기둥3 반전). 본 2종은 **다이아 단가를 낮추는 프로모션**이라 P2W 계열이다(코스메틱 아님). 그러나 실제 전력은 여전히 전지훈련 캡(99·오프시즌 1회·200/코스)이 바운드 → **리그 인플레 0**(AI는 캠프 안 함, §5 파급 참조).
6. **RC 게이트웨이·진실 소유 분리 불변**(§13.18) — 소모성(패스 구매·다이아 팩) 지급 진실=우리 원장. RC Virtual Currency 금지.

---

# §A. 다이아 출석 패스

## 2.1 상품·구매

- **스토어 상품 = RC 소비성(consumable) SKU `diamond_pass`.** 표시가 ₩9,900은 **스토어 등록값이 정본**(다이아 팩과 동일 규칙 — 표시가는 `data/diamondTiers`류 설계값, 실청구는 스토어). 소비성인 이유: 28일 후 **재구매**가 가능해야 하므로 비소모 엔타이틀먼트(영구·1회)로 등록하면 안 된다.
- **구매 ≠ 즉시 다이아.** 구매는 **서버가 우리 DB에 "패스 엔타이틀먼트" 1건(28일 창)을 생성**한다. 다이아는 매일 수령(§2.3)으로만 들어온다. → **RC customerInfo 엔타이틀먼트가 아니다**(그건 비소모 광고제거·DLC 전용). 우리 `attendance_passes` 테이블이 진실.
- **지급 경로 = 다이아 팩과 동일한 §13.18 이중경로**(웹훅 + confirm 폴백), 멱등키 `purchase:<userId>:<storeTxnId>` 공유. 차이는 grant 동작이 `applyWalletTx(+다이아)`가 아니라 `grantPass(...)`라는 점뿐. `server/lib/products.ts`에 신규 카테고리 **`PASS_PRODUCTS`**(`diamond_pass`)를 추가하고 `decidePurchaseEvent`가 이를 인식해 pass-grant로 분기(현재는 `diamond_pass`가 `DIAMOND_PRODUCTS`·`ENTITLEMENT_PRODUCTS` 어디에도 없어 "미등록 SKU → 무시"로 떨어짐 — 반드시 등록).
- **시작 = 구매일 KST**, 창 = **28 리셋일**(dayIndex 0~27). `start_date = 구매 시점의 리셋보정 KST 날짜`, `end_date = start_date + 27`(포함) → 정확히 28 슬롯 = 최대 2,800💎.
- **구매 당일 = 1일차, 즉시 지급 명문화**(리서치 표준 관행 — 원신/스타레일/세나 키우기 모두 구매 직후 첫 지급): 구매 성공 그 세션에서 **dayIndex 0(첫 100💎)을 즉시 지급**한다(리셋 대기 없음). → 28일 완주 시 **총 28회 지급 보장**. 별도 "즉시 지급분 lump"(원신 300결정류)는 두지 않는다 — 락된 스펙이 "매일 100·최대 2,800"(=28×100)이라 day-1의 100이 곧 즉시분(리서치의 즉시분 분리 관행은 청약철회 방어 이점이 있으나 스펙 락 우선, §8 미채택 근거).
  - **★ B4 — day-0 지급 주체 = `grantPass`(claim 경유 아님, 리뷰 블로커)**: `grantPass`가 패스 행 생성과 **같은 트랜잭션 안에서** slot 0을 직접 지급한다(`applyWalletTx(+100, 'pass_daily', key='pass_daily:<userId>:<passId>:0', ref=storeTxnId)`). 클라 claim 트리거에 맡기지 않는다. **웹훅이 confirm보다 먼저 오든(웹훅이 grantPass) 반대든(confirm이 grantPass)** slot 0은 grant 시점에 확정되고, 이후 클라의 자동 claim이 **같은 dayIndex 0 키로 dedupe**(`applied:false`)되어 이중지급 0. → 웹훅 지연·클라 미접속에도 **28회 보장이 구조적으로 성립**(day-0이 claim에만 의존하면 구매 직후 앱을 껐다 켜기 전까지 미지급 창이 생김 — 그 창을 제거).
- **리셋 시각 = 서버 KST 04:00**(신설 상수 `PASS_RESET_HOUR_KST=4`, `server/lib/econ.ts` 단일 출처). 게임 관행(원신/스타레일 서버 4시 리셋 — 자정 넘겨 플레이하는 유저를 하루 경계에서 보호). dayIndex·start_date·수령 판정 전부 **리셋보정 날짜**(= `KST(now − 4h)`의 캘린더 날짜)로 계산. 클라 시계 절대 미사용(호요버스 서버리셋 패턴 = "재화는 서버 진실"과 정합). → 리셋 시각은 **미결 Q6**(자정 vs 04:00, 권고 04:00).

## 2.2 중첩 구매 방지

- **1차 방어 = 클라 게이트**: 활성 패스가 있으면 구매 버튼 **비활성 + "남은 N일" 표시**. 정상 흐름에선 두 번째 구매가 발생하지 않는다(구매는 유저가 우리 버튼을 눌러야 시작).
- **서버 방어(엣지) = 큐잉 확정(리뷰 판정 채택, Q1)**: 클라 게이트를 우회한(또는 레이스) 신규 txn이 활성 패스 중 도착하면 — **돈은 이미 스토어가 받았으므로 거부·유령화는 부당** → **큐잉**(만료 후 이어지는 예약 패스). 리뷰 조건 2건 반영:
  - **(a) 큐 패스 start는 고정 저장 금지 = 체인 파생/환불 재계산**: 예약 패스의 `start_date`를 삽입 시점에 박아두면 **앞 패스가 환불로 조기 종료(§4.3)** 됐을 때 그 사이 공백이 생긴다. → 예약 패스 활성화 시점에 **`start = max(오늘, 직전 패스 end+1)`을 파생**하거나, 앞 패스 환불 트랜잭션에서 **뒤 큐 패스 start를 재계산**한다(공백 방지). 저장 형태는 "예약(pending) 플래그 + 앵커=직전 passId", 실 start는 활성화 때 확정.
  - **(b) 큐 깊이 상한 1 + 초과 시 ops 알림**: 예약은 **1장까지만**(활성 1 + 예약 1). 세 번째 구매가 도착하면 큐 상한 초과로 **지급 보류 + ops 디스코드 알림**(수동 처리 — 환불 유도 또는 예외 지급). 원신 180일(6장) 스택 대비 보수적 시작(리서치 §3 "스택 도입은 수요 확인 후").
  - **UI**: UI.1에 **"활성+예약"(4번째 상태)** — "이용 중 · 예약 +28일" 표기(구매 버튼은 큐 만석이면 비활성).
  - 어느 경우든 **환불/멱등키는 storeTxnId 스코프**라 안전(각 패스 독립 클로백).

## 2.3 일일 수령 — 자동 지급 + 비차단 토스트 (개정 2026-07-23 · UX 리서치 반영)

> **권고 정정(취소선)**: ~~"접속해서 탭(수령 UI)해 수령"~~ → **"온라인 접속 시 자동 지급 + 비차단 토스트(UI-30)"**. 근거: 원신·스타레일 지배 패턴 = **로그인이 곧 수령**(별도 수령 버튼 없음 — 마찰 0, 리서치 §1). 우리 관전형·무푸시·비차단 원칙과 정합("매 순간 손이 가게" 금지 — CLAUDE 기둥1). 서버 판정 로직은 동일(KST 리셋보정 날짜·멱등), 클라 트리거만 "탭" → "포그라운드 진입 자동 호출"로.

- **클라 트리거**: 앱 **포그라운드 진입(+온라인)** 시 클라가 `POST /api/pass/claim` 자동 호출(로그인 직후·syncWallet 지점과 합류). 성공 시 **비차단 토스트**("출석 패스 +100💎 · N/28일"). **모달 팝업 금지**(관전형·비차단). 미보유/이미수령이면 조용히 no-op(토스트 없음).
- **서버 라우트 `POST /api/pass/claim`**(Bearer→userId):
  1. 서버가 **리셋보정 오늘 KST 날짜**·현재 dayIndex 계산(`server/lib/dates.ts` 확장 `todayKstResetAdjusted(PASS_RESET_HOUR_KST)`).
  2. 그 유저의 **활성 패스**(`start_date ≤ 오늘 ≤ end_date`, `status='active'`) 조회. 없으면 `{ok:false, reason:'no-pass'}`.
  3. **지급 대상 슬롯 결정**(미수령 정책 §Q5에 따라): 오늘 dayIndex(그리고 유예 채택 시 유예창 내 미수령 dayIndex) 각각에 대해 `applyWalletTx(+PASS_DAILY_REWARD, 'pass_daily', key='pass_daily:<userId>:<passId>:<dayIndex>', ref=<storeTxnId>)`.
- **멱등키 = `pass_daily:<userId>:<passId>:<dayIndex>`**(코디네이터 지정 user×pass×dayIndex) → `wallet_ledger` idempotencyKey UNIQUE가 **패스별 슬롯 1회**를 강제. 재진입·멀티기기·웹 재전송은 `applied:false`(이중지급 0). **날짜가 아니라 dayIndex 키인 이유**: ① 재구매(만료 후 새 패스)는 새 passId라 dayIndex 0부터 다시(슬롯 충돌 없음) ② **유예(B) 구현 가능** — 지난 dayIndex를 나중에도 그 슬롯 키로 청구 가능(날짜 키면 "오늘"만 청구돼 유예 불가).
- **금액 서버 권위** — 100💎는 `server/lib/econ.ts PASS_DAILY_REWARD` 상수(클라값 무시). 클라 표시용 미러 `engine/diamonds.ts`(광고·CAMP 미러 패턴), 드리프트는 `_dv_walletauth`/`_dv_pass` 대조.
- **`pass_daily`는 범용 `/earn` 화이트리스트에 넣지 않는다** — 전용 라우트가 패스 소유·슬롯을 검증. `/earn`(`{ad,achievement,welcome}`)로 클라가 `pass_daily` 사칭 불가(fail-closed 유지, §13.12).
- **오프라인이면 지급 불가** — 재화 적립=온라인 원칙(§13.12). 오프라인 실행일은 그날 지급 없이 넘어가고, **온라인 첫 시점에 재시도**(포그라운드+온라인 복귀 시 claim). 소멸(A)/유예(B)는 §Q5. 잔액 표시는 캐시.

### 2.3.1 미수령(오프라인/미접속 날) 처리 — 미결 Q5

| 안 | 동작 | 리텐션 | 불만 | 표시의무 문구 |
|---|---|---|---|---|
| **(A) 당일 소멸(호요식)** | dayIndex는 그날(리셋 창) 지나면 영구 소멸 — 이후 청구 불가 | **최강**(매일 접속 강제) | **가혹** — 무푸시라 "놓쳤는지도 모름" 불만 증폭(리서치 §6 호요 커뮤니티 실증) | "미접속일 보상은 **그날 소멸**되며 이월·보상되지 않습니다" |
| **(B, 권고) N일 유예 보관** | 미수령 dayIndex를 **최근 G일(권고 3일) 내** 온라인 복귀 시 몰아 지급. G 초과분만 소멸 | 약화(최대 G일에 1번 접속해도 무손실 → 매일 접속 동기 완화) | **완화** — 여행·점검일 방어. 수령 이력(스탬프)에 "받음" 기록으로 "받았나?" 불안 제거(스타레일 우편 패턴 차용) | "미접속일 보상은 **{G}일 내 접속 시 수령**, {G}일 경과분은 소멸됩니다" |

- **확정 = (B) 유예 G=3일**(리뷰 판정 채택, 사용자 최종 확인 대기 표기). 우리는 **무푸시·관전형**이라 (A)"당일 소멸"은 **관전형 기둥과 충돌**(무푸시인데 놓치면 끝 = 가혹, 리뷰 판정). 3일이면 여행·서버점검을 흡수하면서 "3일에 한 번은 켜야" 리텐션 앵커 유지.
- **정직한 대가(명기)**: 유예 G일은 **매일 접속 동기를 G일에 1회로 희석**한다. G=3이면 유저가 3일마다 켜서 300💎 몰아받아도 무손실 → "매일 열어보는 습관"(관전형 리텐션 핵심)이 최대 1/3로 약화. G가 클수록 습관 훅↓·불만↓ 트레이드오프 — G=3은 중간값.
- **★ B3 — 만료 후 유예 정의(리뷰 블로커, 고지 문구와 실동작 일치)**: 유예는 **만료 경계에서도 살아야** 한다. claim 조회 조건 = **`start_date ≤ 오늘(리셋보정) ≤ end_date + G`** (단순 `≤ end_date`면 27일차 놓친 유저가 만료 다음날 유예를 못 받아 고지 "3일 내 수령"과 어긋남). 지급 대상 dayIndex = **`clamp(현재구간, 0, 27)`** 범위의 미수령 슬롯(만료 후엔 현재 오프셋이 27을 넘어도 **27로 클램프** — 28슬롯 초과 지급 없음). 즉 만료+1일 접속 시 놓친 dayIndex 26·27을 수령, 만료+G+1일이면 미지급.
- **구현 영향**: (A)는 오늘 dayIndex 1슬롯만. (B)는 `max(0, 현재dayIndex−G+1)…min(27, 현재dayIndex)` 범위 미수령 슬롯 루프 지급(각 멱등키 dayIndex — 이중 없음). 스키마·멱등 동일(정책 상수 `PASS_GRACE_DAYS=3`만 분기, `PASS_GRACE_DAYS=0`이면 (A)).

## 2.4 스키마 · API

- **신규 테이블 `attendance_passes`**(Expand-only, [[prod-schema-migration-caution]] generate+migrate) — **✅ 구현(2026-07-23, `server/db/schema.ts`)**:
  `id`, `proj_code` FK, `user_id` FK, `store_txn_id` text(nullable — admin=null), `start_date` date(KST), `end_date` date(KST), `source`('purchase'|'admin'), `status`(~~'active'|'refunded'~~ → **'active'|'refunded'|'queued'**), **`queued_after` uuid(nullable)**, `purchased_at` timestamptz, `created_at` default now().
  - `UNIQUE(proj_code, store_txn_id)` = **구매 멱등**(웹훅·confirm 공유 자연키, onConflictDoNothing). store_txn_id nullable → admin 발급(NULL)은 Postgres에서 서로 distinct라 충돌 없음. B1 tombstone 선삽입도 이 UNIQUE 활용.
  - `index(proj_code, user_id)` = 활성 패스 조회.
  - **정정(2026-07-23 구현)**: ~~status는 active|refunded만~~ → Q1 큐잉(§2.2 "예약 pending 플래그 + 앵커")을 담으려면 **`status='queued'` 상태 + `queued_after`(직전 passId 앵커) 컬럼이 필수**다. 예약 패스의 실 start는 활성화 때 `max(오늘, 앵커 end+1)`로 파생(§2.2a·R1a), queued 행엔 프로비저널 start/end 저장(활성화 때 확정). 스키마 §2.4 원안(active|refunded)을 이 2필드로 보강.
- **API**:
  - `POST /api/pass/claim`(Bearer) — 위 §2.3. typed 결과(`ok`·`no-pass`·`already`(멱등)·`offline`·`unauthorized`).
  - **패스 상태 = `getWallet` 확장 확정(Q2 판정 채택)** — 활성 여부·`end_date`·오늘 수령 여부·예약 패스·팩별 1+1 가용을 `getWallet` 응답에 편입. 근거: **claim 자동 트리거와 합류점(syncWallet)이 동일**해 별 라운드트립 0(마이페이지·포그라운드 복귀가 이미 syncWallet 호출). 신 `GET /api/pass/status` 불필요. **메모**: 1+1 가용 여부는 원장 월-키 존재 파생이라 **캐시 신선도 고려**(구매 직후 서버 확정 후 syncWallet로 갱신 — 낙관 표시 금지).
  - 패스 grant는 `server/lib/pass.ts`(신) `grantPass(userId, storeTxnId, purchasedAt)` — 웹훅/confirm이 공유 호출.
- **admin 수동 패스(source='admin')**: 보상·CS용 수동 발급은 `store_txn_id` 대신 **`ref='admin:<passId>'`**(스토어 txn 없음). 환불 클로백 경로는 **admin 패스 무접촉**(RC 환불 웹훅은 store_txn_id 매칭이라 admin 패스에 안 닿음 — 수동 발급은 수동 회수).
- **환영 1000💎(§13.12 welcome)와 상호작용 없음** — 패스·1+1·welcome은 서로 다른 reason·멱등키라 간섭 0(welcome은 계정 1회, 패스는 slot 키). 별도 처리 불요.
- **RC/스토어**: `diamond_pass`를 Play Console 소모성 상품 + RC Products/Offering에 등록(팩과 동일 절차 — RUNBOOK §1·§2). 엔타이틀먼트 매핑 **불필요**(비소모 아님).
- **R6 — 계정 삭제 중 패스**: 소프트삭제(`pseudonymizeUser`, §13.17) 시 잔여 패스 보상은 **소멸**(삭제 계정은 claim 경로가 requireUserId에서 막힘), 환불은 **스토어 정책 경유**(우리가 선제 환불 안 함). 삭제 플로우 카피 + §8에 "삭제 시 잔여 패스·다이아 소멸, 환불은 스토어" 명시.

## 2.5 원장 · 멱등키 요약 (패스)

| 사건 | reason | 멱등키 | delta | ref |
|---|---|---|---|---|
| 패스 구매 | (원장 미기록 — `attendance_passes` 행 생성) | `attendance_passes.store_txn_id` UNIQUE | — | — |
| 일일 수령(슬롯) | `pass_daily` | `pass_daily:<userId>:<passId>:<dayIndex>` | +100 | `<storeTxnId>` |
| 패스 환불 회수 | `refund` | `refund_pass:<userId>:<storeTxnId>` | −Σ(수령분) | `<productId>:pass` |

> 구매 자체는 다이아 0(원장 미기록) — 다이아는 수령으로만. 매출 KRW는 §13.18 `recordRevenueKrwOnce`가 웹훅 `price_in_purchased_currency`로 적재(패스도 실매출).

- **★ R2 — payer/전환/purchaseCount 집계 확장 필요(리뷰)**: 현 매출·전환·결제자 집계는 **`wallet_ledger reason='purchase'`** 기준(§13.18)이다. 패스 구매는 **원장에 `purchase` 델타를 안 남기므로**(다이아 0, `attendance_passes` 행만) — 이 집계로는 **패스 구매자가 payer/전환/purchaseCount에서 통째로 누락**된다(§13.18 D1 "지급 경로만 필터하고 다른 라이터가 덮음"과 **동형 함정**). → **payer 판정을 `purchase_event`(또는 매출 KRW 적재 행) 기준으로 확장**해야 패스 구매도 결제자·전환·건수에 잡힌다. `recordRevenueKrwOnce`는 패스도 태우므로 **매출 KRW는 잡히나 건수/전환/payer는 별도 보정** 필요. `_dv_purchase` 확장 항목(§10)에 등재.

---

# §B. 월 1회 1+1

## 3.1 방식 — 기존 SKU 유지 + 서버 월-플래그 (권고안)

**신규 스토어 SKU를 만들지 않는다.** 기존 6팩(`dia_100`…`dia_10000`) 구매 지급 시, 서버가 "이번 달(KST) 이 팩 첫 구매"면 **동일량 보너스**를 1회 더 지급.

- **지급 합성**(웹훅·confirm 공유 `applyPurchaseGrant`):
  1. 기존: `applyWalletTx(+N, 'purchase', 'purchase:<userId>:<storeTxnId>', ref=productId)`.
  2. **추가**: `applyWalletTx(+N, 'iap_bonus_1p1', key='iap_bonus_1p1:<userId>:<productId>:<YYYY-MM(KST)>', ref=<storeTxnId>)`.
- **멱등키가 곧 월-플래그** — 보너스 키에 **KST 연월 + productId**를 박으면, 그 달 그 팩 **첫 구매의 grant만** 삽입 성공하고, 같은 달 재구매·같은 txn 재전송(웹훅+confirm)은 전부 UNIQUE 충돌 → `applied:false`(보너스 0). "월 1회 첫 구매"가 **별도 플래그 테이블 없이** 원장 멱등으로 성립.
- **월 경계·연월 = 서버 KST 고정**(`kstYearMonth()` 신, `server/lib/dates.ts`). 클라 시계 불신.
- **★ R4 — 월 귀속 = RC 이벤트 `purchased_at` 기준(웹훅 처리 시각 아님)**: 월-키의 연월은 **거래 발생 시각(RC 이벤트 `purchased_at`)의 KST 연월**으로 계산한다. 웹훅 처리 시각을 쓰면 월말 자정 근처 구매가 웹훅 지연으로 다음 달에 귀속돼 "그 달 첫 구매"가 어긋난다(경계 유저 오지급/누락). `kstYearMonth(event.purchased_at)`.
- **★ R3 — 샌드박스 대칭**: 패스·1+1 원장 엔트리도 §13.18 D1 샌드박스 필터에 대칭 편입 — 샌드박스 지급(`RC_SANDBOX_GRANT=all`)이면 `ref`에 **`:sandbox` 마커**(`pass_daily`·`iap_bonus_1p1` 모두). 또한 **샌드박스 구매의 1+1 월-키는 별도 스코프**(예: 키에 `:sandbox` 접미)하거나 **보너스 스킵** — 안 그러면 샌드박스 테스트 구매가 프로덕션 유저의 그 달 1+1 월-키를 소진시켜 실구매 시 보너스 누락. 매출/집계 제외는 §13.18 D1 3경로(웹훅·크론·관리자) 대칭 유지.
- **`iap_bonus_1p1`은 매출 KRW·"구매 다이아" 집계에서 자동 제외** — 매출/전환 롤업은 `reason='purchase'`만 집계(§13.18)하므로 보너스(별 reason)는 안 잡힌다(추가 돈 아님 = 정확). 원장 5년 티어는 결제 인접이라 그대로.
- **`diamond_pass`는 1+1 비대상** — 1+1은 소모성 다이아 팩 6종(`DIAMOND_PRODUCTS`) 전용. 패스는 `PASS_PRODUCTS`라 `applyPurchaseGrant`의 보너스 분기(팩 productDiamonds 매칭)에 안 걸림(구조적 제외). 명시.

## 3.2 대안 비교 — 별도 프로모 SKU 6종

| 축 | **권고: 기존 SKU + 서버 월플래그** | 대안: 별도 프로모 SKU 6종(`dia_100_1p1`…) |
|---|---|---|
| 스토어 등록 | 추가 0 | +6 상품 등록·심사·가격 |
| RC 매핑 | 추가 0 | +6 Product/Offering |
| "월 1회 첫 구매" 강제 | 서버 월-멱등키가 그대로 강제 | **스토어가 못 함** → 어차피 서버 월플래그 필요(중복) |
| 가격 표시 | 팩 카드 1개 + 뱃지 | 프로모/일반 2벌 → 혼선·정가 오인 |
| 진실 소유 | 원장(기존) | 원장(동일) — SKU만 늘 뿐 이득 없음 |
| 카탈로그 정합 가드 | `_dv_walletauth` 6팩 그대로 | 12 SKU 정합 유지 부담 |

→ **별도 SKU는 순비용만 크고 이득 0**(월강제는 어차피 서버 몫, 진실도 어차피 원장). 권고 채택.

## 3.3 앱 뱃지 · 투명성

- 팩 카드에 **"이번 달 1+1"** 뱃지(그 팩의 이번 달 보너스 미소진 시). `GET /api/pass/status`(또는 getWallet 확장)가 팩별 이번 달 보너스 가용 여부를 내려줌(원장 월-키 존재 여부 파생) — 클라 낙관 표시 금지, 서버 파생.
- **소진 시 뱃지 제거 + 일반가 표시**(과장광고 금지 — 표시광고법·컴플라이언스 §8). "1+1 받는 중"으로 오인시키지 않는다.

## 3.4 멱등 · 월경계 요약 (1+1)

| 사건 | reason | 멱등키 | delta |
|---|---|---|---|
| 팩 구매 기본 | `purchase` | `purchase:<userId>:<storeTxnId>` | +N |
| 1+1 보너스 | `iap_bonus_1p1` | `iap_bonus_1p1:<userId>:<productId>:<KST연월>` | +N |
| 팩 구매 환불 | `refund` | `refund:<userId>:<storeTxnId>` | −N |
| 1+1 보너스 환불 | `refund` | `refund_bonus:<userId>:<storeTxnId>` | −N |

---

# §UI. UI/UX 화면 흐름 (2026-07-23 리서치 체크리스트 기반)

> 원칙: **무푸시 · 비차단 · 인앱 표면만으로 유도**(관전형). 모달·강제 관람 금지. 리서치 §2·§3·§7 체크리스트를 우리 IA에 매핑.

## UI.1 상점(`app/buy-diamonds.tsx`) 패스 카드 — 4상태

| 상태 | 표시 | 구매 버튼 |
|---|---|---|
| **미보유** | 가격 ₩9,900 + **고지 6항**(§8: 28일·매일 접속 자동 지급·미접속 3일 유예(Q5=B)·완주 최대 2,800💎·오프라인 수령 불가·리셋 KST 04:00·**자동 갱신 없음/만료 후 수동 재구매**) + "즉시 1일차 100💎 지급" | 활성 "구매" |
| **활성** | **남은 일수 D-N**(원신 상점 카드 패턴 = 사실상 유일한 인앱 리마인더) + **오늘 수령 ✓/대기** + 수령 이력(28칸 스탬프, 유예(B) 놓친 날 표시) | **비활성 "이용 중"**(중첩 방지 §2.2 클라 게이트) |
| **활성 + 예약(Q1 큐잉)** | 위 + **"예약 +28일"**(만료 후 이어서 시작) — 큐 만석(깊이 1) | **비활성 "예약됨"**(큐 상한 도달) |
| **만료 임박(D-3~)** | 카드 강조 **인앱 배너/뱃지**("패스 곧 만료 · 재구매") — **푸시 없음**(무푸시). 만료 후 재구매 유도 | (활성 유지 중엔 여전히 비활성, 만료 즉시 활성) |

## UI.2 홈/마이페이지 자동 수령 토스트

- 포그라운드 진입 + 온라인 → 자동 claim → 성공 시 **비차단 토스트**("출석 패스 +100💎 · N/28일", 자동 사라짐). 실패(오프라인/미보유)면 토스트 없음.
- **수령 실패(오프라인) 유도**: 활성 패스 보유 + 오늘 미수령 + 오프라인이면 마이페이지 다이아 섹션에 **배지**("오늘 출석 보상 대기 — 온라인 시 지급") — 비차단, 클릭 시 재시도.
- 수령 이력(28칸 스탬프) 화면 — "출석 패스" 이름과 정합, "받았나?" 불안 제거(스타레일 우편 기록 패턴 차용).
- **R7 — 장기 세션 리셋 경계 재시도**: 앱을 포그라운드로 켜 둔 채 **리셋(KST 04:00)을 넘긴** 경우, 포그라운드 유지 중 **경계 통과 시 claim 1회 재시도**(다음 dayIndex 지급). 단 이건 편의 최적화일 뿐 **1차 흡수는 (B) 유예** — 다음 포그라운드 진입이나 유예창이 놓친 날을 메운다(재시도 실패해도 손실 0).

## UI.3 1+1 팩 카드(§3.3 재확인)

- 팩 카드에 **"이번 달 1+1"** 뱃지(그 팩 이번 달 보너스 미소진 시, 서버 파생). **소진 시 뱃지 제거 + 정가 표시**(과장광고 금지) + **다음 초기화 날짜**("다음 달 1일 초기화" — KST 월경계) 안내.

## UI.4 멀티 기기 동시 접속

- 두 기기가 같은 날 동시에 자동 claim해도 **서버 멱등키(user×pass×dayIndex)로 이중 지급 불가** — 진 쪽은 `applied:false`. 둘째 기기엔 토스트 없이("이미 수령") 조용히 no-op. 명기(리서치 §4 엣지).

---

# §C. 환불 처리 (필수 — 사용자 지시 2026-07-23)

> 기존 팩 일반구매 환불(§13.18)은 이미 **RC CANCELLATION/REFUND 웹훅 → `applyWalletTx(−N, 'refund', refund:<userId>:<storeTxnId>)`(음수 허용)** 로 정의돼 있고 관리자 수동 환불(§13.17)과 storeTxnId 공유키로 이중차감을 막는다. 본 2종의 환불은 **그 기존 패턴을 그대로 확장**한다(새 reason 문자열을 만들지 않음 — 아래 근거).

## 4.1 팩 일반 환불 (기존 §13.18 — 정합 확인)

- 이미 존재: 웹훅 CANCELLATION/REFUND → `refund:<userId>:<storeTxnId>` −N. `allowsNegativeBalance`가 `reason==='refund'`만 음수 허용. 매출 롤업은 gross(환불 미차감 — §13.17 retention TODO 잔존). **본 문서는 이 패턴을 변경하지 않고 재사용**.

## 4.2 1+1 환불

- **RC 환불 웹훅 수신 → 원장에 회수 엔트리 2건(append-only)**:
  - 기본 지급 회수: `applyWalletTx(−N, 'refund', 'refund:<userId>:<storeTxnId>')` — **기존 팩 환불과 동일 경로**(1+1은 지급 경로만 다를 뿐 기본분은 팩 구매 그 자체).
  - 1+1 보너스 회수: `applyWalletTx(−N, 'refund', 'refund_bonus:<userId>:<storeTxnId>', ref='<productId>:1p1bonus')`.
  - → **둘 다 마이너스**(사용자 지시 충족). 원 구매 txn 참조(키·ref 모두 storeTxnId 스코프).
- **잔액 음수 허용**(이미 소비했으면 부채) — `reason==='refund'` 음수 우회(§13.17 P0-1). 음수 상태에선 **전지훈련 spend 차단**(`insufficient`), 이후 광고/업적/쿠폰/일일수령 적립으로 상쇄(부채상환 — §11.7·§13.17 P1). **이미 집행된 전지훈련은 소급 취소 안 함**(§11.2 "산 캠프 소급 불변"·§13.17 "이미 쓴 전지훈련 효과 취소 안 됨" 원칙 인용).
- **그 달 1+1 소진 플래그는 복구하지 않음** — 보너스 회수 엔트리(`refund_bonus:…`)는 **별도 키**라, 원 보너스 지급의 **월-멱등키(`iap_bonus_1p1:<user>:<pack>:<월>`)는 원장에 그대로 남는다**. 따라서 같은 달 재구매 시 월-키가 여전히 점유돼 **보너스 재지급 0**. → **환불→재구매 파밍 차단**(buy로 +N 보너스 받고 refund로 −N 회수해도 순 0, 게다가 그 달 1+1 재획득 불가라 오히려 손해). 플래그 미복구가 정답인 근거.

## 4.3 패스 환불 (A/B 트레이드오프 + 권고)

- **웹훅 수신 즉시 패스 종료** — `attendance_passes.status='refunded'`(+ `end_date`를 어제로) → **잔여일 소멸**(이후 claim은 `no-pass`).
- **이미 수령한 일일 100💎 처리 — 두 안**:

| 안 | 동작 | 장점 | 위험 |
|---|---|---|---|
| **(A) 수령분 전액 회수** | `refund_pass:<userId>:<storeTxnId>` 로 `−Σ(pass_daily where ref=storeTxnId)` 마이너스 원장(음수 허용) + 패스 종료 | **어뷰징 완전 차단** — "28일 직전 환불로 2,700💎 챙기기" 불가. 팩 환불(전액 회수)과 대칭 | 정상 환불 유저에게 다소 가혹(받은 것도 회수). 단 §11.7 음수 UX·부채상환이 완충 |
| (B) 수령분 인정·잔여만 종료 | 이미 받은 pass_daily 유지, 향후 claim만 차단 | 유저 친화 | **"28일차 직전 환불" 어뷰징** — ₩9,900 안 내고 최대 2,700💎(27일 수령분) 취득 허용. 개발자 재량 환불(48h 후)이 있는 한 실위험 |

- **확정 = (A) 전액 회수(리뷰 판정 채택, 사용자 최종 확인 대기 · B1·B2 선행 조건)**:
  - **호요버스 공개 정책이 (A)를 지지**: 공월의 축복(Welkin Moon) 환불 시 **초기 즉시분 + 이미 수령한 일일 원석까지 소급 전액 차감**, 잔액이 음수가 되면 안내 후 유예기간(약 1~4주) 내 미해결 시 계정 제재. 공식 지원 문서 존재("What should I do if my in-game currency balance is negative after a refund?" · 환불 페널티 타임라인). → **서버 원장 클로백 + 음수 허용 + 유예**가 검증된 패턴.
  - **우리 차이(더 관대)**: 호요는 유예 후 **계정 정지**까지 가지만, **우리는 정지 안 함** — 음수 잔액 + 전지훈련 차감 차단만 유지(§11.7·§13.17). 유저 관대 원칙(§2.5·MONETIZATION §2.5)과 정합. 즉 **회수는 호요만큼 엄격(A), 제재는 안 함**.
  - **구글 환불 정책 산수**: 구글 **구매 후 48시간 = 자동 환불**(유저 직접). 48h 내 환불이면 유저는 **1~2일분(day1 + 경우에 따라 day2)** = **100~200💎**만 수령한 상태 → (A)/(B) 실차이 **100~200💎(≈₩350~700)로 미미** → 정상 유저 대다수(48h 자동환불)에겐 (A)의 "가혹함"이 거의 없다.
  - 48h **이후 개발자 재량 환불**은 수령일수가 커질 수 있고(예: 20일차 환불=2,000💎), (B)는 이 후반 어뷰징에 문을 열지만 (A)는 닫는다.
  - → **Q3 = (A) 확정**(§11) — 호요 선례+48h 산수. 사용자 최종 확인만 대기.
- **환불 회수 링크**: pass_daily 엔트리의 `ref=<storeTxnId>` 덕에 그 패스의 수령분을 `sum(delta) where reason='pass_daily' and ref=storeTxnId`로 집계 → 1건 마이너스로 반전(멱등키 `refund_pass:<userId>:<storeTxnId>`).

### 4.3.1 ★ B1 — 환불 선착(순서역전) 방어 (리뷰 블로커)

환불 웹훅이 **구매 grant보다 먼저** 도착할 수 있다(RC 이벤트 순서 비보장 — §13.18 "순서역전 안전"의 패스판). 이때 해당 `storeTxnId`의 `attendance_passes` 행이 아직 없으면 클로백 대상이 없어 유실되고, 뒤늦은 `grantPass`가 **환불된 패스를 활성으로 되살린다**(유령 활성). 방어:
- **tombstone 선삽입**: 환불 웹훅 수신 시 패스 행이 없으면 **`status='refunded'` 행을 먼저 삽입**(`UNIQUE(proj, store_txn_id)` 활용, onConflictDoNothing). 이후 도착한 `grantPass`는 **onConflictDoNothing 후 기존 행이 `refunded`면 활성화 금지**(활성 패스 생성 안 함·slot 0 지급 안 함).
- **결과**: 환불 선착 → 구매 후착 → 이후 claim은 전부 **`no-pass`**(활성 패스 없음). 지급 0·유령 활성 0.
- `_dv_pass_live` 케이스: "환불 선착 → 구매 후착 → claim 전부 `no-pass`" A/B.

### 4.3.2 ★ B2 — 클로백 트랜잭션 순서 (리뷰 블로커)

클로백은 **단일 트랜잭션**에서 §13.12 spend 행 잠금 패턴(users FOR UPDATE)으로 직렬화:
1. **패스 행 잠금 + `status='refunded'`**(FOR UPDATE — 동시 claim과 직렬화).
2. **`Σ(pass_daily where ref=storeTxnId)` 집계**(잠금 하에서 — claim이 끼어들어 뒤늦게 슬롯을 더하는 레이스 차단).
3. **클로백 삽입** `applyWalletTx(−Σ, 'refund', 'refund_pass:<userId>:<storeTxnId>')`(멱등).
- **claim 측도 같은 잠금 하에서 `status` 확인** — claim이 패스 행을 읽을 때 FOR UPDATE로 잠그고 `status='active'` 확인 후 지급 → 환불 트랜잭션과 상호 배제(환불 중엔 claim이 대기 후 refunded를 보고 `no-pass`, claim 중엔 환불이 대기 후 그 슬롯까지 Σ에 포함). "환불과 claim 동시" 레이스에서 **Σ 정합**(클로백이 실제 지급 총액과 일치).

## 4.4 음수 잔액 · 부채상환 (§11.7 인용)

- 세 환불 모두 잔액이 음수로 떨어질 수 있다(이미 다이아를 전지훈련에 쓴 경우). `balance==Σledger` 불변식 유지(0 clamp 금지). 음수에서 **적립(delta>0)은 항상 통과**(부채상환), **차감(전지훈련)은 거부**. 4화면 공용 `components/NegativeBalanceNote` 캡션 재사용(§11.7) — "스토어 환불로 회수된 내역이 반영된 잔액이에요. 충전·적립으로 채워져요."
- **reason 문자열 선택 — 스펙과 다른 판단(보고)**: 코디네이터 예시는 `refund_iap`/`refund_iap_bonus`였으나, 본 설계는 **기존 `reason='refund'` 를 재사용**하고 회수 종류는 **멱등키 + ref 마커**로 구분한다. 근거: `allowsNegativeBalance`·매출 제외 필터(`reason='purchase'`만 집계)·retention 5년 티어·§11.7 음수 UX가 **전부 `reason==='refund'`에 걸려 있어**, 병렬 refund reason을 신설하면 그 모든 호출부(음수허용·매출제외·보관·UX)를 동시에 손대야 하고 하나라도 누락 시 사고(예: 새 refund reason이 매출 제외에서 빠져 과소/과대 집계). 회수 2건(기본·보너스) 분리라는 **의도는 멱등키로 동일 충족**. → §11 미결이 아닌 **판단 보고 항목**.

---

## 5. 경제 파급 (산수 — 추정 아님)

| 항목 | 계산 | 결과 |
|---|---|---|
| 패스 개당 단가(28일 완주 시) | 9,900 ÷ 2,800 | **₩3.54/💎** (팩 ₩8.4~10 대비 최저가) |
| 패스 단가(14일만 수령) | 9,900 ÷ 1,400 | ₩7.07/💎 (팩 하단과 유사 — 완주 인센티브) |
| 1+1 전종 소진 월 최대 보너스 | 100+500+1,000+2,500+5,000+10,000 | **19,100💎** |
| 1+1 전종 구매 지출(정가) | 1,000+4,800+9,300+22,500+43,500+84,000 | **₩165,100** |
| 1+1 전종 소진 시 총 수령 | 19,100(기본) + 19,100(보너스) | 38,200💎 (실효 ₩4.32/💎) |

- **인플레 아님**: 패스·1+1은 **유저 개인 지갑**만 늘린다. AI 팀은 캠프·구매 안 함 → **리그 전체 인플레 0**(§11.2 원칙 동일). 실전력은 전지훈련 캡(99·오프시즌 1회·200/코스)이 바운드. 본 2종은 "다이아 단가 인하"라 **새로운 밸런스 축 신설이 아니라** 기존 P2W 축(§11 기둥3 반전)의 획득 효율만 높인다 → simFinance/parity 재측정 대상 아님(전력식 무변). 다만 출시 후 전지훈련 실사용 빈도는 관측(BM 대시보드).

---

## 6. 결정론 격리

- 두 기능 **전부 서버 재화·메타 레이어**. `attendance_passes`·`wallet_ledger`(pass_daily·iap_bonus_1p1·refund)는 서버 DB. **시드·리플레이·세이브(base+currentDay+results) 절대 미접근.**
- 수령·보너스 다이아는 `balance`(서버 진실)로 합류 → 전지훈련 spend로만 엔진에 닿고, 그 경로는 이미 `campLog` applied 게이팅·saveId 멱등으로 결정론 보존(§11.2·§13.12). **본 2종은 다이아 출처만 늘릴 뿐 캠프 적용 경로 무변경** → 리플레이 불변.
- 날짜(KST)는 **서버 시각**만 사용(`server/lib/dates.ts`). 엔진/시드에 `Date.now()` 유입 없음(서버 라우트 런타임 한정).

---

## 7. 출시 게이팅

- **상점 노출 = 플래그 뒤**(WORLDCUP_ENABLED 패턴, `data/flags.ts`): 신설 `ATTENDANCE_PASS_ENABLED`(패스 카드·수령 UI)·`PROMO_1P1_ENABLED`(팩 카드 1+1 뱃지). `diamond_pass` 스토어/RC 등록·샌드박스 실결제 완료 전엔 false. 1+1은 서버 로직만이라 별 SKU 없지만, 뱃지·기대치 노출을 서버 배포와 동기화하려 플래그로 감싼다.
- **dev = `lib/iap` 시뮬 경로** — Expo Go/`__DEV__`는 스텁(실결제 없이 흐름·UI 검증). 서버 로직은 dev Supabase + 라이브 가드로 검증.
- 실 SKU 연동은 #43(RC/EAS) 뒤(§9 Phase ③).

---

## 8. 컴플라이언스 점검 (payment-security-compliance 스킬 대조)

- **가챠·확률형 없음 유지** — 패스·1+1은 **결정론 지급**(고정 100/day, 고정 2배). RNG 0 → 게임산업법 §33② 확률표시·글로벌 가챠규제 **전면 N/A**(§14.1 최유리 포지션 불변). 환전·양도 없음(§32①7 무관).
- **기간제 상품 표시의무(전상법·표준약관)** — 패스는 "기간제(28일)" 유료 상품. 구매 화면에 **명확 고지**(표시의무, 고지 6항 UI.1): ① 28일·매일 접속 **자동 지급**(구매 즉시 1일차 100💎) ② **미접속일 = 3일 유예 수령, 경과분 소멸**(Q5=B 확정) ③ 완주 시 최대 2,800💎 ④ 오프라인 수령 불가 ⑤ 리셋 KST 04:00(Q6) ⑥ **자동 갱신 없음 · 만료 후 수동 재구매**(R5 — 소비성, 구독 아님. "자동 결제 오해" 방지·심사 요건). + 환불 시 처리(§4.3). 뱃지·카피가 과장광고 아니게(표시광고법) — 1+1 소진 후 정가 표시(§3.3).
- **R6 — 계정 삭제 중 패스**: 계정 삭제 플로우 카피·§8에 "**삭제 시 잔여 패스·미사용 다이아 소멸**, 결제 환불은 **스토어 정책 경유**(우리가 선제 환불 안 함)" 명시(§2.4 R6·§13.17 소프트삭제 정합).
- **청약철회·소비자보호(전상법 §17)** — 미사용 디지털재화 7일 청약철회. 패스는 "수령 개시=일부 사용" 성격이라 부분사용분 공제가 쟁점 → **실제 환불 금액은 스토어(구글/애플)가 정책대로 집행**하고 우리는 **재화 회수(§4.3)만 정합**. 앱 카피에 "환불 신청=접수, 실제 환불은 스토어 정책 경유, 이미 수령/집행분 처리"를 명시(§13.17 카피 패턴 재사용). buy 화면 청약철회 안내(기존 `buy-diamonds` 문구) 확장.
- **미성년자 결제** — 기존 팩과 동일 스토어 결제 게이트(변경 없음).
- **서버측 검증·환불 클로백** — 패스·1+1 모두 RC 웹훅/confirm 서버 검증 경로(§13.18) + 환불 클로백(§4) 위에 얹힘. 신규 결제표면(패스 grant) 추가분은 §10 가드로 봉인.
- **미결(법률 자문 영역) Q4**: 기간제 유료재화의 "부분 사용분 환불 산정"을 스토어 위임으로 두는 것의 표준약관 적합성 — 출시 전 게임법 자문 확인 권장(스킬 §1.2/§1.5, **법률 자문 아님**). **자문 질의 포인트 추가**: "**day-0 즉시 지급이 '사용 개시'를 구매 즉시로 만드는 구조**가 전상법 §17 청약철회 '미사용' 판단에 미치는 영향"(즉시 1일차 지급이 "개봉/사용 개시"로 해석돼 청약철회를 제한하는지 — 스토어 환불과 별개로 우리 약관 표현에 영향).

---

## 9. 구현 단계 분해 (Phase)

> 표준 작업 순서: 이 문서(설계) → 코드. 각 Phase 착수 전 이 문서에 단계 계획 존재 확인.

- **Phase ① 서버 스키마·API (결정론 밖, 먼저 — 테스트 쉬움)** — **✅ 구현 완료(2026-07-23)**. dev DB(로컬 Supabase :54322) drizzle generate+push 적용. prod는 배포 절차(`deploy-prod`)에서 마이그레이션 `0002_attendance_passes.sql` 적용. 가드 `_dv_pass`·`_dv_1p1`(순수)·`_dv_pass_live`(라이브) 전건 PASS(A/B 자가검증 포함).
  1. ✅ `server/db/schema.ts` — `attendance_passes` 테이블(+status 'queued'·queued_after 보강, 위 §2.4 정정). WalletReason 유니온(`server/lib/wallet.ts`)에 `pass_daily`·`iap_bonus_1p1` 추가.
  2. ✅ `server/lib/econ.ts` — `PASS_DAILY_REWARD=100`·`PASS_DURATION_DAYS=28`·`PASS_MAX_TOTAL=2800`(파생)·`PASS_PRICE_KRW=9900`(표시)·`PASS_RESET_HOUR_KST=4`(Q6)·`PASS_GRACE_DAYS=3`(Q5=B). `server/lib/dates.ts` — `todayKstResetAdjusted(resetHour)`·`kstYearMonth()`·`addDays`·`diffDays`·`maxDateStr`.
  3. ✅ `server/lib/products.ts` — `PASS_PRODUCTS`(`diamond_pass`)·`isPassProduct` + `decidePurchaseEvent`/`rcVerifyPurchase` pass-grant 분기(+`kind`·`purchasedAt` 필드).
  4. ✅ `server/lib/pass.ts`(신) — `grantPass`(B4·B1·Q1)·`claimPassDaily`(B3)·`clawbackPass`(B2·R1a)·`activateDueQueued`·순수 창 함수(`passWindow`·`claimableDayIndexes`·키 빌더). `applyPurchaseGrant`(웹훅/confirm 공유)에 1+1 보너스 grant + 패스 grant 합성. `reversePackBonus`(환불 보너스 회수).
  5. ✅ 라우트 — `POST /api/pass/claim`(신), 패스 상태 = `getWallet` 확장(`passStatus`). 환불 웹훅(§13.18)에 패스 clawback·1+1 보너스 reversal 배선(confirm 라우트도 패스 grant 분기).
  - **판단 보고(구현 중 스펙과 다르게 정한 지점)**:
    - **1+1 프로모 서버 게이트 신설 `PROMO_1P1_ENABLED`**(env, 요청시점 read, 기본 off) — §7 출시 게이팅을 서버에도 적용(앱 뱃지 플래그와 동기화·미출시 시 보너스 silent 발생 방지). 기존 `_dv_purchase` 팩 경로도 off라 무변(회귀 0).
    - **1+1 보너스는 웹훅 경로 전담(confirm 미지급)** — confirm 폴백은 RC `purchased_at` 미상이라, 월경계 근처에서 confirm(now)·웹훅(purchased_at)이 서로 다른 월키를 써 **이중 보너스**가 날 위험. 안전을 위해 보너스는 purchased_at 권위를 가진 웹훅만 지급(`applyPurchaseGrant(withBonus:false)` for confirm). 패스 grant/base 팩 지급은 두 경로 공유(멱등 dedupe).
    - **패스 클로백 링크 = `pass_daily.ref=storeTxnId`(유지) · pass_daily에 R3 :sandbox 마커 미부착** — §4.3 클로백은 `Σ(pass_daily where ref=txn)`을 그대로 씀. pass_daily는 매출 롤업(reason='purchase'만) 대상이 아니라 :sandbox 마커가 불필요하고, ref에 붙이면 클로백 앵커(ref=txn)가 깨진다 → pass_daily ref는 순수 storeTxnId 유지. R3 :sandbox 스코프는 **1+1 월키(iap_bonus_1p1)에만** 적용(그쪽이 실 영향 — 프로덕션 월키 소진 방지). 패스 샌드박스 격리는 매출/건수 recordPurchaseRevenue의 샌드박스 스킵으로 충족.
    - **R2(패스 payer/건수 편입)는 statsDaily 레벨까지** — 패스 grant(activated/queued) 시 `recordPurchaseRevenue(priceKrw, 0, txn)`으로 purchaseCount+1·매출 KRW 적재(다이아는 0 — 지급은 pass_daily). 관리자 대시보드의 payer-set 심층 집계(§13.18 admin)는 statsDaily 건수로 반영되나, purchase_event 기준 payer 판정 확장은 admin/stats 라우트 후속(§13.18 D1 동형).
- **Phase ② 앱 UI + 시뮬 경로 (dev 스텁)**
  1. `engine/diamonds.ts` 미러 상수(표시용). `data/flags.ts` 플래그 2종.
  2. 패스 상품 카드 4상태(UI.1 — 미보유/활성/활성+예약/만료임박) + **포그라운드 자동 수령 + 비차단 토스트**(UI.2, 탭 수령 아님) + 수령 이력 스탬프 + 남은일수·중첩 게이트.
  3. 팩 카드 "이번 달 1+1" 뱃지(서버 파생) + 소진 시 정가 + 다음 초기화 날짜(UI.3).
  4. 구매 화면 표시의무 고지 5항(§8·UI.1) + 환불 안내 카피.
  5. `lib/iap`·`lib/server` 배선(패스 구매=`purchasePackage(diamond_pass)`→confirm 폴백 / claim·status 호출). dev 스텁 no-op.
- **Phase ③ 실 SKU 연동 (#43 뒤)**
  1. Play Console `diamond_pass` 소모성 상품 등록(₩9,900) + RC Product/Offering.
  2. 샌드박스 실결제(패스 구매→pass 행→일일 수령→환불 클로백) 매트릭스(RUNBOOK §5 확장).
  3. 플래그 true 전환 + OTA/AAB(runtimeVersion 규율).

---

## 10. 검증 계획 (가드 초안 — A/B 자가검증 필수)

| 가드 | 종류 | 검증 대상 | A/B 민감도(주입할 결함) |
|---|---|---|---|
| `_dv_pass`(신, 순수) | pure tsx | 패스 창 산수(28슬롯=dayIndex 0~27, day1 즉시), 최대 2,800(28회), claim 멱등키(user×pass×dayIndex) 유일성, **리셋보정 날짜(KST 04:00 경계)·dayIndex 계산**, **B3 만료 후 유예(`start≤오늘≤end+G` + dayIndex clamp 27)**, `PASS_DAILY_REWARD` 서버↔engine 미러 드리프트 | 창 27/29슬롯 변이 → 총액/일수 불일치 · 리셋시각 4→0 변이 → 경계 dayIndex 오프바이원 · **B3: 만료+1일 접속 시 26·27 지급 / 만료+G+1일 미지급**(유예창 확대 → 초과지급 검출) · 보상 100→150 변이 → 미러 드리프트 |
| `_dv_1p1`(신 or `_dv_purchase` 확장, 순수) | pure tsx | 월-멱등키 "월×팩 1회" 강제, 재구매·재전송 dedupe, **R4 월귀속=`purchased_at` KST 연월**, **R3 샌드박스 월키 별도 스코프** | 멱등키에서 연월 제거(또는 txnId 추가) → 매 구매 보너스 검출 · 월경계 오프바이원 · purchased_at→처리시각 변이 → 경계 오귀속 검출 |
| `_dv_walletauth`(확장) | pure tsx | `PASS_PRODUCTS`(`diamond_pass`) 카탈로그 정합 + PASS 상수(daily·duration·reset·grace) 서버↔engine 미러 + 6팩 불변 | 상수 손복제 드리프트 주입 → 검출 |
| `_dv_pass_live`(신, 서버 라이브) | server tsx(:3000, DATABASE_URL) | 실 HTTP: 패스 구매 웹훅→행 생성·**B4 day-0 grant 시점 +100**·confirm dedup / 일일수령 +100 1회·같은 dayIndex 2회째 dedup(멀티기기 이중수령 0) / 활성패스 없이 claim `no-pass` / 만료+유예 경계 claim / **B1 환불 선착→구매 후착→claim 전부 `no-pass`**(유령 활성 0) / **B2 클로백 트랜잭션(패스 잠금→Σ→−Σ), claim↔환불 동시 레이스 Σ 정합** / 환불 웹훅→패스 종료+수령분 −Σ 클로백(A) / 1+1 첫구매 +N·2회째 0·다음달 부활·환불시 보너스 −N·플래그 미복구로 재구매 보너스 0 | 각 항 A/B(멱등키·tombstone·잠금 무력화 시 이중지급/유령활성/파밍 재현) |
| `_dv_purchase`(기존, 확장) | server tsx | 기존 머니패스에 `diamond_pass`(pass-grant·매출KRW 적재)·`iap_bonus_1p1`(매출/전환 집계 제외) 편입, 샌드박스 필터 대칭, **R2 payer/전환/purchaseCount에 패스 구매 편입(purchase_event 기준 확장 — §13.18 D1 동형 함정)** | 보너스가 매출에 새는지 A/B · **패스 구매가 payer/건수에서 누락되는지(R2) A/B** |
| `_gt_determinism`(기존) | tsx | 패스/보너스/환불이 campLog 리플레이 불변(재확인) | — |

> 신규 가드는 프로덕션 코드에 테스트 시임 남기지 않음(제어형 스텁·dev DB만). 통계 주장 없음(멱등·산수 검증이라 N 무관 — 라이브는 실 왕복 결정론).

- **✅ 구현·통과(2026-07-23)**:
  - `server/tools/_dv_pass.ts`(순수) — 창 28슬롯·2800·B3 유예(만료+1 지급/만료+4 미지급)·리셋 KST04 경계·멱등키 유일성·상수 미러, 전부 A/B PASS.
  - `server/tools/_dv_1p1.ts`(순수) — 월×팩 멱등·R4 purchased_at 귀속·R3 샌드박스 스코프·환불 월키 미복구, A/B PASS.
  - `server/tools/_dv_pass_live.ts`(라이브, dev DB) — B4 day-0·confirm dedup·일일수령 멱등/멀티기기·B3 유예·no-pass·B1 tombstone·B2 클로백·claim↔환불 레이스 Σ정합·1+1(2배/2번째0/다음달부활/환불회수/월키미복구)·Q1 큐잉·활성화·R2 건수편입, 전부 PASS.
  - `_dv_purchase`(기존) — 팩 경로 회귀 0 확인(프로모 off 기본 → 보너스 없음, 기존 assertion 불변).
- **후속(Phase②·별 세션)**: `_dv_walletauth`(클라이언트 `tools/`, 엔진 미러 대조)는 `engine/diamonds.ts` PASS 상수 미러(Phase②)가 생긴 뒤 확장 — Phase① 서버 무접촉이라 이번 범위 밖. `_e2e_purchase_live`(실행 서버 :3000 필요)는 dev 체인 기동 시 패스 케이스 추가.
- **가드 실행(dev DB)**: 로컬 Supabase :54322(`.env.development.local`은 임시 PG :55432 가리키므로) — `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" npx tsx tools/_dv_pass_live.ts`. 순수 가드는 DB 불요.

---

## 10.1 엣지 케이스 등록 후보 (리서치 §4·§7 — EDGE_CASES 등록은 구현 단계)

> 아래 7건은 구현 착수 시 `docs/EDGE_CASES.md`에 등록하고 가드(§10)로 봉인할 **후보 목록**이다(지금은 문서 편입만, 등록 자체는 구현 단계).

1. **구매 당일 1일차 즉시 지급 / 리셋 직전 구매** — 구매 즉시 dayIndex 0 지급(§2.1). 리셋(KST 04:00) 직전 구매 시 곧바로 dayIndex 1로 넘어가지 않게 리셋보정 날짜로 start 고정(하루 손실 방지).
2. **자정/리셋(04:00) 경계 세션** — 앱을 켠 채 리셋 시각을 넘긴 세션에서 날짜 재판정(다음 dayIndex 지급). 서버 판정이라 클라 유휴 세션도 다음 포그라운드 claim에서 수렴.
3. **멀티 기기 동시 접속 이중 수령** — 서버 멱등(user×pass×dayIndex)로 봉인, 둘째 기기 "이미 수령"(UI.4).
4. **만료 당일(dayIndex 27) 수령 후 상태 전이 / 만료 후 재구매 dayIndex 리셋** — 새 패스=새 passId라 dayIndex 0부터(슬롯 키 충돌 없음).
5. **오프라인으로 앱만 켠 날** — 적립 불가 비차단 고지(UI.2 배지) + 온라인 복귀 시 당일분 재시도. "시즌은 돌되 적립은 온라인" 제약의 UI 표면.
6. **환불 클로백 후 재구매 시도 / 클로백 음수 잔액에서 전지훈련 시도 차단** — spend 게이트가 음수서 camp 거부(§4.4·§13.17). 재구매는 새 storeTxnId라 정상.
7. **서버 점검·장애로 지급 실패한 날의 보상 정책** — 운영 매뉴얼 사전 결정(유예(B) 채택 시 유예창이 점검일 흡수 / (A) 채택 시 전량 보상 우편 등 운영 보상 — 원신도 점검일은 별도 보상 우편으로 간접 상쇄, 리서치 §6).

## 10.2 출처 (UX 리서치 흡수 — 스크래치패드 경로는 임시라 핵심 근거를 문서 내로)

> 리서치 원본: `scratchpad/pass-ux-research.md`(2026-07-23, 웹 공개 소스). 미확인 항목은 사실로 옮기지 않음. 핵심 근거·URL:

- 원신 공월의 축복(로그인=자동 수령·미로그인 소멸·180일 스택 상한): genshin-impact.fandom.com/wiki/Blessing_of_the_Welkin_Moon · 호요 지원 "미로그인 시 원석 처리"(support.hoyoverse.com/hc/en-us/articles/52089442214809).
- **호요 환불 후 음수 잔액 정책(→ 권고 A 지지)**: support.hoyoverse.com/hc/en-us/articles/50333906875417 · 환불 페널티 타임라인 news.bittopup.com/news/genshin-impact-refund-guide-1-4-week-penalty-timeline.
- 스타레일 Express Supply Pass(로그인 시 우편 발송·소비성 비갱신): honkai-star-rail.fandom.com/wiki/Express_Supply_Pass.
- 소비성 vs 구독 유형(Google Play): support.google.com/googleplay/android-developer/answer/14590082 · developer.android.com/google/play/billing/lifecycle/subscriptions.
- 리텐션·완화(소급 수령이 매일접속 동기 깎음): maf.ad/en/blog/daily-login-rewards-engagement-retention · gamerefinery.com 구독 설계.
- 한국 표준약관·청약철회: korea.kr/briefing/policyBriefingView.do?newsId=156617123.

---

## 11. 확정표 (독립 리뷰 판정 채택 — 사용자 최종 확인 대기) · 잔여 미결

> 리뷰가 Q1·Q3·Q5·Q6을 판정 확정. **잔여 미결은 Q4(법률 자문)뿐.** 확정분은 사용자 최종 "확인"만 대기(설계 방향은 락).

| Q | 주제 | 확정(리뷰 판정) | 근거·조건 |
|---|---|---|---|
| **Q1** | 패스 중첩 | **큐잉**(깊이 1·초과 ops 알림) | 큐 start 체인 파생/환불 재계산(공백 방지)·UI.1 4번째 상태 §2.2 |
| **Q2** | 패스 상태 API | **`getWallet` 확장** | claim 자동트리거와 합류점 동일·왕복 0. 1+1 가용은 캐시 신선도 메모 §2.4 |
| **Q3** | 패스 환불 수령분 | **(A) 전액 회수** | 호요 선례+48h 산수. **B1·B2 선행 필수**. 제재 없이 회수만(관대) §4.3 |
| **Q4** | 기간제 환불 컴플라이언스 | **미결(유일)** | 법률 자문 영역 — 부분사용분 환불 산정 + **day-0 즉시지급이 '사용 개시' 판단에 미치는 영향** §8 |
| **Q5** | 미수령 처리 | **(B) 유예 G=3일** | 무푸시·관전형 기둥과 정합(당일 소멸=기둥 충돌). B3 정의 전제 §2.3.1 |
| **Q6** | 일일 리셋 시각 | **KST 04:00** | 게임 관행·자정 넘겨 플레이 보호. 상수 `PASS_RESET_HOUR_KST` 단일 출처 §2.1 |

- **R8 후보(관측 플래그)**: 환불 이력 유저에 **관측 플래그(차단 아님)** — 반복 환불·환불후 재구매 패턴을 ops가 볼 수 있게. `docs/BACKEND_SYSTEM.md §13.19`(어뷰징 방어) **등재 후보**로 기재(구현 단계 결정). 유저 관대 원칙상 자동 제재 아님·관측만.

---

## 판단 보고 (스펙과 다르게 정한 지점)

1. **환불 reason 문자열 재사용** — 코디네이터 예시 `refund_iap`/`refund_iap_bonus` 대신 **기존 `reason='refund'` 재사용 + 멱등키/ref로 종류 구분**. 근거 §4.4(음수허용·매출제외·보관·음수UX가 전부 `reason==='refund'`에 걸려 있어 병렬 reason 신설은 다중 호출부 동시 수정·누락 사고 위험). 의도(회수 2건 분리)는 멱등키로 동일 충족.
2. **패스 = RC customerInfo 엔타이틀먼트 아님** — 소비성 SKU + 우리 `attendance_passes` 테이블 진실로 명시(재구매 가능성·28일 창 때문). 스펙의 "pass 엔타이틀먼트 생성"을 우리 DB 엔타이틀먼트로 구체화.
3. **패스 중첩 서버 엣지 = 큐잉 확정(Q1)** — 스펙 "중첩 불가(버튼 비활성)"는 클라 1차 방어로 충족하되, 돈을 이미 받은 서버 엣지엔 거부가 부당해 **큐잉**(깊이 1·start 체인 파생·초과 ops 알림). 강제 락 위반 아님(정상 흐름 중첩은 여전히 불가).
4. **BACKEND §13.12 camp 드리프트 정정(별도 발견)** — §13.12 P0-2의 `camp=−300`이 실제 `econ.CAMP_COST=200`(2026-07-17 인하)과 어긋난 잔존 드리프트 → 취소선 정정(−300 → −200).
