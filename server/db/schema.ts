// Drizzle 스키마 (BACKEND_SYSTEM §13.2). 마일스톤2 = User + WalletLedger + 영속 balance.
// balance는 원장 fold(O(n)) 회피 + 동시성 잠금 대상(H2). 원장은 append-only 감사추적.
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().default('dev'), // google | apple | dev
    providerId: text('provider_id').notNull(),
    balance: integer('balance').notNull().default(0), // 영속 다이아 잔액(원장 합과 항상 일치)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_provider_uniq').on(t.provider, t.providerId)],
);

export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    delta: integer('delta').notNull(), // +적립 / -사용
    reason: text('reason').notNull(), // purchase | ad | achievement | camp | refund | adjust
    idempotencyKey: text('idempotency_key').notNull(), // 이중지급/이중차감 차단(§4)
    balanceAfter: integer('balance_after').notNull(), // 적용 후 잔액(재시도 시 반환)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ledger_idem_uniq').on(t.idempotencyKey), index('ledger_user_idx').on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type WalletLedgerRow = typeof walletLedger.$inferSelect;
