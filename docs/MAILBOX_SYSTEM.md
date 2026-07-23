# 우편함(메일박스) 시스템 (MAILBOX_SYSTEM)

> **신설 2026-07-23** (사용자 확정: "우편함으로 보상 받을 수 있게 + 관리자 화면에서 우편함으로 바로 다이아 지급").
> **상태: 설계 문서 단계 · 코드 미착수**(문서 먼저 — 표준 작업 순서 2단계). 이 문서가 우편함의 정본.
>
> **정합 정본(이 문서가 종속·정합해야 할 상위)**
> - `docs/BACKEND_SYSTEM.md` §13.12(다이아 서버 진실·earn/spend·멱등·금액권위·reason 화이트리스트)·§13.13(공지 in-app — 유사 전달 인프라)·§13.14(쿠폰 — 지급 멱등·단일 트랜잭션 패턴)·§13.15(관리자 콘솔 ops-9f3a2c·requireAdmin fail-closed)·§13.17(음수 balance 부채상환·admin grant source='admin')·§13.19(어뷰징 방어).
> - `docs/DIAMOND_PASS_SYSTEM.md`(구 ATTENDANCE_PASS) §2.4(admin 패스 `grantPassTx(tx,…,{rejectOnQueueFull})`·`store_txn_id` 합성키)·§2.2(Q1 큐잉)·§2.3(**다이아 패스 일일 지급 = 우편함 스케줄러 발송** sender `system:pass`)·§4.3.2(환불 시 미수령 우편 recall). **패스 첨부 수령·일일 패스 우편은 이 문서 인프라 재사용**.
> - `docs/DEVNOTES_SYSTEM.md` §3.3(안읽음 배지 — 로컬 읽음 처리 패턴, 여기선 서버 판정으로 변형).
> - 컴플라이언스: 유저 레벨 스킬 `payment-security-compliance`.
>
> **한 줄 구조(외우고 시작)**: 우편함은 **서버 재화·전달 레이어**다. 시드/리플레이/세이브 **무접촉**. 우편 자체(`mails`)와 수령 원장(`wallet_ledger reason='mail'`)이 서버 진실. 패스 첨부는 `attendance_passes`(패스 시스템 진실)로 위임. 클라 잔액·미확인 수는 **표시 캐시**.

---

## 0. 확정 기획 (사용자 락 2026-07-23 — 바꾸지 말 것)

| 항목 | 결정 | 비고 |
|---|---|---|
| 용도 | **운영 보상·개별 지급(CS)·이벤트 채널** | 공지/쿠폰/패스와 역할 분리(§1) |
| 진입 | **마이페이지 허브 "우편함" 카드** | 기존 기록/업적/설정 카드와 같은 스타일(1차 추가) |
| 미확인 배지 | **빨간 점 — ①마이페이지 탭 아이콘 ②마이페이지 내 우편함 카드** | 미확인 수 = **서버 판정**(bootstrap/지갑 동기화 응답 편입, 별도 폴링 금지) |
| 상태 필터 | **전체 / 받음 / 안받음** 3탭, **서버 재조회**(status 쿼리 파라미터) | 기본 탭 = ~~받음~~ → **안받음**(사용자 정정 2026-07-23 — 열자마자 수령할 우편이 보이는 통상 UX. 확정값) |
| 보존 기간 | **30일**(`MAIL_RETENTION_DAYS=30`) | 발송 후 30일 경과 = 만료(수령 불가) |
| 첨부 타입 | **다이아(amount) · 다이아 패스(28일 1개)** | 확장 가능 스키마(type+payload). 패스=`grantPassTx(source='admin')` 재사용 |
| 관리자 발송 | ops-9f3a2c "우편" 탭 — 유저 검색 → 제목/본문/첨부 입력 → 발송 | 금액 상한 캡·감사·발송 이력·미수령 회수 |
| 발송 단위 | **개별 우편이 1차** · 전체 우편(브로드캐스트)은 후속 Phase | §9 |

> 위 수치·대상은 확정이다. 아래 설계는 이 락을 구현하는 방법(멱등·만료·타임존·배지·큐잉)을 정하며, 그 부분에서만 판단 여지가 있다(각 지점에 근거·미결 Q 표시).

---

## 1. 용도 구분 — 4채널 역할 분리 (겹침 없음)

우편함은 기존 3채널과 **역할이 겹치지 않는다**. 신규 채널을 만드는 이유가 여기 있다.

| 채널 | 방향 | 재화 지급? | 개별 타겟? | 능동성 | 정본 |
|---|---|---|---|---|---|
| **우편함(신규)** | 서버 → 유저 | ✅ (다이아·패스) | ✅ 개별 지급 가능 | 유저가 "받기" | 이 문서 |
| 공지사항 | 서버 → 유저 | ❌ 읽기 전용 안내 | ❌ 전체 | 부팅 모달 + 재열람 | §13.13 |
| 쿠폰 | 유저 → 서버 | ✅ (다이아) | ✅ 개인 쿠폰 | 유저가 **코드 입력** | §13.14 |
| 다이아 패스(구 출석 패스) | 서버 → 유저 | ✅ (다이아) | ❌ 구매자 | **일일 지급 = 우편함 스케줄러 발송** → 우편함에서 수령 | DIAMOND_PASS §2.3 |

- **우편함 vs 공지**: 공지는 재화가 없는 순수 안내(읽고 끝). 우편함은 **보상이 붙는다**(받기 액션 = 재화 이동).
- **우편함 vs 쿠폰**: 쿠폰은 유저가 코드를 알아야 능동 입력(외부 배포 채널·마케팅). 우편함은 **관리자가 특정 유저에게 직접 꽂는다**(코드 불필요 — CS 보상·개별 지급). "관리자 화면에서 우편함으로 바로 다이아 지급"이 이 채널의 핵심 용도.
- **우편함 vs 다이아 패스(관계 갱신 2026-07-23)**: 패스는 정해진 유료 상품(28일·매일 100). **일일 지급이 이제 우편함을 배달 채널로 쓴다** — 스케줄러가 매일 `pass_daily` 우편(sender `system:pass`)을 우편함에 발송, 유저는 일반 우편과 같은 화면에서 수령. 즉 우편함은 **전달 인프라**, 패스는 **상품**(구매·큐잉·환불은 패스 시스템 소유). 역할 겹침 아님(우편함이 채널을 제공, 패스가 콘텐츠를 채움). 첨부로 **패스 상품 자체**를 우편에 실을 수도 있으나(§8, 관리자 보상용) — 그건 "패스를 우편으로 배달"이라 또 다른 층.
- **왜 §13.17 P2-b 수동 지갑 조정(admin grant)으로 안 하고 우편함인가**: admin grant는 **관리자가 즉시 유저 잔액에 꽂는다**(유저 인지 0 — 소리 없이 늘어남). 우편함은 **유저가 받기를 눌러 수령**한다 → ①유저에게 "무엇을 왜 받았는지"(제목·본문) 전달 ②수령 이력·미수령 상태 ③유저 동의된 재화 유입(청약·환불 맥락에서 깔끔). 즉 **소리 없는 조정(admin grant)**과 **설명 붙은 보상(우편)**은 다른 도구. 둘 다 유지한다.

---

## 2. 설계 원칙 (이 문서가 지키는 것)

