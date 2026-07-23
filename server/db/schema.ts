// Drizzle 스키마 (BACKEND_SYSTEM §13.2). 멀티게임: 부모 proj_info + 모든 테이블 proj_code FK로 게임별 격리.
// balance는 원장 fold(O(n)) 회피 + 동시성 잠금 대상(H2). 원장은 append-only 감사추적(reason+ref로 "어떻게 얻었나" 영구 기록).
import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';

// ── 부모: 게임 카탈로그(정체성) ── 이 서버는 배구명가로 시작, 향후 타 스포츠게임이 같은 재화·결제 구조 공유(§13.2).
export const projInfo = pgTable('proj_info', {
  projCode: text('proj_code').primaryKey(), // 'volleyball' (이번) · 'basketball' 등 추가
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 운영 설정(게임별 1행) ── 앱이 부팅 시 조회(§13.11): 버전 게이트 + 서버 점검. 스토어 강제업데이트에 의존하지 않고
// **DB로 우회** — minVersion 미만이면 진입 차단(강제 업데이트), maintenance면 점검 화면으로 진입 차단. 관리자가 갱신.
export const serverSetting = pgTable('server_setting', {
  projCode: text('proj_code').primaryKey().references(() => projInfo.projCode),
  minVersion: text('min_version'), // 이 미만 = 강제 업데이트(진입 차단). null=게이트 없음
  latestVersion: text('latest_version'), // 이 미만 = 소프트 업데이트 안내. null=없음
  androidStoreUrl: text('android_store_url'),
  iosStoreUrl: text('ios_store_url'),
  maintenance: boolean('maintenance').notNull().default(false), // 점검 여부 — true면 진입 차단
  maintenanceTitle: text('maintenance_title'), // 점검 화면 제목
  maintenanceBody: text('maintenance_body'), // 점검 화면 내용
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode), // 게임 격리 FK
    provider: text('provider').notNull().default('dev'), // google | apple | dev
    providerId: text('provider_id').notNull(),
    displayName: text('display_name'), // 표시 이름(비필수 개인정보 — 파기 대상 가능, §13.9)
    balance: integer('balance').notNull().default(0), // 영속 다이아 잔액(원장 합과 항상 일치, 환불 시 음수 가능 §13.17)
    // 진단용 기기정보(§13.17) — 로그인 때 갱신되는 "마지막 로그인 기기"(보조). 최소수집(OS·버전). nullable(Expand-only)
    platform: text('platform'), // ios | android | web
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // 소프트삭제 — 결제 원장 5년 보존 위해 하드삭제 대신(§13.9). 탈퇴 시 providerId 가명화(AUTH §7)
    ageConfirmedAt: timestamp('age_confirmed_at', { withTimezone: true }), // 만14세 확인 시점(신규 소셜 가입 시 필수·1회 기록, AUTH §8). null=미확인(익명/가드)
  },
  // 게임별로 계정 격리 — 같은 구글계정이 배구/농구에서 별도 유저
  (t) => [uniqueIndex('users_proj_provider_uniq').on(t.projCode, t.provider, t.providerId)],
);

export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode), // 게임 격리 FK
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    delta: integer('delta').notNull(), // +적립 / -사용
    reason: text('reason').notNull(), // 범주: purchase | ad | achievement | camp | refund | adjust
    ref: text('ref'), // 출처 상세 감사("어떻게 얻었나"): 업적id·상품id·SSV id·전지훈련(playerId:stat) 등
    idempotencyKey: text('idempotency_key').notNull(), // 이중지급/이중차감 차단(§4)
    balanceAfter: integer('balance_after').notNull(), // 적용 후 잔액(재시도 시 반환)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 멱등키도 게임 스코프 — 다른 게임이 같은 키를 써도 충돌 안 함
  (t) => [uniqueIndex('ledger_proj_idem_uniq').on(t.projCode, t.idempotencyKey), index('ledger_user_idx').on(t.userId)],
);

// ── 공지사항(§13.11) — 제목/내용, 기간(startsAt~endsAt) 동안만 노출. 앱 진입 시 bootstrap이 활성분만 반환(무푸시 관전형).
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    title: text('title').notNull(),
    body: text('body').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }), // null = 무기한
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ann_proj_idx').on(t.projCode)],
);

