// 언론 예상 순위 정확도 게이트 ① (STAFF §9.7) — npx tsx tools/_dv_preseason_pred.ts [시즌=400]
//   프리시즌 예상 순위(predictRanks) vs 실제 정규리그 순위의 Spearman 상관을 다시즌 실측.
//   상관이 노이즈면 "기대 대비" 평가가 주사위(명성이 운) → 적정 상관대 수렴 확인. 산출식 검증(추정 금지).
//   + A/B: 셔플(무작위) 예측의 상관 ≈ 0을 대조 실측(오라클이 신호를 실제로 재는가 — 허위 오라클 방지).
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
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';
import { predictRanks } from '../engine/reputation';
import { createRng, strSeed } from '../engine/rng';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(20, Number(process.argv[2]) || 120);
const LEGEND_POINTS = 7500;
resetLeagueBase();

/** Spearman ρ(예상 rank vs 실제 rank) — 둘 다 순위라 rho = 1 − 6Σd²/(n(n²−1)). */
function spearman(predOrder: string[], actualOrder: string[]): number {
  const n = actualOrder.length;
  if (n < 2) return 0;
  const predRank = new Map(predOrder.map((t, i) => [t, i + 1]));
  let d2 = 0;
  for (let i = 0; i < actualOrder.length; i++) {
    const pr = predRank.get(actualOrder[i]) ?? n;
    d2 += (pr - (i + 1)) ** 2;
  }
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const rhos: number[] = [];
const shuffledRhos: number[] = []; // A/B 대조: 무작위 예측

const recentRankOrders: string[][] = [];
for (let s = 0; s < N; s++) {
  // 이 시즌 개막 예상(현 base 로스터 = 시즌 시작 전력, computeStandings가 시즌을 굴리기 전 결정론)
  const predOrder = predictRanks(LEAGUE.teams.map((t) => ({ teamId: t.id, players: getTeamPlayers(t.id) })));
  // 무작위 대조(같은 팀 집합 셔플 — 시드 결정론)
  const rng = createRng(strSeed(`shuf:${s}`));
  const shuffled = [...LEAGUE.teams.map((t) => t.id)];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = rng.int(0, i); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }

  // 실제 정규리그 순위(시즌 시뮬)
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);

  rhos.push(spearman(predOrder, rankOrder));
  shuffledRhos.push(spearman(shuffled, rankOrder));

  // ── 오프시즌 롤오버(simStaffLife와 동일 진행) ──
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
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const meanRho = avg(rhos);
const meanShuf = avg(shuffledRhos);
rhos.sort((a, b) => a - b);
const median = rhos[Math.floor(rhos.length / 2)];
log(`\n═══ 언론 예상 순위 정확도 — ${N}시즌 (7팀) ═══`);
log(`Spearman ρ  평균 ${meanRho.toFixed(3)} · 중앙 ${median.toFixed(3)} · 최소 ${rhos[0].toFixed(2)} · 최대 ${rhos[rhos.length - 1].toFixed(2)}`);
log(`무작위 대조 ρ 평균 ${meanShuf.toFixed(3)} (셔플 예측 — 노이즈 기준선, 0 근처여야 함)`);

// 게이트: 예측이 무작위보다 확실히 나으면서(신호 존재) 완전 결정적(ρ=1, 운 제거)은 아님 = "적정 상관대"
const signal = meanRho > 0.35;          // 노이즈(0) 대비 유의미한 신호
const notDeterministic = meanRho < 0.95; // 순위가 예측으로 완전 고정되면 "기대 대비"가 무의미(운 제거)
const controlOk = Math.abs(meanShuf) < 0.15; // 무작위 대조는 0 근처(오라클이 신호를 실제로 잰다)
const ok = signal && notDeterministic && controlOk;
log(ok
  ? `\n✅ 적정 상관대 — 신호 유의(ρ ${meanRho.toFixed(3)} > 무작위 ${meanShuf.toFixed(3)}) · 완전결정 아님(불확실성 보존)`
  : `\n❌ 상관 이상 — signal ${signal} · notDet ${notDeterministic} · control ${controlOk}`);
process.exit(ok ? 0 : 1);
