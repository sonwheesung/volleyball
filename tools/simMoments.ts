// 서브~득점 공간 이벤트 검증 — 한 랠리를 좌표로 따라가고, 대량 집계로 6항목을 검증.
//   npx tsx tools/simMoments.ts [경기수=40]
// (1) 한 랠리 전체 이벤트(좌표 포함)  (2) 무결성 단언(공이 엉뚱한 곳에 안 가는지)  (3) 6항목 분포

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, getTeam, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { RallyEvent } from '../engine/events';
import { inHalf, COURT, type Pt } from '../engine/court';
import type { Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const P = (p: Pt) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
const pct = (x: number, d: number) => (d > 0 ? (x / d * 100) : 0).toFixed(1) + '%';
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const A = getEvolvedTeamPlayers(ids[0], 0), B = getEvolvedTeamPlayers(ids[1], 0);

// (1) 한 경기의 첫 랠리(서브~득점) 이벤트 출력
const ev: RallyEvent[] = [];
simulateMatch(770001, A, B, { home: coachInfoOf(ids[0]), away: coachInfoOf(ids[1]), events: ev });
log(`\n═══ 한 랠리 공간 추적: ${getTeam(ids[0])?.name} vs ${getTeam(ids[1])?.name} ═══`);
let shown = 0;
for (const e of ev) {
  if (e.t === 'serve') log(`서브 [${e.side}] ${e.player}(${e.pos}) ${e.serveType} ${P(e.from)}→목표${P(e.target)} 낙하${P(e.landing)} 오차${e.errMargin.toFixed(1)}m [${e.outcome}]`);
  else if (e.t === 'receive') log(`  리시브 [${e.side}] ${e.player}(${e.pos}) 위치${P(e.at)} 공${P(e.ball)} 도달거리${e.reach.toFixed(1)}m → ${e.result}(q${e.q.toFixed(2)})`);
  else if (e.t === 'set') log(`  세트 [${e.side}] ${e.player}(${e.pos}) ${P(e.from)}→타점${P(e.target)} 토스낙하${P(e.landing)} 오차${e.offTarget.toFixed(1)}m ${e.inSystem ? '인시스템' : '아웃오브시스템'} → ${e.atk}`);
  else if (e.t === 'block') log(`  블록 [${e.side}] ${e.count}장 ${e.players.map((p, i) => `${p}(${e.positions[i]})`).join('+')} @${P(e.at)}`);
  else if (e.t === 'attack') log(`  공격 [${e.side}] ${e.player}(${e.pos}) ${e.atk} ${P(e.from)}→코스${P(e.course)} = ${e.result}`);
  else if (e.t === 'dig') log(`  디그 [${e.side}] ${e.player}(${e.pos}) 위치${P(e.at)} 공${P(e.ball)} 도달${e.reach.toFixed(1)}m ${e.ok ? '성공' : '실패'}`);
  else if (e.t === 'point') { log(`  ▶ 득점: ${e.winner} (${e.reason})`); if (++shown >= 3) break; }
}

// (2)(3) 대량 집계 + 무결성 단언
const N = Math.max(1, Number(process.argv[2]) || 40);
const all: RallyEvent[] = [];
let seed = 600000;
for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
  if (i === j) continue;
  for (let k = 0; k < N; k++) {
    seed += 7;
    simulateMatch(seed, getEvolvedTeamPlayers(ids[i], 0), getEvolvedTeamPlayers(ids[j], 0),
      { home: coachInfoOf(ids[i]), away: coachInfoOf(ids[j]), events: all });
  }
}

let fail = 0; const failEx: string[] = [];
const bad = (cond: boolean, msg: string) => { if (cond) { fail++; if (failEx.length < 6) failEx.push(msg); } };

// 카운터
const srv = { in: 0, ace: 0, fault: 0, faultOut: 0, errIn: [0, 0] as [number, number] };
const rcv: Record<string, number> = { good: 0, poor: 0, shank: 0, ace: 0 };
const rcvReach: Record<string, number> = { good: 0, poor: 0, shank: 0, ace: 0 };
const setc = { inSys: 0, out: 0, offIn: 0, offOut: 0, landOwn: 0, landTot: 0 };
const atkBy: Record<string, number> = { quick: 0, tempo: 0, open: 0, back: 0 };
const atkRes: Record<string, number> = {};
const courseIn = { kill: [0, 0] as [number, number], err: [0, 0] as [number, number] };
let blkCount = 0, blkTot = 0, blkBackBad = 0;
let setterAttacks = 0;
let backDeep = [0, 0] as [number, number];

