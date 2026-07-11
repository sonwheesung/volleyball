// 측정(추정 금지, N≥10,000 만료자 표본) — 재계약 UX 격상 설계 결정용(FA §2.5c 격상, 리뷰 step0).
//   npx tsx tools/_ms_resignfeedback.ts [SEASONS]
// 산출:
//   ① 만료자(willBeFA) 불만 topic 분포 (win/minutes/money/hometown/null)
//   ② money 불만 선수 중 표준/후하게/짧게 옵션 간 잔류 전망 밴드가 갈리는 비율 (핵심 — <15%면 피벗)
//   ③ 오퍼일(mid-season day) 프리뷰 밴드 ↔ 시즌말(SEASON_END_DAY) 최종 밴드 flip율
import './_gt_mock';

import {
  resetLeagueBase, setMyTeamStaff, LEAGUE, getEvolvedTeamPlayers, currentRosters,
  commitPlayerBase, commitRosters, getTeam, teamScoutReveal,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction, getPlayerProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { willBeFA } from '../engine/faMarket';
import { discontentNow, resignOutlookNow, type ResignBand } from '../data/owner';
import { resignOptions } from '../engine/salary';
import { marketVal } from '../data/awardSalary';
import { SEASON_DAYS } from '../engine/calendar';
import type { Contract } from '../types';

const SEASONS = Math.max(1, Number(process.argv[2]) || 400);
const OFFER_DAY = Math.round(SEASON_DAYS * 0.7); // 오퍼일(대략 시즌 후반, 계약 관리 진입 시점)
const END_DAY = SEASON_DAYS;

resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);
const teamIds = LEAGUE.teams.map((t) => t.id);
const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';

const topicDist: Record<string, number> = { win: 0, minutes: 0, money: 0, hometown: 0, null: 0 };
let expiring = 0;
let moneyN = 0, moneyBandDiverge = 0;
const bandTriples: Record<string, number> = {};
let flipN = 0, flipDiff = 0;
const flipMatrix: Record<string, number> = {};

function contractOf(salary: number, years: number, age: number): Contract {
  return { salary, years, remaining: years, signedAtAge: age };
}

for (let s = 1; s <= SEASONS; s++) {
  const interviews: any[] = [];
  for (const tid of teamIds) {
    const players = getEvolvedTeamPlayers(tid, OFFER_DAY).filter((p) => !p.isForeign && willBeFA(p));
    for (const p of players) {
      const { topic } = discontentNow(p, tid, OFFER_DAY);
      topicDist[topic ?? 'null']++;
      expiring++;

      if (topic === 'money') {
        moneyN++;
        const market = marketVal(p, getPlayerProduction(p.id, OFFER_DAY));
        const opts = resignOptions(p, market);
        const bandFor = (salary: number, years: number): ResignBand => {
          const ov: Record<string, Contract> = { [p.id]: contractOf(salary, years, p.age) };
          return resignOutlookNow(p, tid, OFFER_DAY, interviews, s, ov).band;
        };
        const std = opts.find((o) => o.key === 'standard')!;
        const gen = opts.find((o) => o.key === 'generous')!;
        const sht = opts.find((o) => o.key === 'short')!;
        const bStd = bandFor(std.salary, std.years);
        const bGen = bandFor(gen.salary, gen.years);
        const bSht = bandFor(sht.salary, sht.years);
        const key = `${bStd}|${bGen}|${bSht}`;
        bandTriples[key] = (bandTriples[key] ?? 0) + 1;
        if (!(bStd === bGen && bGen === bSht)) moneyBandDiverge++;
      }
    }
  }

  {
    const offerPlayers = getEvolvedTeamPlayers(myTeam, OFFER_DAY).filter((p) => !p.isForeign && willBeFA(p));
    for (const p of offerPlayers) {
      const bo = resignOutlookNow(p, myTeam, OFFER_DAY, interviews, s).band;
      const be = resignOutlookNow(p, myTeam, END_DAY, interviews, s).band;
      flipN++;
      flipMatrix[`${bo}->${be}`] = (flipMatrix[`${bo}->${be}`] ?? 0) + 1;
      if (bo !== be) flipDiff++;
    }
  }

  const ctx = buildDraftContext(myTeam, {}, {}, [], false, [], s, undefined, 9_999_999);
  const snapshot = ctx.snapshot;
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
  for (const pk of d.picked) snapshot[pk.id] = pk;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const np of f.newPlayers) snapshot[np.id] = np;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const t of Object.keys(f.rosters)) for (const id of f.rosters[t]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
  void currentRosters;
}

const pct = (n: number, d: number) => d === 0 ? '0.0%' : `${(100 * n / d).toFixed(1)}%`;
console.log(`\n=== 재계약 UX 측정 (${SEASONS}시즌 · OFFER_DAY=${OFFER_DAY} · 엔진 대조 ${new Date().toISOString().slice(0, 10)}) ===`);
console.log(`\n① 만료자(willBeFA) 불만 topic 분포 — 표본 ${expiring}명`);
for (const k of ['null', 'win', 'minutes', 'money', 'hometown']) console.log(`   ${k.padEnd(9)}: ${String(topicDist[k]).padStart(6)}  ${pct(topicDist[k], expiring)}`);

console.log(`\n② money 불만 선수 밴드 divergence — 표본 ${moneyN}명 (핵심 지표)`);
console.log(`   3택(표준|후하게|짧게) 밴드가 갈리는 비율: ${moneyBandDiverge}/${moneyN} = ${pct(moneyBandDiverge, moneyN)}`);
console.log(`   → ${100 * moneyBandDiverge / Math.max(1, moneyN) < 15 ? 'PIVOT (밴드 <15% — 옵션별 차별화를 기간·캡 트레이드오프로)' : 'KEEP 밴드(옵션별 밴드 표시 유효)'}`);
console.log(`   밴드 조합 빈도(std|gen|short):`);
for (const [k, v] of Object.entries(bandTriples).sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(24)} ${String(v).padStart(6)}  ${pct(v, moneyN)}`);

console.log(`\n③ 오퍼일→시즌말 밴드 flip — 내 팀 만료자 표본 ${flipN}명`);
console.log(`   flip율: ${flipDiff}/${flipN} = ${pct(flipDiff, flipN)}`);
for (const [k, v] of Object.entries(flipMatrix).sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(20)} ${String(v).padStart(6)}  ${pct(v, flipN)}`);
