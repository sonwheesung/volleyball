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
import { attributeProduction, splitLineup } from '../engine/production';
import { teamOverall } from '../engine/overall';
import { LEAGUE } from '../data/league';
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

console.log(fail === 0 ? '\n✅ _dv_gp PASS — 위반 0건' : `\n❌ _dv_gp FAIL — ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
