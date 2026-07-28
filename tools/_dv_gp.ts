// _dv_gp.ts — 출전 경기수(ProdLine.gamesPlayed, 정수 GP) 상비 가드 (UI-46 정정, SALARY_SYSTEM §1)
//
// 배경: 화면의 "경기수"가 소수("35.8경기")로 노출됐다. 원인은 ProdLine.matches가 표시용 경기수가 아니라
//   코트타임 가중 "참여량"(작전/피로 교체를 subUse/40로 분수 적립)이라 XP·연봉·팬심·시상 자격에 물린 밸런스값인데
//   그걸 화면에 그대로 썼기 때문. 정수 GP를 위한 표시 전용 필드 gamesPlayed를 신설했다(matches는 엔진용으로 불변).
//
// 이 가드가 지키는 불변식:
//   A. gamesPlayed는 항상 **음이 아닌 정수**, 한 경기당 0 또는 1(어떤 출전이든 1, 중복 없음).
//   B. gamesPlayed>0 ⟺ matches>0 (둘 다 "출전 존재"를 함께 표시 — 한쪽만 0이면 귀속 누락).
//   C. **분수 matches와의 독립(A/B 자가검증)**: 교체(subUse)만 뛴 선수는 matches가 분수(예: 0.25)여도
//      gamesPlayed는 정수 1이어야 한다. 만약 gamesPlayed를 matches로 잘못 잇는 뮤턴트라면 gamesPlayed가 분수가 돼
//      Number.isInteger 검사에서 FAIL → 오라클이 비어있지 않음을 증명.
//
// 실행: npx tsx tools/_dv_gp.ts ; echo $?

import { simulateMatchSimple, type SimResult, type PointLog } from '../engine/simMatch';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { attributeProduction, splitLineup } from '../engine/production';
import { teamOverall } from '../engine/overall';
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import type { Player } from '../types';

let fail = 0;
const bad = (m: string) => { console.log('  ❌ ' + m); fail++; };

const home = LEAGUE.teams[0].players.map((id) => LEAGUE.players.find((p) => p.id === id)!) as Player[];
const away = LEAGUE.teams[1].players.map((id) => LEAGUE.players.find((p) => p.id === id)!) as Player[];

// ── A·B. 스케일 불변식: 다수 경기에서 gamesPlayed 정수·경기당 0/1·matches와 존재 동치 ──
console.log('── A·B. gamesPlayed 정수 · 경기당 0/1 · matches 존재 동치 (seed 1..300) ──');
let checked = 0, sawFractionalMatches = 0;
for (let seed = 1; seed <= 300; seed++) {
  const sim = simulateMatchSimple(seed, teamOverall(home), teamOverall(away));
  const prod = attributeProduction(sim, home, away, seed);
  for (const [id, l] of prod) {
    checked++;
    if (!Number.isInteger(l.gamesPlayed)) bad(`gamesPlayed 비정수 ${id} seed ${seed}: ${l.gamesPlayed}`);
    if (l.gamesPlayed < 0 || l.gamesPlayed > 1) bad(`gamesPlayed 경기당 0/1 위반 ${id} seed ${seed}: ${l.gamesPlayed}`);
    if ((l.gamesPlayed > 0) !== (l.matches > 0)) bad(`gamesPlayed⟺matches 존재 불일치 ${id} seed ${seed}: gp=${l.gamesPlayed} m=${l.matches}`);
    if (l.matches > 0 && !Number.isInteger(l.matches)) sawFractionalMatches++;
  }
}
console.log(`  검사 ${checked}개 라인 · matches 분수 관측 ${sawFractionalMatches}개`);

