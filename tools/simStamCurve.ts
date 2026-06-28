// 체력 곡선 가드(2026-06-28) — 경기 중 체력이 실제로 빠지고 세트가 쌓일수록 누적되는지 검증.
// 옛 버그(회복≈소모로 전 세트 평균 ~95% 평탄 → 체력 무의미)를 회귀로 막는다. 타임아웃 시점 코트 체력을
// 세트별 집계(사용자가 보는 그 값). PASS: ① 세트1→세트5 가시적 하락(≥8%p) ② 세트5 평균이 합리 밴드(60~82%).
import { LEAGUE, getEvolvedTeamPlayers } from '../data/league';
import { simulateMatch } from '../engine/match';

const N = Number(process.argv[2] || 3000);
const home = getEvolvedTeamPlayers(LEAGUE.teams[0].id, 0);
const away = getEvolvedTeamPlayers(LEAGUE.teams[1].id, 0);

const bySet: Record<number, { sum: number; cnt: number }> = {};
for (let i = 0; i < N; i++) {
  const sim = simulateMatch(1000 + i, home, away);
  for (const t of sim.timeouts ?? []) {
    const vals = [...t.stamHome.map((s) => s.stam), ...t.stamAway.map((s) => s.stam)];
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const a = (bySet[t.setNo] ??= { sum: 0, cnt: 0 });
    a.sum += avg; a.cnt++;
  }
}
const avgOf = (set: number) => (bySet[set] ? (bySet[set].sum / bySet[set].cnt) * 100 : NaN);
const s1 = avgOf(1), s5 = avgOf(5);
console.log(`세트별 타임아웃 코트 평균 체력 (N=${N}):`);
for (const s of [1, 2, 3, 4, 5]) console.log(`  ${s}세트: ${avgOf(s).toFixed(1)}%`);

const drop = s1 - s5;
const visible = drop >= 8;            // 세트 누적 피로가 보인다(평탄-95 회귀 차단)
const inBand = s5 >= 60 && s5 <= 82;  // 과소/과다 드레인 차단
console.log(`\n세트1→세트5 하락 ${drop.toFixed(1)}%p (≥8 필요) → ${visible ? '✅' : '❌'}`);
console.log(`세트5 평균 ${s5.toFixed(1)}% (60~82 밴드) → ${inBand ? '✅' : '❌'}`);
const ok = visible && inBand;
console.log(ok ? '\n✅ 체력 곡선 정상 — 경기 중 빠지고 세트 누적' : '\n❌ FAIL — 체력 곡선 점검(회복/소모 튜닝)');
process.exit(ok ? 0 : 1);