for (const e of all) {
  if (e.t === 'serve') {
    srv[e.outcome]++;
    const recvSide = other(e.side);
    if (e.outcome === 'fault') { if (!inHalf(recvSide, e.landing)) srv.faultOut++; bad(inHalf(recvSide, e.landing), `범실인데 코트 안: ${P(e.landing)}`); }
    else bad(!inHalf(recvSide, e.landing), `서브 ${e.outcome}인데 코트 밖: ${P(e.landing)}`);
  } else if (e.t === 'receive') { rcv[e.result]++; rcvReach[e.result] += e.reach; }
  else if (e.t === 'set') {
    if (e.inSystem) { setc.inSys++; setc.offIn += e.offTarget; } else { setc.out++; setc.offOut += e.offTarget; }
    setc.landTot++; if (inHalf(e.side, e.landing)) setc.landOwn++;
    bad(!inHalf(e.side, e.landing), `토스가 자기 코트 밖(엉뚱): ${P(e.landing)}`);
  } else if (e.t === 'attack') {
    atkBy[e.atk]++; atkRes[e.result] = (atkRes[e.result] ?? 0) + 1;
    const def = other(e.side);
    if (e.result === 'kill') { courseIn.kill[1]++; if (inHalf(def, e.course)) courseIn.kill[0]++; bad(!inHalf(def, e.course), `킬인데 코스 코트 밖: ${P(e.course)}`); }
    if (e.result === 'error') { courseIn.err[1]++; if (!inHalf(def, e.course)) courseIn.err[0]++; }
    if (e.pos === 'S') setterAttacks++;
    if (e.atk === 'back') { backDeep[1]++; const deep = e.side === 'home' ? e.from.y > COURT.NET_Y + 2.5 : e.from.y < COURT.NET_Y - 2.5; if (deep) backDeep[0]++; }
  } else if (e.t === 'block') { blkTot++; blkCount += e.count; bad(e.count < 1 || e.count > 3, `블록 인원 이상: ${e.count}`); if (e.positions.includes('L')) blkBackBad++; }
}

log(`\n═══ 무결성 단언 (대량 ${all.length}이벤트) ═══`);
log(`  실패 ${fail}건` + (failEx.length ? '  예: ' + failEx.join(' | ') : '  ✓ 모두 통과'));

log(`\n═══ 6항목 검증 ═══`);
log(`[1] 서브: 인플레이 ${srv.in}·에이스 ${srv.ace}·범실 ${srv.fault} / 범실 중 코트밖 ${pct(srv.faultOut, srv.fault)} (목표 100%)`);
const rt = (k: string) => (rcv[k] ? (rcvReach[k] / rcv[k]).toFixed(1) : '-');
log(`[2] 리시브: good ${pct(rcv.good, rcv.good + rcv.poor + rcv.shank + rcv.ace)}·poor ${pct(rcv.poor, rcv.good + rcv.poor + rcv.shank + rcv.ace)}·shank ${pct(rcv.shank, rcv.good + rcv.poor + rcv.shank + rcv.ace)}·ace ${pct(rcv.ace, rcv.good + rcv.poor + rcv.shank + rcv.ace)}`);
log(`     도달거리 평균(m): good ${rt('good')} < poor ${rt('poor')} < shank ${rt('shank')} < ace ${rt('ace')}  (못 닿을수록 ↑면 정상)`);
log(`[3] 세트: 인시스템 ${pct(setc.inSys, setc.inSys + setc.out)} · 토스오차 인시스템 ${(setc.offIn / Math.max(1, setc.inSys)).toFixed(2)}m vs 아웃 ${(setc.offOut / Math.max(1, setc.out)).toFixed(2)}m (아웃이 커야 정상) · 자기코트 낙하 ${pct(setc.landOwn, setc.landTot)} (엉뚱X)`);
const atkT = atkBy.quick + atkBy.tempo + atkBy.open + atkBy.back;
log(`[4] 속공: 속공 ${pct(atkBy.quick, atkT)}·시간차 ${pct(atkBy.tempo, atkT)} (센터 ${pct(atkBy.quick + atkBy.tempo, atkT)}) · 결과 ${Object.entries(atkRes).map(([k, v]) => `${k} ${pct(v, atkT)}`).join(' ')}`);
log(`     ※ "토스 빠르거나 느려서 속공 불발"(타이밍 변수)은 3단계 범위 — 현재 미모델`);
log(`[5] 2어택(세터 공격): ${setterAttacks}회 / ${atkT}공격 (${pct(setterAttacks, atkT)}) — 전위에 OH/OP 없는 로테이션의 폴백일 뿐, 의도적 2어택 아님(3단계에서 모델링)`);
log(`[6] 백어택: ${pct(atkBy.back, atkT)} · 후위(깊은 타점)에서 출발 ${pct(backDeep[0], backDeep[1])}`);
log(`\n[블록] 평균 ${blkTot ? (blkCount / blkTot).toFixed(2) : '-'}장 · 리베로 블록 참여(이상) ${blkBackBad}회`);
log(`[코스] 킬 코트안 ${pct(courseIn.kill[0], courseIn.kill[1])} · 범실 코트밖 ${pct(courseIn.err[0], courseIn.err[1])} (둘 다 100% 목표)`);
