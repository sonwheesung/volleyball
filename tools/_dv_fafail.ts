// FA 실패 사유 코드(faFail) ↔ 실제 게이트 정합 가드 — FA_SYSTEM §2.7 UX.
//   npx tsx tools/_dv_fafail.ts [자연런 시즌=120]
//
// 배경: FA 센터가 실패를 '경합/불발' 한 문자열로 뭉갰다(자금 없어 입찰조차 못 한 것도 '경합'으로 오표시).
//   resolveFAMarket 이 실패 사유 5종(ROSTER 정원·CAP 캡초과·CASH 자금부족·LOST 경쟁패배·SIT_OUT 선수잔류)을
//   faFail 로 노출하도록 관측 추가(resolve 결정 로직 불변). 이 가드는 그 코드가 **실제 게이트와 일치**하는지 검증.
//
// (A) 합성 직접호출 — 입력을 조작해 CASH/CAP/ROSTER 게이트를 강제하고 코드를 대조(정밀·결정론).
//     · CASH: 운영 자금 0 → 캡은 남아도 입찰 불가 = '자금 부족'. (AI가 그 선수를 가져가 lostTo 가 찍혀도 CASH 우선 — 오해 수정의 핵심)
//     · CAP : 내 국내 연봉 ≈ 캡 → 오퍼 얹으면 초과 = '캡 초과'.
//     · ROSTER: 내 로스터 정원(16) 참 → 입찰 전 컷 = '자리 없음'.
//     A/B 민감도: 같은 CASH 시나리오를 자금 충분으로 뒤집으면 코드가 사라지는지(게이트에 반응) 확인.
// (B) 자연 장기런 — 실제 리그를 굴려 WON/LOST/SIT_OUT 을 관측 가능한 최종 로스터로 교차검증(엔진 내부 플래그 불신):
//     · WON     ⟹ faFail 없음 & 내 팀 로스터에 있음
//     · LOST    ⟹ lostTo 세팅 & 그 팀 로스터에 실제로 있음
//     · SIT_OUT ⟹ 어느 팀 로스터에도 없음 & lostTo 없음
//     · 지명했으나 실패한 풀 FA 는 정확히 1개 코드, 영입 성공 선수는 코드 없음(조립 불변식)

import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE, currentBasePlayers,
} from '../data/league';
import { resolveFAMarket, faMarketPreview } from '../data/offseason';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';
import { LEAGUE_CAP } from '../engine/cap';
import { ROSTER_TOTAL } from '../engine/aiGM';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let violations = 0;
const fail = (msg: string) => { violations++; log(`  ❌ ${msg}`); };
const ok = (msg: string) => log(`  ✓ ${msg}`);

resetLeagueBase();
const A = LEAGUE.teams[0].id; // myTeam
const B = LEAGUE.teams[1].id;

// ── 합성 도우미: 실제 선수를 템플릿으로 유효한 Player 를 만든다(faPref 등 보존) ──
const templates = currentBasePlayers().filter((p) => !p.isForeign);
let tIdx = 0;
const nextTemplate = () => templates[(tIdx++) % templates.length];
function clonePlayer(id: string, pos: Player['position'], salary: number): Player {
  const t = nextTemplate();
  return { ...t, id, position: pos, isForeign: false, isAsianQuota: false,
    contract: { ...t.contract, salary, remaining: 0 } };
}

/** 합성 off 를 만들어 resolveFAMarket 호출 → 지명한 FA_P 의 faFail 코드 반환 */
function runSynthetic(opts: {
  myRoster: Player[];      // 내 팀(A) 로스터
  bRoster: Player[];       // 상대(B) 로스터
  target: Player;          // 풀에 있는 지명 대상(prevTeamOf=B)
  myCash: number;
}): { code: string | undefined; lostTo: string | undefined } {
  const snapshot: Record<string, Player> = {};
  for (const p of [...opts.myRoster, ...opts.bRoster, opts.target]) snapshot[p.id] = p;
  const rosters: Record<string, string[]> = {
    [A]: opts.myRoster.map((p) => p.id),
    [B]: opts.bRoster.map((p) => p.id),
  };
  const off = { snapshot, rosters, pool: [opts.target.id] };
  const prevTeamOf: Record<string, string> = { [opts.target.id]: B };
  const prestige = { [A]: 0.5, [B]: 0.5 };
  const r = resolveFAMarket(off, A, [opts.target.id], false, [], prevTeamOf, 9000, prestige, undefined, opts.myCash);
  return { code: r.faFail[opts.target.id], lostTo: r.lostTo[opts.target.id] };
}

