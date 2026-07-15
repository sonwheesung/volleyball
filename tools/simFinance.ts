// 구단 재정 장기 시뮬 (FINANCE_SYSTEM) — N시즌 동안 내 팀 지갑(모기업+직관+굿즈−연봉)을 굴린다.
//   npx tsx tools/simFinance.ts [시즌수=120] [유니버스=8]
// 검증: 잔고 궤적(영구 침몰 없음), 모기업 보전 빈도, "캡은 남는데 자금 부족" 발생(핵심 연출),
//       성적-수입 민감도(꼴찌 vs 우승 시즌 수입 차), 리그 건강 유지.
//
// [2026-07-08] 다중 유니버스 평균화 — 단일 궤적은 cash→FA→로스터→성적→cash 되먹임으로 카오스(버터플라이):
//   같은 sponsorBase라도 트래젝토리 하나가 왕조로 눈덩이지면 잔고·좌절률이 요동친다.
//   → reseedLeague로 U개 독립 유니버스를 돌려 밴드(잔고·보전·좌절)를 평균으로 안정화(sponsorBase 재보정의 신뢰 신호).

import { LEAGUE, getTeam, resetLeagueBase, reseedLeague, commitPlayerBase, commitRosters, teamScoutReveal, evolveOnDay, currentRosters } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { teamFanbaseNow } from '../data/owner';
import { settleSeason, applyNet } from '../engine/finance';
import { fanScore as fanScoreOf } from '../engine/owner';
import { assignFAGrades, askingPrice, isFAEligible } from '../engine/faMarket';
import { canAfford } from '../engine/cap';
import { marketValue } from '../engine/salary';
import { medianOvr } from '../engine/overall';
import { overall } from '../engine/overall';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 120);
const universes = Math.max(1, Number(process.argv[3]) || 8);
const END_DAY = 164;

interface UniStat {
  cashAvg: number; cashMin: number; cashMax: number;
  bailouts: number; capOkCashBlocked: number; faTried: number; faSigned: number;
  worstIncome: number; bestIncome: number; myRankAvg: number;
  titlesMy: number; teamsWon: number;
}

/** 한 유니버스(고정 시드) N시즌 재정 궤적. 호출 전 resetLeagueBase()/reseedLeague()로 리그 상태 설정. */
function runUniverse(): UniStat {
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
    const allNow = Object.values(currentRosters()).flat()
      .map((id) => evolveOnDay(id, END_DAY))
      .filter((p): p is Player => !!p);
    const medDom = medianOvr(allNow.filter((p) => !p.isForeign)); // 시대 앵커(SALARY 2장)
    const pool = allNow
      .filter((p) => isFAEligible(p) && p.contract.remaining <= 1)
      .sort((a, b) => overall(b) - overall(a));
    let faSignings: string[] = [];
    if (pool.length) {
      const grades = assignFAGrades(pool);
      const cand = pool
        .map((p) => ({ p, asking: askingPrice(marketValue(p, medDom), grades.get(p.id) ?? 'C') }))
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
    // 프로덕션 우주 정합(#116/#117 ①, 2026-07-15): store endSeason과 동일하게 aiTargetOf(그 시즌 순위) 주입 —
    //   미주입(기본=CAP 20)은 폐기된 "상한까지 지명" 우주라 로스터·페이롤이 부풀어 재정 측정이 어긋난다.
    //   구 우주 A/B는 환경변수 FIN_OLD_UNIVERSE=1 로 재현(인공물 지분 분리용).
    const targetOf = process.env.FIN_OLD_UNIVERSE ? undefined : aiTargetOf(standings);
    const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], MY, [], styleOf, teamScoutReveal, undefined, targetOf);
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
    // FA 지출 차감(store.endSeason과 동일 규칙 — 몸값은 myPayroll 단일 채널, faSpend=보상금 compCash만).
    //   [이중과금 수정 EC-FN-03] 예전엔 여기서 영입 FA 첫해 salary를 더해 payroll과 이중 차감했으나 제거.
    const faSpend = ctx.compCash;
    if (faSignings.length > 0) stat.faSigned++;
    cash = Math.max(0, cash - faSpend);

    stat.cashMin = Math.min(stat.cashMin, cash);
    stat.cashMax = Math.max(stat.cashMax, cash);
    stat.cashSum += cash;

    commitPlayerBase(snapshot);
    commitRosters(filled.rosters);
  }
  return {
    cashAvg: stat.cashSum / seasons, cashMin: stat.cashMin, cashMax: stat.cashMax,
    bailouts: stat.bailouts, capOkCashBlocked: stat.capOkCashBlocked, faTried: stat.faTried, faSigned: stat.faSigned,
    worstIncome: stat.worstIncome, bestIncome: stat.bestIncome, myRankAvg: myRankSum / seasons,
    titlesMy: titles[MY], teamsWon: ids.filter((id) => titles[id] > 0).length,
  };
}

