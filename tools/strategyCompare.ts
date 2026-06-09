// 단장 전략 비교 — 같은 약체 팀을 서로 다른 스태프 구성으로 N시즌 운영.
//   npx tsx tools/strategyCompare.ts [시즌=100]
// 코치 집중 vs 스카우터 집중 vs 균형 → 스태프 역할이 의미 있는 전략 선택인지 검증.

import {
  LEAGUE, getTeam, resetLeagueBase, getEvolvedTeamPlayers,
  availableCoaches, hireHeadCoach, availableAssistants, hireAssistant, availableScouts, hireScout,
  staffSpend, teamScoutReveal,
} from '../data/league';
import { runUniverse } from './simLeague';
import { teamOverall } from '../engine/overall';
import { formatMoney } from '../engine/salary';
import type { CoachSpecialty } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

function weakest(): string {
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  return ids.map((id) => ({ id, ovr: teamOverall(getEvolvedTeamPlayers(id, 164)) })).sort((a, b) => a.ovr - b.ovr)[0].id;
}

interface Strat { name: string; coaches: CoachSpecialty[]; scouts: number }
const STRATS: Strat[] = [
  { name: '무스태프(기준)', coaches: [], scouts: 0 },
  { name: '코치 집중(3)', coaches: ['attack', 'defense', 'setter'], scouts: 0 },
  { name: '균형(코치2+스카1)', coaches: ['attack', 'defense'], scouts: 1 },
  { name: '스카우터 집중(코치1+스카3)', coaches: ['attack'], scouts: 3 },
  { name: '노쇠/멘탈(체력+멘탈+공격)', coaches: ['stamina', 'mental', 'attack'], scouts: 0 },
];

function run(seasons: number, my: string, st: Strat) {
  resetLeagueBase();
  const head = availableCoaches().sort((a, b) => b.charisma - a.charisma)[0];
  if (head) hireHeadCoach(my, head.id);
  for (const sp of st.coaches) {
    const a = availableAssistants().filter((x) => x.specialty === sp).sort((x, y) => y.rating - x.rating)[0];
    if (a) hireAssistant(my, a.id);
  }
  let scoutsHired = 0;
  for (let k = 0; k < st.scouts; k++) {
    const sc = availableScouts().sort((a, b) => b.scouting - a.scouting)[0];
    if (sc && hireScout(my, sc.id)) scoutsHired++;
  }
  const spend = staffSpend(my);
  const reveal = teamScoutReveal(my);
  const u = runUniverse(seasons);
  return { titles: u.titles[my], avgRank: u.rankSum[my] / seasons, finalOvr: teamOverall(getEvolvedTeamPlayers(my, 164)), best: Math.min(...u.rankHistory[my]), spend, reveal, scoutsHired };
}

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  const my = weakest();
  resetLeagueBase();
  const startOvr = teamOverall(getEvolvedTeamPlayers(my, 164));
  log(`\n═══ 단장 전략 비교 — ${getTeam(my)?.name}(최약체 ${startOvr}) · ${seasons}시즌 ═══`);
  log(`전략                          지출      공개도  우승   평균순위  최고  최종전력`);
  for (const st of STRATS) {
    const r = run(seasons, my, st);
    log(`  ${st.name.padEnd(26)} ${formatMoney(r.spend).padStart(6)}  ${String(Math.round(r.reveal * 100)).padStart(3)}%  ${String(r.titles).padStart(3)}회  ${r.avgRank.toFixed(1).padStart(4)}위  ${r.best}위   ${r.finalOvr}`);
  }
  log(`\n→ 전략마다 우승·순위가 갈리면 "어떤 스태프를 둘지"가 의미 있는 단장 결정.`);
}

main();
