// 결함 주입(BUGGIFY, TEST_METHODOLOGY §1.H) — 유효하지만 극단적인 입력을 경기 엔진에 강제 주입해,
// 평범한 시즌으론 잘 안 닿는 엣지에서 불변식이 깨지는지 본다(FoundationDB BUGGIFY 패턴 — 입력 스트레서).
//   Usage: npx tsx tools/_buggify.ts [seeds=300]
import { simulateMatchSimple, type SimResult } from '../engine/simMatch';
import { attributeProduction, splitLineup } from '../engine/production';
import { teamOverall } from '../engine/overall';
import { createRng } from '../engine/rng';
import { TRAINABLE_STATS } from '../engine/training';
import type { Player, Position, TrainableStat } from '../types';

const SEEDS = parseInt(process.argv[2] ?? '300', 10);
const log = (m: string) => process.stdout.write(m + '\n');

// 극단(스트레서) 레이팅 쌍 — 0·만점·초과·동률·최대격차. 평범한 시즌엔 안 나오는 입력.
const PAIRS: [number, number][] = [
  [0, 0], [0, 100], [100, 0], [1, 1], [99, 99], [50, 50],
  [150, 20], [20, 150], [100, 99], [0, 1], [120, 120], [5, 95],
];

// 경기 결과 불변식 — 깨지면 위반 문자열
function checkSim(sim: SimResult, tag: string): string[] {
  const v: string[] = [];
  const win = Math.max(sim.homeSets, sim.awaySets), lose = Math.min(sim.homeSets, sim.awaySets);
  if (win !== 3) v.push(`${tag}: 승자 세트 ${win}≠3`);
  if (lose > 2 || lose < 0) v.push(`${tag}: 패자 세트 ${lose}`);
  if (!sim.points.length) v.push(`${tag}: points 비어있음`);
  for (const p of sim.points) {
    if (p.scorer !== 'home' && p.scorer !== 'away') v.push(`${tag}: scorer=${p.scorer}`);
    if (!Number.isFinite(p.setNo) || p.setNo < 1 || p.setNo > 5) v.push(`${tag}: setNo=${p.setNo}`);
  }
  return v;
}

// 극단 스탯 로스터(귀속 보존 스트레스용) — 전부 FLOOR / 전부 99 / 한 명만 스타
function roster(kind: 'floor' | 'max' | 'lopsided', tag: string): Player[] {
  const layout: Position[] = ['S', 'S', 'OH', 'OH', 'OH', 'OH', 'OP', 'OP', 'MB', 'MB', 'MB', 'MB', 'L', 'L'];
  return layout.map((pos, i) => {
    const star = kind === 'lopsided' && i === 0;
    const val = kind === 'max' || star ? 99 : 25;
    const pot = {} as Record<TrainableStat, number>;
    for (const s of TRAINABLE_STATS) pot[s] = 99;
    return {
      id: `${tag}-${i}`, name: 'x', age: 25, position: pos, isForeign: false, height: 185,
      jump: val, agility: val, staminaMax: val, staminaRegen: val, reaction: val, positioning: val,
      focus: val, consistency: val, vq: val, skSpike: val, skBlock: val, skDig: val, skReceive: val, skSet: val, skServe: val,
      xp: {}, potential: pot, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
      contract: { salary: 5000, years: 2, remaining: 2, signedAtAge: 25 }, clubTenure: 3, peakAge: 28,
      career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
    };
  });
}

const violations: string[] = [];
let crashes = 0, matches = 0;

// 1) 극단 레이팅 주입 — 매 경기 불변식
for (const [hOvr, aOvr] of PAIRS) {
  for (let s = 0; s < SEEDS; s++) {
    try {
      const sim = simulateMatchSimple(s * 31 + 7, hOvr, aOvr);
      violations.push(...checkSim(sim, `[${hOvr}v${aOvr}#${s}]`));
      matches++;
    } catch (e: any) { crashes++; if (crashes <= 3) violations.push(`[${hOvr}v${aOvr}#${s}] CRASH ${e?.message}`); }
  }
}

// 2) 극단 로스터 귀속 보존(points == spikes+blocks+aces) + 라인업 구성 가능
const KINDS: ('floor' | 'max' | 'lopsided')[] = ['floor', 'max', 'lopsided'];
let consChecked = 0;
for (const hk of KINDS) for (const ak of KINDS) {
  const home = roster(hk, `h${hk}`), away = roster(ak, `a${ak}`);
  if (splitLineup(home).starters.length < 6 || splitLineup(away).starters.length < 6) violations.push(`라인업 부족 ${hk}/${ak}`);
  for (let s = 0; s < 40; s++) {
    try {
      const sim = simulateMatchSimple(s + 1, teamOverall(home), teamOverall(away));
      const prod = attributeProduction(sim, home, away, s + 1);
      for (const [id, l] of prod) {
        if (l.points !== l.spikes + l.blocks + l.aces) violations.push(`보존 위반 ${id} (${hk}/${ak})`);
        if (l.backSpikes > l.spikes) violations.push(`backSpikes>spikes ${id}`);
        for (const k of ['points', 'spikes', 'blocks', 'aces', 'digs', 'matches'] as const)
          if (!Number.isFinite(l[k]) || l[k] < 0) violations.push(`${k} 음수/NaN ${id}`);
      }
      consChecked++;
    } catch (e: any) { crashes++; if (crashes <= 6) violations.push(`보존 ${hk}/${ak} CRASH ${e?.message}`); }
  }
}

// A/B 자가검증 — 깨진 결과 주입 시 checkSim이 잡는가
const abBroken = checkSim({ homeSets: 4, awaySets: 0, setScores: [], points: [{ scorer: 'home', setNo: 9, how: 'kill' } as any] } as SimResult, 'ab').length > 0;

log(`=== BUGGIFY (극단 레이팅 ${PAIRS.length}쌍 × ${SEEDS}시드 = ${matches}경기 + 극단로스터 보존 ${consChecked}경기) ===`);
log(`crashes=${crashes} · 불변식 위반=${violations.length}`);
violations.slice(0, 12).forEach((x) => log('  · ' + x));
log(`[A/B] 깨진 결과(세트4·setNo9) 검출=${abBroken} (true여야 신뢰)`);
const ok = crashes === 0 && violations.length === 0 && abBroken;
log(`\nBUGGIFY OK = ${ok}`);
process.exit(ok ? 0 : 2);
