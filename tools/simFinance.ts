// 구단 재정 장기 시뮬 (FINANCE_SYSTEM) — N시즌 동안 내 팀 지갑(모기업+직관+굿즈−연봉)을 굴린다.
//   npx tsx tools/simFinance.ts [시즌수=120]
// 검증: 잔고 궤적(영구 침몰 없음), 모기업 보전 빈도, "캡은 남는데 자금 부족" 발생(핵심 연출),
//       성적-수입 민감도(꼴찌 vs 우승 시즌 수입 차), 리그 건강 유지.

import { LEAGUE, getTeam, resetLeagueBase, commitPlayerBase, commitRosters, teamScoutReveal, evolveOnDay, currentRosters } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { teamFanbaseNow } from '../data/owner';
import { settleSeason, applyNet } from '../engine/finance';
import { fanScore as fanScoreOf } from '../engine/owner';
import { assignFAGrades, askingPrice, isFAEligible } from '../engine/faMarket';
import { canAfford } from '../engine/cap';
import { marketValue } from '../engine/salary';
import { overall } from '../engine/overall';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 120);
const END_DAY = 164;

resetLeagueBase();
const MY = LEAGUE.teams[0].id;
const ids = LEAGUE.teams.map((t) => t.id);

const stat = {
  cashMin: Number.MAX_SAFE_INTEGER, cashMax: 0, cashSum: 0,
  bailouts: 0, capOkCashBlocked: 0, faTried: 0, faSigned: 0,
  worstIncome: Number.MAX_SAFE_INTEGER, bestIncome: 0,
};
const titles: Record<string, number> = {};
for (const id of ids) titles[id] = 0;
let myRankSum = 0;
let cash = 50000;
let fan = 50;
const cashTrail: number[] = [];

for (let s = 0; s < seasons; s++) {
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const myRank = Math.max(1, standings.findIndex((r) => r.teamId === MY) + 1);
  myRankSum += myRank;
  const po = buildPlayoffs(s);
  const champ = po.championId ?? standings[0].teamId;
  titles[champ]++;
  const runnerUp = po.final ? (po.final.hiId === champ ? po.final.loId : po.final.hiId) : null;
  const myRow = standings.find((r) => r.teamId === MY)!;
  const winRate = myRow.wins / Math.max(1, myRow.wins + myRow.losses);

  // 재정 정산
  const fb = teamFanbaseNow(MY, END_DAY, fan, []);
  const payroll = (currentRosters()[MY] ?? []).reduce((sum, id) => sum + (evolveOnDay(id, END_DAY)?.contract.salary ?? 0), 0);
  const fin = settleSeason({
    teamId: MY, rank: myRank, teamCount: standings.length,
    champion: champ === MY, runnerUp: runnerUp === MY,
    winRate, fan, fanTotal: fb.total, playerFansTotal: fb.playerFansTotal,
    payroll, staff: 0, cashBefore: cash,
  });
  const settled = applyNet(cash, fin.net);
  cash = settled.cash;
  if (settled.bailout) stat.bailouts++;
  stat.worstIncome = Math.min(stat.worstIncome, fin.income);
  stat.bestIncome = Math.max(stat.bestIncome, fin.income);
  fan = fanScoreOf(winRate, champ === MY, 0);

  // 오프시즌: 매 시즌 최고 FA 1명을 노린다 — "캡은 OK인데 자금이 막는" 케이스 측정
  const myPayrollNow = payroll;
  const pool = Object.values(currentRosters()).flat()
    .map((id) => evolveOnDay(id, END_DAY))
    .filter((p): p is Player => !!p && isFAEligible(p) && p.contract.remaining <= 1)
    .sort((a, b) => overall(b) - overall(a));
  let faSignings: string[] = [];
  if (pool.length) {
    // 캡 안에서 노릴 수 있는 가장 비싼 FA — 그래야 "캡 OK·자금 부족" 게이트가 측정된다
    const grades = assignFAGrades(pool);
    const cand = pool
      .map((p) => ({ p, asking: askingPrice(marketValue(p), grades.get(p.id) ?? 'C') }))
      .find((c) => canAfford(myPayrollNow, c.asking));
    if (cand) {
      stat.faTried++;
      const cashOk = cand.asking <= cash;
      if (!cashOk) stat.capOkCashBlocked++;
      else faSignings = [cand.p.id];
    }
  }

  const ctx = buildDraftContext(MY, {}, {}, faSignings, false, [], s + 1, undefined, cash);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], MY, [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = seasonProd.get(id);
    if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
    const prev = ctx.prevTeamOf[id];
    if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
  }
  // FA 지출 차감(store.endSeason과 동일 규칙)
  let faSpend = 0;
  for (const id of filled.rosters[MY] ?? []) {
    const prev = ctx.prevTeamOf[id];
    if (prev && prev !== MY) faSpend += snapshot[id]?.contract.salary ?? 0;
  }
  if (faSpend > 0) stat.faSigned++;
  cash = Math.max(0, cash - faSpend);

  stat.cashMin = Math.min(stat.cashMin, cash);
  stat.cashMax = Math.max(stat.cashMax, cash);
  stat.cashSum += cash;
  cashTrail.push(cash);

  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  if ((s + 1) % 20 === 0) process.stderr.write(`  …${s + 1}/${seasons}\n`);
}

const fmt = (n: number) => `${(n / 10000).toFixed(1)}억`;
log(`\n═══ 구단 재정 ${seasons}시즌 (내 팀: ${getTeam(MY)?.name}) ═══`);
log(`▸ 잔고: 평균 ${fmt(stat.cashSum / seasons)} · 범위 ${fmt(stat.cashMin)}~${fmt(stat.cashMax)}`);
log(`▸ 시즌 수입: ${fmt(stat.worstIncome)}(최악) ~ ${fmt(stat.bestIncome)}(최고) — 성적이 지갑을 흔든다`);
log(`▸ 모기업 적자 보전: ${stat.bailouts}회 (${(stat.bailouts / seasons * 100).toFixed(0)}% 시즌)`);
log(`▸ "캡은 남는데 자금 부족"으로 입찰 좌절: ${stat.capOkCashBlocked}회 / FA 도전 ${stat.faTried}회 (영입 성사 ${stat.faSigned})`);
log(`▸ 내 팀 평균 순위 ${(myRankSum / seasons).toFixed(1)}위 · 우승 분포 ${ids.map((id) => titles[id]).join('/')}`);
const tArr = ids.map((id) => titles[id]);
const healthy = stat.cashMax > 0 && tArr.filter((t) => t > 0).length >= ids.length - 1
  && stat.capOkCashBlocked > 0 && stat.bailouts < seasons * 0.5;
log(healthy
  ? `\n✅ 재정 건강 — 핵심 연출(캡OK·자금부족) 발생, 영구 침몰 없음, 보전은 가끔`
  : `\n❌ 재정 튜닝 필요`);
process.exit(healthy ? 0 : 1);
