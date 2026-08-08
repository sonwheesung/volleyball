import postgres from 'postgres';
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = await sql`select delta, balance_after, created_at from wallet_ledger where reason='refund' and ref='dia_5000:sandbox' limit 1`;
  if (rows.length) { console.log(`dia_5000 지연 회수 도착: ${rows[0].created_at.toISOString()} delta=${rows[0].delta} bal=${rows[0].balance_after}`); await sql.end(); process.exit(0); }
  await sql.end(); process.exit(1);
}
main().catch(() => process.exit(2));
