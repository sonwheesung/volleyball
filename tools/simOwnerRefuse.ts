// 면담/재계약 거부 경로(OWNER) 검증 — 불만 선수가 재계약을 거부하고 FA로 떠날 때
// 선수가 중복/누락되지 않는지. refuseProb를 강제로 최대로 걸어 거부를 대량 유발.
//   npx tsx tools/simOwnerRefuse.ts [시즌=20]

import {
  resetLeagueBase, LEAGUE, getTeam, getPlayer, teamScoutReveal,
  commitPlayerBase, commitRosters, currentRosters,
} from '../data/league';
import { faMarketPreview, resolvePreDraft } from '../data/offseason';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import type { OwnerFx } from '../engine/owner';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(2, Number(process.argv[2]) || 20);
resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
const teamIds = LEAGUE.teams.map((t) => t.id);
const tname = (id: string) => getTeam(id)?.name ?? id;

let violations = 0;
let totalRefused = 0;
const fail = (s: number, m: string) => { if (violations < 30) log(`  ❌ [S${s}] ${m}`); violations++; };

for (let s = 1; s <= N; s++) {
  const startMine = [...(currentRosters()[myTeam] ?? [])]; // 시즌 시작 내 명단(국내+외인)
  // 강제 거부: 내 모든 선수에 refuseProb 최대(만료자만 실제 발동)
  const ownerFx: OwnerFx = { refuseProb: {}, offerBias: {} };
  for (const id of startMine) ownerFx.refuseProb[id] = 0.99;

  // 미리보기 — 풀(롤오버 후·FA 전) + 내 잔류 명단
  const peek = faMarketPreview(myTeam, {}, {}, [], true, [], s, ownerFx, 9_999_999);
  const keptMine = new Set(peek.myRoster);
  const poolSet = new Set(peek.pool);
  // 시즌 시작 내 국내 선수 중 잔류 안 된 사람 = 거부/만료 → 풀에 있어야(은퇴·외인 제외)
  for (const id of startMine) {
    const p = peek.snapshot[id];
    if (!p || p.isForeign) continue;
    if (!keptMine.has(id)) {
      totalRefused++;
      if (!poolSet.has(id)) {
        // 풀에도 없고 내 명단에도 없음 — 다른 팀 명단인지 확인(아직 FA 전이라 있으면 안 됨)
        if (peek.snapshot[id]) fail(s, `거부/만료 선수 ${id} 가 내 명단에도 풀에도 없음(누락)`);
      } else if (keptMine.has(id)) {
        fail(s, `${id} 가 내 명단과 풀에 동시 존재(중복)`);
      }
    } else if (poolSet.has(id)) {
      fail(s, `${id} 가 잔류했는데 FA 풀에도 있음(중복)`);
    }
  }

  // 실제 적용(드래프트 직전) — 전역 유일성
  const ctx = buildDraftContext(myTeam, {}, {}, [], true, [], s, ownerFx, 9_999_999);
  const owner = new Map<string, string>();
  for (const t of teamIds) for (const id of ctx.rosters[t] ?? []) {
    const prev = owner.get(id);
    if (prev && prev !== t) fail(s, `선수 ${id} 두 팀 동시 소속(${tname(prev)}·${tname(t)})`);
    owner.set(id, t);
  }
  // 활성 계약(거부로 만료된 선수가 명단에 남으면 위반)
  for (const t of teamIds) for (const id of ctx.rosters[t] ?? []) {
    const p = ctx.snapshot[id];
    if (p && (p.contract?.remaining ?? 0) < 1) fail(s, `${tname(t)} ${id} 만료 계약(잔여 ${p.contract?.remaining}) 명단 잔존`);
  }

  // 다음 시즌으로 진행(드래프트+신인+커밋)
  const snapshot = ctx.snapshot;
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  // 최종 전역 유일성
  const own2 = new Map<string, string>();
  for (const t of teamIds) for (const id of f.rosters[t] ?? []) {
    const prev = own2.get(id);
    if (prev && prev !== t) fail(s, `[최종] 선수 ${id} 두 팀(${tname(prev)}·${tname(t)})`);
    own2.set(id, t);
  }
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
  void resolvePreDraft; void getPlayer;
}

log(`\n═══ 면담/재계약 거부 경로 검증 ${N}시즌 (강제 거부) ═══`);
log(`거부/만료 발생 ${totalRefused}건`);
log(violations === 0
  ? `\n✅ 위반 0건 — 거부 선수 풀로 정확히 이동, 중복/누락/만료잔존 없음`
  : `\n❌ 위반 ${violations}건`);
process.exit(violations === 0 ? 0 : 1);