// ── 개발자 노트/패치노트(DEVNOTES_SYSTEM) — 공개 GET은 status='published'만. 무푸시 관전형 읽을거리(공지=차단성 안내와 역할 구분).
export const devnotes = pgTable(
  'devnotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    kind: text('kind').notNull(),              // 'patch' | 'note' (앱·admin에서 검증, DB는 text)
    title: text('title').notNull(),
    body: text('body').notNull(),              // 마크다운 원문
    appVersion: text('app_version'),           // 패치노트만 채움(예 '0.4.0'), 노트는 null
    status: text('status').notNull().default('draft'), // 'draft' | 'published'
    publishedAt: timestamp('published_at', { withTimezone: true }), // 게시 순간 세팅(정렬·표시용)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('devnotes_proj_idx').on(t.projCode), index('devnotes_proj_status_idx').on(t.projCode, t.status)],
);

// ── 쿠폰(§13.14) — 전체용(targetUserId null)·개인용(set), 둘 다 기간제. 보상=다이아. 관리자 발급, 유저 코드입력 사용.
export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    code: text('code').notNull(), // 정규형(대문자+trim) 저장/조회
    rewardDiamonds: integer('reward_diamonds').notNull(), // >0 (관리자 발급 시 강제 + 상한캡)
    targetUserId: uuid('target_user_id').references(() => users.id), // null=전체(모두 1회) · set=개인(그 유저만)
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }), // null=무기한
    disabled: boolean('disabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('coupons_proj_code_uniq').on(t.projCode, t.code), index('coupons_proj_idx').on(t.projCode)],
);

// ── 쿠폰 사용기록 — 유저당 1회 게이트(UNIQUE) + 감사. **파기 제외**(§13.14 P0-C — 활성/무기한 쿠폰 재수령 구멍 차단).
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    couponId: uuid('coupon_id').notNull().references(() => coupons.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('redemption_proj_coupon_user_uniq').on(t.projCode, t.couponId, t.userId),
    index('redemption_coupon_idx').on(t.couponId),
    index('redemption_user_idx').on(t.userId),
  ],
);

// ── 문의(티켓) — §13.17. 카테고리에 'refund'(환불 신청) 포함. 제출 시점 기기 스냅(어떤 폰서 문제났나)을 박는다.
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    userId: uuid('user_id').notNull().references(() => users.id),
    category: text('category').notNull(), // bug | suggestion | question | etc | refund
    content: text('content').notNull(),
    status: text('status').notNull().default('open'), // open | replied | resolved | refunded
    reply: text('reply'), // 관리자 답변
    platform: text('platform'), // 제출 시점 기기(진단) — users.platform과 별개(문제 난 그 기기)
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
  },
  (t) => [index('tickets_proj_idx').on(t.projCode), index('tickets_user_idx').on(t.userId)],
);

// ── 진단 스냅샷 — 티켓 분리 테이블(§13.17 P0-4). 10시즌 재생 JSON이 커서 목록 쿼리에 안 붙이고 상세 열 때만 로드.
// 보관 90일(진단 티어 — 오래된 재생은 가치 0). 티켓 텍스트(3년)보다 짧게 파기.
export const diagnosticSnapshots = pgTable(
  'diagnostic_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    snapshot: jsonb('snapshot').notNull(), // 최근 10시즌 재생 진단 JSON(전지훈련 내역·로그·선수 포함)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('snapshot_ticket_idx').on(t.ticketId)],
);

// ── 수입 일집계(롤업) — 영구 보존(§13.10). 원본 결제가 5년 뒤 파기돼도 총수입은 여기 생존.
// 매일 크론이 어제치를 재집계 upsert(멱등). 관리자 대시보드(#46)가 즉시 조회(원본 5년 스캔 불필요).
export const statsDaily = pgTable(
  'stats_daily',
  {
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    day: date('day').notNull(), // 달력일(UTC)
    revenueKrw: integer('revenue_krw').notNull().default(0), // 실매출(원) — Purchase 테이블(#43) 연결 시 채움
    purchaseCount: integer('purchase_count').notNull().default(0), // 결제 건수(현재: 결제 원장 카운트)
    diamondsPurchased: integer('diamonds_purchased').notNull().default(0), // 구매로 지급된 다이아 합
    newUsers: integer('new_users').notNull().default(0), // 그날 신규 가입
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projCode, t.day] })],
);

