// 독립 검증(코드 모드) — 소형 로스터 중복-선수 라인업이 박스 귀속을 왜곡하는가.
// 가설: buildLineup 이 six 에 같은 Player 를 여러 슬롯에 넣으면, 그 선수가 한 랠리에서
//   서버이자 동시에 다른 슬롯의 공격수/디거 등으로 잡혀 박스가 비현실적으로 부풀 수 있다.
//   (현실 불변식: 코트 6명은 서로 다른 사람.)
// A/B: 정상 로스터는 코트 6 id 가 distinct / 소형 로스터는 distinct < 6 이고 동일인이
//   서브+공격 등 양립 불가 역할을 동시 보유.

import { generateLeague } from '../data/seed';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';
import type { BoxSink } from '../engine/rally';

const lg = generateLeague(2024);
const teamA = lg.teams[0].players.map((id) => lg.players.find((p) => p.id === id)!) as Player[];
const teamB = lg.teams[1].players.map((id) => lg.players.find((p) => p.id === id)!) as Player[];

function distinctSix(roster: Player[]): number {
  return new Set(buildLineup(roster).six.map((p) => p.id)).size;
}

// 한 랠리 내 같은 선수가 서브 & 공격을 동시에 — touches 로 검출
function selfPlayRallies(roster: Player[], opp: Player[], seed: number): number {
  const r = simulateMatch(seed, roster, opp, { touches: true });
  let weird = 0;
  for (const pt of r.points) {
    if (!pt.touches) continue;
    // home 측(=roster) 같은 점에서 동일 id 가 서브 act 와 atk act 를 둘 다 가지면 비정상
    const homeServe = pt.touches.find((t) => t.side === 'home' && t.act === 'serve');
    const homeAtk = pt.touches.filter((t) => t.side === 'home' && t.act === 'atk');
    if (homeServe && homeAtk.some((a) => a.id === homeServe.id)) weird++;
  }
  return weird;
}

console.log('=== A: 정상 16인 ===');
console.log('  distinct six =', distinctSix(teamA), '(기대 6)');
console.log('  자가-서브&공격 랠리 =', selfPlayRallies(teamA, teamB, 5), '(기대 0 또는 매우 드묾)');

console.log('\n=== B: 소형 5인 ===');
const sub5 = teamA.slice(0, 5);
console.log('  distinct six =', distinctSix(sub5), '(불변식 위반: <6)');
console.log('  자가-서브&공격 랠리 =', selfPlayRallies(sub5, teamB, 5), '(>0이면 동일인이 서브+공격)');

console.log('\n=== B: 소형 4인 박스 더블카운트 — 한 선수의 srvAtt vs 실제 출전 가능 인원 ===');
const sub4 = teamA.slice(0, 4);
const box: BoxSink = new Map();
simulateMatch(5, sub4, teamB.slice(0, 4), { box });
// 코트엔 4명뿐인데 박스 라인 수가 4 초과면 중복 객체가 별 라인을 만든 것은 아님(같은 객체=같은 id).
// 핵심: 4인 로스터인데 한 경기에서 서브 시도 총합이 비정상적으로 한쪽에 몰리는지 확인.
const lines = [...box.entries()].sort((a, b) => (b[1].srvAtt + b[1].atkAtt) - (a[1].srvAtt + a[1].atkAtt));
console.log('  박스 라인 수(distinct id):', box.size, '(로스터 한쪽 4 + 상대 4 = 최대 ~8±)');
for (const [id, l] of lines.slice(0, 6)) {
  console.log(`    ${id}: srvAtt=${l.srvAtt} atkAtt=${l.atkAtt} digSucc=${l.digSucc} recvAtt=${l.recvAtt}`);
}