log('═══ (A) 합성 직접호출 — 게이트별 코드 대조 ═══');

// CASH — 운영 자금 0, 캡 여유 충분(내 로스터 비어 payroll 0). B 는 비어 gap 있어 입찰/영입 → lostTo 찍힘.
{
  const target = clonePlayer('FA_CASH', 'OP', 40000);
  const bFill = [clonePlayer('B_S1', 'S', 5000)];
  const { code, lostTo } = runSynthetic({ myRoster: [], bRoster: bFill, target, myCash: 0 });
  if (code === 'CASH') ok(`CASH 게이트 → '${code}' (자금 0, 캡 여유 있음)`);
  else fail(`CASH 게이트인데 코드='${code}' (기대 CASH)`);
  if (lostTo === B) ok(`  └ AI(${getTeam(B)?.name})가 데려가 lostTo 찍혔지만 코드는 CASH 우선 — '뺏김' 오표시 수정 확인`);
}

// CAP — 국내 연봉 ≈ 캡(오퍼 얹으면 초과). 자금은 충분.
{
  const near = Math.floor(LEAGUE_CAP / 2); // 두 명 합 ≈ 캡
  const myRoster = [clonePlayer('A_H1', 'MB', near), clonePlayer('A_H2', 'OH', near)];
  const target = clonePlayer('FA_CAP', 'OP', 40000);
  const bFill = [clonePlayer('B_S2', 'S', 5000)];
  const { code } = runSynthetic({ myRoster, bRoster: bFill, target, myCash: 99_999_999 });
  if (code === 'CAP') ok(`CAP 게이트 → '${code}' (내 payroll≈${LEAGUE_CAP}, 자금 충분)`);
  else fail(`CAP 게이트인데 코드='${code}' (기대 CAP)`);
}

// ROSTER — 로스터 정원(16) 참. 캡·자금 여유(저연봉 필러).
{
  const myRoster = Array.from({ length: ROSTER_TOTAL }, (_, i) => clonePlayer(`A_F${i}`, 'OH', 1000));
  const target = clonePlayer('FA_ROST', 'OP', 40000);
  const bFill = [clonePlayer('B_S3', 'S', 5000)];
  const { code } = runSynthetic({ myRoster, bRoster: bFill, target, myCash: 99_999_999 });
  if (code === 'ROSTER') ok(`ROSTER 게이트 → '${code}' (로스터 ${ROSTER_TOTAL}/${ROSTER_TOTAL} 참)`);
  else fail(`ROSTER 게이트인데 코드='${code}' (기대 ROSTER)`);
}

// A/B 민감도 — 같은 CASH 시나리오를 자금 충분으로 뒤집으면 코드가 사라져야(게이트에 반응하는 오라클 증명)
{
  const target = clonePlayer('FA_SENS', 'OP', 40000);
  const bFill = [clonePlayer('B_S4', 'S', 5000)];
  const poor = runSynthetic({ myRoster: [], bRoster: bFill, target, myCash: 0 }).code;
  const rich = runSynthetic({ myRoster: [], bRoster: bFill, target, myCash: 99_999_999 }).code;
  if (poor === 'CASH' && rich !== 'CASH') ok(`A/B 민감도 — 자금 0='${poor}' vs 충분='${rich ?? '없음(입찰 성사)'}' (게이트에 반응)`);
  else fail(`A/B 민감도 실패 — 자금 0='${poor}', 충분='${rich}' (충분에서 CASH가 사라져야)`);
}

// ── (B) 자연 장기런 — 관측 가능한 최종 로스터로 WON/LOST/SIT_OUT 교차검증 ──
log('\n═══ (B) 자연 장기런 — WON/LOST/SIT_OUT 관측 교차검증 ═══');
resetLeagueBase();
const N = Math.max(1, Number(process.argv[2]) || 120);
const BIG = 99_999_999;
let cWon = 0, cLost = 0, cSit = 0, cCash = 0, cCap = 0, cRost = 0, targets = 0;

