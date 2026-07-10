// 선수 역제안 카운터(counterTolerance) ↔ 실제 해소 정합 가드 — FA_SYSTEM §2.8.6 Phase6.
//   npx tsx tools/_dv_facounter.ts [자연런 시즌=60]
//
// 배경: 내가 오퍼에 counterTolerance(salaryUp)를 걸어두면, 선수가 counterAsk(=asking×(1+δ))를 요구할 때
//   그 한도 안에서 자동으로 offer를 counterAsk까지 상향하고(같은 rand로 재계산) 정상 롤한다(§2.8.6).
//   δ는 facounter 해시 서브스트림(메인 rng 밖) → rng 소비 불변. AI는 tolerance 없음(전량 미발동).
//
// 검증:
// (1) 0드리프트   — tolerance 미설정 오퍼로 두 번 호출 → 해소 결과 byte-동일 + counterFired 빈 객체.
// (2) 발동 정합   — 큰 tolerance 지명에서 counterFired 수집: from<to · to≤개인상한 · (서명 시)to=계약 연봉 ·
//                   grade∈{A,B} · baseScore<CERTAIN(만족도 셀렉터로 파생 대조, rand 오차 보정).
// (3) all-or-nothing — 작은 salaryUp(offer+up<counterAsk)이면 미발동·원 오퍼 계약(counterFired 없음).
// (4) preview=result — 같은 faOffers(tolerance 포함)로 faMarketPreviewFrom(FAPreview)·buildDraftContextFrom(DraftContext)의
//                   counterFired·signedByMe 동일(fa.tsx 프리뷰 == endSeason 경로).
// (5) 오라클 이빨(A/B) — 손상된 counterFired(to≤from, to>개인상한, to≠계약연봉)를 순수 체크가 검출.
// (6) rng 소비 불변 — [tolerance 없는 오퍼]와 [조건 미달로 미발동하는 tolerance(작은 salaryUp)] 두 케이스의
//                   전체 해소 결과 byte-동일 → 카운터 코드 경로(δ 서브스트림·hoist rand)가 메인 rng를 안 민다.

