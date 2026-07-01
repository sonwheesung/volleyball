// 성장 effect-A/B 가드 (§1.8 C) — "주전이 벤치보다 큰다"는 순효과를 영구 박제.
//   §1.7 경기경험 도입 때 이 A/B가 없어 훈련 saturation이 조용히 무력화(주전=벤치, 죽은 기능) → 못 잡음.
//   이 가드가 그 사각을 메운다(engine-verify lenses.md "기능 순효과"). 자체완결·결정론.
//   PASS 조건: (주전 − 벤치) 합 ≥ 4 AND 각 포지션 주전 ≥ 벤치 AND 벤치도 충분(OVR ≥ 65). exit 0/1.
import { makePlayer } from '../data/seed';
import { createRng } from '../engine/rng';
import { simulateMatch } from '../engine/match';
import { evolvePlayer } from '../engine/progression';
import { applyMatchXp } from '../engine/experience';
import { ageOneSeason } from '../engine/aging';
import { overall } from '../engine/overall';
import { emptyBox, type BoxSink } from '../engine/rally';
import type { ProdLine } from '../engine/production';
import type { Position, TrainingFocus } from '../types';

const ROSTER: Position[] = ['S', 'S', 'OH', 'OH', 'OH', 'OP', 'OP', 'MB', 'MB', 'MB', 'L', 'L', 'S', 'OH', 'MB'];
const gen = createRng(555);
const team = (t: string) => ROSTER.map((pos, i) => makePlayer(gen, `${t}${i}`, pos, false, undefined, 0, [23, 29]));
const A = team('H'), opps = Array.from({ length: 6 }, (_, i) => team(`O${i}`));
const box: BoxSink = new Map();
for (let m = 0; m < 34; m++) simulateMatch(m >>> 0, A, opps[m % 6], { box });
const bl = (id: string) => box.get(id) ?? emptyBox();
function prodOf(pos: Position): ProdLine {
  const c = A.filter((p) => p.position === pos);
  const s = c.reduce((b, p) => (bl(p.id).atkAtt + bl(p.id).digSucc > bl(b.id).atkAtt + bl(b.id).digSucc ? p : b));
  const b = bl(s.id);
  return { matches: 34, points: 0, spikes: b.atkKill, backSpikes: 0, blocks: b.blockPt, aces: b.srvAce, assists: b.assist, digs: b.digSucc, receives: b.recvGood } as ProdLine;
}
const noF: TrainingFocus = { primary: [], secondary: [] } as any;
function finalOvr(pos: Position, mode: 's' | 'b'): number {
  const prod = prodOf(pos);
  let p = makePlayer(createRng(999), 'y', pos, false, 18, 0, [18, 18]);
  for (let age = 18; age <= 28; age++) { p = evolvePlayer(p, noF, 164); if (mode === 's') p = applyMatchXp(p, prod); p = ageOneSeason(p); }
  return overall(p);
}

const fails: string[] = [];
let gapSum = 0;
const POS: Position[] = ['OH', 'MB', 'S', 'L', 'OP'];
console.log('성장 effect-A/B (§1.8 C) — 경기경험 순효과(주전 > 벤치):');
for (const pos of POS) {
  const s = finalOvr(pos, 's'), b = finalOvr(pos, 'b');
  const gap = s - b; gapSum += gap;
  console.log(`  ${pos}: 주전 ${s} · 벤치 ${b} · 격차 +${gap}`);
  if (s < b) fails.push(`${pos} 주전<벤치(${s}<${b}) — 경기경험 역효과`);
  if (b < 65) fails.push(`${pos} 벤치 OVR ${b}<65 — 벤치 과도 정체(충분성장 실패)`);
}
console.log(`\n격차 합계 ${gapSum} (기준 ≥4 — 경기경험이 실제로 완성도를 올려야)`);
if (gapSum < 4) fails.push(`격차 합계 ${gapSum}<4 — 경기경험 순효과 미미(죽은 기능 재발 의심)`);

// A/B 자가검증: 벤치 vs 벤치는 격차 0이어야(오라클 민감도 — 같은 입력이면 안 벌어짐)
const bb = finalOvr('OH', 'b') - finalOvr('OH', 'b');
if (bb !== 0) fails.push(`A/B 오라클 이상: 벤치-벤치 격차 ${bb}≠0`);
console.log(`[A/B] 벤치-벤치 격차=${bb}(0이어야 — 오라클 정상)`);

console.log(`\nRESULT: ${fails.length ? 'FAIL — ' + fails.join(' / ') : 'PASS'}`);
process.exit(fails.length ? 1 : 0);
