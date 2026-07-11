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
import { willBeFA, prefWeightsOf } from '../engine/faMarket';
import { discontentNow, resignOutlookNow, type ResignBand } from '../data/owner';
import { resignOptions } from '../engine/salary';
import { lowOfferRefuse, guaranteeRelief, LOW_OFFER_R0, LOW_OFFER_K, MINUTES_RELIEF_FLOOR } from '../engine/owner';
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

// ④ 오퍼 레버 A/B(FA §2.5c-격상) — 저연봉 가산·주전보장 완화·bit-동일(표준/무오퍼).
const MULTS = [1.0, 0.9, 0.85, 0.8] as const;
let leverN = 0;
const probByMult: Record<string, number> = { '1': 0, '0.9': 0, '0.85': 0, '0.8': 0 }; // 합
let dltSum = 0, dltSqSum = 0, monoUp = 0;     // prob(0.8×) − prob(1.0×) 통계(단조·유의)
let stdLowRefuseNonzero = 0;                   // 표준(1.0×)에서 lowRefuse≠0 (0이어야 — bit-동일 by construction)
// 주전보장 완화(minutes 불만 표본)
let guarN = 0, guarReliefSum = 0, guarPosFloor = 0, guarBreachN = 0, guarBreachHeld = 0;
// K 민감도(순수함수 스윕) — (ratio, wMoney) 표본을 모아 K별 평균 가산
const KSweep = [1.5, 2.0, 3.0] as const;
const kAccMoney: Record<string, Record<number, number>> = {}; // mult → K → sum(add) (money 아키타입)
const kAccNon: Record<string, Record<number, number>> = {};
let kMoneyN = 0, kNonN = 0;
const round100 = (x: number) => Math.round(x / 100) * 100;

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

      // ── ④ 오퍼 레버 A/B(모든 만료자 표본) ──
      {
        const market = marketVal(p, getPlayerProduction(p.id, OFFER_DAY));
        const wMoney = prefWeightsOf(p).money;
        const probAt = (mult: number, guarantee = false): number => {
          const salary = round100(market * mult);
          const ov: Record<string, Contract> = { [p.id]: { salary, years: 3, remaining: 3, signedAtAge: p.age, ...(guarantee ? { starterGuarantee: true } : {}) } };
          return resignOutlookNow(p, tid, OFFER_DAY, interviews, s, ov).prob;
        };
        const p10 = probAt(1.0), p09 = probAt(0.9), p085 = probAt(0.85), p08 = probAt(0.8);
        probByMult['1'] += p10; probByMult['0.9'] += p09; probByMult['0.85'] += p085; probByMult['0.8'] += p08;
        const dlt = p08 - p10;
        dltSum += dlt; dltSqSum += dlt * dlt; if (dlt >= -1e-12) monoUp++;
        leverN++;
        // 표준(1.0×)에서 저연봉 가산은 정확히 0이어야(표준 bit-동일 by construction)
        if (lowOfferRefuse(round100(market * 1.0) / Math.max(1, market), wMoney) !== 0) stdLowRefuseNonzero++;

        // K 민감도(순수함수 스윕) — money(≥0.25) vs 비-money 분리
        const bucket = wMoney >= 0.25 ? kAccMoney : kAccNon;
        if (wMoney >= 0.25) kMoneyN++; else kNonN++;
        for (const mult of [0.9, 0.85, 0.8]) {
          const ratio = round100(market * mult) / Math.max(1, market);
          const key = String(mult);
          bucket[key] ??= {};
          for (const K of KSweep) bucket[key][K] = (bucket[key][K] ?? 0) + K * Math.max(0, wMoney) * Math.max(0, LOW_OFFER_R0 - ratio);
        }

        // 주전보장 완화(minutes 불만만) — 표준 연봉에서 보장 off vs on
        if (topic === 'minutes') {
          const offG = probAt(1.0, false), onG = probAt(1.0, true);
          guarN++; guarReliefSum += (offG - onG);
          if (onG > 0) guarPosFloor++; // 완화 후에도 prob>0(약속≠확정 잔류)
          if (p.contract.starterGuarantee) { guarBreachN++; if (onG >= MINUTES_RELIEF_FLOOR + 0.4) guarBreachHeld++; } // 기존 계약 파기(0.5)는 완화 뒤에도 남음
        }
      }

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

// ── ④ 오퍼 레버 A/B (K=현재값) ──
const meanDlt = dltSum / Math.max(1, leverN);
const varDlt = dltSqSum / Math.max(1, leverN) - meanDlt * meanDlt;
const seDlt = Math.sqrt(Math.max(0, varDlt) / Math.max(1, leverN));
const tStat = meanDlt / Math.max(1e-12, seDlt);
console.log(`\n④ 오퍼 레버 A/B — 만료자 표본 ${leverN}명 (K=${LOW_OFFER_K}·R0=${LOW_OFFER_R0})`);
console.log(`   평균 재계약 거부 prob (guarantee off):`);
for (const m of ['1', '0.9', '0.85', '0.8']) console.log(`      ×${m.padEnd(5)}: ${(probByMult[m] / Math.max(1, leverN)).toFixed(4)}`);
console.log(`   Δ(0.8× − 1.0×): mean ${meanDlt.toFixed(4)} · SE ${seDlt.toFixed(5)} · t ${tStat.toFixed(1)} (단조 ${monoUp}/${leverN})`);
console.log(`   → ${meanDlt > 0 && tStat > 3 && monoUp === leverN ? 'PASS 단조·유의' : 'CHECK'}  |  표준(1.0×) 저연봉가산≠0: ${stdLowRefuseNonzero} (0이어야 = 표준 bit-동일 by construction)`);
console.log(`\n   K 민감도(순수함수 스윕 — 평균 저연봉 가산량):`);
console.log(`      money 아키타입(w.money≥0.25, N=${kMoneyN}):`);
for (const mult of ['0.9', '0.85', '0.8']) console.log(`         ×${mult}: ${KSweep.map((K) => `K${K}=${((kAccMoney[mult]?.[K] ?? 0) / Math.max(1, kMoneyN)).toFixed(3)}`).join(' · ')}`);
console.log(`      비-money(w.money<0.25, N=${kNonN}):`);
for (const mult of ['0.9', '0.85', '0.8']) console.log(`         ×${mult}: ${KSweep.map((K) => `K${K}=${((kAccNon[mult]?.[K] ?? 0) / Math.max(1, kNonN)).toFixed(3)}`).join(' · ')}`);

console.log(`\n⑤ 주전보장 완화(minutes 불만 표본 ${guarN}명) — 표준 연봉 보장 off vs on`);
console.log(`   평균 완화량 Δ(off − on): ${(guarReliefSum / Math.max(1, guarN)).toFixed(4)} · 완화 후 prob>0 유지: ${guarPosFloor}/${guarN} (약속≠확정 잔류)`);
console.log(`   기존 계약 파기(contract.starterGuarantee) 표본 ${guarBreachN}명 중 완화 뒤에도 파기(≥floor+0.4) 유지: ${guarBreachHeld}/${guarBreachN} (세탁 봉인)`);
console.log(`   guaranteeRelief 표(refuseBias): 0.00→${guaranteeRelief(0).toFixed(3)} · −0.18(면담카드)→${guaranteeRelief(-0.18).toFixed(3)} · −0.30→${guaranteeRelief(-0.30).toFixed(3)} (합산상한 ≤0.25)`);
