// 탐색 — "1시즌 1회 특별훈련(+1 카테고리 스탯)"의 장기(커리어/100년) 누적 영향 측정.
// 질문(사용자): 100년 계속 +1을 투입하면 스탯이 인플레되나? 핵심 변수 = 포텐셜 상한 존중 여부.
// 방법: 같은 선수를 3조건으로 커리어 끝까지(은퇴까지) 돌려 **피크 OVR 분포 + 99 만렙 비율**을 A/B.
//   base   = 특별훈련 없음(정상 롤오버)
//   capped = +1 하되 min(99, potential) 상한 존중(= 천장 못 넘음, 도달만 빨라짐)
//   bypass = +1을 포텐 무시하고 99까지(= 천장 자체가 올라감)
//   npx tsx tools/simSpecialTrain.ts
import { createRng, strSeed } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { MED_REF } from '../engine/overall';
import { rolloverPlayer } from '../engine/rollover';
import { overall } from '../engine/overall';
import type { Player, Position, TrainableStat, TrainingFocus } from '../types';

const FOCUS: TrainingFocus = { primary: [1, 4], secondary: [2, 3, 6] };
const POS: Position[] = ['OH', 'OP', 'MB', 'S', 'L'];
const N = 300;          // 포지션당 N/5명 코호트
const RETIRE_AGE = 35;  // 이 나이 넘으면 커리어 종료(피크는 이미 지남)
const ALL_STATS: TrainableStat[] = ['jump', 'agility', 'staminaMax', 'staminaRegen', 'reaction', 'positioning', 'focus', 'consistency', 'vq', 'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe'];

const catFor = (pos: Position): TrainableStat[] =>
  pos === 'L' ? ['skDig', 'skReceive', 'agility']
    : pos === 'S' ? ['skSet', 'vq']
      : pos === 'MB' ? ['skBlock', 'skSpike', 'jump']
        : ['skSpike', 'skServe', 'jump']; // OH/OP

type Mode = 'base' | 'capped' | 'bypass';

function special(p: Player, mode: Mode): Player {
  if (mode === 'base') return p;
  const s = { ...p } as Player & Record<string, number>;
  for (const k of catFor(p.position)) {
    const cur = s[k] as number;
    const cap = mode === 'capped' ? Math.min(99, p.potential[k] ?? cur) : 99;
    if (cur < cap) s[k] = cur + 1;
  }
  return s;
}

function maxedStats(p: Player): number {
  return ALL_STATS.reduce((a, s) => a + ((p as unknown as Record<string, number>)[s] >= 99 ? 1 : 0), 0);
}

interface Agg { peak: number[]; peakMaxed: number[]; seasonsToPeak: number[] }
function runMode(mode: Mode): Agg {
  const peak: number[] = [], peakMaxed: number[] = [], seasonsToPeak: number[] = [];
  for (let i = 0; i < N; i++) {
    const pos = POS[i % POS.length];
    let p = makeProspect(createRng(strSeed(`st-${i}`)), `st-${i}`, pos);
    let bestOvr = overall(p), bestMaxed = maxedStats(p), bestSeason = 0, season = 0;
    while (p.age <= RETIRE_AGE) {
      p = rolloverPlayer(p, FOCUS, MED_REF);
      p = special(p, mode);
      season++;
      const o = overall(p);
      if (o > bestOvr) { bestOvr = o; bestMaxed = maxedStats(p); bestSeason = season; }
    }
    peak.push(bestOvr); peakMaxed.push(bestMaxed); seasonsToPeak.push(bestSeason);
  }
  return { peak, peakMaxed, seasonsToPeak };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)]; };

const log = (m: string) => process.stdout.write(m + '\n');
log(`\n═══ 특별훈련(+1/시즌) 장기 영향 — 커리어 N=${N}, 은퇴 ${RETIRE_AGE}세 ═══`);
log('포텐 상한 존중(capped)이면 "천장"은 안 오르고 도달만 빨라져야 한다(인플레 0). bypass면 99로 수렴(인플레).\n');

const modes: Mode[] = ['base', 'capped', 'bypass'];
const res: Record<Mode, Agg> = { base: runMode('base'), capped: runMode('capped'), bypass: runMode('bypass') };

log('조건    | 피크OVR 평균 | 피크OVR P90 | 피크OVR 최대 | 피크때 99만렙스탯(평균/15) | 피크도달(시즌)');
for (const m of modes) {
  const a = res[m];
  log(`${m.padEnd(7)} |    ${mean(a.peak).toFixed(2)}    |     ${pct(a.peak, 0.9)}     |     ${Math.max(...a.peak)}     |          ${mean(a.peakMaxed).toFixed(2)}          |     ${mean(a.seasonsToPeak).toFixed(1)}`);
}

const dCap = mean(res.capped.peak) - mean(res.base.peak);
const dByp = mean(res.bypass.peak) - mean(res.base.peak);
log(`\n피크 OVR 인플레(평균 Δ vs base): capped ${dCap >= 0 ? '+' : ''}${dCap.toFixed(2)} · bypass ${dByp >= 0 ? '+' : ''}${dByp.toFixed(2)}`);
log(`해석: capped Δ가 ~0이면 "천장 불변(인플레 없음)·도달만 빨라짐" → 100년 누적해도 리그 OVR 폭주 없음.`);
log(`      bypass Δ가 크면 → 매 시즌 +1이 포텐을 뚫고 99로 수렴 = 장기 인플레(밸런스/기록/노쇠서사 붕괴).`);
log(`A/B 민감도: bypass가 base보다 뚜렷이 높아야 측정 도구가 살아있다는 증거(capped만 보면 허위 안심).`);
