// 시상식 sanity — 시드 리그 0시즌을 풀시뮬하고 시상 결과를 출력.
//   npx tsx tools/simAwards.ts
import { resetLeagueBase, getPlayer, getTeam } from '../data/league';
import { currentSeasonAwards } from '../data/awards';
import type { AwardWinner } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const short = (tid: string) => (getTeam(tid)?.name ?? tid).split(' ').slice(-1)[0];
const nm = (w: AwardWinner | null, unit = '') =>
  !w ? '—' : `${getPlayer(w.playerId)?.name ?? w.playerId} (${short(w.teamId)}) ${w.value}${unit}`;

resetLeagueBase();
const a = currentSeasonAwards(0);

log('\n═══ 0시즌 시상식 ═══');
log(`정규 MVP    : ${nm(a.mvp)}`);
log(`챔프전 MVP  : ${nm(a.finalsMvp)}`);
log(`신인상      : ${nm(a.rookie)}`);
log(`기량발전상  : ${nm(a.mostImproved, ' OVR')}`);
log('\n── 부문 기록왕 ──');
log(`득점왕  ${nm(a.titles.scoring)}`);
log(`공격상  ${nm(a.titles.spike)}`);
log(`블로킹왕 ${nm(a.titles.block)}`);
log(`서브왕  ${nm(a.titles.serve)}`);
log(`디그왕  ${nm(a.titles.dig)}`);
log(`세트왕  ${nm(a.titles.set)}`);
log('\n── 베스트7 ──');
for (const s of a.best7) log(`${s.pos.padEnd(3)} ${nm(s.winner)}`);
log('\n── 라운드 MVP ──');
a.roundMvps.forEach((w, i) => log(`R${i + 1}  ${nm(w)}`));
log('');
