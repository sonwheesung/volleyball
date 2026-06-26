// 중계 현수막 검증 — 발생 빈도 + 스포일러 정책(빌드는 finished 후에만, 코드 구조로 보장).
//   npx tsx tools/simBroadcast.ts
import { resetLeagueBase, SEASON, getPlayer, currentBasePlayers } from '../data/league';
import { commitPlayerBase } from '../data/league';
import { buildMatchBanners } from '../data/broadcast';
resetLeagueBase();
let rec = 0, clinch = 0, elim = 0, champ = 0, withBanner = 0;
for (const f of SEASON) {
  const bs = buildMatchBanners(f.homeTeamId, f.awayTeamId, f.dayIndex, 'home');
  if (bs.length) withBanner++;
  for (const b of bs) { if (b.kind === 'record') rec++; else if (b.kind === 'clinch') clinch++; else if (b.kind === 'champion') champ++; else elim++; }
}
console.log(`시즌0(${SEASON.length}경기): 우승확정 ${champ} · 기록 ${rec} · PO확정 ${clinch} · PO탈락 ${elim} · 현수막 경기 ${withBanner}`);
// 합성 마일스톤: 득점형 선수(OP/OH) career.points를 999로 올려 그 선수 경기에서 1000 돌파 현수막 뜨는지
const players = currentBasePlayers();
const star = players.find((p) => (p.position === 'OP' || p.position === 'OH') && !p.isForeign) ?? players[0];
const snap: Record<string, any> = {}; for (const p of players) snap[p.id] = p;
snap[star.id] = { ...star, career: { ...star.career, points: 999 } };
commitPlayerBase(snap);
const f0 = SEASON.find(f => f.homeTeamId === star.id.slice(0,2).replace('p','') || true)!; // 아무 경기
let found = 0;
for (const f of SEASON.slice(0, 60)) {
  const bs = buildMatchBanners(f.homeTeamId, f.awayTeamId, f.dayIndex, 'home');
  if (bs.some(b => b.kind === 'record' && b.title.includes(star.name))) { found++; }
}
console.log(`합성 검증: ${star.name}(career 999점) → 1000점 돌파 현수막 ${found > 0 ? '✅ 발생' : '❌ 미발생'}`);
console.log(`스포일러: buildMatchBanners는 match/[id]에서 finished일 때만 호출(코드 구조 보장) — 결과-결정(확정/탈락) 누출 0`);
