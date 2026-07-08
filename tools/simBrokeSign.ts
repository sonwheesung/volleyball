// 돈 없는데 영입? + 몸값 이중과금 감시 — 독립 설계 오라클(store 규칙 재귀 복제 아님).
//   npx tsx tools/simBrokeSign.ts [시즌=40]
//   INJECT_DOUBLE=1 npx tsx tools/simBrokeSign.ts   → 이중과금(구버그) 재도입 모사 → 가드① 발화 A/B 자가검증
//
// 설계(FINANCE/FA_SYSTEM)에서 도출한 두 불변식:
//   ① 몸값 단일 채널 — 영입 FA(국내·외인)의 첫해 몸값은 *다음 시즌 myPayroll* 이 전액 부과한다.
//      따라서 오프시즌 현금 차감(faSpend)은 **보상금(compCash)만**이어야 하고, 영입 몸값 salary 성분은 0이다.
//      (예전 버그: faSpend += salary → payroll + faSpend 이중 차감 = salary×(N+1). EC-FN-03.)
//   ② 과지출 없음 — 오프시즌 현금 차감(faSpend) ≤ 정산 후 현금(settled). 초과면 클램프로 숨은 과지출.
// A/B: INJECT_DOUBLE=1이면 faSpend에 영입 몸값을 되살려(구버그) 가드①이 실제로 발화하는지 증명(허위 오라클 방지).

import {
  resetLeagueBase, setMyTeamStaff, LEAGUE, getTeam, teamScoutReveal, commitPlayerBase, commitRosters,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { faMarketPreview } from '../data/offseason';
import { projectSettledCash } from '../data/financeProjection';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(2, Number(process.argv[2]) || 40);
const INJECT = process.env.INJECT_DOUBLE === '1'; // 구버그 재도입(A/B)
resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);
const money = (v: number) => `${(v / 10000).toFixed(2)}억`;

let cash = 50000; // 시작 운영 예비금(스토어 기본)
const fanScore = 50;
let overspends = 0;      // 가드②
let doubleCharged = 0;   // 가드①(오프시즌 차감에 몸값이 섞임)
let acqDomestic = 0, acqForeign = 0;
const samples: string[] = [];

for (let s = 1; s <= N; s++) {
  const settled = projectSettledCash(myTeam, s, cash, fanScore, []);

  // 상위 FA 6명 공격적으로 노림(현금 압박) — 이중과금이 있으면 과지출로 드러난다
  const peek = faMarketPreview(myTeam, {}, {}, [], true, [], s, undefined, settled);
  const wish = [...peek.pool].map((id) => peek.snapshot[id]).filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => overall(b) - overall(a)).slice(0, 6).map((p) => p.id);

  const ctx = buildDraftContext(myTeam, {}, {}, wish, true, [], s, undefined, settled);
  const snapshot = ctx.snapshot;

  // 이번 오프시즌 영입 FA(타팀 출신, prev≠my)의 첫해 몸값 합 — 독립 측정.
  //   ctx.rosters는 드래프트 전(FA·보상·복귀 반영)이라 드래프트/신인은 아직 없음 → 순수 영입만 잡힌다.
  let acquiredSalary = 0;
  for (const id of ctx.rosters[myTeam] ?? []) {
    const prev = ctx.prevTeamOf[id];
    if (!prev || prev === myTeam) continue;
    const p = snapshot[id];
    if (!p) continue;
    acquiredSalary += p.contract.salary ?? 0;
    if (p.isForeign) acqForeign++; else acqDomestic++;
  }

  // 설계상 오프시즌 현금 차감 = 보상금만. (구버그면 몸값이 얹힌다.)
  const designFaSpend = ctx.compCash;
  const faSpend = INJECT ? designFaSpend + acquiredSalary : designFaSpend;

  // 가드① 몸값 이중과금: 오프시즌 차감에서 몸값 성분을 분리 — 0이어야 정상.
  const salaryInOffseason = faSpend - ctx.compCash;
  if (salaryInOffseason > 1e-9) {
    doubleCharged++;
    if (samples.length < 12) samples.push(`S${s}: 오프시즌 차감에 몸값 ${money(salaryInOffseason)} 혼입(설계 위반, faSpend=보상금만이어야) — 영입몸값 ${money(acquiredSalary)}`);
  }

  // 가드② 과지출
  if (settled - faSpend < 0) {
    overspends++;
    if (samples.length < 12) samples.push(`S${s}: 정산후 ${money(settled)} < 오프시즌차감 ${money(faSpend)} (보상금 ${money(ctx.compCash)}) → ${money(faSpend - settled)} 초과`);
  }

  cash = Math.max(0, settled - faSpend);

  // 진행
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

log(`\n═══ 재정 무결성 ${N}시즌 (공격적 영입${INJECT ? ' · INJECT_DOUBLE=1[A/B]' : ''}) ═══`);
log(`  영입 표본: 국내 ${acqDomestic} · 외인 ${acqForeign}`);
for (const sm of samples) log(`  ⚠ ${sm}`);
log(`  ① 몸값 이중과금(오프시즌 차감에 몸값 혼입): ${doubleCharged}건`);
log(`  ② 과지출(정산후 현금 < 오프시즌 차감): ${overspends}건`);

if (INJECT) {
  // A/B: 구버그를 되살렸으니 가드①이 반드시 발화해야 한다(영입이 있었다면).
  const ok = doubleCharged > 0;
  log(ok
    ? `\n✅ A/B 자가검증 통과 — 이중과금 재도입을 가드①이 검출(${doubleCharged}건)`
    : `\n❌ A/B 실패 — 이중과금을 되살렸는데 가드①이 못 잡음(오라클 무력)`);
  process.exit(ok ? 0 : 1);
}
const clean = doubleCharged === 0 && overspends === 0;
log(clean
  ? `\n✅ 무결 — 몸값 단일 채널(payroll) 유지·오프시즌 몸값 이중과금 0·과지출 0`
  : `\n❌ ${doubleCharged}건 이중과금 · ${overspends}건 과지출`);
process.exit(clean ? 0 : 1);
