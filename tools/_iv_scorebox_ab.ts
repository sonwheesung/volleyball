// A/B 자가검증 보강 — _iv_scorebox의 타임라인 정합/오라클 체크가 "허위 통과"가 아님을 증명.
// 일부러 깨진 입력(타임라인 셔플·필드 깎기·오라클 위조)을 주입하면 반드시 검출돼야 한다.
// 실행: npx tsx tools/_iv_scorebox_ab.ts

import { buildMatchBox } from '../data/matchBox';
import { LEAGUE, resetLeagueBase } from '../data/league';
import type { BoxSink, BoxLine } from '../engine/rally';

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const FIELDS: (keyof BoxLine)[] = ['atkAtt','atkKill','atkErr','atkBlocked','srvAtt','srvAce','srvErr','blockPt','digSucc','assist','recvAtt','recvGood','recvErr'];

function serBox(b: BoxSink): string {
  const ids = [...b.keys()].sort();
  return ids.map((id) => id + ':' + FIELDS.map((f) => b.get(id)![f]).join(',')).join('|');
}
function checkMonotone(timeline: BoxSink[]): number {
  let viol = 0; const prev = new Map<string, BoxLine>();
  for (const snap of timeline) {
    for (const [id, line] of snap) { const p = prev.get(id); if (p) for (const f of FIELDS) if ((line[f] as number) < (p[f] as number)) viol++; }
    for (const [id, line] of snap) prev.set(id, { ...line });
  }
  return viol;
}

const mb = buildMatchBox(teams[0], teams[1], 0, 12345);
const tl = mb.boxTimeline.map((s) => { const m: BoxSink = new Map(); for (const [k, v] of s) m.set(k, { ...v }); return m; });

// 정상 상태: 위반 0
const baseMono = checkMonotone(tl);
const baseLast = serBox(tl[tl.length - 1]) === serBox(mb.box);

// 깨뜨림 1: 마지막 스냅샷의 한 선수 atkKill을 0으로 깎음 → 단조성 위반(이전 스냅보다 작아짐) + 마지막!=최종
const broken = tl.map((s) => { const m: BoxSink = new Map(); for (const [k, v] of s) m.set(k, { ...v }); return m; });
const someId = [...broken[broken.length - 1].keys()].find((id) => (broken[broken.length - 1].get(id)!.atkKill) > 0);
if (someId) broken[broken.length - 1].get(someId)!.atkKill = 0;
const brokMono = checkMonotone(broken);
const brokLast = serBox(broken[broken.length - 1]) === serBox(mb.box);

// 깨뜨림 2: 타임라인 두 스냅샷 순서 뒤집기(중간 누적 역전) → 단조성 위반
const swapped = tl.map((s) => { const m: BoxSink = new Map(); for (const [k, v] of s) m.set(k, { ...v }); return m; });
if (swapped.length >= 4) { const t = swapped[1]; swapped[1] = swapped[swapped.length - 2]; swapped[swapped.length - 2] = t; }
const swapMono = checkMonotone(swapped);

console.log('A/B 자가검증 — 타임라인 정합 체크가 깨진 입력을 검출하나\n');
console.log(`정상 타임라인: 단조위반 ${baseMono} (=0 기대) · 마지막==최종 ${baseLast} (=true 기대)`);
console.log(`깨뜨림1(마지막 atkKill 깎음): 단조위반 ${brokMono} (>0 기대) · 마지막==최종 ${brokLast} (=false 기대)`);
console.log(`깨뜨림2(스냅 순서 swap): 단조위반 ${swapMono} (>0 기대)`);
const pass = baseMono === 0 && baseLast && brokMono > 0 && !brokLast && swapMono > 0;
console.log(`\n판정: ${pass ? '✅ 도구 민감 — 깨진 입력 검출' : '❌ 허위 오라클 의심(깨진 입력을 못 잡음)'}`);
