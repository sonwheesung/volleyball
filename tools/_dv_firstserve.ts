// 가드 — "5세트 첫 서브 = 코인토스"(MATCH_SYSTEM v2.1)가 (a)엔진서 일어나고 (b)보드까지 정확히 반영되나.
//   실제 배구: 결승 세트는 새 코인토스로 첫 서브를 정함(1~4세트 홀짝 교대를 잇지 않음).
//   npx tsx tools/_dv_firstserve.ts [N=8000]
//   (A) 엔진 sim.setFirstServers[4] 홈 비율 ≈ 50%(코인토스 공정) + 1~4세트는 홀짝 교대 정확.
//   (B) 측정 민감도: 1~4세트(결정론 첫서브) 받는 팀 사이드아웃 이점 검출(허위 오라클 차단).
//   (C) 교차계층 정합: 엔진값 == 독립 오라클(첫 set5 point의 recvId/scorer) == 보드 reconstructRallies 시작 서브.
//       소스 revert(courtDirector/engine) 시 (C) 불일치 폭발 = teeth.
import './_gt_mock';
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies } from '../components/courtDirector';

resetLeagueBase();
const N = Number(process.argv[2]) || 8000;
const ids = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) if (i !== j) pairs.push([ids[i], ids[j]]);

let homeFirst5 = 0, s5Total = 0;       // 엔진 setFirstServers[4]==home
let fsWins14 = 0, sets14 = 0;          // 1~4세트 첫서브팀 세트 승률(민감도)
let alt14Bad = 0;                      // 1~4세트 첫서브가 홀짝 교대와 어긋난 수(0이어야)
let xlayerBad = 0, xlayerChecked = 0;  // (C) 엔진==독립오라클==보드 불일치 수(0이어야)
let s = 0;

for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const homeIds = new Set(A.map((p) => p.id));
  const sim = simulateMatch(++s, A, B, { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any);
  const fs = sim.setFirstServers ?? [];

  // 1~4세트: 첫서브 효과(민감도) + 홀짝 교대 정확성
  for (let i = 0; i < Math.min(4, sim.setScores.length); i++) {
    const sc = sim.setScores[i];
    const setWinner: 'home' | 'away' = sc.home > sc.away ? 'home' : 'away';
    const expect: 'home' | 'away' = (i + 1) % 2 === 1 ? 'home' : 'away';
    sets14++;
    if (setWinner === fs[i]) fsWins14++;
    if (fs[i] !== expect) alt14Bad++;
  }

  if (sim.setScores.length >= 5) {
    s5Total++;
    if (fs[4] === 'home') homeFirst5++;

    // (C) 독립 오라클: 5세트 첫 point의 recvId = 리시버 → 첫 서버 = 그 반대 팀(정확).
    //   리시버 없는 오프닝(서브범실·포지션폴트 등 ~0.4%)은 단일 point로 서버를 단정 못 해 (C)에서 제외
    //   — 엔진값(A)이 전수 커버하고, 보드가 깨지면 recvId 있는 오프닝 ~1000건이 어긋나 teeth는 유지.
    const pt1 = sim.points.find((p) => p.setNo === 5);
    if (pt1 && pt1.recvId) {
      const indepFS: 'home' | 'away' = homeIds.has(pt1.recvId) ? 'away' : 'home';
      const boardFS = reconstructRallies(sim).find((r) => r.setNo === 5)?.serving;
      xlayerChecked++;
      if (!(fs[4] === indepFS && boardFS === fs[4])) xlayerBad++;
    }
  }
}

const pct = (x: number, n: number) => (n ? (100 * x / n).toFixed(2) + '%' : 'n/a');
const z = (x: number, n: number) => (n ? (x / n - 0.5) / Math.sqrt(0.25 / n) : 0);
const zf = (x: number, n: number) => z(x, n).toFixed(1);

const coinFair = Math.abs(z(homeFirst5, s5Total)) < 4;   // 5세트 코인 균등
const altOK = alt14Bad === 0;                            // 1~4세트 홀짝 정확
const sensitivityOK = z(fsWins14, sets14) < -3;          // 측정 민감도
const xlayerOK = xlayerBad === 0;                        // 교차계층 정합

console.log(`=== 5세트 코인토스: 발생 + 보드 반영 검증 (N=${N}) ===`);
console.log(`  (A) 엔진 5세트 첫서브 홈 비율: ${pct(homeFirst5, s5Total)} (z=${zf(homeFirst5, s5Total)}σ, ${s5Total}경기) — 코인이면 ~50%`);
console.log(`      1~4세트 홀짝 교대 어긋남: ${alt14Bad}건 (0이어야)`);
console.log(`  (B) 1~4세트 첫서브팀 세트승률: ${pct(fsWins14, sets14)} (z=${zf(fsWins14, sets14)}σ) — 받는팀 이점(민감도)`);
console.log(`  (C) 교차계층 정합(엔진==독립오라클==보드): 불일치 ${xlayerBad}/${xlayerChecked}건 (0이어야)`);
console.log(`\n  코인 공정 |z|<4: ${coinFair} · 홀짝 정확: ${altOK} · 측정민감도 z<-3: ${sensitivityOK} · 보드반영 0불일치: ${xlayerOK}`);
const pass = coinFair && altOK && sensitivityOK && xlayerOK;
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
if (!pass) process.exit(1);
