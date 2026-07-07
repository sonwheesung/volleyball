// 실제 동시 2건+ 교체 랠리를 찾아 subEvsNow(보드 입력) → 옛 렌더 vs 새 렌더를 텍스트로 재현·증명.
//   npx tsx tools/_proofSubBadge.ts
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const KO: Record<string, string> = { pinch: '서브 보강', block: '블로킹 보강', def: '수비 보강', injury: '몸 상태 · 교체' };

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

// 알려진 혼합 케이스 재현(seed 순서는 _measSubBadge와 동일 순회)
let seed = 990000;
let found = 0;
for (let m = 0; m < 60 && found < 3; m++) {
  const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
  if (hi === ai) continue;
  seed += 13;
  const sim = simulateMatch(seed, sq[hi], sq[ai], { home: coachInfoOf(hi), away: coachInfoOf(ai) });
  const byId = new Map<string, Player>();
  for (const p of sq[hi]) byId.set(p.id, p);
  for (const p of sq[ai]) byId.set(p.id, p);
  const evs = sim.subEvents ?? [];
  const byPoint = new Map<number, typeof evs>();
  for (const e of evs) { const a = byPoint.get(e.point) ?? []; a.push(e); byPoint.set(e.point, a); }
  for (const [pt, arr] of byPoint) {
    const curSet = arr[0].setNo;
    const shown = arr.filter((e) => e.enter || e.setNo === curSet); // subEvsNow 필터
    const kinds = new Set(shown.map((e) => `${e.enter ? 'in' : 'out'}:${e.kind}`));
    if (shown.length < 2 || kinds.size < 2) continue; // 사유 소실이 실제로 나던 케이스
    found++;
    log(`\n━━━ seed=${seed} point=${pt} · subEvsNow ${shown.length}건 ━━━`);
    log('  subEvsNow 원본:');
    for (const e of shown) log(`    side=${e.side} enter=${e.enter} kind=${e.kind} in=${byId.get(e.inId)?.name} out=${byId.get(e.outId)?.name}`);
    log('  옛 렌더(헤더 단수 — 2번째부터 사유 소실):');
    log(`    헤더: ${shown[0].enter ? `🔄 ${KO[shown[0].kind]}` : '↩ 원위치 복귀'}`);
    for (const e of shown.slice(0, 2)) log(`      ${byId.get(e.inId)?.name} IN / ${byId.get(e.outId)?.name} OUT   ← 사유 미표시`);
    log('  새 렌더(이벤트별 사유+측):');
    for (const e of shown.slice(0, 3)) {
      log(`    [${e.side === 'home' ? '홈' : '원정'}] ${e.enter ? `🔄 ${KO[e.kind]}` : '↩ 원위치 복귀'}`);
      log(`      ${byId.get(e.inId)?.name} IN`);
      log(`      ${byId.get(e.outId)?.name} OUT`);
    }
    if (shown.length > 3) log(`    +${shown.length - 3}`);
    break;
  }
}
log(`\n(혼합 사유 동시 교체 케이스 ${found}건 재현)`);