1. **재화는 서버 진실**([[server-authoritative-currency]] · §13.12) — 우편 수령은 **서버 확정 후에만** 반영. 클라 잔액·미확인 수는 표시 캐시. **낙관적 반영 금지**(수령 성공 응답 후 `syncWallet()`로만 갱신).
2. **멱등·append-only 원장** — 다이아 수령은 `wallet_ledger` 불변 엔트리 + 자연 멱등키(`mail:<mailId>`). `balance == Σledger` 불변식(§13.4). 패스 첨부는 `attendance_passes` 행 생성(패스 시스템 진실).
3. **결정론 격리** — 시드·리플레이·세이브 **무접근**. 우편 다이아는 이미 P2W 재화(§11 전지훈련)로 편입된 다이아의 **획득 경로 추가**일 뿐 엔진 파급 0.
4. **관전형·무푸시 유지** — 우편 도착은 **푸시 없음**. 빨간 점 배지로만 조용히 알린다(공지·DEVNOTES 배지와 동결). 강제 관람·nag 없음. 수령은 유저가 접속해 "받기"를 누르는 opt-in.
5. **RC 게이트웨이 불변** — 우편은 무상 지급(결제 아님). `reason='mail'`은 매출·payer·전환 집계에서 **제외**(§10 R2 함정 예방).
6. **fail-closed 관리자** — 발송은 `requireAdmin`(§13.15 P0-B) 통과만. env 누락·짧은 토큰=전면 거부. 금액 상한 캡·감사행 필수.

---

## 3. 스키마 (Drizzle — Expand-only)

> [[prod-schema-migration-caution]] — Expand-only. `drizzle-kit generate` + `migrate`(운영은 :5432 직결). 모든 테이블 `proj_code` FK(§13.2 멀티게임 격리).

### 3.1 `mails` (개별 우편 — 1차)

```
mails (
  id            uuid PK default random
  proj_code     text FK → proj_info        -- 게임 격리
  user_id       uuid FK → users            -- 대상 유저(개별 지급)
  idem_key      text NOT NULL              -- 발송 멱등(R1) — admin UI 폼-오픈 시 클라 UUID 1회 생성
  title         text NOT NULL
  body          text NOT NULL
  attach_type   text NOT NULL default 'diamonds'  -- 'diamonds' | 'pass' (앱·admin에서 검증, DB는 text)
  attach_amount integer                     -- diamonds: 지급량(>0, 캡 이내) · pass: null(고정 28일 1개)
  sender        text NOT NULL default 'admin'     -- 'admin'(관리자 발송) | 'system'(자동) | 'system:pass'(다이아 패스 일일 스케줄러, DIAMOND_PASS §2.3)
                                                    --   sender='system:pass' 우편은 첨부 diamonds 100 고정·reason 'pass_daily'(claim 시)·관리자 회수 대상 아님(환불 recall만, §4)
  expires_at    timestamptz NOT NULL        -- diamonds=created_at+30(RETENTION) · pass=created_at+60(PASS_EXPIRE, R3). 이후 수령 불가
  read_at       timestamptz                 -- 유저가 우편함 화면에서 확인한 시각(배지 소등, §6.3)
  claimed_at    timestamptz                 -- 수령(받기) 시각. null=미수령
  recalled_at   timestamptz                 -- 관리자 회수(R2 소프트마킹). set=목록·카운트 제외, 물리삭제는 purge 크론
  created_at    timestamptz NOT NULL default now
)
UNIQUE(proj_code, idem_key)                 -- 발송 멱등 하드가드(R1, 더블클릭 이중발송 봉인)
index(proj_code, user_id)                   -- 목록/미확인 카운트 조회
index(proj_code, user_id, claimed_at)       -- 상태 필터(받음/안받음)
```

- **`attach_type`+`attach_amount` = 확장 가능 첨부**: 지금은 diamonds·pass 2종. 향후 아이템·재화 확장 시 `attach_type` 추가값 + payload 컬럼(jsonb) 예약. 현재는 amount 단일 필드로 충분(diamonds=amount·pass=null).
- **패스 첨부는 `attendance_passes.store_txn_id='mail:<mailId>'`로 지급 멱등**(§4 B3) — `mails`에 별도 지급 플래그 불필요(패스 테이블 UNIQUE가 하드가드).
- **`read_at` ≠ `claimed_at` 분리(핵심)**: 배지 소등은 read(확인), 재화 유입은 claim(수령). 둘을 나눠 "봤지만 아직 안 받은 우편"을 표현(§6.3 배지 정책 근거). `recalled_at`은 셋과 독립(관리자 회수).
- **감사**: `mails` 행 자체가 발송 감사(누가=sender·언제=created_at·누구=user_id·무엇=attach_type/amount·왜=title/body). 수령 감사는 `wallet_ledger`(reason='mail', ref=`mail:<mailId>` — S2 고정) + `purchase_event` 관측행(R2). append-only 테이블들이 감사 추적을 완성.

### 3.2 `mail_broadcasts` + `mail_broadcast_receipts` (전체 우편 — 후속 Phase §9)

```
mail_broadcasts (
  id            uuid PK
  proj_code     text FK
  idem_key      text NOT NULL              -- 발송 멱등(R1·§9) — ★정정(2026-07-23 구현): §3.2 초안이 누락, §9는 "개별과 동일 idem_key UNIQUE 멱등" 명시 → 스키마에 편입(개별 mails와 대칭)
  title, body   text NOT NULL
  attach_type   text NOT NULL default 'diamonds'
  attach_amount integer
  sender        text NOT NULL default 'admin'
  expires_at    timestamptz NOT NULL        -- created_at + 30일
  created_at    timestamptz NOT NULL default now   -- ★ audience cutoff(§9): 이 시점 이전 가입자만 대상
)
UNIQUE(proj_code, idem_key)                  -- 발송 멱등 하드가드(개별 mails와 동형·R1)
mail_broadcast_receipts (                    -- 유저별 상태(공지 읽음추적·쿠폰 redemption과 동형)
  id            uuid PK
  proj_code     text FK
  broadcast_id  uuid FK → mail_broadcasts
  user_id       uuid FK → users
  read_at       timestamptz
  claimed_at    timestamptz
  UNIQUE(proj_code, broadcast_id, user_id)   -- 유저당 1행(lazy 생성) = 이중수령 하드가드
)
```

- **lazy per-user 행**: 브로드캐스트는 유저 N명치 행을 미리 만들지 않는다. 유저가 처음 확인/수령할 때 `mail_broadcast_receipts` 1행 생성(공지 bootstrap·쿠폰 redemption 패턴 재사용). 본문·첨부는 `mail_broadcasts`에 1벌만.
- **개별과 같은 화면 합성 표시**: 우편함 목록은 `mails`(개별) + `mail_broadcasts`(대상·미만료) LEFT JOIN `receipts`를 **합쳐** 최신순 정렬(§6.1). 클라는 개별/전체를 구분 없이 한 리스트로 본다.

### 3.3 econ 상수 (`server/lib/econ.ts` 단일 출처)

