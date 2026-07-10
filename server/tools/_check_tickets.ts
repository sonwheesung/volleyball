// 읽기 전용 — 최근 문의(티켓) + 진단 스냅샷 실제 구조 덤프. `npx tsx tools/_check_tickets.ts`
// dev는 .env.development.local(로컬 Supabase) 우선, 없으면 .env.local(운영). 운영 겨냥 시 DATABASE_URL 오버라이드.
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
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
  console.log('\n=== snapshotVersion ===', s?.meta?.snapshotVersion);
  const rep = s?.replay;
  console.log('=== replay(재현키) ===', rep ? `version=${rep.version} · state 필드 ${Object.keys(rep.state ?? {}).length}개 · bytes ${Buffer.byteLength(JSON.stringify(rep))}` : '없음');
  if (rep?.state) {
    const st: any = rep.state;
    console.log('    핵심 필드:', ['selectedTeamId', 'season', 'currentDay'].map((k) => `${k}=${JSON.stringify(st[k])}`).join(' · '),
      `· playerBase ${Object.keys(st.playerBase ?? {}).length}명 · results ${Object.keys(st.results ?? {}).length} · archive ${Array.isArray(st.archive) ? st.archive.length : '?'}`);
  }
  console.log('\n=== players (count) ===', Array.isArray(s?.players) ? s.players.length : typeof s?.players);
  console.log('\n=== releasedNow ===', JSON.stringify(s?.releasedNow)?.slice(0, 200));
  await db.$client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