import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE,
} from '../data/league';
import { buildOffseasonBase, faMarketPreviewFrom, scandalRepMap, type FAPreview } from '../data/offseason';
import { buildDraftContextFrom } from '../data/draftSetup';
import { relationBonds } from '../data/relationships';
import { offerSatisfaction } from '../data/faOfferSatisfaction';
import { assignFAGrades, CERTAIN, DEFAULT_FA_OFFER } from '../engine/faMarket';
import { maxSalaryFor } from '../engine/cap';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';
import type { FAOffer, Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let violations = 0;
const fail = (msg: string) => { violations++; log(`  ❌ ${msg}`); };
const ok = (msg: string) => log(`  ✓ ${msg}`);

resetLeagueBase();
const A = LEAGUE.teams[0].id; // myTeam
const BIG = 99_999_999;
const N = Math.max(1, Number(process.argv[2]) || 60);

const BIG_UP = 300_000;   // salaryUp 충분 → counterAsk 항상 커버(발동 조건 충족 시 발동)
const TINY_UP = 50;       // salaryUp 부족 → all-or-nothing 실패(미발동)

/** 해소 결과 대표 키(결정론·byte 비교용) — 풀 전원 최종 소속·연봉 + 내 지표(pv는 팀별 로스터 직접 미제공 → snapshot 연봉+signed/lost로 대표). */
function resKey(pv: FAPreview): string {
  const signed = [...pv.signedByMe].sort();
  const poolSalary = [...pv.pool].sort().map((id) => [id, pv.snapshot[id]?.contract.salary ?? null]);
  return JSON.stringify({ signed, lostTo: pv.lostTo, faFail: pv.faFail, myRoster: [...pv.myRoster].sort().map((id) => [id, pv.snapshot[id]?.contract.salary ?? null]), poolSalary });
}

/** 오퍼 맵 조립(지명 id → 오퍼). tol: 'none' | 'big' | 'tiny' */
function offersFor(ids: string[], tol: 'none' | 'big' | 'tiny'): Record<string, FAOffer> {
  const m: Record<string, FAOffer> = {};
  for (const id of ids) {
    m[id] = { ...DEFAULT_FA_OFFER, ...(tol === 'big' ? { counterTolerance: { salaryUp: BIG_UP } } : tol === 'tiny' ? { counterTolerance: { salaryUp: TINY_UP } } : {}) };
  }
  return m;
}

const preview = (base: ReturnType<typeof buildOffseasonBase>, ids: string[], offers: Record<string, FAOffer>, s: number): FAPreview =>
  faMarketPreviewFrom(base, A, ids, false, [], s, undefined, BIG, [], null, [], [], null, offers);

// ── 순수 오라클(오라클 이빨 A/B 재사용) ─────────────────────────────
/** counterFired 엔트리 유효성: from<to · to≤개인상한 · (서명 시)to=계약연봉. */
function counterValid(cf: { from: number; to: number }, maxSal: number, signedSalary: number | null): boolean {
  if (!(cf.from < cf.to)) return false;
  if (!(cf.to <= maxSal)) return false;
  if (signedSalary != null && cf.to !== signedSalary) return false;
  return true;
}

log('═══ (자연 장기런) counterTolerance ↔ 해소 결과 교차검증 ═══');
let firedN = 0, targetsN = 0, tinyTargetsN = 0, sitCertainSoft = 0;

for (let s = 1; s <= N; s++) {
  const base = buildOffseasonBase(A, {}, {}, s, undefined);
  const preSnap = base.off.snapshot;
  const prePool = base.off.pool;
  const grades = assignFAGrades(prePool.map((id) => preSnap[id]).filter((p): p is Player => !!p));
  // A/B FA 상위 6명을 내 팀이 지명(카운터 발동 유발 — grade A/B 게이트)
  const abTargets = prePool
    .map((id) => preSnap[id]).filter((p): p is Player => !!p && (grades.get(p.id) === 'A' || grades.get(p.id) === 'B'))
    .sort((a, b) => overall(b) - overall(a)).slice(0, 6).map((p) => p.id);

  const repMap = scandalRepMap();
  const bonds = relationBonds();

  // (1) 0드리프트 — tolerance 미설정으로 두 번 호출 == byte-동일 + counterFired 빈 객체
  const pvNo = preview(base, abTargets, offersFor(abTargets, 'none'), s);
  const pvNo2 = preview(base, abTargets, offersFor(abTargets, 'none'), s);
  if (s <= 10) {
    if (resKey(pvNo) !== resKey(pvNo2)) fail(`[s${s}] (1) 무tolerance 재호출 해소 불일치(비결정론)`);
    if (Object.keys(pvNo.counterFired).length !== 0) fail(`[s${s}] (1) 무tolerance인데 counterFired 비어있지 않음`);
  }

  // (6) rng 소비 불변 — 작은 salaryUp(미발동) 케이스가 무tolerance와 전체 byte-동일
  const pvTiny = preview(base, abTargets, offersFor(abTargets, 'tiny'), s);
  if (Object.keys(pvTiny.counterFired).length !== 0) fail(`[s${s}] (3) tiny salaryUp인데 counterFired 발동(all-or-nothing 위반)`);
  if (s <= 10 && resKey(pvTiny) !== resKey(pvNo)) fail(`[s${s}] (6) 미발동 tolerance가 해소를 바꿈(rng 스트림 밀림?)`);
  // (3) tiny 지명이 서명됐으면 원 오퍼(auto=asking) 연봉이어야(상향 안 됨)
  for (const id of abTargets) {
    if (pvTiny.signedByMe.has(id)) {
      tinyTargetsN++;
      if (pvTiny.counterFired[id]) fail(`[s${s}] (3) ${id} tiny인데 counterFired 존재`);
    }
  }

  // (2) 발동 정합 — 큰 salaryUp 지명에서 counterFired 수집
  const pvBig = preview(base, abTargets, offersFor(abTargets, 'big'), s);
  for (const id of abTargets) {
    if (!pvBig.pool.includes(id)) continue;
    targetsN++;
    const cf = pvBig.counterFired[id];
    if (!cf) continue;
    firedN++;
    const p = preSnap[id];
    const maxSal = maxSalaryFor(p);
    const signedSalary = pvBig.signedByMe.has(id) ? (pvBig.snapshot[id]?.contract.salary ?? null) : null;
    if (!counterValid(cf, maxSal, signedSalary)) fail(`[s${s}] (2) ${p?.name ?? id} counterFired 무효 from=${cf.from} to=${cf.to} maxSal=${maxSal} signed=${signedSalary}`);
    const g = grades.get(id);
    if (!(g === 'A' || g === 'B')) fail(`[s${s}] (2) ${id} counter 발동인데 grade=${g}(A/B 아님)`);
    // baseScore<CERTAIN(발동 게이트) — **오직 최고 OVR 지명(abTargets[0])만** 파생 대조. 엔진은 순차 해소 중 라이브(변동)
    //   로스터로 score를 매기고 offerSatisfaction은 pre-FA 정적 로스터를 쓰므로, 내 로스터가 아직 안 바뀐 #1 지명에서만 정확히 일치
    //   (그 아래 지명은 내 이전 서명으로 teamOvr·posGap이 변해 파생이 어긋남 → 허위 실패). rand(0.05·rand) 오차는 threshold로 흡수.
    if (id === abTargets[0]) {
      const sat = offerSatisfaction({
        player: p, myTeam: A, snapshot: preSnap, myRosterIds: base.off.rosters[A] ?? [],
        prevTeamOf: base.prevTeamOf, prestige: base.prestige[A] ?? 0,
        grade: g!, repMult: repMap.get(id) ?? 1, offer: { ...DEFAULT_FA_OFFER }, // 원(base auto) 오퍼
        talkBias: undefined, bonds,
      });
      // 실제 baseScore<CERTAIN이면 sat=baseScore−0.05·rand+0.025 < CERTAIN+0.025 → 정상 상한 ~0.625. threshold 0.65는
      //   정상 발동엔 여유(위반 0), 게이트 제거(확정권 남발) 회귀엔 이빨(baseScore≥0.675면 검출).
      if (sat.score < CERTAIN + 0.05) sitCertainSoft++;
      else fail(`[s${s}] (2) ${p?.name ?? id} #1지명 counter 발동인데 baseScore(파생 ${sat.score.toFixed(3)}) ≥ CERTAIN(${CERTAIN})+ε — 확정권엔 발동 안 해야`);
    }
  }

  // (4) preview=result — 같은 faOffers(big)로 DraftContext 경로의 counterFired·signedByMe가 FAPreview와 동일
  const ctxBig = buildDraftContextFrom(base, A, abTargets, false, [], s, undefined, BIG, [], null, [], [], null, offersFor(abTargets, 'big'));
  const cfPv = JSON.stringify(Object.entries(pvBig.counterFired).sort());
  const cfCtx = JSON.stringify(Object.entries(ctxBig.counterFired).sort());
  if (cfPv !== cfCtx) fail(`[s${s}] (4) FAPreview.counterFired ≠ DraftContext.counterFired`);
  // signedByMe: DraftContext는 rosters로만 표현 → 내 로스터에 지명 id가 있는지로 대조
  const myCtxRoster = new Set(ctxBig.rosters[A] ?? []);
  for (const id of abTargets) {
    const inPv = pvBig.signedByMe.has(id);
    const inCtx = myCtxRoster.has(id);
    if (inPv !== inCtx) fail(`[s${s}] (4) ${id} signedByMe 불일치 pv=${inPv} ctx=${inCtx}`);
  }

  // ── 다음 시즌 진화(중립 — 지명 없이 AI만, 내 팀 린 유지로 gap>0 발동 기회 확보) ──
  const ctx = buildDraftContextFrom(base, A, [], false, [], s, undefined, BIG);
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

log(`\n관측 — A/B 지명 ${targetsN}건 · 카운터 발동 ${firedN}건 · baseScore<CERTAIN 소프트 통과 ${sitCertainSoft} · tiny 서명 ${tinyTargetsN}건`);
if (firedN === 0) fail('카운터 발동 케이스 0 — 유발 셋업 실패(큰 salaryUp+A/B 지명인데 미발동, 게이트 과잉?)');

// ── (5) 오라클 이빨(A/B) — 손상된 counterFired 를 순수 체크가 검출 ──
log('\n═══ 오라클 이빨(A/B) — 손상된 counterFired 를 체크가 검출 ═══');
{
  const good = { from: 30000, to: 34000 };
  const maxSal = 80000, signed = 34000;
  const passGood = counterValid(good, maxSal, signed);                 // 정상 → true
  const mUp = counterValid({ from: 34000, to: 34000 }, maxSal, signed); // to≤from → false
  const mCap = counterValid({ from: 30000, to: 90000 }, maxSal, 90000); // to>개인상한 → false
  const mSal = counterValid(good, maxSal, 33000);                       // to≠계약연봉 → false
  if (passGood && !mUp && !mCap && !mSal) ok('A/B — 정상=통과, (to≤from·to>상한·to≠연봉) 손상=검출(체크에 이빨)');
  else fail(`A/B 실패 — good=${passGood} up=${mUp} cap=${mCap} sal=${mSal} (손상은 전부 false 여야)`);
}

log(violations === 0
  ? `\n✅ FACOUNTER_GUARD PASS — 카운터 발동/미발동·0드리프트·preview=result·rng 불변 정합(위반 0)`
  : `\n❌ FACOUNTER_GUARD FAIL — 위반 ${violations}건`);
process.exit(violations === 0 ? 0 : 1);