```
MAIL_RETENTION_DAYS      = 30   // 다이아 우편 보존(발송 후 만료까지). expires_at = created_at + 30일
MAIL_PASS_EXPIRE_DAYS    = 60   // 패스 첨부 우편 보존(R3 상향). 이유: 패스 수령→최대 56일 큐 점유(활성28+예약28) > 30일 보존이면
                                //   "받아둔 우편이 큐 대기 중 만료" 모순 창 → 60일로 해소. admin 발송 폼 pass 선택 시 기본 60(조정 가능)
MAIL_MAX_GRANT           = 10000 // 우편 1통당 다이아 상한 캡(관리자 오발송 blast-radius 바운드)
MAIL_PURGE_GRACE_DAYS    = 30   // 만료·회수 후 크론 물리삭제 유예(Q1 확정). 만료+30일 경과분만 삭제(원장은 보존, 우편 메타만)
// reason 'mail'은 서버 권위 금액이 mails.attach_amount(발송 시 캡 검증) — earnAmount() 화이트리스트 밖(전용 라우트)
// 만료·회수 청소는 server/lib/retention.ts에 편입 + 기존 삭제 스케줄러 크론(§13.10) 재사용 — 신 크론 미신설
```

---

## 4. 원장 · 멱등키 요약

| 사건 | reason | 멱등키 | delta | ref |
|---|---|---|---|---|
| 개별 우편 다이아 수령 | `mail` | `mail:<mailId>` | +amount | **`mail:<mailId>`**(S2 — title 폐기) |
| 전체 우편 다이아 수령 | `mail` | `mail_bc:<broadcastId>:<userId>` | +amount | `mail_bc:<bcId>:<userId>` |
| **다이아 패스 일일 우편 수령**(sender `system:pass`) | **`pass_daily`** | `pass_daily:<userId>:<passId>:<dayIndex>` | +100 | `mail:<mailId>`(그 슬롯 우편) |
| 개별 우편 패스 수령 | (원장 미기록 — `attendance_passes` 행 생성) | `attendance_passes.store_txn_id = 'mail:<mailId>'` UNIQUE + `mails.claimed_at` 가드 | — | (day-0 원장 ref=`mail:<mailId>`) |
| 전체 우편 패스 수령 | (원장 미기록) | `attendance_passes.store_txn_id = 'mail_bc:<bcId>:<userId>'` UNIQUE + `receipts.claimed_at` 가드 | — | — |

- **ref = 멱등키 고정(S2, 소견 채택)**: 다이아 수령 원장 `ref`는 ~~title(가변·PII 성)~~ → **`mail:<mailId>` 고정**. title은 우편 행에 이미 있어 원장 ref로 중복 저장·유출할 이유 없음. 역추적은 mailId로 `mails` JOIN.
- **패스 첨부 멱등 = `store_txn_id` 합성키(B3, 블로커 — ref 유령 필드 제거)**: `attendance_passes`에 **`ref` 컬럼이 없다**(DIAMOND_PASS §2.4의 "admin ref" 문구는 유령 — 그 문서도 취소선 정정). 신규 컬럼을 만들지 않고 **`store_txn_id`에 합성키 `mail:<mailId>`(브로드캐스트는 `mail_bc:<bcId>:<userId>`)를 저장**한다 → 기존 `UNIQUE(proj_code, store_txn_id)`가 **공짜 이중생성 하드가드**(같은 우편 재수령이 패스 2개 생성 못 함) + **역추적 복원**(store_txn_id에서 어느 우편인지) + **RC 웹훅 무충돌**(RC는 실제 스토어 txn_id만 매칭 — `mail:`·`mail_bc:` 접두 합성키는 절대 안 닿음). day-0 slot 지급 원장 ref도 자연히 `mail:<mailId>`.
- **★ 다이아 패스 일일 우편의 reason = `pass_daily`(≠ `mail`, 중요)**: sender `system:pass` 우편의 첨부 지급은 원장 reason **`pass_daily`**(패스 슬롯 귀속·클로백 Σ 추적, DIAMOND_PASS §2.5)이지 일반 우편 `mail`이 **아니다**. 같은 우편함 claim UX를 쓰지만 **claim 라우트가 우편의 `sender`를 보고 reason·멱등키를 분기**: `system:pass` → `pass_daily`(키 `pass_daily:<userId>:<passId>:<dayIndex>`, 금액 `PASS_DAILY_REWARD` 서버 권위), `admin`/`system` → `mail`(키 `mail:<mailId>`, 금액 `attach_amount`). passId·dayIndex는 발송 시 우편 메타(idem_key `pass_daily:<passId>:<dayIndex>`)에서 파생.
- **★ 다이아 패스 환불 시 미수령 우편 recall(§DIAMOND §4.3.2 상호 링크)**: 패스 환불 클로백은 **수령된 `pass_daily`를 −Σ 회수**(passId 멱등키 프리픽스 앵커)하고, 동시에 **그 패스가 발송한 미수령 `system:pass` 우편을 `recalled_at` 마킹**(안 하면 환불 후에도 우편함에서 잔여 슬롯 계속 수령 = 구멍). recall 대상 = `mails WHERE idem_key LIKE 'pass_daily:<passId>:%' AND claimed_at IS NULL`. MAILBOX 목록·카운트는 `recalled_at IS NULL` 필터라 즉시 사라짐(§5.2). purge 크론이 유예 후 물리삭제.
- **`mail:<mailId>`에 userId를 안 넣는 이유**: `mailId`는 유저 귀속 PK(UUID)라 이미 전역 유일 → 교차유저 충돌 없음. 반면 `mail_bc:<broadcastId>:<userId>`는 broadcastId가 **전유저 공유**라 반드시 userId를 박아 유일화(achId·dayIndex 키와 같은 논리 §13.12).
- **음수 잔액에서도 수령 가능(부채 상쇄)**: `mail`은 적립(delta>0)이라 §13.17 P0-1 정정으로 **잔액이 음수여도 항상 통과**(환불된 유저가 우편 보상으로 빚 갚기 가능). 회수(refund, delta<0)와 방향이 다르다.
- **매출·payer 집계 무영향**: 매출/전환/결제자 롤업은 `reason='purchase'`(+패스는 §13.18 매출KRW) 기준. `reason='mail'`·`reason='pass_daily'`는 결제가 아니므로 **자동 제외**(추가 돈 아님 = 정확). DIAMOND_PASS R2와 **동형 함정** — `_dv_mail_live`가 "mail 지급 후 매출·payer 불변" 대조로 봉인(§12).

---

## 5. API

### 5.1 유저 라우트 (Bearer → userId, 익명 폴백 금지 §13.17 P0-5)

> **R5 — 아래 모든 쿼리는 `proj_code = PROJ_CODE` 스코프 필수**(§13.2 멀티게임 격리). 스니펫이 간결화로 생략해도 실 WHERE에는 항상 포함(공지 DELETE F1 스코프 누락 재발 방지).

- **`GET /api/mail?status=all|claimed|unclaimed&cursor=`**(requireUserId, null이면 401) — 우편함 목록.
  - **서버 재조회 필터**(클라 로컬 필터 아님): `status=all`(만료·회수 제외 전체·만료분은 §11 Q2 정책), `claimed`(수령됨), `unclaimed`(미수령·미만료). 회수분(`recalled_at`) 전 상태 제외. 페이지네이션(cursor 또는 offset·페이지 크기 예 30).
  - `WHERE proj_code=? AND user_id=? [AND …status]`(R5). 개별(`mails`) + 대상 브로드캐스트(§9) 합성. 각 항목: `{ id, kind:'mail'|'bc', title, body, attachType, attachAmount, claimedAt, readAt, expiresAt, createdAt }`.
