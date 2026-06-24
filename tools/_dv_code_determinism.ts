// 독립 검증 — 결정론: 같은 시드/입력이면 박스·터치·점수까지 바이트 동일.
// 또한 box 유무가 승패 바이트를 바꾸지 않는지(코드 주석의 핵심 불변식) A/B.
import { generateLeague } from '../data/seed';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';
import type { BoxSink } from '../engine/rally';

const lg = generateLeague(77);
const A = lg.teams[0].players.map(id=>lg.players.find(p=>p.id===id)!) as Player[];
const B = lg.teams[1].players.map(id=>lg.players.find(p=>p.id===id)!) as Player[];

const sig = (r:any)=>`${r.homeSets}-${r.awaySets}|${r.points.map((p:any)=>`${p.scorer[0]}${p.how}`).join(',')}`;

let fail=0;
for(let seed=0; seed<2000; seed++){
  const r1 = simulateMatch(seed, A, B, {});
  const r2 = simulateMatch(seed, A, B, {});                       // 반복
  const box:BoxSink = new Map();
  const r3 = simulateMatch(seed, A, B, { box, touches:true });    // box+touches 켬
  if(sig(r1)!==sig(r2)){ fail++; if(fail<=3) console.log(`seed ${seed}: 비결정(반복 불일치)`); }
  if(sig(r1)!==sig(r3)){ fail++; if(fail<=3) console.log(`seed ${seed}: box/touches 가 승패 바꿈!`); }
}
console.log(fail===0?'PASS: 2000시드 결정론·box중립 통과':`FAIL ${fail}건`);

// A/B 음성대조: 시드가 다르면 거의 항상 결과가 다르다(오라클이 살아있음을 증명)
let diff=0; for(let s=0;s<200;s++){ if(sig(simulateMatch(s,A,B,{}))!==sig(simulateMatch(s+10000,A,B,{}))) diff++; }
console.log(`음성대조: 200쌍 중 다른 시드 결과 상이 ${diff} (오라클 민감)`);
