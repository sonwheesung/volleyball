// 스탯 유효성 검증기 — 선수 스탯 전부가 경기 결과에 "올바른 방향으로" 작용하는지 통제 실험.
// 동일 로스터에서 스탯 하나만 고/저(80 vs 45, 키는 188 vs 170)로 가른 A/B를 진영 교대로
// N경기 돌려 승률로 판정한다. 스탯이 무의미하면(드레인≈회복 상쇄, 산식 미연결 등) 여기서 드러난다.
//
//   npx tsx tools/simStatEffect.ts [경기수=500]
//
// 판정(노이즈 바닥은 대조군 행으로 동시 표시 — N=500 기준 1σ ≈ 2.2%p):
//   ✅ 유효(≥54%) · ⚠ 약함(51~54%) · ❌ 무효(48~51%) · 🔻 역효과(<48%)
// 이력(2026-06-12): 최초 측정에서 체력·체젠 무효 검출(회복이 소모를 상쇄) → 체력 경제 재설계로 해소.
// 기준표 (N=10,000경기/암 · 엔진 2551c57 · 2026-06-12 — 대조군 49.9%로 실험 무편향 확인):
//   키 84.5 · 반응 80.1 · 서브 76.7 · 점프 73.9 · 위치선정 73.7 · 공격 72.7 · 기복 70.4 ·
//   VQ 68.8 · 집중 68.1 · 디그 67.5 · 민첩 67.2 · 리시브 60.3 · 세팅 59.4 · 블로킹 57.1 ·
//   체력 55.2 · 체젠 53.9(⚠약함 — 단독은 완만, 체력과 함께 62.4%: 보완재, MATCH_SYSTEM 7.1)
// 주의(STATS_PROTOCOL): 이 도구의 기본 N=500은 스모크용 — 문서에 적을 수치는 N≥10000으로 돌릴 것.

import { LEAGUE, getEvolvedTeamPlayers, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(100, Number(process.argv[2]) || 500);

resetLeagueBase();
const base = getEvolvedTeamPlayers(LEAGUE.teams[0].id, 0);

type NumKey = 'height' | 'jump' | 'agility' | 'staminaMax' | 'staminaRegen' | 'reaction' | 'positioning'
  | 'focus' | 'consistency' | 'vq' | 'skSpike' | 'skBlock' | 'skDig' | 'skReceive' | 'skSet' | 'skServe';

interface Spec { key: NumKey | null; label: string; group: string; hi: number; lo: number }
const SPECS: Spec[] = [
  { key: null, label: '대조군(차이 없음)', group: '—', hi: 0, lo: 0 },
  { key: 'height', label: '키', group: '신체', hi: 188, lo: 170 },
  { key: 'jump', label: '점프력', group: '신체', hi: 80, lo: 45 },
  { key: 'agility', label: '민첩성', group: '신체', hi: 80, lo: 45 },
  { key: 'staminaMax', label: '체력', group: '신체', hi: 80, lo: 45 },
  { key: 'staminaRegen', label: '체젠', group: '신체', hi: 80, lo: 45 },
  { key: 'reaction', label: '반응속도', group: '공통', hi: 80, lo: 45 },
  { key: 'positioning', label: '위치선정', group: '공통', hi: 80, lo: 45 },
  { key: 'focus', label: '집중력', group: '멘탈', hi: 80, lo: 45 },
  { key: 'consistency', label: '기복', group: '멘탈', hi: 80, lo: 45 },
  { key: 'vq', label: 'VQ(배구IQ)', group: '멘탈', hi: 80, lo: 45 },
  { key: 'skSpike', label: '공격기술', group: '기술', hi: 80, lo: 45 },
  { key: 'skBlock', label: '블로킹기술', group: '기술', hi: 80, lo: 45 },
  { key: 'skDig', label: '디그기술', group: '기술', hi: 80, lo: 45 },
  { key: 'skReceive', label: '리시브기술', group: '기술', hi: 80, lo: 45 },
  { key: 'skSet', label: '세팅기술', group: '기술', hi: 80, lo: 45 },
  { key: 'skServe', label: '서브기술', group: '기술', hi: 80, lo: 45 },
];

const mk = (tag: string, key: NumKey | null, val: number): Player[] =>
  base.map((p) => ({ ...p, id: `${p.id}:${tag}`, ...(key ? { [key]: val } : {}) }));

function runArm(spec: Spec, seedBase: number): { win: number; set5: number; set5n: number } {
  const A = mk('A', spec.key, spec.hi);
  const B = mk('B', spec.key, spec.lo);
  let win = 0, set5w = 0, set5n = 0;
  for (let i = 0; i < N; i++) {
    const flip = i % 2 === 1; // 진영 교대 — 홈 어드밴티지 상쇄
    const sim = flip ? simulateMatch(seedBase + i, B, A) : simulateMatch(seedBase + i, A, B);
    const aSets = flip ? sim.awaySets : sim.homeSets;
    const bSets = flip ? sim.homeSets : sim.awaySets;
    if (aSets > bSets) win++;
    if (sim.setScores.length === 5) {
      set5n++;
      const s = sim.setScores[4];
      if ((flip ? s.away : s.home) > (flip ? s.home : s.away)) set5w++;
    }
  }
  return { win: win / N, set5: set5n ? set5w / set5n : NaN, set5n };
}

const verdict = (w: number): string => (w >= 0.54 ? '✅ 유효' : w >= 0.51 ? '⚠ 약함' : w >= 0.48 ? '❌ 무효' : '🔻 역효과');

log(`\n═══ 스탯 유효성 — 스탯 하나만 고/저(80 vs 45)로 가른 동일 전력 A/B, 각 ${N}경기 ═══`);
log('스탯           구분   고스탯팀 승률   5세트 승률   판정');
let fails = 0;
for (const spec of SPECS) {
  const r = runArm(spec, 7000 + SPECS.indexOf(spec) * 100000);
  const v = spec.key === null ? (Math.abs(r.win - 0.5) < 0.04 ? '✅ 노이즈 정상' : '❌ 실험 자체 편향') : verdict(r.win);
  if (v.startsWith('❌') || v.startsWith('🔻')) fails++;
  log(`${spec.label.padEnd(12)} ${spec.group.padEnd(4)} ${(r.win * 100).toFixed(1).padStart(8)}%   ${isNaN(r.set5) ? '   -' : (r.set5 * 100).toFixed(0).padStart(4) + '%'} (${String(r.set5n).padStart(3)}회)   ${v}`);
}
log(fails === 0
  ? '\n✅ 전 스탯 유효 — 모든 스탯이 올바른 방향으로 경기에 작용'
  : `\n❌ 무효/역효과 스탯 ${fails}건 — 산식 미연결 또는 상쇄(예: 체력 드레인≈회복). 엔진 튜닝 대상`);
process.exit(fails === 0 ? 0 : 1);
