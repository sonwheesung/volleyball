// 독립 검증(분포) — 경기 결과(세트 스코어) 분포 + 홈 승률 + matchPoints 분포.
// 불변식: 3-0/3-1/3-2 가 합리적 분포(어느 한 결과에 0/100 붙음 없음), 홈/원정 균형(편향 없음),
//   matchPoints 합이 항상 3(완승) 또는 3(2+1, 풀세트) — 즉 패자 0 또는 1.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { matchPoints } from '../data/standings';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '20000', 10);
const teams = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < teams.length; i++) for (let j = 0; j < teams.length; j++) if (i !== j) pairs.push([teams[i], teams[j]]);

const out: Record<string, number> = { '3-0': 0, '3-1': 0, '3-2': 0 };
let homeWin = 0, total = 0, ptsBad = 0, fiveSet = 0;
let s = 0;
for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const sim = simulateMatch(++s, A, B, { home: coachInfoOf(ta), away: coachInfoOf(tb) });
  const w = Math.max(sim.homeSets, sim.awaySets), l = Math.min(sim.homeSets, sim.awaySets);
  out[`${w}-${l}`]++;
  total++;
  if (sim.homeSets > sim.awaySets) homeWin++;
  if (sim.homeSets + sim.awaySets === 5) fiveSet++;
  // matchPoints 불변식: 승자+패자 = 3(완승 3+0) 또는 3(풀세트 2+1)
  const [wp, lp] = matchPoints(w, l);
  if (!((wp === 3 && lp === 0) || (wp === 2 && lp === 1))) ptsBad++;
}
log(`=== 세트 스코어 분포 (N=${total}경기) ===`);
for (const k of ['3-0', '3-1', '3-2']) log(`  ${k}: ${(out[k] / total * 100).toFixed(1)}%  (${out[k]})`);
log(`  └ 풀세트(5세트) 비율: ${(fiveSet / total * 100).toFixed(1)}%  (KOVO 통상 ~20~25%)`);
log(`\n홈 승률: ${(homeWin / total * 100).toFixed(2)}%  (편향 없으면 ~50%, 홈어드밴티지 있으면 >50)`);
log(`matchPoints 불변식 위반: ${ptsBad}건  ${ptsBad === 0 ? 'PASS' : 'FAIL'}`);

// A/B 자가검증: 불변식 술어가 *깨진* matchPoints 쌍을 정말 거부하나(허위 오라클 차단).
const ok2 = (wp: number, lp: number): boolean => (wp === 3 && lp === 0) || (wp === 2 && lp === 1);
const broken: [number, number][] = [[3, 2], [2, 2], [3, 3], [1, 1], [3, 1], [0, 0]];
const abCaught = broken.filter(([wp, lp]) => !ok2(wp, lp)).length;
const valid: [number, number][] = [[3, 0], [2, 1]];
const abValidPass = valid.every(([wp, lp]) => ok2(wp, lp));
log(`[A/B] 깨진 matchPoints ${broken.length}종 거부 = ${abCaught}/${broken.length} · 정상 2종 통과 = ${abValidPass} → ${abCaught === broken.length && abValidPass ? 'PASS(오라클 이빨)' : 'FAIL'}`);

// 분포 sanity: 세 결과 모두 출현(0/100 붙음 없음)·홈승률 밴드·풀세트 합리·불변식 0
const allPresent = out['3-0'] > 0 && out['3-1'] > 0 && out['3-2'] > 0;
const homeBand = homeWin / total >= 0.4 && homeWin / total <= 0.6;
const fiveBand = fiveSet / total >= 0.03 && fiveSet / total <= 0.45;
const ok = ptsBad === 0 && allPresent && homeBand && fiveBand && abCaught === broken.length && abValidPass;
log(ok ? '\n결론: ✅ 세트스코어 분포 정상·matchPoints 불변식 0위반·오라클 이빨' : '\n결론: ❌ 점검 필요');
process.exit(ok ? 0 : 1);
