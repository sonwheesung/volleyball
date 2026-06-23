// 1단계 가산 sanity — touches가 실제로 코히런트하게 기록되는가(silent no-op 아님 확인).
// 검사: ① 모든 점에 touches 존재 ② 첫 터치=serve ③ 종결 터치 행위자가 byId와 정합
//   (킬/팁/블록아웃/cap → 마지막 atk 행위자==byId · stuff → byId는 블로커라 touches엔 없음 ·
//    ace → 마지막 serve 행위자==byId). 가산·중립이므로 byId/how는 기존과 동일.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '200', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

let pts = 0, noTouch = 0, firstNotServe = 0, lastAtkMatchById = 0, killish = 0, aceMatch = 0, aces = 0, mism = 0;

for (let s = 1; s <= N; s++) {
  const sim = simulateMatch(s, A, B, { ...base, touches: true });
  for (const p of sim.points) {
    pts++;
    const t = p.touches;
    if (!t || t.length === 0) { noTouch++; continue; }
    if (t[0].act !== 'serve') firstNotServe++;
    const lastAtk = [...t].reverse().find((e) => e.act === 'atk');
    const lastServe = [...t].reverse().find((e) => e.act === 'serve');
    // kill/tip/blockout은 byId=종결 공격수 → 마지막 atk 행위자와 같아야. cap은 byId 생략(특정 공격수 없음)이라 제외.
    if (p.how === 'kill' || p.how === 'tip' || p.how === 'blockout') {
      killish++;
      if (lastAtk && lastAtk.id === p.byId) lastAtkMatchById++; else mism++;
    }
    if (p.how === 'ace') {
      aces++;
      if (lastServe && lastServe.id === p.byId) aceMatch++; else mism++;
    }
  }
}

log(`표본: ${pts} 점 (${N}경기)`);
log(`① touches 비어있음: ${noTouch}  (기대 0)`);
log(`② 첫 터치 ≠ serve: ${firstNotServe}  (기대 0)`);
log(`③ 킬류 종결: 마지막 atk == byId  ${lastAtkMatchById}/${killish}  (기대 100%)`);
log(`③ 에이스 종결: 마지막 serve == byId  ${aceMatch}/${aces}  (기대 100%)`);
log(`불일치 합계: ${mism}`);
log(noTouch === 0 && firstNotServe === 0 && mism === 0 ? '✅ PASS — 터치 기록 코히런트(가산·중립 sanity)' : '❌ FAIL');
