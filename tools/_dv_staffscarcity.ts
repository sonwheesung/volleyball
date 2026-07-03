// 스태프 희소성 측정 (STAFF_SYSTEM §8.1 스태프 2.0 1축 — 공급 실측, 추정 금지).
//   npx tsx tools/_dv_staffscarcity.ts [시즌=50]
// 질문: 90+(S) 스태프가 시즌당 몇 명 생기고 정상상태 풀에 몇 명인가? 7팀이 다 상위 스태프를 확보할 만큼 넉넉한가?
//   초기 스냅샷(티어 분포) + 정상상태(N시즌 평균) + 수요(7팀×[감독1·코치3]) 대비.
import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters,
  currentCoachPool, commitCoachPool, assignCoach, reconcileStaff, getTeamCoach, LEAGUE,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { computeStandings } from '../data/standings';
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';
import { COACH_SLOTS } from '../engine/staff';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 50);
const LEGEND_POINTS = 7500;
const TEAMS = 7;
resetLeagueBase();

const tier = (v: number): 'S' | 'A' | 'B' | 'C' => (v >= 90 ? 'S' : v >= 80 ? 'A' : v >= 70 ? 'B' : 'C');
const tierCounts = (vals: number[]) => { const c = { S: 0, A: 0, B: 0, C: 0 }; for (const v of vals) c[tier(v)]++; return c; };
const fmt = (c: { S: number; A: number; B: number; C: number }) => `S ${c.S} · A ${c.A} · B ${c.B} · C ${c.C}`;

// 초기 스냅샷
const p0 = currentCoachPool();
log('── 초기 풀 스냅샷 ──');
log(`  감독(charisma):   ${fmt(tierCounts(p0.coaches.map((c) => c.charisma)))}  (총 ${p0.coaches.length})`);
log(`  전문코치(rating): ${fmt(tierCounts(p0.assistants.map((a) => a.rating)))}  (총 ${p0.assistants.length})`);
log(`  스카우터(scouting): ${fmt(tierCounts(LEAGUE.scouts.map((s) => s.scouting)))}  (총 ${LEAGUE.scouts.length})`);

// 정상상태(N시즌) — 티어별 풀 크기 평균 + 시즌당 신규 S/A 유입
const headTiers: Record<string, number[]> = { S: [], A: [], B: [], C: [] };
const asstTiers: Record<string, number[]> = { S: [], A: [], B: [], C: [] };
let newSHeads = 0, newAHeads = 0, newSAsst = 0, newAAsst = 0;
const seenHead = new Set(p0.coaches.map((c) => c.id));
const seenAsst = new Set(p0.assistants.map((a) => a.id));
const recentRankOrders: string[][] = [];

for (let s = 0; s < N; s++) {
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
  const bottomYears: Record<string, number> = {};
  for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);
  const assignedHead: Record<string, string> = {};
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }

  const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
  const legendIds = new Set(retiredPlayers.filter((p) => accrueCareer(p, prod.get(p.id)).career.points >= LEGEND_POINTS).map((p) => p.id));

  const pool = currentCoachPool();
  const res = advanceCoaches(s + 1, pool, assignedHead, retiredPlayers, legendIds, rankOrder, bottomYears, '___none___');
  commitCoachPool(res.coaches, res.assistants);
  for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
  reconcileStaff();

  const hc = tierCounts(res.coaches.map((c) => c.charisma));
  const ac = tierCounts(res.assistants.map((a) => a.rating));
  (['S', 'A', 'B', 'C'] as const).forEach((t) => { headTiers[t].push(hc[t]); asstTiers[t].push(ac[t]); });
  for (const c of res.coaches) if (!seenHead.has(c.id)) { seenHead.add(c.id); if (c.charisma >= 90) newSHeads++; else if (c.charisma >= 80) newAHeads++; }
  for (const a of res.assistants) if (!seenAsst.has(a.id)) { seenAsst.add(a.id); if (a.rating >= 90) newSAsst++; else if (a.rating >= 80) newAAsst++; }

  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s + 1);
  for (const r of f.newPlayers) snapshot[r.id] = r;
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
log(`\n── 정상상태 풀(${N}시즌 평균 티어 크기) ──`);
log(`  감독:   S ${avg(headTiers.S).toFixed(1)} · A ${avg(headTiers.A).toFixed(1)} · B ${avg(headTiers.B).toFixed(1)} · C ${avg(headTiers.C).toFixed(1)}`);
log(`  전문코치: S ${avg(asstTiers.S).toFixed(1)} · A ${avg(asstTiers.A).toFixed(1)} · B ${avg(asstTiers.B).toFixed(1)} · C ${avg(asstTiers.C).toFixed(1)}`);
log(`  시즌당 신규 유입: 감독 S ${(newSHeads / N).toFixed(2)}·A ${(newAHeads / N).toFixed(2)} / 코치 S ${(newSAsst / N).toFixed(2)}·A ${(newAAsst / N).toFixed(2)}`);

log(`\n── 수요 대비(핵심 질문) ──`);
const headS = avg(headTiers.S), headSA = avg(headTiers.S) + avg(headTiers.A);
const asstS = avg(asstTiers.S), asstSA = avg(asstTiers.S) + avg(asstTiers.A);
log(`  감독 수요 ${TEAMS}(팀당 1) — S급 공급 ${headS.toFixed(1)} / S+A 공급 ${headSA.toFixed(1)}`);
log(`  코치 수요 ${TEAMS * COACH_SLOTS}(팀당 ${COACH_SLOTS}) — S급 공급 ${asstS.toFixed(1)} / S+A 공급 ${asstSA.toFixed(1)}`);
log(`  → 감독: 모든 팀 S급 확보 ${headS >= TEAMS ? '가능(공급 과잉 — 희소성 없음)' : '불가(희소 — 상위 다툼 발생)'}`);
log(`  → 코치: 모든 팀 S급 3명 확보 ${asstS >= TEAMS * COACH_SLOTS ? '가능(공급 과잉 — 희소성 없음)' : '불가(희소)'}`);
log(`\n※ 판단: 공급이 수요보다 넉넉하면(과잉) → 지배전략 성립(누구나 최고 확보) → 공급 조임 필요. 부족하면 이미 희소 → 튜닝만.`);

// ── 붕괴 해소 게이트 (phase②③ 회귀) — 정상상태 코치 A가 멸종(≈0)이 아니라 "소수 시장"을 유지하는가.
//   phase②③ 이전 베이스라인: 코치 A 0.3(멸종). 이후 재생성+성장으로 A ≥ 1.5(소수) 여야 함. 과다(≥8)면 글럿 회귀 경고.
const asstA = avg(asstTiers.A);
const collapsed = asstA < 1.5;
const glut = asstA >= 8;
log(`\n[게이트] 정상상태 코치 A ${asstA.toFixed(1)} — ${collapsed ? '❌ 붕괴(멸종)' : glut ? '⚠️ 과다(글럿 회귀 위험)' : '✅ 소수 시장 유지(붕괴 해소)'}`);
process.exit(collapsed ? 1 : 0);
