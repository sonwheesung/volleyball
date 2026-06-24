// 독립 검증(코드 모드) — buildLineup / simulateMatch 의 적대적 로스터 입력.
// 가설: buildLineup 의 fallback `players[i % players.length]` 가 6인 미만 로스터에서
//   같은 Player 객체를 여러 슬롯에 중복 배치 → six 에 동일 id 중복. 그 상태로 simulateMatch 가
//   회전/교체/박스 귀속을 돌리면 불변식(코트 6인 = 서로 다른 6명)이 깨질 수 있다.
// A/B: 정상(16인) 로스터는 중복 없음 통과 / 소형(1~5인) 로스터는 중복 검출.

import { generateLeague } from '../data/seed';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';

const lg = generateLeague(12345);
const teamA = lg.teams[0].players.map((id) => lg.players.find((p) => p.id === id)!) as Player[];
const teamB = lg.teams[1].players.map((id) => lg.players.find((p) => p.id === id)!) as Player[];

function dupCount(six: Player[]): number {
  const ids = six.map((p) => p.id);
  return ids.length - new Set(ids).size;
}

console.log('=== A: 정상 16인 로스터 ===');
{
  const lu = buildLineup(teamA);
  console.log('six len', lu.six.length, 'dup', dupCount(lu.six), 'libero', lu.libero?.id ?? 'none');
}

console.log('\n=== B: 소형 로스터(1..5인) buildLineup 중복 검출 ===');
for (let k = 1; k <= 5; k++) {
  const sub = teamA.slice(0, k);
  try {
    const lu = buildLineup(sub);
    const d = dupCount(lu.six);
    console.log(`  k=${k}: six=[${lu.six.map((p) => p.id).join(',')}] dup=${d} ${d > 0 ? '<<< 중복 발생' : ''}`);
  } catch (e) {
    console.log(`  k=${k}: throw ${(e as Error).message}`);
  }
}

console.log('\n=== B2: 소형 로스터로 simulateMatch — 크래시/무한루프/NaN/박스 불변식 ===');
for (let k = 1; k <= 5; k++) {
  const subA = teamA.slice(0, k);
  const subB = teamB.slice(0, k);
  try {
    const box = new Map();
    const t0 = Date.now();
    const r = simulateMatch(999, subA, subB, { box, touches: true });
    const ms = Date.now() - t0;
    const score = `${r.homeSets}-${r.awaySets}`;
    const nan = Number.isNaN(r.homeSets) || Number.isNaN(r.awaySets);
    // 박스 귀속이 코트에 없는(중복으로 가려진) 선수에게 갔는지: 단순히 완주 여부·시간만 본다.
    console.log(`  k=${k}: score=${score} sets=${r.setScores.length} pts=${r.points.length} ${ms}ms ${nan ? 'NaN!' : ''} ${ms > 3000 ? '<<< 느림(루프 의심)' : ''}`);
  } catch (e) {
    console.log(`  k=${k}: throw "${(e as Error).message}"`);
  }
}

console.log('\n=== B3: 포지션 결손 — 세터 0명 / 리베로 0명 / 전원 동일 포지션 ===');
const noS = teamA.filter((p) => p.position !== 'S');
const noL = teamA.filter((p) => p.position !== 'L');
const allMB = teamA.filter((p) => p.position === 'MB');
const tests: [string, Player[]][] = [['세터0명', noS], ['리베로0명', noL], ['전원MB', allMB]];
for (const [label, roster] of tests) {
  try {
    const r = simulateMatch(7, roster, teamB, {});
    console.log(`  ${label}(n=${roster.length}): score ${r.homeSets}-${r.awaySets}, pts ${r.points.length}`);
  } catch (e) {
    console.log(`  ${label}(n=${roster.length}): throw "${(e as Error).message}"`);
  }
}

console.log('\n=== B4: 빈 로스터 — 명시적 throw 기대(가드 존재 확인) ===');
try {
  simulateMatch(1, [], teamB, {});
  console.log('  빈 로스터: NO THROW <<< 가드 누락');
} catch (e) {
  console.log(`  빈 로스터: throw "${(e as Error).message}" (가드 OK)`);
}