for (let s = 1; s <= N; s++) {
  // 상위 FA 4명을 공격적으로 노려 성공/뺏김/잔류 경로를 두루 유발
  const pre = faMarketPreview(A, {}, {}, [], true, [], s, undefined, BIG);
  const wishlist = [...pre.pool].map((id) => pre.snapshot[id]).filter((p): p is Player => !!p)
    .sort((a, b) => overall(b) - overall(a)).slice(0, 4).map((p) => p.id);

  const pv = faMarketPreview(A, {}, {}, wishlist, true, [], s, undefined, BIG);
  const ctx = buildDraftContext(A, {}, {}, wishlist, true, [], s, undefined, BIG);

  // 최종(드래프트+충원) 로스터 — 관측 오라클의 근거
  const snapshot = ctx.snapshot;
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;

  // 선수 → 소속팀(FA 직후 ctx.rosters 로 판정 — 뺏김/잔류의 진실. 드래프트/충원은 신규만 추가라 FA 결과 불변)
  const teamOf = new Map<string, string>();
  for (const tid of Object.keys(ctx.rosters)) for (const id of ctx.rosters[tid]) teamOf.set(id, tid);

  for (const id of wishlist) {
    if (!pv.pool.includes(id)) continue; // 풀에 실재하는 지명만
    targets++;
    const won = pv.signedByMe.has(id);
    const code = pv.faFail[id];
    const where = teamOf.get(id);
    const name = pv.snapshot[id]?.name ?? id;

    if (won) {
      cWon++;
      if (code) fail(`[s${s}] ${name} 영입 성공인데 faFail='${code}' (코드 없어야)`);
      if (where !== A) fail(`[s${s}] ${name} 영입 성공인데 내 팀 아님 → ${where ? getTeam(where)?.name : '없음'}`);
      continue;
    }
    // 실패 = 정확히 1개 코드
    if (!code) { fail(`[s${s}] ${name} 지명 실패인데 코드 없음`); continue; }
    if (code === 'LOST') {
      cLost++;
      const lt = pv.lostTo[id];
      if (!lt) fail(`[s${s}] ${name} LOST 인데 lostTo 없음`);
      else if (lt === A) fail(`[s${s}] ${name} LOST 인데 lostTo=내 팀`);
      else if (where !== lt) fail(`[s${s}] ${name} LOST→${getTeam(lt)?.name} 인데 실제 소속=${where ? getTeam(where)?.name : '없음'}`);
    } else if (code === 'SIT_OUT') {
      cSit++;
      if (pv.lostTo[id]) fail(`[s${s}] ${name} SIT_OUT 인데 lostTo 세팅됨`);
      if (where) fail(`[s${s}] ${name} SIT_OUT(잔류)인데 ${getTeam(where)?.name} 로스터에 있음`);
    } else if (code === 'CASH') { cCash++; if (where === A) fail(`[s${s}] ${name} CASH 인데 내 팀에 있음`); }
    else if (code === 'CAP') { cCap++; if (where === A) fail(`[s${s}] ${name} CAP 인데 내 팀에 있음`); }
    else if (code === 'ROSTER') { cRost++; if (where === A) fail(`[s${s}] ${name} ROSTER 인데 내 팀에 있음`); }
    else fail(`[s${s}] ${name} 알 수 없는 코드 '${code}'`);
  }

  // 다음 시즌으로 진화(simFaDup 와 동일 커밋)
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
    const prod = leagueProduction(Number.MAX_SAFE_INTEGER).get(id);
    if (prod && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], prod), prod);
  }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

log(`\n지명 ${targets}건 — 성공 ${cWon} · 뺏김 ${cLost} · 잔류 ${cSit} · 자금부족 ${cCash} · 캡초과 ${cCap} · 정원 ${cRost}`);
log(violations === 0
  ? `\n✅ FAFAIL_GUARD PASS — 실패 사유 코드가 실제 게이트/관측 결과와 일치(위반 0)`
  : `\n❌ FAFAIL_GUARD FAIL — 위반 ${violations}건`);
process.exit(violations === 0 ? 0 : 1);
