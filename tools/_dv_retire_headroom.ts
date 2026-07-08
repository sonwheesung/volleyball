// 은퇴 재정비 — 30대 성장 헤드룸(비노쇠 스탯) 분포 측정 → 대기만성/헤드룸 보호 임계 근거.
//   npx tsx tools/_dv_retire_headroom.ts [시즌수=80]
import { resetLeagueBase, currentBasePlayers } from '../data/league';
import { advanceOffseason } from './simLeague';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { DECAY_STATS } from '../engine/aging';
import { TRAINABLE_STATS } from '../engine/training';
import type { Player, TrainableStat } from '../types';

const NONDECAY: TrainableStat[] = TRAINABLE_STATS.filter((s) => !DECAY_STATS.includes(s));
const log = (m: string) => process.stdout.write(m + '\n');
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

/** 비노쇠 스탯 성장 여지 합(포텐−현재, 양수만) */
function growthHeadroom(p: Player): number {
  let h = 0;
  for (const s of NONDECAY) h += Math.max(0, (p.potential[s] ?? 0) - ((p as unknown as Record<string, number>)[s] ?? 0));
  return h;
}

function main() {
  const seasons = Math.max(1, Number(process.argv[2]) || 80);
  resetLeagueBase();
  const hr30: number[] = [];
  const hrByAge: Record<number, number[]> = {};
  let lateBloomerN = 0, tot30 = 0;
  for (let s = 0; s < seasons; s++) {
    const standings = computeStandings(Number.MAX_SAFE_INTEGER);
    const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
    if (s >= 20) {
      for (const p of currentBasePlayers()) {
        if (p.isForeign || p.age < 30 || p.age > 39) continue;
        tot30++;
        const h = growthHeadroom(p);
        hr30.push(h);
        (hrByAge[p.age] ??= []).push(h);
        if (p.traits?.includes('lateBloomer')) lateBloomerN++;
      }
    }
    advanceOffseason(s, champ, standings.map((st) => st.teamId));
  }
  log(`\n═══ 30~39세 비노쇠 헤드룸(포텐−현재 합) · ${seasons}시즌 (s≥20) N=${hr30.length} ═══`);
  log(`전체: 평균 ${mean(hr30).toFixed(1)}  p25 ${pct(hr30, 0.25)}  중앙 ${pct(hr30, 0.5)}  p75 ${pct(hr30, 0.75)}  p90 ${pct(hr30, 0.9)}  max ${Math.max(...hr30)}`);
  for (let a = 30; a <= 39; a++) {
    const arr = hrByAge[a]; if (!arr?.length) continue;
    const sig8 = arr.filter((x) => x >= 8).length / arr.length * 100;
    const sig12 = arr.filter((x) => x >= 12).length / arr.length * 100;
    log(`  ${a}세: 평균 ${mean(arr).toFixed(1)}  중앙 ${pct(arr, 0.5)}  ≥8: ${sig8.toFixed(0)}%  ≥12: ${sig12.toFixed(0)}%  N ${arr.length}`);
  }
  log(`대기만성 특성 보유 비중(30대): ${(lateBloomerN / Math.max(1, tot30) * 100).toFixed(1)}%`);
}
main();
