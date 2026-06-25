// 가드 — 경기 MVP(매치 단위, AWARDS_SYSTEM §1): matchMvp가 이긴 팀 최고 생산자를 정확히 고르는가.
//   npx tsx tools/_ev_matchmvp.ts [경기수=300]
// 불변식: ① MVP는 이긴 팀 소속 ② 이긴 팀 내 최고점수(points+0.3·digs) == 독립 재유도 ③ points>0·id 실존
// A/B: 독립 오라클(직접 box 순회 최대)와 100% 일치 + 결정론(같은 경기 동일 MVP).
import { resetLeagueBase, LEAGUE } from '../data/league';
import { buildMatchBox } from '../data/matchBox';
import { matchMvp } from '../data/matchAward';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '300', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const fails: string[] = [];
const posCount: Record<string, number> = {};
let nullMvp = 0;

const scoreOf = (s: any) => (s.atkKill + s.blockPt + s.srvAce) + s.digSucc * 0.3;

for (let seed = 1; seed <= N; seed++) {
  const { homeSquad, awaySquad, sim, box } = buildMatchBox(t0, t1, 0, seed);
  const mvp = matchMvp(box, homeSquad, awaySquad, sim, '홈', '원정');
  if (!mvp) { nullMvp++; continue; }
  const winner = sim.homeSets > sim.awaySets ? 'home' : 'away';
  const squad = winner === 'home' ? homeSquad : awaySquad;
  // ① 이긴 팀 소속
  if (mvp.side !== winner) fails.push(`seed${seed} MVP side=${mvp.side}≠승자 ${winner}`);
  if (!squad.some((p) => p.id === mvp.id)) fails.push(`seed${seed} MVP id 이긴팀 명단에 없음`);
  // ② 독립 오라클: 이긴 팀 최고 score
  let bestId: string | null = null, bestScore = -1;
  for (const p of squad) { const s = box.get(p.id); if (!s) continue; const sc = scoreOf(s); if (sc > bestScore) { bestScore = sc; bestId = p.id; } }
  if (bestId !== mvp.id) fails.push(`seed${seed} MVP=${mvp.id}≠오라클 최고생산자 ${bestId}`);
  // ③ points>0
  if (mvp.points <= 0) fails.push(`seed${seed} MVP points=${mvp.points}≤0`);
  posCount[mvp.position] = (posCount[mvp.position] ?? 0) + 1;
  // 결정론
  const mvp2 = matchMvp(buildMatchBox(t0, t1, 0, seed).box, homeSquad, awaySquad, sim, '홈', '원정');
  if (mvp2?.id !== mvp.id) fails.push(`seed${seed} 결정론 위반(${mvp.id}≠${mvp2?.id})`);
}

log(`=== 경기 MVP 검증 (${N}경기) ===`);
log(`  MVP 포지션 분포: ${Object.entries(posCount).map(([k, v]) => `${k} ${v}`).join(' · ')} (널 ${nullMvp})`);
log(`  예) ${(() => { const m = matchMvp(buildMatchBox(t0, t1, 0, 1).box, buildMatchBox(t0, t1, 0, 1).homeSquad, buildMatchBox(t0, t1, 0, 1).awaySquad, buildMatchBox(t0, t1, 0, 1).sim, LEAGUE.teams[0].name, LEAGUE.teams[1].name); return m?.line ?? '(없음)'; })()}`);
const pass = fails.length === 0 && nullMvp === 0;
log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 5).join(' / ') : ''}${nullMvp ? ` · 널 MVP ${nullMvp}` : ''}`);
if (!pass) process.exit(1);
