// FA/오프시즌 선수 중복 배정 전수 검증 — 한 선수가 두 팀에 동시에 들어가는가?
//   npx tsx tools/simFaDup.ts [시즌=300]
// 매 오프시즌(롤오버·은퇴·외인 트라이아웃·FA 경쟁·보상선수·AI 충원·드래프트·신인) 이후 불변식:
//   (a) 전역 유일성 — 어떤 선수도 2개 이상 팀 로스터에 없다
//   (b) 로스터 내 유일성 — 같은 팀 안에 같은 id 중복 없음
//   (c) 은퇴자는 어느 로스터에도 없다
//   (d) 로스터의 모든 id는 스냅샷에 존재
//   (e) 팀당 외인 ≤ 1 (FOREIGN 규칙)
//   (f) 내가 영입한 FA(signedByMe)는 전부 내 팀에 있다(보상으로 넘어가지 않음 — 이중 배정 회귀 가드)
// 공격적 영입 + 거대 자금으로 FA 경쟁·보상선수 경로를 강제로 자주 태운다.

import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { faMarketPreview } from '../data/offseason';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 300);
const BIG_CASH = 99_999_999;
resetLeagueBase();

const myTeam = LEAGUE.teams[0].id;
let violations = 0;
let totalSigned = 0, totalComp = 0, totalSeasonsWithSign = 0;
const fail = (s: number, msg: string) => { violations++; log(`  ❌ [시즌 ${s}] ${msg}`); };

for (let s = 1; s <= N; s++) {
  // 1) 풀 미리보기 — 영입 대상 선정(상위 FA 4명까지 공격적으로 노린다 → 보상선수 경로 유발)
  const pre = faMarketPreview(myTeam, {}, {}, [], true, [], s, undefined, BIG_CASH);
  const wishlist = [...pre.pool]
    .map((id) => pre.snapshot[id]).filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => overall(b) - overall(a))
    .slice(0, 4).map((p) => p.id);

  // 2) 실제 영입 결과(같은 결정론 소스) — signedByMe 확정
  const outcome = faMarketPreview(myTeam, {}, {}, wishlist, true, [], s, undefined, BIG_CASH);
  const signedByMe = [...outcome.signedByMe];
  if (signedByMe.length) totalSeasonsWithSign++;
  totalSigned += signedByMe.length;

  // 3) 드래프트 직전 컨텍스트(롤오버·은퇴·트라이아웃·FA·보상·AI충원 반영)
  const ctx = buildDraftContext(myTeam, {}, {}, wishlist, true, [], s, undefined, BIG_CASH);
  const snapshot = ctx.snapshot;

  // 4) 드래프트 + 신인 충원 → 최종 로스터
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;

  // ── 불변식 검사 (드래프트 전 ctx.rosters + 최종 f.rosters 둘 다) ──
  for (const [label, rosters] of [['드래프트전', ctx.rosters], ['최종', f.rosters]] as const) {
    const owner = new Map<string, string>(); // playerId → teamId
    for (const tid of Object.keys(rosters)) {
      const seen = new Set<string>();
      let foreignCnt = 0;
      for (const id of rosters[tid]) {
        // (b) 로스터 내 유일성
        if (seen.has(id)) fail(s, `${label}: ${id} 가 ${getTeam(tid)?.name} 로스터에 중복`);
        seen.add(id);
        // (a) 전역 유일성
        const prev = owner.get(id);
        if (prev && prev !== tid) fail(s, `${label}: ${id} 가 두 팀에 동시 소속 (${getTeam(prev)?.name} & ${getTeam(tid)?.name})`);
        owner.set(id, tid);
        // (d) 스냅샷 존재
        if (!snapshot[id]) fail(s, `${label}: ${id} 가 로스터에 있으나 스냅샷에 없음`);
        // (e) 외인 ≤1
        if (snapshot[id]?.isForeign) foreignCnt++;
      }
      if (foreignCnt > 1) {
        fail(s, `${label}: ${getTeam(tid)?.name} 외인 ${foreignCnt}명 (>1)`);
        if (violations <= 2) {
          const fgn = rosters[tid].filter((id) => snapshot[id]?.isForeign);
          for (const id of fgn) {
            const p = snapshot[id]!;
            log(`        외인 ${id} ${p.name} pos=${p.position} age=${p.age} salary=${p.contract.salary} rem=${p.contract.remaining}`);
          }
        }
      }
    }
    // (c) 은퇴자 부재
    for (const rid of ctx.retired) if (owner.has(rid)) fail(s, `${label}: 은퇴자 ${rid} 가 ${getTeam(owner.get(rid)!)?.name} 로스터에 있음`);
  }

  // (f) 내가 영입한 FA는 전부 내 팀에 — 보상으로 넘어가면 위반
  const myFinal = new Set(f.rosters[myTeam] ?? []);
  for (const id of signedByMe) {
    if (!myFinal.has(id)) {
      // 어느 팀에 있는지 추적
      let where = '리그 이탈';
      for (const tid of Object.keys(f.rosters)) if (f.rosters[tid].includes(id)) { where = getTeam(tid)?.name ?? tid; break; }
      fail(s, `signedByMe ${id} 가 내 팀에 없음 → ${where} (이중 배정/보상 유출)`);
    }
  }
  // 보상선수 발생 추정(내 팀에서 빠진 인원) — 통계용
  totalComp += Math.max(0, signedByMe.length - ((f.rosters[myTeam] ?? []).filter((id) => signedByMe.includes(id)).length));

  // 5) 커밋 — 다음 시즌으로 진화
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
    const prod = leagueProduction(Number.MAX_SAFE_INTEGER).get(id);
    if (prod && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], prod), prod);
  }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

log(`\n═══ FA 중복 배정 검증 ${N}시즌 (myTeam=${getTeam(myTeam)?.name}, 공격 영입) ═══`);
log(`FA 영입 ${totalSigned}건 (영입 발생 시즌 ${totalSeasonsWithSign}/${N}) · 보상 유출 추정 ${totalComp}건`);
log(violations === 0
  ? `\n✅ 위반 0건 — 어떤 선수도 두 팀에 동시 소속되지 않음, 영입 FA 유출 없음`
  : `\n❌ 위반 ${violations}건 — 위 로그 확인`);
process.exit(violations === 0 ? 0 : 1);
