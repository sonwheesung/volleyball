// 구단주 건의 시뮬 (Phase 4) — 여러 감독(카리스마·성향)을 대상으로 선발 건의의
// 수락률이 설계 의도대로 갈리는지 측정. (타임아웃은 감독 고유 권한 — 건의 제거, 2026-06-16)
// STATS_PROTOCOL: 판정 표본 10,000/셀.
//   npx tsx tools/simSuggest.ts

import { LEAGUE, getTeamCoach, resetLeagueBase } from '../data/league';
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
    for (let i = 0; i < 10000; i++) if (startSuggestAccept(`p${i}`, 1, 40, cha, gapT)) ok++;
    row.push(ok / 10000);
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
  for (let i = 0; i < 10000; i++) {
    if (startSuggestAccept(`q${i}`, 2, 60, c.charisma, 0.7)) okS++;
    if (benchAccept(`q${i}`, 2, 60, c.charisma, 0.7, 4, 'noResign')) okB++;
  }
  log(`  ${c.name.padEnd(8)} 카리스마 ${String(c.charisma).padStart(2)} · 선발 건의 ${(okS / 10000 * 100).toFixed(0)}% · 벤치 건의 ${(okB / 10000 * 100).toFixed(0)}%`);
}

// ── 3) 빅매치 판정 ──
check(isBigMatch(1, 2, 100) && isBigMatch(4, 5, 130) && !isBigMatch(1, 7, 50), '빅매치: 상위권 맞대결·종반 인접 순위전만');

log(fails === 0 ? '\n✅ 건의 시스템 전부 통과 — 감독 성향이 답을 가른다' : `\n❌ ${fails}건 실패`);
process.exit(fails === 0 ? 0 : 1);
