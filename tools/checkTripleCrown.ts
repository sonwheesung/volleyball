// 트리플 크라운 빈도 측정 — 현수막(BROADCAST)에 걸 "한 경기 공격·블로킹·서브 동시 득점" 사건의
// 발생 빈도를 정의 후보별로 잰다. 추정 금지: 임계값은 측정으로 정한다(시즌당 몇 건이 적정한지).
//   npx tsx tools/checkTripleCrown.ts
// 주: KOVO 정통 정의는 '후위공격+블로킹+서브'지만 엔진 생산은 공격을 후위/전위로 분리 안 함
//     → 달성 가능한 '공격(spike)+블로킹(block)+서브(ace)' 정의로 측정.
import { resetLeagueBase, coachInfoOf, LEAGUE, SEASON } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();

// 시즌 0 전 경기를 경기단위로 생산 귀속 → 선수별 (spikes, blocks, aces) 수집
type PM = { s: number; b: number; a: number };
const playerMatches: PM[] = [];
let matches = 0;
const byDay = new Map<number, typeof SEASON>();
for (const f of SEASON) { const arr = byDay.get(f.dayIndex) ?? []; arr.push(f); byDay.set(f.dayIndex, arr as any); }
for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
  for (const f of byDay.get(day)!) {
    const home = availableTeamPlayers(f.homeTeamId, day);
    const away = availableTeamPlayers(f.awayTeamId, day);
    const sim = simulateMatch(f.seed, home, away, { home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId) });
    const lines = attributeProduction(sim, home, away, f.seed);
    matches++;
    for (const [, l] of lines) {
      if (l.matches <= 0) continue;
      playerMatches.push({ s: l.spikes, b: l.blocks, a: l.aces });
    }
  }
}

const defs: { name: string; ok: (p: PM) => boolean }[] = [
  { name: 's≥1·b≥1·a≥1', ok: (p) => p.s >= 1 && p.b >= 1 && p.a >= 1 },
  { name: 's≥3·b≥1·a≥1', ok: (p) => p.s >= 3 && p.b >= 1 && p.a >= 1 },
  { name: 's≥1·b≥2·a≥1', ok: (p) => p.s >= 1 && p.b >= 2 && p.a >= 1 },
  { name: 's≥1·b≥1·a≥2', ok: (p) => p.s >= 1 && p.b >= 1 && p.a >= 2 },
  { name: 's≥1·b≥2·a≥2', ok: (p) => p.s >= 1 && p.b >= 2 && p.a >= 2 },
  { name: 's≥2·b≥2·a≥2', ok: (p) => p.s >= 2 && p.b >= 2 && p.a >= 2 },
  { name: 's≥1·b≥3·a≥2', ok: (p) => p.s >= 1 && p.b >= 3 && p.a >= 2 },
  { name: 's≥1·b≥2·a≥3', ok: (p) => p.s >= 1 && p.b >= 2 && p.a >= 3 },
  { name: 's≥3·b≥2·a≥2', ok: (p) => p.s >= 3 && p.b >= 2 && p.a >= 2 },
  { name: 's≥1·b≥3·a≥3', ok: (p) => p.s >= 1 && p.b >= 3 && p.a >= 3 },
  { name: 's≥2·b≥3·a≥3', ok: (p) => p.s >= 2 && p.b >= 3 && p.a >= 3 },
  { name: 's≥3·b≥3·a≥3', ok: (p) => p.s >= 3 && p.b >= 3 && p.a >= 3 },
  { name: 's≥10·b≥3·a≥3', ok: (p) => p.s >= 10 && p.b >= 3 && p.a >= 3 },
];

log(`\n═══ 트리플 크라운 빈도 — 시즌0 ${matches}경기 / ${playerMatches.length} 선수-경기 ═══`);
log(`(KOVO 정통: 후위공격+블로킹+서브. 엔진 미분리 → 공격(spike)+블로킹(block)+서브(ace) 정의로 측정)\n`);
for (const d of defs) {
  const n = playerMatches.filter(d.ok).length;
  const perSeason = n; // 시즌0 전체 = 시즌당
  const perMatch = (100 * n / matches).toFixed(1);
  log(`  ${d.name.padEnd(16)} : ${String(n).padStart(4)}건  ·  시즌당 ${perSeason}  ·  경기당 ${perMatch}%`);
}
log('\n참고: 현수막은 "big 사건"이어야 가치 유지 — 시즌당 한 자릿수~십수 건이 적정선(BROADCAST_SYSTEM 6).');
