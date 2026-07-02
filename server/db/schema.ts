// Drizzle 스키마 (BACKEND_SYSTEM §13.2). 멀티게임: 부모 proj_info + 모든 테이블 proj_code FK로 게임별 격리.
// balance는 원장 fold(O(n)) 회피 + 동시성 잠금 대상(H2). 원장은 append-only 감사추적(reason+ref로 "어떻게 얻었나" 영구 기록).
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ── 부모: 게임 카탈로그 ── 이 서버는 배구명가로 시작, 향후 타 스포츠게임이 같은 재화·결제 구조 공유(§13.2).
export const projInfo = pgTable('proj_info', {
  projCode: text('proj_code').primaryKey(), // 'volleyball' (이번) · 'basketball' 등 추가
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

export type ProjInfo = typeof projInfo.$inferSelect;
export type User = typeof users.$inferSelect;
export type WalletLedgerRow = typeof walletLedger.$inferSelect;
