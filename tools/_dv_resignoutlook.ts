// 상설 가드 — 계약 관리 '잔류 전망' 셀렉터가 엔진 산출에 위임함을 증명(FA §2.5c-보완 3단계). 검증=Fable / 구현=Opus.
//   npx tsx tools/_dv_resignoutlook.ts   (exit 0/1)
//
// 불변식:
//   (1) resignOutlookNow.prob == refuseResignProb(topic,weight,refuseBias)+accum+breach (currentDay 파생, buildOwnerFx와 동일 primitive) — UI 재구현 아님.
//   (2) band 경계: prob<0.15 stable / <0.45 fluid / ≥0.45 risk.
//   (3) override money 반영: money 성향 선수에 stingy(0.3×) override → prob↑, generous(1.2×) → prob↓ (Stage 2 UI 반영).
import './_gt_mock';

import { resetLeagueBase, setMyTeamStaff, LEAGUE, getEvolvedTeamPlayers } from '../data/league';
import { resignOutlookNow, discontentNow } from '../data/owner';
import { refuseResignProb, sustainedBenchRefuse, PROMISE_BREACH_REFUSE, starterPromised, interviewEffects } from '../engine/owner';
import { prefWeightsOf } from '../engine/faMarket';
import { marketVal } from '../data/awardSalary';
import { getPlayerProduction } from '../data/production';
import type { Contract } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const my = LEAGUE.teams[0].id;
setMyTeamStaff(my);
const DAY = 150;
const season = 0;
const interviews: any[] = []; // 면담 없음(기본) — refuseBias 0
const players = getEvolvedTeamPlayers(my, DAY).filter((p) => !p.isForeign);

// (1)+(2) 위임 정합 — 각 선수 prob·band를 primitive 재조립과 대조
let checked = 0, mismatch = 0, bandBad = 0;
for (const p of players) {
  const o = resignOutlookNow(p, my, DAY, interviews, season);
  const { topic, weight, playRatio } = discontentNow(p, my, DAY);
  const fx = interviewEffects(interviews, season);
  const accum = topic === 'minutes' ? sustainedBenchRefuse(playRatio, weight) : 0;
  const promised = starterPromised(interviews, season, p.id) || !!p.contract.starterGuarantee;
  const breach = topic === 'minutes' && promised ? PROMISE_BREACH_REFUSE : 0;
  const expected = Math.min(0.95, refuseResignProb(topic, weight, fx.refuseBias[p.id] ?? 0) + accum + breach);
  checked++;
  if (Math.abs(o.prob - expected) > 1e-9) { mismatch++; if (mismatch <= 5) console.error(`   drift ${p.name}: ui=${o.prob} vs engine=${expected}`); }
  const wantBand = expected >= 0.45 ? 'risk' : expected >= 0.15 ? 'fluid' : 'stable';
  if (o.band !== wantBand) bandBad++;
}
console.log(`── (1)(2) 위임 정합 ── ${checked}명 검사 · prob 불일치 ${mismatch} · band 불일치 ${bandBad}`);
ok(checked >= 3, `표본 충분(${checked})`);
ok(mismatch === 0, `prob == 엔진 산출(refuseResignProb+가산항) — UI 위임(불일치 ${mismatch})`);
ok(bandBad === 0, `band 경계 0.15/0.45 정합(불일치 ${bandBad})`);

// (3) override money 반영 — money 성향 선수에 stingy→전망 악화, generous→개선.
//   ★ 오퍼 배율은 **오퍼를 만든 시장가**(marketVal=prod+수상 반영)로 산정해야 lowOfferRefuse(FA §2.5c-격상)와 정합
//     (marketValue[무prod]로 만들면 수상·호성적 선수의 1.2×가 실제 시장가의 <0.95× → 저연봉 가산 발화 → 전망 악화가 정답인데 이 단순 단조성 테스트가 오판).
let mTested = 0, mUp = 0, mDown = 0;
for (const p of players) {
  if (prefWeightsOf(p).money < 0.25) continue;
  const mv = marketVal(p, getPlayerProduction(p.id, DAY));
  const base = resignOutlookNow(p, my, DAY, interviews, season).prob;
  const stingy: Record<string, Contract> = { [p.id]: { salary: Math.round(mv * 0.3), years: 3, remaining: 3, signedAtAge: p.age } };
  const gen: Record<string, Contract> = { [p.id]: { salary: Math.round(mv * 1.2), years: 3, remaining: 3, signedAtAge: p.age } };
  const pS = resignOutlookNow(p, my, DAY, interviews, season, stingy).prob;
  const pG = resignOutlookNow(p, my, DAY, interviews, season, gen).prob;
  mTested++;
  if (pS > base + 1e-9) mUp++;
  if (pG <= base + 1e-9) mDown++;
}
console.log(`── (3) override money 반영 ── w.money≥0.25 ${mTested}명 · stingy 전망↑ ${mUp} · generous 전망≤ ${mDown}`);
ok(mTested >= 2 && mUp >= Math.ceil(mTested * 0.5), `stingy override → 전망 악화(${mUp}/${mTested})`);
ok(mDown === mTested, `generous override → 전망 개선/유지(${mDown}/${mTested})`);

console.log(fail === 0 ? '\n✅ PASS — 잔류 전망 셀렉터 엔진 위임 가드 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
