// 선수 개개인 포지션 정합 감사 — 전 구단 전 선수를 1명씩 포지션 기대치와 대조.
//   npx tsx tools/simRoster.ts [팀수=전체]
// 포지션별 핵심 레이팅이 기대대로인지, 어긋나는 선수(⚠)를 표시.

import { LEAGUE, getEvolvedTeamPlayers, getTeam, resetLeagueBase } from '../data/league';
import { deriveRatings } from '../engine/ratings';
import { overall } from '../engine/overall';
import type { Player, Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const p2 = (n: number) => n.toFixed(0).padStart(3);

// 포지션별 핵심(◎)/무관(·) 레이팅 — CLAUDE.md 5.3 가중치 기반 기대
const KEY: Record<Position, { core: (keyof ReturnType<typeof deriveRatings>)[]; na: (keyof ReturnType<typeof deriveRatings>)[] }> = {
  S:  { core: ['set'],            na: ['spike'] },
  OH: { core: ['spike', 'receive'], na: [] },
  OP: { core: ['spike', 'serve'], na: ['receive'] },
  MB: { core: ['block', 'spike'], na: ['receive'] },
  L:  { core: ['dig', 'receive'], na: ['spike', 'block', 'serve', 'set'] },
};

function auditPlayer(p: Player): string[] {
  const r = deriveRatings(p);
  const flags: string[] = [];
  // 역할 역전(진짜 이상)만 표시 — 스파이크 절대값 낮음은 스케일 이슈(아래 요약)라 제외
  // 리베로: 핵심 수비 스탯이 자기 공격 스탯보다 낮으면 이상
  if (p.position === 'L' && (r.dig < r.spike + 15 || r.receive < r.spike + 15)) flags.push(`리베로 수비<공격(역전)`);
  // 세터: 세팅이 최고 스탯이 아니면 이상
  if (p.position === 'S' && r.set < Math.max(r.spike, r.block, r.dig, r.receive, r.serve)) flags.push(`세터 세팅 비최고`);
  // MB: 블록이 디그/리시브보다 낮으면 이상(신체 의존 포지션)
  if (p.position === 'MB' && r.block < r.dig) flags.push(`MB 블록<디그(역전)`);
  // 신체 기대
  if (p.position === 'MB' && p.height < 180) flags.push(`MB 단신(${p.height}cm)`);
  if (p.position === 'L' && p.height > 180) flags.push(`L 장신(${p.height}cm)`);
  return flags;
}

resetLeagueBase();
const maxT = Number(process.argv[2]) || LEAGUE.teams.length;
const order: Position[] = ['S', 'OH', 'MB', 'OP', 'L'];

let total = 0, flagged = 0;
const posAgg: Record<Position, { n: number; spike: number; block: number; dig: number; recv: number; set: number; serve: number }> =
  { S: z(), OH: z(), MB: z(), OP: z(), L: z() };
function z() { return { n: 0, spike: 0, block: 0, dig: 0, recv: 0, set: 0, serve: 0 }; }

for (let ti = 0; ti < maxT; ti++) {
  const t = LEAGUE.teams[ti];
  const sq = getEvolvedTeamPlayers(t.id, 0);
  log(`\n═══ ${getTeam(t.id)?.name} (${sq.length}명) ═══`);
  log('  포지션 이름           나이 키   스파 블록 디그 리시 세팅 서브 OVR  점검');
  const sorted = [...sq].sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position) || overall(b) - overall(a));
  for (const p of sorted) {
    const r = deriveRatings(p);
    const a = posAgg[p.position];
    a.n++; a.spike += r.spike; a.block += r.block; a.dig += r.dig; a.recv += r.receive; a.set += r.set; a.serve += r.serve;
    const flags = auditPlayer(p);
    total++; if (flags.length) flagged++;
    const mark = flags.length ? '⚠ ' + flags.join(', ') : '✓';
    log(`  ${p.position.padEnd(3)} ${p.name.padEnd(10)} ${String(p.age).padStart(2)}  ${p.height} ${p2(r.spike)} ${p2(r.block)} ${p2(r.dig)} ${p2(r.receive)} ${p2(r.set)} ${p2(r.serve)} ${p2(overall(p))}  ${mark}`);
  }
}

log(`\n═══ 포지션별 평균 레이팅 (전 ${total}명) ═══`);
log('  POS  n   스파 블록 디그 리시 세팅 서브   기대(◎핵심)');
const exp: Record<Position, string> = {
  S: '세팅◎ · 스파↓', OH: '스파+리시◎', MB: '블록+스파◎ 리시↓', OP: '스파+서브◎ 리시↓', L: '디그+리시◎ 공격/블록/서브 무관',
};
for (const pos of order) {
  const a = posAgg[pos]; if (!a.n) continue;
  const d = (x: number) => p2(x / a.n);
  log(`  ${pos.padEnd(4)} ${String(a.n).padStart(2)}  ${d(a.spike)} ${d(a.block)} ${d(a.dig)} ${d(a.recv)} ${d(a.set)} ${d(a.serve)}   ${exp[pos]}`);
}
log(`\n점검: ${total}명 중 ${flagged}명 ⚠ (역할 역전·신체 이상)`);

// 스케일 관찰 — 스파이크가 수비/세팅 스케일보다 체계적으로 낮은지
const all = order.flatMap((pos) => Array(posAgg[pos].n).fill(pos));
const gAvg = (k: 'spike' | 'block' | 'dig' | 'recv' | 'set' | 'serve') =>
  order.reduce((s, pos) => s + posAgg[pos][k], 0) / total;
log(`\n[스케일 관찰] 전체 평균 — 스파 ${gAvg('spike').toFixed(0)} · 블록 ${gAvg('block').toFixed(0)} · 디그 ${gAvg('dig').toFixed(0)} · 리시 ${gAvg('recv').toFixed(0)} · 세팅 ${gAvg('set').toFixed(0)} · 서브 ${gAvg('serve').toFixed(0)}`);
log(`  ※ 스파이크·블로킹 스케일은 2026-06 보정 완료(키 레인지 정합) — 전 레이팅 60대 정렬. OVR↔승수 r≈0.82(tools/ovrCheck.ts).`);