// ── C. subUse 분수 matches 독립 (A/B 자가검증) — 교체만 뛴 벤치 선수는 matches 분수, gamesPlayed 정수 1 ──
console.log('── C. subUse 분수 matches vs 정수 gamesPlayed 독립 (A/B) ──');
// away의 벤치 선수 1명을 골라(선발 아님 → 선발 matches++가 안 붙음) subUse만 부여.
const { bench } = splitLineup(away);
if (!bench.length) bad('벤치가 비어 A/B 불가(리그 로스터 이상)');
else {
  const subId = bench[0].id;
  // gp=0이 되도록 리드 1(3-2) — 벤치 가비지 matches++ 차단, subUse 분수만 남긴다.
  const pts: PointLog[] = [];
  for (let i = 0; i < 20; i++) pts.push({ setNo: 1, home: i, away: 0, scorer: i % 2 === 0 ? 'home' : 'away', how: 'kill' });
  const sim: SimResult = {
    homeSets: 3, awaySets: 2,
    setScores: [{ home: 25, away: 20 }, { home: 20, away: 25 }, { home: 25, away: 22 }, { home: 18, away: 25 }, { home: 15, away: 12 }],
    points: pts,
    subUse: { [subId]: 10 }, // 10랠리 → matches += min(1, 10/40)=0.25
  };
  const prod = attributeProduction(sim, home, away, 12345);
  const l = prod.get(subId);
  if (!l) bad(`subUse 선수 ${subId} 생산 라인 부재`);
  else {
    if (!Number.isInteger(l.gamesPlayed) || l.gamesPlayed !== 1) bad(`C: gamesPlayed 정수 1 아님: ${l.gamesPlayed}`);
    if (Number.isInteger(l.matches) || l.matches <= 0 || l.matches >= 1) bad(`C: matches 분수(0<m<1) 아님: ${l.matches} — subUse 적립 경로 확인`);
    else console.log(`  ✅ 독립 확인: gamesPlayed=${l.gamesPlayed}(정수) · matches=${l.matches}(분수) — 뮤턴트(gamesPlayed=matches)면 정수검사 FAIL`);
  }
}

// ── D. 출전 세트수(SimResult.setUse → ProdLine.sets) 불변식 (full simulateMatch, seed 1..400) ──
//   gamesPlayed·sets의 진실 원천은 실제 코트 출전(setUse). splitLineup은 **dv·force만 맞추면 buildLineup과 동일**(Part E 참조)이라
//   발산이 아니지만, 가드는 실측 진실(setUse)을 직접 대조해 splitLineup 재구성 자체를 피한다(dv 미복제 인공 발산 예방 — TEST_METHODOLOGY §4).
//   D1. setUse 정수·1≤s≤nSets. D2(A/B 핵심): 클린 경기서 **전세트 출전자(sets==nSets) ≥6/팀**(코트 6인) +
//   **리베로 포지션 중 전세트 출전 ≥1**(리베로는 매 세트 코트). 뮤턴트(libero capture 누락→0 / 이중집계→>nSets)면 FAIL.
//   D3. attributeProduction: sets==setUse & gamesPlayed==(setUse>0?1:0) — 배선·단일진실 정합.
console.log('── D. 출전 세트수 setUse 불변식 · 전세트 출전 ≥6/팀+리베로 A/B (seed 1..400) ──');
resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0) as Player[];
let dChecked = 0, cleanTeams = 0, subPartial = 0;
for (let seed = 1; seed <= 400; seed++) {
  const a = ids[seed % ids.length], b = ids[(seed * 3 + 1) % ids.length];
  if (a === b) continue;
  const sim = simulateMatch(seed, sq[a], sq[b], { home: coachInfoOf(a), away: coachInfoOf(b) });
  const nSets = sim.homeSets + sim.awaySets;
  const setUse = sim.setUse ?? {};
  // D1: 정수·범위
  for (const id in setUse) {
    dChecked++;
    const s = setUse[id];
    if (!Number.isInteger(s)) bad(`D1 sets 비정수 ${id} seed ${seed}: ${s}`);
    if (s < 1 || s > nSets) bad(`D1 sets 범위(1..${nSets}) 위반 ${id} seed ${seed}: ${s}`);
    if (s > 0 && s < nSets) subPartial++; // 부분 출전(교체) 관측
  }
  // D2: 클린 경기(부상 교체 없음) → 팀별 전세트 출전자 ≥6(코트 6인) + 리베로 전세트 출전 ≥1
  const hasInjury = sim.subEvents?.some((e) => e.kind === 'injury');
  if (!hasInjury) {
    for (const team of [a, b]) {
      cleanTeams++;
      const roster = sq[team];
      const allSets = roster.filter((p) => (setUse[p.id] ?? 0) === nSets).length;
      if (allSets < 6) bad(`D2 팀 ${team} 전세트 출전자 ${allSets}<6 (six 코트 capture 누락 의심) seed ${seed} nSets=${nSets}`);
      if (!roster.some((p) => p.position === 'L' && (setUse[p.id] ?? 0) === nSets)) bad(`D2 팀 ${team} 리베로 전세트 출전 0 (libero capture 누락) seed ${seed}`);
    }
  }
  // D3: 배선 — attributeProduction의 sets==setUse & gamesPlayed==1(setUse 존재 선수)
  const prod = attributeProduction(sim, sq[a], sq[b], seed);
  for (const id in setUse) {
    if ((prod.get(id)?.sets ?? -1) !== setUse[id]) bad(`D3 prod.sets≠setUse ${id} seed ${seed}: ${prod.get(id)?.sets} vs ${setUse[id]}`);
    if ((prod.get(id)?.gamesPlayed ?? -1) !== 1) bad(`D3 setUse 존재 선수 gamesPlayed≠1 ${id} seed ${seed}: ${prod.get(id)?.gamesPlayed}`);
  }
}
console.log(`  세트수 검사 ${dChecked}개 · 클린 팀 대조 ${cleanTeams}개 · 부분출전(교체) 관측 ${subPartial}개`);
if (subPartial === 0) bad('D: 부분 출전(1≤sets<nSets) 관측 0 — 교체 경로가 세트수에 안 잡히는 의심(A/B 민감도 부족)');

