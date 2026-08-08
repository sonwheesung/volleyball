import postgres from 'postgres';
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = await sql`select day, revenue_krw, purchase_count, diamonds_purchased from stats_daily order by day desc limit 3`;
  console.log(rows.length ? rows.map(r => `${r.day} | KRW=${r.revenue_krw} | count=${r.purchase_count} | dia=${r.diamonds_purchased}`).join('\n') : '(stats_daily empty)');
  await sql.end();
}
main();