- **`POST /api/mail/claim {id, kind}`**(requireUserId) — **단일 트랜잭션**(쿠폰 §13.14 P0-A 패턴):
  1. 대상 우편 조회(`WHERE proj_code=? AND id=? AND user_id=?` — 소유권, 브로드캐스트는 대상자격 §9). 없으면 `{ok:false, reason:'not-found'}`.
  2. **만료 판정 = DB `now()`**(클라 시계 불신, 쿠폰 C4 동일): `now() > expires_at`이면 `{ok:false, reason:'expired'}`.
  3. **수령 가드(멱등)**: `UPDATE mails SET claimed_at=now() WHERE proj_code=? AND id=? AND claimed_at IS NULL RETURNING`(브로드캐스트는 `receipts` onConflict/rowcount) — rowcount 0이면 이미 수령 → `{ok:true, applied:false}`(dedup, 이중수령 0).
  4. **첨부 지급**(같은 트랜잭션 tx — 원자성 필수):
     - `attach_type='diamonds'`: `applyWalletTx(tx, userId, +amount, 'mail', key='mail:<mailId>', ref='mail:<mailId>')`(S2 — ref=멱등키 고정).
     - `attach_type='pass'`: **`grantPassTx(tx, userId, storeTxnId='mail:<mailId>', today, source='admin', { rejectOnQueueFull: true })`** — B1·B2·B3 반영(아래).
  5. 성공 → `{ok:true, applied:true, balance:<현재잔액>}`(다이아) 또는 `{ok:true, applied:true, pass:<상태>}`(패스). 클라는 응답 후 `syncWallet()`.
- **`POST /api/mail/read`**(requireUserId) — 우편함 **화면 진입 시** 현재 미확인 우편 일괄 읽음: `UPDATE mails SET read_at=now() WHERE proj_code=? AND user_id=? AND read_at IS NULL`(+브로드캐스트 receipts upsert). 배지 소등(§6.3). typed `{ok, unreadMailCount:0, unclaimedMailCount:<n>}`(R4).

#### ★ 패스 첨부 원자성 3블로커 (B1·B2·B3 — grantPass 재사용 가정 수정)

- **B1 — `grantPassTx(tx, …)` 추출(자체 트랜잭션 → 주입 tx)**: 실 `grantPass`는 **tx 인자가 없고 내부에서 자체 트랜잭션을 연다**. 그대로 우편 claim에서 부르면 패스 지급이 **독립 커밋**돼 "우편 claim과 같은 트랜잭션" 원자성이 깨진다 — 바깥 롤백 시 **패스는 지급됐는데 우편은 미수령**(claimed_at NULL)으로 남아 **재클레임 이중 지급**. → `pass.ts` 본문을 **`grantPassTx(tx, userId, storeTxnId, today, source, opts)`** 로 추출하고 기존 `grantPass`는 이를 감싸는 얇은 래퍼(웹훅/confirm 호출부 무변경, coupon.ts `applyWalletTx`/`applyWallet` 추출과 동형). 우편 claim은 **①`UPDATE mails … claimed_at IS NULL`(rowcount 가드) ②`grantPassTx`** 를 **한 tx**에 합성. **`purchasedAt`은 우편 경로에서 서버 `new Date()`**(RC 이벤트 시각 없음 — 월귀속·리셋보정 기준).
- **B2 — `rejectOnQueueFull` 옵션(구매 false / 우편 true)**: 실 `grantPass`는 큐 만석 시 **거부가 아니라 queued-overflow로 삽입**(구매=돈 이미 받음 → 유령화 부당, 의도된 동작). 우편은 **반대**여야 한다(무상 지급이라 롤백·재수령 가능이 옳음). → `opts.rejectOnQueueFull: boolean`. 구매 경로=`false`(현행 큐 오버플로 유지), 우편 경로=`true`. **판정 위치 = `grantPassTx` 내부에서 대상 유저 행 `FOR UPDATE` 잠금 이후**(외부 사전 카운트는 멀티기기 동시 수령 레이스 — 잠금 안에서 활성+예약 수를 세야 정확). 만석+`rejectOnQueueFull`이면 **트랜잭션 throw/롤백 → claim 라우트가 `{ok:false, reason:'pass-queue-full'}`** 반환, `claimed_at` 미설정(재수령 가능).
- **B3 — `store_txn_id` 합성키(신규 ref 컬럼 대신)**: §4 참조 — `storeTxnId='mail:<mailId>'`를 그대로 `attendance_passes.store_txn_id`에 저장. `UNIQUE(proj, store_txn_id)`가 이중생성 하드가드·역추적·RC 무충돌을 공짜로 준다.

> **`mail` reason은 범용 `/earn` 화이트리스트(`{ad,achievement,welcome}`)에 넣지 않는다** — 전용 claim 라우트가 우편 소유·만료·캡을 검증. `/earn`으로 클라가 `mail` 사칭 불가(fail-closed 유지 §13.12). `lib/wallet.ts WalletReason`에 `'mail'` 추가(적립 계열, `allowsNegativeBalance` 무관 — 적립은 항상 통과).

### 5.2 미확인 수 = 지갑 동기화 응답 편입 (별도 폴링 금지)

- **`getWallet(userId)` 확장 — `unreadMailCount` + `unclaimedMailCount` 동반(R4)** — 응답에 두 카운트 편입(패스 상태 편입 Q2와 동일 근거: syncWallet 합류점 재사용, 별 라운드트립 0). 둘 다 `WHERE proj_code=? AND user_id=?` 스코프(R5).
  - **`unreadMailCount`**(빨간 점 데이터 소스, §6.3): 미확인·미만료·미회수 우편 수 = 개별 `read_at IS NULL AND now()≤expires_at AND recalled_at IS NULL` + 대상 브로드캐스트 중 receipt 없거나 read_at NULL·미만료.
  - **`unclaimedMailCount`**(우편함 카드 "받을 우편 N건" 텍스트 데이터 소스, §6.3): 미수령·미만료·미회수 우편 수(`claimed_at IS NULL AND now()≤expires_at AND recalled_at IS NULL`). 빨간 점(미확인)과 카드 텍스트(미수령)가 **서로 다른 데이터**라 둘 다 서버가 내려줘야 신호 분리가 성립.
- **왜 `getWallet`이고 `/api/bootstrap` 아닌가**: 두 카운트 모두 **per-user**라 인증 필요. `getWallet`은 이미 `requireUserId` + syncWallet 진입점(마이페이지·포그라운드 복귀·로그인 직후 호출). `bootstrap`은 무인증이라 부적합. 별도 `/api/mail/count` 폴링 라우트 만들지 않음.
- **오프라인**: 마지막 캐시 카운트 표시(잔액 캐시와 동일 정책). 수령 버튼 비활성.

### 5.3 관리자 라우트 (전부 requireAdmin — fail-closed §13.15 P0-B)