// ── E. splitLineup(귀속) ≡ buildLineup(실제 코트) — **dv·force 일치 시** 동일 라인업 (프로덕션 정합 회귀 가드) ──
//   TEST_METHODOLOGY §4: 가드가 dv 없이 splitLineup을 부르면 인공 발산이 생겨 phantom GP로 오진했던 사건의 회귀 봉인.
//   프로덕션은 항상 실제 dv/force를 넘기므로(data/production.ts·상대 미리보기) 여기서도 넘겨 six+libero 완전 일치를 확인.
//   두 함수 정렬식이 드리프트(한쪽만 기준 변경)하면 이 검사가 FAIL → 진짜 발산을 잡는다.
console.log('── E. splitLineup ≡ buildLineup (dv·force 일치) — 프로덕션 라인업 정합 회귀 ──');
let eTeams = 0;
for (const team of ids) {
  const dv = coachInfoOf(team)?.dvPhilosophy ?? 0;
  const bl = buildLineup(sq[team], dv);
  const sl = splitLineup(sq[team], dv);
  const blSet = new Set([...bl.six.map((p) => p.id), ...(bl.libero ? [bl.libero.id] : [])]);
  const slSet = new Set(sl.starters.map((p) => p.id));
  eTeams++;
  // 대칭차 = 두 라인업이 지목한 코트 7인의 불일치. dv 일치면 0이어야(정렬식 동일).
  const diff = [...blSet].filter((id) => !slSet.has(id)).concat([...slSet].filter((id) => !blSet.has(id)));
  if (diff.length) bad(`E 팀 ${team}(dv=${dv}) splitLineup≠buildLineup 코트 불일치: ${diff.join(',')} — 정렬식 드리프트 의심`);
}
console.log(`  라인업 정합 ${eTeams}팀 대조 (dv 일치 시 대칭차 0)`);

console.log(fail === 0 ? '\n✅ _dv_gp PASS — 위반 0건' : `\n❌ _dv_gp FAIL — ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