// ── 결제 이벤트 감사 로그(§13.22, 2026-07-05) — **append-only 진단**(돈 진실은 walletLedger·statsDaily). 결제 생애주기
//   단계마다 1행: 성공/dedup/실패사유·상관ID(requestId, storeTxnId, rcEventId)·금액/환경/기기 컨텍스트. "돈 내고 0개"를
//   idempotencyKey로 walletLedger와 JOIN해 감사. **관찰 전용**(로깅 실패가 지급을 되돌리지 않음 — logPaymentEvent가 삼킴).
//   PII/토큰/영수증/시크릿 금지(§13.22 §E — scrub). userId/rcAppUserId는 text(익명 $RCAnonymousID·비UUID도 로깅되게 — insert 실패 방지).
export const purchaseEvent = pgTable(
  'purchase_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // 상관·귀속
    userId: text('user_id'),                 // 우리 유저 참조(이메일·이름 금지). auth 전 단계면 null
    rcAppUserId: text('rc_app_user_id'),     // RC app_user_id(익명일 수 있음)
    requestId: text('request_id'),           // client→confirm 한 시도 상관(웹훅은 storeTxnId로 매칭)
    storeTxnId: text('store_txn_id'),        // 원장 앵커(스토어 거래 id)
    rcEventId: text('rc_event_id'),          // 웹훅 dedupe 키(event.id)
    idempotencyKey: text('idempotency_key'), // walletLedger JOIN → 지급 여부 증명
    // 무엇/결과
    source: text('source').notNull(),        // client | webhook | confirm
    stage: text('stage').notNull(),          // 생애주기 단계(webhook.grant.applied 등)
    eventType: text('event_type'),           // RC 웹훅 타입(INITIAL_PURCHASE 등)
    ok: boolean('ok').notNull(),
    outcome: text('outcome'),                // applied|deduped|rejected|pending|cancelled|ignored|error
    reasonCode: text('reason_code'),         // 실패/무시 사유(정규화 코드 또는 원사유)
    errorMessage: text('error_message'),     // ≤500자 truncate·스크럽
    // 상품/금액/환경
    productId: text('product_id'),
    price: integer('price'),                 // 구매통화 정수(반올림) — currency와 함께 해석
    currency: text('currency'),
    diamondsDelta: integer('diamonds_delta'),
    balanceAfter: integer('balance_after'),
    environment: text('environment'),        // SANDBOX | PRODUCTION
    platform: text('platform'),              // ios | android
    appVersion: text('app_version'),
    detail: jsonb('detail'),                 // 화이트리스트 추가정보만(원본 웹훅 바디 덤프 금지)
  },
  (t) => [
    index('pe_user_time_idx').on(t.userId, t.createdAt),
    index('pe_txn_idx').on(t.storeTxnId),
    index('pe_rc_event_idx').on(t.rcEventId),
    index('pe_reason_idx').on(t.reasonCode),
  ],
);

// ── 시즌 종료 세이브 백업(§13.26) — 서버는 payload를 **불투명 blob으로 보관만**(게임플레이 불개입·결정론 격리 §1·§8).
// 유저당 최근 5개 롤링 · 같은 season 재업로드=교체(UNIQUE 하드가드) · payload 3MB 캡(라우트에서 검증).
// save_version은 봉투(app/kind/version)에서 추출한 목록 표시용 메타 — 내용(state)은 신뢰 안 함(봉투만 검증).
export const saveBackups = pgTable(
  'save_backups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode), // 게임 격리 FK(§13.2)
    userId: uuid('user_id').notNull().references(() => users.id),
    season: integer('season').notNull(), // 백업된 시즌(같은 season 재업로드=교체)
    payload: text('payload').notNull(), // 클라 내보내기 JSON 문자열 원문(불투명 — 서버는 봉투만 검증)
    sizeBytes: integer('size_bytes').notNull(), // payload 바이트 길이(목록 표시·3MB 캡 감사)
    saveVersion: text('save_version'), // 봉투 version 추출값(목록 표시용, 없으면 null)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('save_backups_proj_user_idx').on(t.projCode, t.userId), // 목록/롤링 조회
    uniqueIndex('save_backups_proj_user_season_uniq').on(t.projCode, t.userId, t.season), // 同시즌 교체 하드가드
  ],
);

