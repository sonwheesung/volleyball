// A/B 인과 검증 — 같은 약체 팀을 (스태프 풀세트) vs (무스태프)로 각각 N시즌 운영.
//   npx tsx tools/abStaff.ts [시즌=100]
// 같은 리그 시드에서 스태프만 차이 → 부흥이 운이 아니라 단장 결정(스태프) 덕인지 확인.

import {
  LEAGUE, getTeam, resetLeagueBase, getEvolvedTeamPlayers,
  availableCoaches, hireHeadCoach, availableAssistants, hireAssistant, availableScouts, hireScout,
} from '../data/league';
import { runUniverse } from './simLeague';
import { teamOverall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');

function weakestTeam(): string {
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  return ids.map((id) => ({ id, ovr: teamOverall(getEvolvedTeamPlayers(id, 164)) })).sort((a, b) => a.ovr - b.ovr)[0].id;
}

function run(seasons: number, my: string, withStaff: boolean) {
  resetLeagueBase();
  const startOvr = teamOverall(getEvolvedTeamPlayers(my, 164));
  if (withStaff) {
    const fc = availableCoaches().sort((a, b) => b.matchOps - a.matchOps)[0];
    if (fc) hireHeadCoach(my, fc.id);
    for (const sp of ['attack', 'defense', 'setter'] as const) {
      const a = availableAssistants().filter((x) => x.specialty === sp).sort((x, y) => y.rating - x.rating)[0];
      if (a) hireAssistant(my, a.id);
    }
    const sc = availableScouts().sort((a, b) => b.scouting - a.scouting)[0];
    if (sc) hireScout(my, sc.id);
  }
  const u = runUniverse(seasons);
  return { startOvr, titles: u.titles[my], avgRank: u.rankSum[my] / seasons, finalOvr: teamOverall(getEvolvedTeamPlayers(my, 164)), best: Math.min(...u.rankHistory[my]) };
}

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  const my = weakestTeam();
  log(`\n═══ A/B 인과 검증 — ${getTeam(my)?.name}(최약체) · ${seasons}시즌 ═══`);
  process.stderr.write('▶ 무스태프 운영…\n');
  const off = run(seasons, my, false);
  process.stderr.write('▶ 풀스태프 운영…\n');
  const on = run(seasons, my, true);

  log(`\n지표              무스태프    풀스태프    차이`);
  log(`시작 전력         ${off.startOvr}         ${on.startOvr}         (동일 출발)`);
  log(`통산 우승         ${String(off.titles).padStart(3)}회       ${String(on.titles).padStart(3)}회       ${on.titles - off.titles >= 0 ? '+' : ''}${on.titles - off.titles}`);
  log(`평균순위          ${off.avgRank.toFixed(1)}위      ${on.avgRank.toFixed(1)}위      ${(on.avgRank - off.avgRank).toFixed(1)} ${on.avgRank < off.avgRank ? '(상승)' : ''}`);
  log(`최고순위          ${off.best}위        ${on.best}위`);
  log(`최종 전력         ${off.finalOvr}         ${on.finalOvr}         ${on.finalOvr - off.finalOvr >= 0 ? '+' : ''}${on.finalOvr - off.finalOvr}`);
  log(`\n→ 같은 출발·같은 리그에서 스태프만 차이. 풀스태프가 우승·순위·전력 모두 앞서면 부흥은 단장 결정 덕.`);
}

main();