- **`POST /api/admin/mail`** {userId, title, body, attachType, attachAmount?, expiresInDays?, **idemKey**} → 개별 우편 발송.
  - 검증: userId 존재(없으면 400 `no-such-user`, 쿠폰 C3 패턴)·소프트삭제 계정 거부·title/body 비어있지 않음·`attachType∈{diamonds,pass}`·diamonds면 `0<amount≤MAIL_MAX_GRANT`(초과 400 `over-cap`).
  - **R1 — 발송 멱등(더블클릭 이중발송 봉인)**: `mails`에 **`idem_key` 컬럼 + `UNIQUE(proj_code, idem_key)`**. **관리자 UI가 폼 열 때 클라 UUID를 1회 생성**(§13.17 P0-2 refund 멱등키 패턴 — 서버 생성 시 더블클릭=이중발송). INSERT `onConflictDoNothing`, 충돌이면 기존 mailId 반환(`{ok:true, deduped:true}`). 서버 생성 금지.
  - `expires_at = now() + (expiresInDays ?? (attachType==='pass' ? MAIL_PASS_EXPIRE_DAYS : MAIL_RETENTION_DAYS))`(R3 — 패스 기본 상향, §3.3). 발송=INSERT 1행(감사 완비). 응답 `{ok, mailId}`.
- **`GET /api/admin/mail?userId=&status=`** — 발송 이력 목록(수령 여부·읽음·만료·**회수** 표시). 사용자별 필터. **관리자 발송분(sender IN `admin`,`system`)만** — `system:pass`(다이아 패스 일일 스케줄러) 우편은 관리자 발송 이력이 아니라 제외(패스 현황은 DIAMOND_PASS 스탬프에서).
- **`DELETE /api/admin/mail {id}` → 회수 = `recalled_at` 소프트마킹(R2, 물리삭제 아님)**: `UPDATE mails SET recalled_at=now() WHERE proj_code=? AND id=? AND claimed_at IS NULL AND recalled_at IS NULL AND sender <> 'system:pass' RETURNING` → 0건이면 `{ok:false, reason:'already-claimed'}`(수령분은 회수 불가 — 재화 이미 이동, 회수는 §13.17 admin refund 별도 도구). **`system:pass` 우편은 관리자 회수 대상 아님**(패스 일일분은 환불 클로백의 recall만 건드림 — §4). **물리 삭제는 purge 크론이 유예 후 수행**(§13.3 MAIL_PURGE_GRACE — 회수 이력 감사 보존). 회수된 우편은 목록·카운트에서 제외(`recalled_at IS NULL` 필터, §5.2). 오발송 대응(§10).
- **관측행(R2 — money-path observability, backend-verify 기법 L)**: 발송·수령·회수를 `purchase_event`(§13.22)에 append(무상이지만 재화 이동 감사 대칭 — admin grant §13.17 P2-b 동형). 단계 태그: **`admin.mail.sent`**(발송)·**`mail.claim.applied`**(수령, diamondsDelta/balanceAfter 기록)·**`admin.mail.recalled`**(회수). source=`admin`(발송/회수)·`mail`(수령). **관찰 전용**(로깅 실패가 지급을 되돌리지 않음 — logPaymentEvent가 삼킴, §13.22).
- **감사**: 발송·수령·회수는 `mails` 행 상태(created_at·claimed_at·recalled_at) + `wallet_ledger`(수령) + `purchase_event`(관측) 3중. 별도 로그 테이블 불필요.

---

## 6. 앱 화면

### 6.1 우편함 화면 (`app/mailbox.tsx`)

- **상태 필터 3탭**: `전체 / 받음 / 안받음` — 탭 전환 시 **서버 재조회**(`GET /api/mail?status=`). **기본 선택 = "안받음"**(사용자 정정 2026-07-23, 확정 — ~~"받음" 기본은 취소~~). 열자마자 수령할 우편이 먼저 보이는 통상 UX(수령 유도).
- **목록 행**: 제목 + 첨부 뱃지(💎 N / 🎫 다이아 패스) + 등록일 + 상태(미수령=강조·수령됨=흐림·만료=회색 "만료됨"). 행 클릭 → 본문 펼침(또는 상세) + **"받기" 버튼**(미수령·미만료만 활성). 다이아 패스 일일 우편(sender `system:pass`)도 같은 목록에 최신순 합성(💎 100 뱃지).
- **빈 상태 카피(S5, 소견 채택)**: "안받음" 탭이 비면 **"받을 우편이 없어요 · 전체 탭에서 지난 우편을 확인하세요"**(단순 "없음"이 아니라 전체 탭으로 유도 — 기본 탭이 안받음이라 첫 진입 빈 화면 대비). "받음"·"전체" 탭 빈 상태는 "우편이 없어요".
- **"모두 받기"**: 미수령·미만료 우편을 순회 claim. 서버는 각 건 멱등이라 재시도 안전.
- **부분 실패 = 집계 토스트 1회(S7, 소견 채택)**: 다이아·패스 혼재에서 일부만 성공(예 패스 큐 만석 보류)해도 **건별 토스트 난사 금지** → **끝나고 한 번**: "3건 수령 · 1건은 패스 예약이 가득해 보류"(성공 수 + 보류 사유 집계). 관전형 비차단·nag 방지.
- **수령 성공**: 비차단 토스트("+N💎 받았습니다" / "다이아 패스를 받았습니다") + **서버 응답 후 잔액 갱신**(`syncWallet`). 모달 강제 금지(관전형 비차단 UI-30).
- **★ 우편량 증가 주기(2026-07-23)**: 다이아 패스 활성 유저는 **하루 1통**씩 우편이 쌓인다(28일간 최대 28통 + 일반 우편). → **목록 페이지네이션·"모두 받기"의 중요도 상승** — 며칠 미접속 후 진입 시 수 통이 쌓여 있어 "모두 받기" 한 번으로 밀린 슬롯을 몰아 수령하는 UX가 핵심(개별 받기만 있으면 마찰).
- **오프라인**: 목록 = 마지막 캐시 표시, "받기"·"모두 받기" **비활성 + "연결이 필요합니다"** 안내(§13.12 적립=온라인 원칙). UI-30 비차단.
- **결정론·세이브 무접촉**: 재화 표시 캐시만 갱신. 시드/리플레이 무관.

### 6.2 마이페이지 진입 (`app/(tabs)/mypage.tsx`)

- 마이페이지 허브에 **"우편함" `LinkCard`** 추가(기존 공지·업적·쿠폰 카드와 동일 스타일). 아이콘 예 `mail-outline`. `onPress → router.push('/mailbox')`.
- **sub 텍스트**: 평상시 "운영 보상·이벤트 우편을 확인하세요", **`unclaimedMailCount>0`이면 "받을 우편 N건"**(R4 데이터 소스, §6.3).
- 카드 우측에 **미확인 빨간 점**(`unreadMailCount>0`, §6.3).

### 6.3 빨간 점 배지 (2곳 — 서버 판정)

미확인 우편이 있으면 두 곳에 빨간 점을 띄운다(유저가 마이페이지에 안 들어가도 하단 탭에서 인지):

1. **마이페이지 탭 아이콘**(`app/(tabs)/_layout.tsx`) — `tabBarIcon`에 red dot 오버레이(또는 `tabBarBadge`를 점 스타일로). 값 = `unreadMailCount > 0`.
2. **마이페이지 내 우편함 카드** — `LinkCard`에 red dot.

