// 트리플 크라운(KOVO 공식) 빈도 측정 — 한 경기 후위공격·블로킹·서브 에이스 각 3개 이상.
// 현수막(BROADCAST)에 걸 사건. 추정 금지: 임계·귀속률은 측정으로 확인(시즌당 몇 건이 적정한지).
//   npx tsx tools/checkTripleCrown.ts
// 후위공격(backSpikes)은 production이 OH/OP 킬에서 BACK_ATK_RATE로 별도 귀속(engine/production).
import { resetLeagueBase, coachInfoOf, LEAGUE, SEASON } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();

type PM = { back: number; b: number; a: number; sp: number };
const playerMatches: PM[] = [];
let matches = 0, totBack = 0, totSpike = 0;
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
      totBack += l.backSpikes; totSpike += l.spikes;
      playerMatches.push({ back: l.backSpikes, b: l.blocks, a: l.aces, sp: l.spikes });
    }
  }
}

log(`\n═══ 트리플 크라운(KOVO: 후위공격·블로킹·서브 각 3+) — 시즌0 ${matches}경기 / ${playerMatches.length} 선수-경기 ═══`);
log(`후위공격 귀속 검증: backSpikes/spikes = ${(100 * totBack / Math.max(1, totSpike)).toFixed(1)}% (엔진 백어택 18.3% 정렬), 경기당 backSpikes ${(totBack / matches).toFixed(1)}(양팀)\n`);

const defs: { name: string; ok: (p: PM) => boolean }[] = [
  { name: '후위공격≥3·블록≥3·에이스≥3 (KOVO 공식)', ok: (p) => p.back >= 3 && p.b >= 3 && p.a >= 3 },
  { name: '후위공격≥2·블록≥2·에이스≥2 (참고)', ok: (p) => p.back >= 2 && p.b >= 2 && p.a >= 2 },
  { name: '후위공격≥3·블록≥2·에이스≥2 (참고)', ok: (p) => p.back >= 3 && p.b >= 2 && p.a >= 2 },
];
for (const d of defs) {
  const n = playerMatches.filter(d.ok).length;
  log(`  ${d.name.padEnd(34)} : ${String(n).padStart(3)}건 / 시즌  ·  경기당 ${(100 * n / matches).toFixed(1)}%`);
}
log('\n참고: 실제 KOVO 여자부 트리플 크라운은 매우 희귀(시즌당 0~수건). big 사건이라 드물수록 가치↑(BROADCAST 6).');
