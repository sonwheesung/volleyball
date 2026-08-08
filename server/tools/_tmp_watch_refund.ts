import postgres from 'postgres';
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = await sql`select delta, balance_after, reason, ref, created_at from wallet_ledger where reason = 'refund' and created_at > now() - interval '3 hours' order by created_at desc limit 3`;
  if (rows.length) {
    console.log('REFUND ARRIVED:');
    for (const r of rows) console.log(`${r.created_at.toISOString()} | delta=${r.delta} bal=${r.balance_after} | ref=${r.ref}`);
    await sql.end();
    process.exit(0);
  }
  await sql.end();
  process.exit(1);
}
main().catch(() => process.exit(2));