- **미확인 수 = 서버 판정**(DEVNOTES §3.3 로컬 읽음추적과 **다른 점**): 우편은 서버 데이터라 로컬 추적이 아니라 **`unreadMailCount`(getWallet 편입, §5.2)** 를 쓴다. 비영속/영속 캐시 스토어(예 `useServerConfig` 또는 지갑 캐시)에 넣어 배지가 재조회 없이 읽음. **별도 폴링 금지** — 기존 syncWallet 합류점(마이페이지·포그라운드 복귀·로그인) 응답에 실려옴. 오프라인은 마지막 캐시.
- **배지 소등 기준 = 화면 진입 읽음(read_at)** — 확정(Q3, 2026-07-23)·근거:
  - **채택**: 우편함 **화면 진입 시** `POST /api/mail/read`로 현재 미확인분 일괄 read_at 처리 → `unreadMailCount=0` → 빨간 점 소등. **미수령 우편은 화면 안에 "받기" 버튼으로 잔존**(수령 유도는 화면 안에서). 근거: ①공지·DEVNOTES 배지와 **동결**(본 것 = 배지 off, 표준 관성) ②빨간 점의 의미 = "새 소식 있음"(awareness)이지 "미수령 있음"(action)이 아님 — 둘을 분리해야 배지가 정직 ③read/claim 분리 스키마(§3.1)가 이를 그대로 지원.
  - **미수령 이탈 방어**: 배지가 read로 꺼져 "받을 우편을 잊는" 위험 → 우편함 **카드 sub 텍스트에 "받을 우편 N건"**(빨간 점이 아닌 카운트 텍스트)로 별도 표기해 수령 유도. **데이터 소스 = `unclaimedMailCount`**(R4 — getWallet 동반 편입, §5.2). 빨간 점=`unreadMailCount`(미확인) / 카드 텍스트=`unclaimedMailCount`(미수령), 두 카운트가 서로 다른 데이터라 신호 분리가 성립.
  - **대안(미채택)**: 배지 = 미수령(claim) 기준 → 받을 때까지 빨간 점 유지(수령 압박↑). 관전형 nag 성격이 강하고 "확인했는데도 안 꺼지는 점" 피로라 기각.

---

## 7. 관리자 화면 (ops-9f3a2c "우편" 탭)

- **위치**: 사이드바 **운영 그룹**에 `✉ 우편`(문의/쿠폰/공지와 같은 그룹). `NAV`·`TITLES`에 `mail` 탭 추가(§13.15 IA).
- **발송 폼**:
  - **유저 검색**(기존 `/api/admin/users` 조회 재사용) → 대상 userId 선택.
  - 제목 · 본문 입력.
  - **첨부 종류 선택**: `다이아(수량 입력)` | `다이아 패스(28일 1개)`. 다이아면 수량 입력칸(상한 `MAIL_MAX_GRANT` 클라·서버 이중 검증), 패스면 수량칸 숨김. (일일 패스 우편 sender `system:pass`는 스케줄러 전용 — 관리자 수동 발송 폼엔 없음.)
  - **만료일 기본값 = 첨부 종류 연동(R3)**: 다이아 선택 시 **30일**, 패스 선택 시 **60일**(큐 점유 최대 56일 > 30일 보존 모순 창 해소, §3.3). 선택 조정 가능.
  - **발송 멱등(R1)**: 폼을 **열 때** 클라 UUID `idemKey` 1회 생성해 발송 body에 실음(더블클릭·재제출이 `UNIQUE(proj, idem_key)`로 dedup — 이중발송 봉인). 발송 성공/취소 후 새 폼은 새 UUID.
