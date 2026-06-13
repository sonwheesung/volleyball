// 감독 생애주기 장기 검증 (STAFF_SYSTEM 6) — N시즌 동안 풀 순환이 건강한지.
//   npx tsx tools/simStaffLife.ts [시즌=100]
// 체크: 풀 고갈/폭발 없음 · 감독 평균 연령 안정 · 은퇴↔유입 균형 · 선수 출신/승격 비율.

import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, currentRosters,
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
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 100);
const LEGEND_POINTS = 7500;
resetLeagueBase();

let totalRetired = 0, totalNew = 0, totalPromoted = 0, totalFired = 0, totalWalked = 0;
const poolSizes: number[] = [];
const avgAges: number[] = [];
let starOriginHeads = 0, totalHeadsEver = 0;
const seenHeadIds = new Set<string>();
const recentRankOrders: string[][] = [];

for (let s = 0; s < N; s++) {
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
  const bottomYears: Record<string, number> = {};
  for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);

  // 배정 감독(teamId → 현재 감독 id)
  const assignedHead: Record<string, string> = {};
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }

  // 오프시즌 컨텍스트(은퇴자)
  const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
  const legendIds = new Set(retiredPlayers.filter((p) => accrueCareer(p, prod.get(p.id)).career.points >= LEGEND_POINTS).map((p) => p.id));

  // 감독 생애주기 진행
  const pool = currentCoachPool();
  const res = advanceCoaches(s + 1, pool, assignedHead, retiredPlayers, legendIds, rankOrder, bottomYears, '___none___');
  commitCoachPool(res.coaches, res.assistants);
  for (const r of res.reassign) assignCoach(r.teamId, r.coachId); // store와 동일하게 재배정 적용
  reconcileStaff();

  totalRetired += res.retiredCoaches.filter((n) => !n.includes('경질')).length;
  totalFired += res.retiredCoaches.filter((n) => n.includes('경질')).length;
  totalNew += res.newCoaches.length;
  totalPromoted += res.promoted.length;
  totalWalked += res.walked.length;
  poolSizes.push(res.coaches.length + res.assistants.length);
  const ages = [...res.coaches, ...res.assistants].map((c) => c.age);
  avgAges.push(ages.reduce((a, b) => a + b, 0) / Math.max(1, ages.length));
  for (const c of res.coaches) if (!seenHeadIds.has(c.id)) { seenHeadIds.add(c.id); totalHeadsEver++; if (c.archetype === '선수 출신') starOriginHeads++; }

  // 다음 시즌 진행(드래프트+신인+누적)
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s + 1);
  for (const r of f.newPlayers) snapshot[r.id] = r;
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

const fin = currentCoachPool();
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
log(`\n═══ 감독 생애주기 ${N}시즌 ═══`);
log(`풀 크기: 평균 ${avg(poolSizes).toFixed(0)} · 최소 ${Math.min(...poolSizes)} · 최대 ${Math.max(...poolSizes)} (시작 ${LEAGUE.coaches.length + LEAGUE.assistants.length})`);
log(`감독/코치 평균 연령: ${avg(avgAges).toFixed(1)}세`);
log(`은퇴 ${totalRetired}명 · 경질 ${totalFired}명 · 계약만료 FA ${totalWalked}명 · 선수 출신 신규 코치 ${totalNew}명 · 감독 승격 ${totalPromoted}명 (${N}시즌)`);
log(`역대 등장 감독 ${totalHeadsEver}명 중 선수 출신 ${starOriginHeads}명 (${(starOriginHeads / Math.max(1, totalHeadsEver) * 100).toFixed(0)}%)`);
log(`종료 시점 — 감독 ${fin.coaches.length}명(프리 ${fin.coaches.filter((c) => c.teamId === null).length}) · 전문코치 ${fin.assistants.length}명`);

const ok = Math.min(...poolSizes) >= 7 && Math.max(...poolSizes) < 200 && avg(avgAges) < 65;
log(ok ? '\n✅ 풀 건강 — 고갈/폭발 없음, 연령 안정, 순환 작동' : '\n❌ 풀 이상 — 고갈·폭발·노령화 점검');
process.exit(ok ? 0 : 1);
