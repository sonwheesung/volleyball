// 명성 분포 게이트 ②③ (STAFF §9.7) — npx tsx tools/_dv_reputation_dist.ts [시즌=150]
//   ② 분포 수렴: 100시즌+ 전원 거장/전원 무명 쏠림 없음(티어 히스토그램 극단 봉우리 아님).
//   ③ 경로 편중: 특정 경력 경로가 명성 독점 수렴 안 함. 실측(추정 금지) — endSeason 경력 로그 파생 명성을 다시즌 누적해 분포 측정.
import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters,
  currentCoachPool, commitCoachPool, assignCoach, reconcileStaff, getTeamCoach, getTeamPlayers, LEAGUE,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';
import { predictRanks, reputationOf, reputationTier, type CoachCareerRow, type PlayoffResult } from '../engine/reputation';
import type { Coach } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(50, Number(process.argv[2]) || 150);
const LEGEND_POINTS = 7500;
resetLeagueBase();

let careerLog: CoachCareerRow[] = [];
const coachSeen = new Map<string, Coach>(); // 등장 감독(명성 계산 대상)
const mediaPred = new Map<number, string[]>();
mediaPred.set(0, predictRanks(LEAGUE.teams.map((t) => ({ teamId: t.id, players: getTeamPlayers(t.id) }))));

const recentRankOrders: string[][] = [];
for (let s = 0; s < N; s++) {
  const assignedHead: Record<string, string> = {};
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) { assignedHead[t.id] = c.id; coachSeen.set(c.id, c); } }
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  const playoffs = buildPlayoffs(s);
  const championId = playoffs.championId ?? '';
  const predOrder = mediaPred.get(s) ?? rankOrder;
  const predRankOf = (tid: string) => { const i = predOrder.indexOf(tid); return i < 0 ? rankOrder.length : i + 1; };
  const playoffOf = (tid: string): PlayoffResult =>
    championId === tid ? 'champion'
    : playoffs.final && (playoffs.final.hiId === tid || playoffs.final.loId === tid) ? 'final'
    : playoffs.po && (playoffs.po.hiId === tid || playoffs.po.loId === tid) ? 'po' : 'none';
  for (let i = 0; i < rankOrder.length; i++) {
    const tid = rankOrder[i]; const headId = assignedHead[tid];
    if (!headId || headId.startsWith('acting_')) continue;
    careerLog.push({ season: s, coachId: headId, teamId: tid, predictedRank: predRankOf(tid), actualRank: i + 1, playoff: playoffOf(tid), champion: championId === tid, midSeasonFired: false });
  }
  careerLog = careerLog.slice(-1000);

  // 오프시즌 롤오버
  recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
  const bottomYears: Record<string, number> = {};
  for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);
  const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
  const legendIds = new Set(retiredPlayers.filter((p) => accrueCareer(p, prod.get(p.id)).career.points >= LEGEND_POINTS).map((p) => p.id));
  const res = advanceCoaches(s + 1, currentCoachPool(), assignedHead, retiredPlayers, legendIds, rankOrder, bottomYears, '___none___');
  commitCoachPool(res.coaches, res.assistants);
  for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
  reconcileStaff();
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal, [], aiTargetOf());
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s + 1);
  for (const r of f.newPlayers) snapshot[r.id] = r;
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
  mediaPred.set(s + 1, predictRanks(LEAGUE.teams.map((t) => ({ teamId: t.id, players: getTeamPlayers(t.id) }))));
}

// 명성 분포 — 경력 3시즌+ 감독만(단명 제외, 의미 있는 표본)
const counted = careerLog.reduce((m, r) => { m.set(r.coachId, (m.get(r.coachId) ?? 0) + 1); return m; }, new Map<string, number>());
const reps: number[] = [];
const hist: Record<string, number> = { 무명: 0, 주목: 0, '인정받는 감독': 0, 명장: 0, 거장: 0 };
for (const [id, coach] of coachSeen) {
  if ((counted.get(id) ?? 0) < 3) continue;
  const rep = reputationOf(careerLog, coach);
  reps.push(rep); hist[reputationTier(rep).label]++;
}
reps.sort((a, b) => a - b);
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
log(`\n═══ 명성 분포 — ${N}시즌 · 경력 3시즌+ 감독 ${reps.length}명 ═══`);
log(`명성 평균 ${avg(reps).toFixed(1)} · 중앙 ${reps[Math.floor(reps.length / 2)]} · 최소 ${reps[0]} · 최대 ${reps[reps.length - 1]}`);
log(`티어: ${Object.entries(hist).map(([k, v]) => `${k} ${v}(${(v / Math.max(1, reps.length) * 100).toFixed(0)}%)`).join(' · ')}`);

// 게이트: 극단 쏠림 아님(어느 한 티어 ≥80%면 붕괴) + 최소 3개 티어에 분포
const maxTierPct = Math.max(...Object.values(hist)) / Math.max(1, reps.length);
const tiersUsed = Object.values(hist).filter((v) => v > 0).length;
const ok = reps.length >= 5 && maxTierPct < 0.8 && tiersUsed >= 3;
log(ok ? `\n✅ 분포 건강 — 극단 쏠림 없음(최대 티어 ${(maxTierPct * 100).toFixed(0)}%<80%) · ${tiersUsed}개 티어 분포`
  : `\n❌ 분포 이상 — 최대 티어 ${(maxTierPct * 100).toFixed(0)}% · 티어수 ${tiersUsed} · 표본 ${reps.length}`);
process.exit(ok ? 0 : 1);
