// A4 결정론 — 진화(타임라인 방침)가 먹인 로스터로 300시드 ×2 경기 바이트 동일 + 데이터층 배선 == 순수 해석기. DO NOT COMMIT.
import { simulateMatch } from '../engine/match';
import { ARCHETYPES } from '../data/seed';
import { resetLeagueBase, LEAGUE, setFocusTimeline, getEvolvedTeamPlayers } from '../data/league';
import type { Player } from '../types';
import type { BoxSink } from '../engine/rally';

const ATK = ARCHETYPES.find((a) => a.name === '공격파')!.focus;
const DEF = ARCHETYPES.find((a) => a.name === '수비파')!.focus;
const sig = (r: any) => `${r.homeSets}-${r.awaySets}|${r.points.map((p: any) => `${p.scorer[0]}${p.how}`).join(',')}`;
let fail = 0;

// ─── (1) 데이터층 결정론 + 세그먼트 정합(효과 포함, 타임라인만 격리) ───
resetLeagueBase();
const my = LEAGUE.teams[0].id;
const D = 70;
const teamSig = (day: number) => getEvolvedTeamPlayers(my, day).map((p) => JSON.stringify(p)).join('|');

// (1a) 결정론: 같은 타임라인·같은 day → 두 번 호출 바이트 동일(캐시 우회 위해 다른 day 끼워 재계산 유도)
setFocusTimeline(my, [{ fromDay: 0, focus: ATK }, { fromDay: D, focus: DEF }]);
const det1 = teamSig(120); teamSig(5); const det2 = teamSig(120);
console.log(`  ${det1 === det2 ? '✅' : '❌ FAIL'} 데이터층 진화 결정론(동일 타임라인·day 두 번 = 동일)`);
if (det1 !== det2) fail++;

// (1b) 세그먼트 정합: [0:ATK, D:DEF] 타임라인 vs [0:ATK] 상수 — day≤D 동일(과거 소급 0), day>D 상이(앞으로 발현)
setFocusTimeline(my, [{ fromDay: 0, focus: ATK }, { fromDay: D, focus: DEF }]); const chgAtD = teamSig(D), chgFull = teamSig(120);
setFocusTimeline(my, [{ fromDay: 0, focus: ATK }]); const constAtD = teamSig(D), constFull = teamSig(120);
console.log(`  ${chgAtD === constAtD ? '✅' : '❌ FAIL'} day≤D 데이터층 == 상수 ATK(소급 0)`);
console.log(`  ${chgFull !== constFull ? '✅' : '❌ FAIL'} day>D 데이터층 발산(변경 앞으로 발현)`);
if (chgAtD !== constAtD) fail++;
if (chgFull === constFull) fail++;

// ─── (2) 진화 로스터로 300시드 ×2 경기 바이트 동일 ───
resetLeagueBase();
setFocusTimeline(my, [{ fromDay: 0, focus: ATK }, { fromDay: D, focus: DEF }]);
const other = LEAGUE.teams[1].id;
const A = getEvolvedTeamPlayers(my, 120) as Player[];
const B = getEvolvedTeamPlayers(other, 120) as Player[];
let matchFail = 0;
for (let seed = 0; seed < 300; seed++) {
  const r1 = simulateMatch(seed, A, B, {});
  const box: BoxSink = new Map();
  const r2 = simulateMatch(seed, A, B, { box, touches: true });
  if (sig(r1) !== sig(r2)) { matchFail++; if (matchFail <= 3) console.log(`   seed ${seed} 비결정`); }
}
console.log(`  ${matchFail === 0 ? '✅' : '❌ FAIL'} 진화(타임라인) 로스터 300시드 ×2 바이트 동일 (실패 ${matchFail})`);
if (matchFail) fail++;

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} (fail ${fail})`);
process.exit(fail > 0 ? 1 : 0);
