// 구단주 건의 시뮬 (Phase 4) — 여러 감독(카리스마·성향)을 대상으로 선발 건의·타임아웃 건의의
// 수락률이 설계 의도대로 갈리는지 측정. + 결정론·경기 영향 범위 검증.
//   npx tsx tools/simSuggest.ts

import { LEAGUE, getEvolvedTeamPlayers, getTeamCoach, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { startSuggestAccept, benchAccept, isBigMatch } from '../engine/owner';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
let fails = 0;
const check = (ok: boolean, name: string, detail = '') => {
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

// ── 1) 선발 건의 — 카리스마 × 합리성(격차) 매트릭스 ──
log('\n═══ 구단주 건의 — 여러 감독 대상 ═══');
log('\n▸ 선발 기용 건의 수락률 (카리스마 × 건의 합리성):');
log('  카리스마   비등(gap 1.0)  애매(0.5)  무리수(0.1)');
const rates: Record<number, number[]> = {};
for (const cha of [30, 50, 70, 90]) {
  const row: number[] = [];
  for (const gapT of [1.0, 0.5, 0.1]) {
    let ok = 0;
    for (let i = 0; i < 800; i++) if (startSuggestAccept(`p${i}`, 1, 40, cha, gapT)) ok++;
    row.push(ok / 800);
  }
  rates[cha] = row;
  log(`     ${cha}      ${(row[0] * 100).toFixed(0)}%          ${(row[1] * 100).toFixed(0)}%        ${(row[2] * 100).toFixed(0)}%`);
}
check(rates[30][0] > rates[90][0], '온화한 감독이 소신파보다 잘 들어준다');
check(rates[50][0] > rates[50][2] + 0.25, '합리적 건의가 무리수보다 훨씬 잘 통한다');
check(rates[90][2] < 0.2, '소신파 감독에게 무리수는 거의 안 통한다');

// ── 2) 실제 7명 감독 프로필 ──
log('\n▸ 실제 리그 감독별 (선발 건의, 비등 케이스):');
for (const id of ids) {
  const c = getTeamCoach(id);
  if (!c) continue;
  let okS = 0, okB = 0;
  for (let i = 0; i < 600; i++) {
    if (startSuggestAccept(`q${i}`, 2, 60, c.charisma, 0.7)) okS++;
    if (benchAccept(`q${i}`, 2, 60, c.charisma, 0.7, 4, 'noResign')) okB++;
  }
  log(`  ${c.name.padEnd(8)} 카리스마 ${String(c.charisma).padStart(2)} · 선발 건의 ${(okS / 600 * 100).toFixed(0)}% · 벤치 건의 ${(okB / 600 * 100).toFixed(0)}%`);
}

// ── 3) 타임아웃 건의 — 흐름(밀림/이김)별 수락률 + 경기 영향 ──
log('\n▸ 타임아웃 건의 (경기 내 판정 — 흐름별):');
const A = getEvolvedTeamPlayers(ids[0], 0);
const B = getEvolvedTeamPlayers(ids[1], 0);
let accLosing = 0, nLosing = 0, accWinning = 0, nWinning = 0;
let identical = true, divergeAfterOnly = true;
for (let m = 0; m < 60; m++) {
  const seed = 5000 + m;
  const base = simulateMatch(seed, A, B);
  // 매 12랠리마다 홈이 건의
  const reqs = [];
  for (let r = 6; r < base.points.length; r += 12) reqs.push({ side: 'home' as const, atRally: r });
  const sim = simulateMatch(seed, A, B, { toSuggest: reqs });
  const sim2 = simulateMatch(seed, A, B, { toSuggest: reqs });
  if (JSON.stringify(sim.points) !== JSON.stringify(sim2.points)) identical = false;
  for (const resp of sim.toResponses ?? []) {
    // 건의 시점의 흐름: 직전 점수(원본 경기 기준 — 같은 시드라 그 랠리까지 동일 전개)
    const before = sim.points[resp.atRally - 1];
    if (!before) continue;
    const losing = before.home < before.away;
    if (losing) { nLosing++; if (resp.accepted) accLosing++; }
    else { nWinning++; if (resp.accepted) accWinning++; }
  }
  // 수락된 첫 건의 전까지는 경기 전개가 원본과 동일해야(그 후에만 달라짐)
  const firstAcc = (sim.toResponses ?? []).find((r) => r.accepted);
  if (firstAcc) {
    for (let i = 0; i < firstAcc.atRally && i < base.points.length; i++) {
      if (JSON.stringify(sim.points[i]) !== JSON.stringify(base.points[i])) { divergeAfterOnly = false; break; }
    }
  }
}
log(`  밀리는 흐름에서 수락 ${(accLosing / Math.max(1, nLosing) * 100).toFixed(0)}% (${nLosing}건) vs 이기는 흐름 ${(accWinning / Math.max(1, nWinning) * 100).toFixed(0)}% (${nWinning}건)`);
check(accLosing / Math.max(1, nLosing) > accWinning / Math.max(1, nWinning), '감독은 밀릴 때 더 잘 받아들인다');
check(identical, '같은 건의 = 같은 경기(결정론)');
check(divergeAfterOnly, '수락 전 랠리는 원본과 동일(영향은 수락 후부터)');

// ── 4) 빅매치 판정 ──
check(isBigMatch(1, 2, 100) && isBigMatch(4, 5, 130) && !isBigMatch(1, 7, 50), '빅매치: 상위권 맞대결·종반 인접 순위전만');

log(fails === 0 ? '\n✅ 건의 시스템 전부 통과 — 감독 성향이 답을 가른다' : `\n❌ ${fails}건 실패`);
process.exit(fails === 0 ? 0 : 1);
