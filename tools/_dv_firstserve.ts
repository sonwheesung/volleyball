// 가드 — "5세트 첫 서브 = 코인토스"(MATCH_SYSTEM v2.1). 실제 배구: 결승 세트는 새 코인토스로 첫 서브를 정한다
//   (1~4세트의 홀짝 교대를 잇지 않는다). 구 코드는 5세트(홀수)에 항상 홈이 먼저 서브 → 결승 세트 체계적 편향.
//   npx tsx tools/_dv_firstserve.ts [N=8000]
//   관측: 각 매치 5세트의 **첫 리시버**(recvId)는 받는 팀 → 첫 서버는 그 반대 팀. 서로 다른 두 팀(고유 id)이라 귀속 가능.
//   (A) 수정: 5세트 홈-선서브 비율 ≈ 50%(코인토스). 구 코드(결정론)면 100% → |z|가 폭발(강한 teeth).
//   (B) 측정장치 민감도: 1~4세트(결정론 첫서브)에서 받는 팀 사이드아웃 이점이 검출돼야(허위 오라클 차단).
import './_gt_mock';
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';

resetLeagueBase();
const N = Number(process.argv[2]) || 8000;
const ids = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) if (i !== j) pairs.push([ids[i], ids[j]]);

let homeFirst5 = 0, s5Total = 0;   // 5세트 첫 서브가 홈인 매치 수
let fsWins14 = 0, sets14 = 0;      // 1~4세트: 첫 서브팀(결정론)이 그 세트 승리?
let s = 0;

for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const homeIds = new Set(A.map((p) => p.id));
  const sim = simulateMatch(++s, A, B, { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any);

  // 1~4세트 첫 서브권 효과(결정론 홀짝)
  for (let i = 0; i < Math.min(4, sim.setScores.length); i++) {
    const sc = sim.setScores[i];
    const setWinner: 'home' | 'away' = sc.home > sc.away ? 'home' : 'away';
    const firstServer: 'home' | 'away' = (i + 1) % 2 === 1 ? 'home' : 'away';
    sets14++;
    if (setWinner === firstServer) fsWins14++;
  }

  // 5세트 첫 서버 재구성: 첫 set5 포인트의 recvId(받는 팀) → 서버는 반대 팀
  if (sim.setScores.length >= 5) {
    const firstS5 = sim.points.find((p) => p.setNo === 5 && p.recvId);
    if (firstS5 && firstS5.recvId) {
      const recvHome = homeIds.has(firstS5.recvId);
      const firstServerHome = !recvHome; // 받는 쪽이 홈이면 서브는 원정
      s5Total++;
      if (firstServerHome) homeFirst5++;
    }
  }
}

const pct = (x: number, n: number) => (n ? (100 * x / n).toFixed(2) + '%' : 'n/a');
const z = (x: number, n: number) => (n ? (x / n - 0.5) / Math.sqrt(0.25 / n) : 0);
const zf = (x: number, n: number) => z(x, n).toFixed(1);

const z5 = z(homeFirst5, s5Total);    // 코인토스면 ~0, 결정론(구코드)이면 +대폭(100%)
const z14 = z(fsWins14, sets14);      // 받는팀 이점 → 음수 뚜렷
const fixOK = Math.abs(z5) < 4;       // 5세트 첫 서브 홈/원정 균등(코인토스)
const sensitivityOK = z14 < -3;       // 측정 장치가 서브 효과를 잡는다(허위 오라클 아님)

console.log(`=== 5세트 코인토스 검증 (서로 다른 두 팀, N=${N}) ===`);
console.log(`  (A) 5세트 ${s5Total}개 · 첫 서브 홈 비율: ${pct(homeFirst5, s5Total)} (z=${zf(homeFirst5, s5Total)}σ) — 코인토스면 ~50%, 구 결정론이면 100%`);
console.log(`  (B) 1~4세트 ${sets14}개 · 첫 서브팀 세트 승률: ${pct(fsWins14, sets14)} (z=${zf(fsWins14, sets14)}σ) — 받는팀 사이드아웃 이점(측정 민감도)`);
console.log(`\n  수정 확인(5세트 첫 서브 균등, |z|<4): ${fixOK} ${fixOK ? '✓' : '✗ — 5세트가 코인토스가 아님(편향)'}`);
console.log(`  측정장치 민감도(1~4세트 첫서브 불이익, z<-3): ${sensitivityOK} ${sensitivityOK ? '✓' : '✗ (허위 오라클 의심)'}`);
console.log(`\nRESULT: ${fixOK && sensitivityOK ? 'PASS' : 'FAIL'}`);
if (!(fixOK && sensitivityOK)) process.exit(1);