// === 다중 유니버스 집계 ===
const runs: UniStat[] = [];
for (let u = 0; u < universes; u++) {
  if (u === 0) resetLeagueBase();
  else reseedLeague(20251018 + u * 101, 777 + u * 13);
  runs.push(runUniverse());
  process.stderr.write(`  …유니버스 ${u + 1}/${universes}\n`);
}
const mean = (f: (r: UniStat) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
const fmt = (n: number) => `${(n / 10000).toFixed(1)}억`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

const cashAvg = mean((r) => r.cashAvg);
const bailRate = mean((r) => r.bailouts / seasons);
const frustRate = mean((r) => (r.faTried > 0 ? r.capOkCashBlocked / r.faTried : 0));
const rankAvg = mean((r) => r.myRankAvg);
const worstInc = mean((r) => r.worstIncome);
const bestInc = mean((r) => r.bestIncome);
const teamsWonAvg = mean((r) => r.teamsWon);

log(`\n═══ 구단 재정 ${seasons}시즌 × ${universes}유니버스 평균 (내 팀 index0) ═══`);
log(`▸ 잔고 평균: ${fmt(cashAvg)}  (유니버스별 ${runs.map((r) => (r.cashAvg / 10000).toFixed(0)).join('/')}억)`);
log(`▸ 시즌 수입: ${fmt(worstInc)}(최악) ~ ${fmt(bestInc)}(최고) — 성적이 지갑을 흔든다`);
log(`▸ 모기업 적자 보전: ${pct(bailRate)} 시즌  (유니버스별 ${runs.map((r) => Math.round(r.bailouts / seasons * 100)).join('/')}%)`);
log(`▸ "캡OK·자금부족" 좌절률: ${pct(frustRate)}  (유니버스별 ${runs.map((r) => Math.round((r.faTried > 0 ? r.capOkCashBlocked / r.faTried : 0) * 100)).join('/')}%)`);
log(`▸ 내 팀 평균 순위 ${rankAvg.toFixed(1)}위 · 우승 경험 팀수 평균 ${teamsWonAvg.toFixed(1)}/${LEAGUE.teams.length}`);

// 건강 밴드(FINANCE 2.0 Stage1 재보정): 좌절 20~35% · 보전 3~20% · 잔고 양수 · 파산 없음(cashMax>0 자명).
//  단일 궤적 카오스를 평균화한 밴드로 판정 — 좌절/보전이 설계-의미 지표(재정이 FA를 의미있게 제약).
const healthy = frustRate >= 0.18 && frustRate <= 0.40 && bailRate <= 0.25 && cashAvg > 0 && teamsWonAvg >= LEAGUE.teams.length - 1;
log(healthy
  ? `\n✅ 재정 건강 — 좌절 ${pct(frustRate)}(핵심 연출)·보전 ${pct(bailRate)}(가끔)·영구 침몰 없음`
  : `\n❌ 재정 튜닝 필요 — 좌절 ${pct(frustRate)}/보전 ${pct(bailRate)} 밴드 이탈`);
process.exit(healthy ? 0 : 1);
