// FA 경쟁 구단·협상 순위 관측(faCompete) ↔ 실제 해소 정합 가드 — FA_SYSTEM §2.8.5 Phase5.
//   npx tsx tools/_dv_facompete.ts [자연런 시즌=120]
//
// 배경: FA 센터가 "관심 구단"·"협상 순위"를 보여주려면 resolveFAMarket이 이미 만든 bids에서
//   faCompete{bidders,myRank}를 관측 전용으로 노출해야 한다(rng 미소비·해소 로직 불변). 이 가드는
//   그 관측이 **실제 해소 결과와 일치**하고 **순수(해소에 미개입)** 함을 검증한다.
//
// (a) 승자(입찰 성사 팀) ∈ bidders — 관측이 실제 계약 결과와 정합. 모든 풀 FA(AI 서명 포함).
// (b) 내가 입찰(BID 게이트)한 지명 FA의 myRank ∈ [1, bidders.length].
// (c) faFail==='LOST'이면 lostTo 존재 + 그 팀이 bidders에 포함(경쟁 패배의 승자가 입찰자여야).
// (d) 관측 순수성: 같은 입력 재호출 시 해소 결과(signedByMe·lostTo·faFail·최종 로스터) byte-동일
//     (faCompete 파생이 해소를 밀지 않음) + **오라클 이빨(A/B)**: 유효 faCompete를 손상(승자 제거)하면
//     체크 (a)가 잡아내야(허위 오라클 방지).

import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE, currentBasePlayers,
} from '../data/league';
import { faMarketPreview } from '../data/offseason';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let violations = 0;
const fail = (msg: string) => { violations++; log(`  ❌ ${msg}`); };
const ok = (msg: string) => log(`  ✓ ${msg}`);

resetLeagueBase();
const A = LEAGUE.teams[0].id; // myTeam
const BIG = 99_999_999;
const N = Math.max(1, Number(process.argv[2]) || 20);

/** (a) 승자 ∈ bidders — 순수 체크 함수(오라클 이빨 A/B 에도 재사용). */
function winnerInBidders(comp: { bidders: string[] } | undefined, winner: string): boolean {
  return !!comp && comp.bidders.includes(winner);
}

log('═══ (자연 장기런) faCompete ↔ 해소 결과 교차검증 ═══');
let targets = 0, wonN = 0, lostN = 0, sitN = 0, gateN = 0, poolChecked = 0, aiSigned = 0;