- **발송 이력 목록**: 시각·대상 유저·제목·첨부(💎N / 🎫패스)·상태(미수령/수령됨/읽음/만료/**회수됨**). 행 클릭 → 상세 모달(§13.15 리스트↔모달 분리 패턴). 미수령 우편은 모달에서 **회수** 버튼(`window.confirm`, 수령분은 회수 불가 → 실패 토스트). 회수 = `recalled_at` 소프트마킹(R2, 물리삭제 아님).
- **CRUD 피드백 일관화**(§13.15 2026-07-11): 발송/회수 성공=상단 토스트(`flash`)+모달 닫기+목록 새로고침, 실패=인라인 에러+모달 유지.
- **전체 우편 발송 폼**: 브로드캐스트(§9) — **후속 Phase**. 개별 발송 UI 하단에 "전체 발송" 별도 섹션으로 추가(Phase 분리 시 §9 착수 때).

---

## 8. 첨부 타입 — 다이아 · 다이아 패스(상품)

- **`attach_type='diamonds'`**: `attach_amount`💎를 `applyWalletTx(reason='mail')`로 지급(§4·§5.1). 서버 권위 금액 = `mails.attach_amount`(발송 시 `0<amount≤MAIL_MAX_GRANT` 검증). 클라 표시값 무시.
- **`attach_type='pass'`**: 28일 다이아 패스 1개를 **`grantPassTx(tx, userId, storeTxnId='mail:<mailId>', today, source='admin', { rejectOnQueueFull: true })`** 로 발급(§5.1 B1·B2·B3). (이건 **패스 상품 자체를 우편으로 배달** — 관리자 CS 보상용. 일일 100💎 슬롯 우편[§4 pass_daily]과 다른 층.) ~~`grantPass(…, ref=…, storeTxnId=null)`~~ 은 **불가** — ①tx 미주입이라 우편 claim과 원자성 안 됨(B1) ②큐 만석 동작이 우편과 반대(B2) ③`ref` 컬럼 부재(B3). 세 블로커 모두 grantPassTx 추출 + opts + store_txn_id 합성키로 해소.
  - **환불 무접촉**: `store_txn_id='mail:<mailId>'`(실 스토어 txn 아님)이라 RC 환불 웹훅(실 store_txn_id 매칭)이 **안 닿는다**. 우편 패스는 무상 지급이라 회수도 수동.
  - **큐잉 규칙(Q1) + 우편은 만석 거부**: 활성 패스 보유 중 우편 패스 수령 → 예약(active+queued, 깊이 1). **큐 만석이면(구매와 달리) claim 롤백·`pass-queue-full`**(rejectOnQueueFull:true, 판정은 grantPassTx 내부 user FOR UPDATE 이후 — 멀티기기 레이스 방지, B2). `claimed_at` 미설정 → 유저는 패스 만료 후 우편함에서 재수령.
  - **day-0 즉시 지급(우편 발송)**: `grantPassTx`가 패스 행 생성과 같은 tx에서 slot 0(첫날) **우편을 발송**(DIAMOND_PASS §2.1 B4)하므로, 관리자 우편으로 받은 패스도 그 즉시 1일차 슬롯 우편이 우편함에 도착.
  - **보존 창 = 60일**(R3): 패스 첨부 우편은 수령 후 최대 56일 큐 점유가 가능해 30일 보존이면 모순 → `MAIL_PASS_EXPIRE_DAYS=60`(§3.3).
- **확장 여지**: `attach_type`은 text라 향후 아이템·특수재화 추가 가능. payload가 복잡해지면 `attach_payload jsonb` 컬럼 예약(현재 amount 단일로 충분).

---

## 9. 전체 우편(브로드캐스트) — 후속 Phase

> 개별 우편(§3.1)이 1차. 브로드캐스트는 스키마·라우트가 더 무거워 **Phase 분리**(§13). 아래는 설계 확정, 구현은 개별 이후.

- **lazy 수령**(§3.2): `mail_broadcasts` 1행 + 유저별 `mail_broadcast_receipts` lazy 생성(첫 확인/수령 시). 멱등키 `mail_bc:<broadcastId>:<userId>`.
- **대상 cutoff(발송 시점 고정)**: 브로드캐스트 발송 후 **신규 가입자는 미대상**. 대상 자격 = `users.created_at ≤ mail_broadcasts.created_at`(유저가 발송 시점 이전에 존재). 목록/카운트 쿼리에서 이 조건으로 필터. 근거: 지난 이벤트 보상을 나중에 가입한 유저가 소급 받으면 부당·집계 왜곡. (반대로 "전 유저 상시 보상"이 필요하면 그건 개별 발송 스크립트 또는 쿠폰(전체용)으로.)
- **관리자 발송 폼**: 제목/본문/첨부/만료 → 전체 발송(대상 수 미리보기 = cutoff 이하 활성 유저 수). 발송도 개별과 동일 `idem_key` UNIQUE 멱등(R1). 브로드캐스트 회수 = 미수령분 소프트마킹(수령 receipt 있는 유저는 불변).
- **청소 FK 순서(R6)**: purge 크론은 **`mail_broadcast_receipts` 선삭제 → `mail_broadcasts` 후삭제**(FK 참조 순서 — 자식 먼저). 유예는 개별 우편과 동일(`MAIL_PURGE_GRACE_DAYS`). receipts를 남기고 broadcasts만 지우면 FK 위반·orphan.
- **패스 첨부 브로드캐스트 = 불가(확정 Q4)**: 전 유저 28일 패스 지급은 전 유저 큐잉 파급이 커 **브로드캐스트 첨부는 다이아만**(패스는 개별 우편 한정). 추후 필요 시 별도 결정. 브로드캐스트 발송 폼은 첨부 종류에 패스를 노출하지 않는다.

---

## 10. 엣지 · 보안 점검

| # | 엣지 | 처리 |
|---|---|---|
| E1 | **수령↔만료 경계 레이스** | 만료 판정 = **DB `now()`**(claim 트랜잭션 안, 클라·서버 JS 클럭 불신 — 쿠폰 C4). `now() > expires_at`이면 거부. claim과 만료 판정이 같은 트랜잭션·같은 클럭이라 경계에서 정합. |
| E2 | **이중 수령**(연타·멀티기기·재전송) | 다이아: `claimed_at IS NULL` 가드(rowcount 0=dedup) + `mail:<mailId>` 원장 멱등 3중. 패스: `claimed_at` 가드 + `attendance_passes.store_txn_id='mail:<mailId>'` UNIQUE(B3). `applied:false` 반환(이중지급/이중생성 0). |
| E2b | **패스 지급 원자성**(claim 롤백 후 패스만 잔존) | `grantPassTx(tx,…)`가 우편 claim과 **한 tx**(B1). 바깥 롤백 시 패스 삽입도 롤백 → "패스 지급됐는데 우편 미수령" 불가. ~~자체 트랜잭션 grantPass~~는 독립 커밋이라 금지. |
| E3 | **발송 대상 유저 소프트삭제** | 발송 시 삭제 계정 거부(400). 이미 발송된 우편은 삭제 계정이 `requireUserId`에서 막혀 수령 불가 → 잔여 우편 자연 소멸(패스 R6·§13.17 동형). |
| E4 | **패스 첨부 + 활성 패스 보유** | Q1 큐잉(active+queued 깊이1). **큐 만석 → `rejectOnQueueFull:true`라 claim 롤백·`pass-queue-full`·`claimed_at` 미설정(재수령 가능)** — 구매 경로(만석=queued-overflow 삽입)와 **반대**(B2). 판정은 grantPassTx 내부 FOR UPDATE 이후(멀티기기 레이스 방지). |
| E5 | **관리자 오발송** | 미수령 우편 회수 = `recalled_at` 소프트마킹(§5.3 R2, 물리삭제 아님·감사 보존). **수령분은 회수 불가**(재화 이동 완료 — §13.17 admin refund 별도). 캡(`MAIL_MAX_GRANT`)이 blast-radius 바운드. |
| E5b | **발송 더블클릭** | `UNIQUE(proj, idem_key)`(R1, 폼-오픈 UUID) — 재제출 dedup(`deduped:true`, 기존 mailId 반환). |
| E6 | **브로드캐스트 발송 후 신규 가입자** | cutoff = `created_at ≤ broadcast.created_at`(§9). 신규 가입자 미대상. |
| E7 | **클라 사칭**(`/earn`로 mail reason) | `mail`은 `/earn` 화이트리스트 밖 — 전용 claim 라우트만 지급. fail-closed(§13.12). |
| E8 | **금액 조작**(클라가 amount 부풀림) | 서버 권위 = `mails.attach_amount`(발송 시 캡 검증). claim은 mailId만 받고 금액은 서버 DB에서 읽음. |
| E9 | **매출·payer 오염** | `reason='mail'`은 purchase/revenue 집계 제외(§4). R2 함정 예방 — `_dv_mail_live` 대조. |
| E10 | **음수 잔액 유저 수령** | 적립(delta>0)이라 항상 통과(부채 상쇄 §13.17 P0-1). 회수와 방향 다름. |
| E11 | **만료 우편 청소** | **확정(Q2)**: 만료분은 목록에서 "만료됨" 표시(즉시 삭제 안 함, 유저 투명성) + **청소 크론이 만료 후 +30일 경과분 물리 삭제**(`retention.ts` 편입·기존 크론 인프라 재사용 — 원장은 보존, 우편 메타만). |

---

## 11. 결정 사항 (전건 확정 2026-07-23 — 사용자)

앞선 미결 4건 전부 확정. ~~미결 질문 섹션~~ → 확정표.

| # | 결정 | 확정값 | 반영 |
|---|---|---|---|
| Q1 상태 필터 기본 탭 | ~~받음~~ → **안받음**(사용자 번복) | 열자마자 수령할 우편이 보이는 통상 UX | §0·§6.1 |
| Q2 만료 우편 처리 | **표시 유지 + 유예 후 크론 물리 삭제**(권고 채택) | 만료 후에도 목록에 "만료" 표시로 잔존(유저 인지), **만료+30일** 경과분 크론 청소(기존 크론 인프라 재사용·retention 정책과 결). 원장은 보존, 우편 메타만 삭제 | §6.1·E11·§13.3 |
| Q3 빨간 점 소등 기준 | **화면 진입 읽음(read_at) 기준**(권고 채택) | 미수령 우편은 우편함 "안받음" 탭 + "받기" 버튼으로 유도(빨간 점=미확인 / 카드 텍스트=미수령, 신호 분리) | §6.3 |
| Q4 브로드캐스트 첨부 | **초기 다이아만**(권고 채택) | 패스 브로드캐스트는 전 유저 큐잉 파급이 커 **개별 우편 한정**. 추후 필요 시 별도 결정 | §9 |

### 11.1 소견 채택 (독립 리뷰 S-series, 2026-07-23)

- **S1 — syncWallet 쿼리 수 관측 등재**: `getWallet`에 우편 카운트 2종(unread·unclaimed)이 추가돼 syncWallet 왕복당 쿼리가 는다. 마이페이지·포그라운드 복귀마다 호출되므로 **쿼리 수를 서브쿼리/집계 1문으로 억제**(패스 상태 편입과 합산)하고 성능 관측 대상으로 등재(§12).
- **S3 — 원장 2년 보존 충분**: `reason='mail'`은 결제 아님 → 게임경제 원장 **2년 티어**(§13.9 쿠폰 'coupon'과 동형, 5년 결제 티어 아님). 충분.

---

## 12. 검증 계획 (가드 초안 — A/B 자가검증 필수)

- **`server/tools/_dv_mail.ts`(순수 — DB 무의존)**: 멱등키 빌더 유일성(`mail:<mailId>` vs `mail_bc:<bc>:<user>` 비충돌)·만료 판정 경계(now vs expires_at)·캡 클램프(`amount>MAIL_MAX_GRANT` 거부)·상태 필터 분류 로직·**만료일 파생**(diamonds 30 / pass 60, R3). **A/B**: 캡 미적용·경계 오프바이원·pass 만료 30일 오설정 변이 주입 → 검출.
- **`server/tools/_dv_mail_live.ts`(라이브 dev DB)**: admin 발송 → 유저 수령(+amount·balance 갱신) → **이중수령 0**(applied:false) → **만료 우편 수령 거부** → **패스 첨부 수령**(attendance_passes 행·store_txn_id='mail:<id>' UNIQUE 이중생성 0·**큐 만석 시 rejectOnQueueFull 롤백+claimed_at NULL 유지**) → **grantPassTx 원자성**(claim 롤백 강제 시 패스 미잔존·재수령 이중지급 0, B1) → **발송 idem_key 더블클릭 dedup**(R1) → **회수 recalled_at 소프트마킹**(수령분 회수 거부, R2) → **requireAdmin 토큰 없이 401**(fail-closed) → **감사행**(mails·wallet_ledger reason='mail'·purchase_event admin.mail.sent/claim.applied/recalled, R2) → **매출·payer 불변**(R2 함정). **A/B**: fail-closed 우회·만료 게이트 제거·이중수령 가드 제거·rejectOnQueueFull false(구매동작) 변이로 민감도 증명.
- **`server/tools/_dv_walletauth.ts` 확장**: reason 화이트리스트에 `mail`이 `/earn` 밖임을 대조(클라 mail 사칭 401) + `MAIL_MAX_GRANT`·`MAIL_RETENTION_DAYS`·`MAIL_PASS_EXPIRE_DAYS` 드리프트 대조.
- **grantPass 회귀 무손상(B1)**: `grantPassTx` 추출 후 기존 구매 경로(웹훅/confirm) 동작 불변 — DIAMOND_PASS 라이브 가드(`_dv_pass`류)로 재검증(래퍼가 자체 tx로 동일 결과).
- **S1 — syncWallet 쿼리 수 관측**: `getWallet` 우편 카운트 추가 후 왕복당 쿼리 수를 측정·등재(콜드 측정, 워밍 금지 — [[cold-measure-perf-fixes]]).
- **결정론 격리 확인**: 우편 수령 전후 시드/리플레이/세이브 불변(엔진 가드 배터리 무회귀).

> 새 가드는 **프로덕션 코드에 테스트 시임 미주입**(env 플래그 시임 없이 실 라우트·실 store 구동). README 검증 루틴 등재는 **메인 세션 소유**.

---

## 13. 구현 Phase 분해

| Phase | 범위 | 산출물 |
|---|---|---|
| **1. 서버(개별+브로드캐스트) + 가드 ✅ 구현(2026-07-23)** | `mails`·`mail_broadcasts`·`mail_broadcast_receipts` 스키마(idem_key·recalled_at)·econ 상수(RETENTION·PASS_EXPIRE·MAX_GRANT·PURGE_GRACE)·`reason 'mail'`·유저 라우트(claim/list/read)·admin 라우트(발송/이력/회수 + 브로드캐스트 발송)·`getWallet` unread+unclaimed 편입·**`grantPassTx(tx,…,opts)` 추출**(B1, `pass.ts` — 기존 grantPass는 래퍼로)·`rejectOnQueueFull` 옵션(B2)·store_txn_id 합성키(B3)·purge 크론 편입(retention.ts)·purchase_event 관측(R2) | `server/db/schema.ts`(mails·mail_broadcasts·receipts)·`server/db/migrations/0003_mailbox.sql`·`server/lib/econ.ts`·`server/lib/wallet.ts`(WalletReason 'mail'·getWallet 카운트)·`server/lib/pass.ts`(**grantPassTx 추출**)·`server/lib/mail.ts`(신)·`server/lib/retention.ts`(purge)·`server/app/api/mail/{route,claim,read}/route.ts`·`server/app/api/admin/mail/route.ts` · 가드 `_dv_mail`·`_dv_mail_live` |
| **2. 앱 화면 + 배지** | 우편함 화면(상태 필터·받기·모두받기·오프라인)·마이페이지 카드·빨간 점 2곳·lib/server 메서드 | `app/mailbox.tsx`(신)·`app/(tabs)/mypage.tsx`(카드+배지)·`app/(tabs)/_layout.tsx`(탭 red dot)·`lib/server.ts`(getMail/claimMail/readMail·unreadMailCount 캐시)·`app/_layout.tsx`(라우트) |
| **3. 관리자 우편 탭** | ops-9f3a2c "우편" 탭(발송 폼·첨부 종류 선택·만료 기본 연동·폼-오픈 idemKey·이력·회수) | `server/app/ops-9f3a2c/page.tsx`(NAV·TITLES·MailSection) |
| ~~**4. 전체 우편(브로드캐스트)**~~ → **Phase① 서버로 앞당김(2026-07-23 구현 지시)** | ~~`mail_broadcasts`+`receipts`·lazy 수령·cutoff·admin 전체 발송·목록 합성~~ → **서버(스키마·lazy 수령·cutoff·합성 목록·admin 브로드캐스트 발송·다이아 전용 Q4)는 Phase①에 편입.** 잔여 = **앱 화면의 브로드캐스트 발송 폼**(관리자 UI)만 후속 | `server/app/api/admin/mail/route.ts`(target='broadcast' 분기) + `server/lib/mail.ts` |

> ~~Phase 1~3이 "개별 우편으로 보상 받기 + 관리자 화면에서 우편 발송"(사용자 확정 핵심)을 완성. Phase 4(브로드캐스트)는 이벤트 대량 지급 필요 시 착수.~~
> → **정정(2026-07-23 구현)**: 브로드캐스트 **서버**(스키마·lazy·cutoff·claim·admin 발송)는 개별과 결합도가 높아(목록 합성·getWallet 카운트가 개별+브로드캐스트 합산) Phase① 서버에 함께 구현했다. 앱 화면(우편함 UI·관리자 브로드캐스트 발송 폼)만 Phase 2/3에 남는다. `_dv_walletauth` 확장(§12)은 클라측 가드라 이 서버 Phase에서 제외(메인 세션/클라 작업).
