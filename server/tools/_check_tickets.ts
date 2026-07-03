// 읽기 전용 — 최근 문의(티켓) + 진단 스냅샷 실제 구조 덤프. `npx tsx --env-file=.env.local tools/_check_tickets.ts`
import { db } from '../db';
import { tickets, diagnosticSnapshots } from '../db/schema';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(tickets).orderBy(desc(tickets.createdAt)).limit(1);
  const t = rows[0];
  console.log(`\n[${t.createdAt.toISOString()}] ${t.category}/${t.status}  content=${JSON.stringify(t.content)}`);
  const snaps = await db.select({ snap: diagnosticSnapshots.snapshot }).from(diagnosticSnapshots).where(eq(diagnosticSnapshots.ticketId, t.id));
  const s: any = snaps[0]?.snap;
  console.log('\n=== snapshot top keys ===', s ? Object.keys(s) : 'NONE');
  console.log('\n=== meta ===', JSON.stringify(s?.meta, null, 1));
  console.log('\n=== wallet ===', JSON.stringify(s?.wallet, null, 1));
  console.log('\n=== seasons (count) ===', Array.isArray(s?.seasons) ? s.seasons.length : typeof s?.seasons, JSON.stringify(s?.seasons)?.slice(0, 400));
  console.log('\n=== logs (count) ===', Array.isArray(s?.logs) ? s.logs.length : typeof s?.logs);
  console.log('    logs sample:', JSON.stringify(s?.logs)?.slice(0, 400));
  console.log('\n=== players (count) ===', Array.isArray(s?.players) ? s.players.length : typeof s?.players);
  console.log('\n=== releasedNow ===', JSON.stringify(s?.releasedNow)?.slice(0, 200));
  await db.$client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