for (let s = 1; s <= N; s++) {
  // 상위 FA 4명을 공격적으로 노려 성공/뺏김/잔류 경로를 두루 유발(=_dv_fafail 와 동일 셋업)
  const pre = faMarketPreview(A, {}, {}, [], true, [], s, undefined, BIG);
  const wishlist = [...pre.pool].map((id) => pre.snapshot[id]).filter((p): p is Player => !!p)
    .sort((a, b) => overall(b) - overall(a)).slice(0, 4).map((p) => p.id);

  const pv = faMarketPreview(A, {}, {}, wishlist, true, [], s, undefined, BIG);
  const ctx = buildDraftContext(A, {}, {}, wishlist, true, [], s, undefined, BIG);

  // (d) 관측 순수성 — 같은 입력 재호출 시 해소 결과가 byte-동일(faCompete 가 해소를 밀지 않음).
  //   signedByMe·lostTo·faFail + 내 팀 최종 로스터 연봉까지 비교(해소 산출물 대표). 비용 큰 재호출은 앞 8시즌만.
  if (s <= 8) {
    const pv2 = faMarketPreview(A, {}, {}, wishlist, true, [], s, undefined, BIG);
    const key = (x: typeof pv) => JSON.stringify({
      signed: [...x.signedByMe].sort(), lostTo: x.lostTo, faFail: x.faFail,
      myRoster: [...x.myRoster].sort().map((id) => x.snapshot[id]?.contract.salary ?? null),
    });
    if (key(pv) !== key(pv2)) fail(`[s${s}] 재호출 해소 불일치(비결정론 — 관측이 해소에 개입?)`);
  }

  // 최종 소속(FA 직후 ctx.rosters) — 승자의 진실
  const teamOf = new Map<string, string>();
  for (const tid of Object.keys(ctx.rosters)) for (const id of ctx.rosters[tid]) teamOf.set(id, tid);

  // (a) 모든 풀 FA: 서명됐다면 그 승자 팀이 bidders 에 있어야(관측=결과)
  for (const id of pv.pool) {
    const where = teamOf.get(id);
    if (!where) continue; // 미서명(SIT_OUT/무입찰) — 승자 없음
    // prevTeam 에 그대로 남은 재계약이 아니라 'FA 시장 서명'만 대상: bidders 가 비어있지 않은 경우만 승자 판정
    const comp = pv.faCompete[id];
    if (!comp) { fail(`[s${s}] ${id} 서명됐는데 faCompete 없음`); continue; }
    if (comp.bidders.length === 0) continue; // 입찰 0 — 승자는 재계약/보상 경로(FA 시장 승자 아님)
    poolChecked++;
    if (!winnerInBidders(comp, where)) fail(`[s${s}] ${pv.snapshot[id]?.name ?? id} 승자=${getTeam(where)?.name} 인데 bidders 밖`);
    if (where !== A) aiSigned++;
  }

  // (b)(c) 내가 지명한 FA — myRank·LOST 정합
  for (const id of wishlist) {
    if (!pv.pool.includes(id)) continue;
    targets++;
    const comp = pv.faCompete[id];
    if (!comp) { fail(`[s${s}] ${id} 지명인데 faCompete 없음`); continue; }
    const won = pv.signedByMe.has(id);
    const code = pv.faFail[id];
    const rank = comp.myRank;

    if (won) {
      wonN++;
      if (!winnerInBidders(comp, A)) fail(`[s${s}] ${id} 영입 성공인데 내 팀이 bidders 밖`);
      if (!(rank && rank >= 1 && rank <= comp.bidders.length)) fail(`[s${s}] ${id} 영입 성공인데 myRank=${rank} 범위밖(1..${comp.bidders.length})`);
      continue;
    }
    if (code === 'LOST') {
      lostN++;
      const lt = pv.lostTo[id];
      if (!lt) fail(`[s${s}] ${id} LOST 인데 lostTo 없음`);
      else if (!winnerInBidders(comp, lt)) fail(`[s${s}] ${id} LOST→${getTeam(lt)?.name} 인데 bidders 밖`);
      if (!(rank && rank >= 1 && rank <= comp.bidders.length)) fail(`[s${s}] ${id} LOST 인데 myRank=${rank} 범위밖(내가 입찰했어야)`);
    } else if (code === 'SIT_OUT') {
      sitN++;
      // 내가 입찰(BID)했으므로 순위가 있어야, bidders 에 내 팀 포함
      if (!(rank && rank >= 1 && rank <= comp.bidders.length)) fail(`[s${s}] ${id} SIT_OUT 인데 myRank=${rank} 범위밖`);
      if (!comp.bidders.includes(A)) fail(`[s${s}] ${id} SIT_OUT(내 입찰)인데 bidders 에 내 팀 없음`);
    } else if (code === 'CAP' || code === 'CASH' || code === 'ROSTER') {
      gateN++;
      // 입찰 자체가 안 들어감 → 내 팀은 bidders 밖, myRank undefined
      if (rank !== undefined) fail(`[s${s}] ${id} 게이트(${code})인데 myRank=${rank} (미입찰이라 undefined 여야)`);
      if (comp.bidders.includes(A)) fail(`[s${s}] ${id} 게이트(${code})인데 bidders 에 내 팀 있음(입찰 안 했어야)`);
    }
  }

  // 다음 시즌 진화(=_dv_fafail 와 동일 커밋)
  const snapshot = ctx.snapshot;
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
    const prod = leagueProduction(Number.MAX_SAFE_INTEGER).get(id);
    if (prod && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], prod), prod);
  }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

log(`\n관측 — 지명 ${targets}건(성공 ${wonN}·뺏김 ${lostN}·잔류 ${sitN}·게이트 ${gateN}) · 풀 승자검증 ${poolChecked}건(AI서명 ${aiSigned})`);

// ── 오라클 이빨(A/B) — 유효 faCompete 를 손상하면 (a) 체크가 잡아내야(허위 오라클 방지) ──
log('\n═══ 오라클 이빨(A/B) — 손상된 faCompete 를 체크가 검출 ═══');
{
  const good = { bidders: [LEAGUE.teams[1].id, A], myRank: 2 };
  const winner = LEAGUE.teams[1].id;
  const passOnGood = winnerInBidders(good, winner);        // 정상 → true
  const mutated = { bidders: good.bidders.filter((t) => t !== winner) }; // 승자 제거
  const passOnMutant = winnerInBidders(mutated, winner);   // 손상 → false 여야(체크 이빨)
  if (passOnGood && !passOnMutant) ok('A/B — 정상 faCompete=통과, 승자 제거 손상=검출(체크에 이빨)');
  else fail(`A/B 실패 — 정상=${passOnGood}, 손상=${passOnMutant} (손상에서 false 여야)`);
  // myRank 범위 체크 이빨
  const rankOk = (r: number | undefined, n: number) => !!r && r >= 1 && r <= n;
  if (rankOk(2, 2) && !rankOk(3, 2) && !rankOk(undefined, 2)) ok('A/B — myRank 범위 체크 이빨(2/2 통과, 3/2·undefined 검출)');
  else fail('A/B — myRank 범위 체크 이빨 실패');
}

log(violations === 0
  ? `\n✅ FACOMPETE_GUARD PASS — 관측(bidders·myRank)이 실제 해소와 정합·순수(위반 0)`
  : `\n❌ FACOMPETE_GUARD FAIL — 위반 ${violations}건`);
process.exit(violations === 0 ? 0 : 1);
