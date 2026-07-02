// Drizzle 스키마 (BACKEND_SYSTEM §13.2). 멀티게임: 부모 proj_info + 모든 테이블 proj_code FK로 게임별 격리.
// balance는 원장 fold(O(n)) 회피 + 동시성 잠금 대상(H2). 원장은 append-only 감사추적(reason+ref로 "어떻게 얻었나" 영구 기록).
import { pgTable, uuid, text, integer, boolean, timestamp, date, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';

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
    balance: integer('balance').notNull().default(0), // 영속 다이아 잔액(원장 합과 항상 일치)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // 소프트삭제 — 결제 원장 5년 보존 위해 하드삭제 대신(§13.9)
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

export type ProjInfo = typeof projInfo.$inferSelect;
export type ServerSetting = typeof serverSetting.$inferSelect;
export type User = typeof users.$inferSelect;
export type WalletLedgerRow = typeof walletLedger.$inferSelect;
export type StatsDailyRow = typeof statsDaily.$inferSelect;