// ── 다이아 출석 패스(ATTENDANCE_PASS_SYSTEM §2.4) — ₩9,900·28일·매일 100💎. 구매 시 이 테이블에 "패스 엔타이틀먼트" 1행 생성
//   (다이아는 매일 pass_daily 원장 수령으로만 들어옴 — 이 행은 창(start~end)·상태 진실). RC customerInfo 엔타이틀먼트 아님(소비성·재구매).
//   · UNIQUE(proj, store_txn_id) = 구매 멱등(웹훅·confirm 공유 자연키, onConflictDoNothing). store_txn_id nullable → admin 발급(txn 없음)은
//     NULL(Postgres UNIQUE는 NULL 서로 distinct라 충돌 없음). B1 환불 선착 tombstone도 이 UNIQUE로 선삽입.
//   · status: 'active'(수령 중) | 'refunded'(환불 종료 tombstone, B1/§4.3) | 'queued'(중첩 구매 예약 — Q1 큐잉, §2.2).
//   · queued_after: Q1 큐 앵커(직전 passId) — status='queued'일 때 실 start를 활성화 시점에 max(오늘, 앵커 end+1)로 파생(공백 방지·R1a 환불 재계산).
//   ※ 스키마 §2.4는 status(active|refunded)만 명시했으나 Q1 큐잉(§2.2 "예약 pending 플래그+앵커")을 담으려면 'queued' 상태 + queued_after 앵커가 필수 —
//     문서 §2.4를 취소선 정정으로 보강(구현 정합).
export const attendancePasses = pgTable(
  'attendance_passes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode), // 게임 격리 FK
    userId: uuid('user_id').notNull().references(() => users.id),
    storeTxnId: text('store_txn_id'), // 스토어 거래 id(구매 멱등 앵커). admin 발급=null(ref='admin:<passId>' 별도, §2.4)
    startDate: date('start_date').notNull(), // KST 리셋보정 시작일(dayIndex 0). queued면 앵커 파생 프로비저널(활성화 때 확정)
    endDate: date('end_date').notNull(),     // start + (PASS_DURATION_DAYS-1) = start+27(포함, 28슬롯). refunded면 어제로 종료
    source: text('source').notNull(),        // 'purchase' | 'admin'
    status: text('status').notNull().default('active'), // 'active' | 'refunded' | 'queued'
    queuedAfter: uuid('queued_after'),       // Q1 큐 앵커(직전 passId) — queued에서 활성화 때 start 파생
    purchasedAt: timestamp('purchased_at', { withTimezone: true }), // RC 이벤트 purchased_at(월귀속·start 리셋보정 기준, R4)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('passes_proj_txn_uniq').on(t.projCode, t.storeTxnId), // 구매 멱등(웹훅·confirm 공유). NULL(admin)은 서로 distinct
    index('passes_proj_user_idx').on(t.projCode, t.userId),           // 활성 패스 조회
  ],
);

export type ProjInfo = typeof projInfo.$inferSelect;
export type ServerSetting = typeof serverSetting.$inferSelect;
export type User = typeof users.$inferSelect;
export type WalletLedgerRow = typeof walletLedger.$inferSelect;
export type StatsDailyRow = typeof statsDaily.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type Devnote = typeof devnotes.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type DiagnosticSnapshot = typeof diagnosticSnapshots.$inferSelect;
export type PurchaseEvent = typeof purchaseEvent.$inferSelect;
export type SaveBackup = typeof saveBackups.$inferSelect;
export type AttendancePass = typeof attendancePasses.$inferSelect;
