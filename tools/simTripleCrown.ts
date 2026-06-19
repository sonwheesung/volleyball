// 트리플 크라운(KOVO: 후위공격·블로킹·서브 에이스 각 3+) — "한 시즌에 몇 번 나오나" 측정.
// 실제 게임처럼 N시즌을 진행(노쇠·드래프트·FA로 로스터 진화, simLeague.advanceOffseason 재현)하며
// 시즌마다 전 경기 생산을 귀속해 트리플 크라운 달성 선수-경기를 센다.
//   npx tsx tools/simTripleCrown.ts [시즌수=40]
import { resetLeagueBase, coachInfoOf, SEASON } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import { advanceOffseason } from './simLeague';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 40);
const MIN = 3; // 각 부문 임계(KOVO)

function countSeason(): { tc: number; achievers: string[] } {
  const byDay = new Map<number, typeof SEASON>();
  for (const f of SEASON) { const a = byDay.get(f.dayIndex) ?? []; a.push(f); byDay.set(f.dayIndex, a as any); }
  let tc = 0; const achievers: string[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const f of byDay.get(day)!) {
      const home = availableTeamPlayers(f.homeTeamId, day);
      const away = availableTeamPlayers(f.awayTeamId, day);
      const sim = simulateMatch(f.seed, home, away, { home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId) });
      const lines = attributeProduction(sim, home, away, f.seed);
      const nameOf = new Map([...home, ...away].map((p) => [p.id, p.name]));
      for (const [id, l] of lines) {
        if (l.backSpikes >= MIN && l.blocks >= MIN && l.aces >= MIN) {
          tc++;
          achievers.push(`${nameOf.get(id) ?? id}(후위 ${l.backSpikes}·블록 ${l.blocks}·에이스 ${l.aces})`);
        }
      }
    }
  }
  return { tc, achievers };
}

resetLeagueBase();
const perSeason: number[] = [];
const firstExamples: string[] = [];
for (let s = 0; s < N; s++) {
  const { tc, achievers } = countSeason();
  perSeason.push(tc);
  if (firstExamples.length < 8) for (const a of achievers) if (firstExamples.length < 8) firstExamples.push(`시즌${s}: ${a}`);
  process.stderr.write(`  …시즌 ${s + 1}/${N} (트리플크라운 ${tc})\n`);
  advanceOffseason(s);
}

const sum = perSeason.reduce((a, b) => a + b, 0);
const sorted = [...perSeason].sort((a, b) => a - b);
const hist = (k: number) => perSeason.filter((x) => (k === 3 ? x >= 3 : x === k)).length;
log(`\n═══ 트리플 크라운 / 시즌 — ${N}시즌 (실게임 진행: 노쇠·드래프트·FA 반영) ═══`);
log(`정의: 한 경기 후위공격 ${MIN}+ · 블로킹 ${MIN}+ · 서브 에이스 ${MIN}+ (KOVO 공식)\n`);
log(`  시즌당 평균: ${(sum / N).toFixed(2)}건  ·  최소 ${sorted[0]}  ·  최대 ${sorted[sorted.length - 1]}  ·  중앙값 ${sorted[Math.floor(N / 2)]}`);
log(`  분포: 0건 ${hist(0)}시즌 · 1건 ${hist(1)}시즌 · 2건 ${hist(2)}시즌 · 3건+ ${hist(3)}시즌  (총 ${N}시즌)`);
log(`  시즌별: [${perSeason.join(', ')}]`);
log(`\n예시:`);
for (const e of firstExamples) log('  · ' + e);
log(`\n참고: 실제 KOVO 여자부 트리플 크라운도 시즌당 0~수건(매우 희귀). big 사건이라 드물수록 가치↑.`);
