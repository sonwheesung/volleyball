// 감독·코치·스카우터·선수 중복/오배정 전수 검증 — "한 사람 = 한 팀" 불변식.
//   npx tsx tools/simStaffDup.ts [시즌=120]
// 매 시즌: (1) AI 감독 생애주기(은퇴·경질·승격·재배정·계약) (2) 내 팀 능동 영입(감독 경질/영입·
//   코치 영입/방출·스카우터 영입) (3) 드래프트+신인 — 그 뒤 불변식 검사:
//   감독: 한 감독이 두 팀 지휘 불가 · 배정과 coach.teamId 일치 · firedFrom 팀 복귀 금지 · 프리감독이 지휘 안 함
//   코치: 한 코치 두 팀 소속 불가 · 감독겸코치 불가 · 슬롯 초과 불가 · teamId 일치
//   스카우터: 한 명 두 팀 불가
//   선수: 한 선수 두 팀 로스터 동시 등록 불가

import {
  resetLeagueBase, setMyTeamStaff, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE,
  currentCoachPool, commitCoachPool, assignCoach, reconcileStaff, getTeamCoach, getCoach,
  getStaffState, availableCoaches, availableAssistants, availableScouts,
  hireHeadCoach, hireAssistant, releaseAssistant, hireScout, releaseScout, fireCoach, coachSlots,
  teamAssistants, teamScouts,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { computeStandings } from '../data/standings';
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 120);
resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);
const teamIds = LEAGUE.teams.map((t) => t.id);

// 결정론 의사난수(시드) — 내 팀 영입 행동 다양화(Math.random 미사용)
let rngState = 123456789;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

let violations = 0;
const fail = (s: number, msg: string) => { if (violations < 40) log(`  ❌ [시즌 ${s}] ${msg}`); violations++; };

/** 한 시점의 스태프·로스터 불변식 전수 검사 */
function checkInvariants(s: number, where: string, rosters: Record<string, string[]>): void {
  const staff = getStaffState();

  // ── 감독 ──
  const headByTeam: Record<string, string> = {};
  for (const t of teamIds) { const c = getTeamCoach(t); if (c) headByTeam[t] = c.id; }
  const headSeen = new Map<string, string>(); // coachId → teamId
  for (const t of teamIds) {
    const id = headByTeam[t];
    if (!id) continue;
    // 한 감독이 두 팀 지휘?
    const prev = headSeen.get(id);
    if (prev && prev !== t) fail(s, `${where}: 감독 ${id} 가 두 팀 지휘 (${getTeam(prev)?.name} & ${getTeam(t)?.name})`);
    headSeen.set(id, t);
    const c = getCoach(id);
    if (!c) { fail(s, `${where}: 팀 ${getTeam(t)?.name} 감독 ${id} 가 풀에 없음`); continue; }
    // 배정과 coach.teamId 일치(대행 제외 — 대행은 임시 teamId=팀)
    if (c.teamId !== t) fail(s, `${where}: 감독 ${id}(${getTeam(t)?.name}) 의 teamId=${c.teamId} 불일치`);
    // firedFrom 팀에 복귀?
    if ((c.firedFrom ?? []).includes(t)) fail(s, `${where}: 경질 감독 ${id} 가 ${getTeam(t)?.name}(firedFrom) 에 복귀`);
  }
  // 배정 오버라이드(headCoachOverride) 값 유일성 + teamId 일치
  const ovSeen = new Map<string, string>();
  for (const [t, id] of Object.entries(staff.head)) {
    const prev = ovSeen.get(id);
    if (prev && prev !== t) fail(s, `${where}: override 감독 ${id} 가 두 팀(${prev} & ${t})`);
    ovSeen.set(id, t);
  }
  // 프리 감독(teamId=null)이 어떤 팀의 실제 감독으로 잡히면 위반(위 teamId 검사로 잡히지만 명시)
  for (const c of currentCoachPool().coaches) {
    if (c.teamId && !c.id.startsWith('acting_')) {
      const heads = getTeamCoach(c.teamId);
      if (heads?.id !== c.id) fail(s, `${where}: 감독 ${c.id} teamId=${c.teamId} 인데 그 팀 감독이 아님(고아 점유)`);
    }
  }

  // ── 전문 코치 ──
  const asstSeen = new Map<string, string>();
  for (const t of teamIds) {
    const list = teamAssistants(t);
    if (list.length > coachSlots()) fail(s, `${where}: ${getTeam(t)?.name} 코치 ${list.length} > 슬롯 ${coachSlots()}`);
    const within = new Set<string>();
    for (const a of list) {
      if (within.has(a.id)) fail(s, `${where}: 코치 ${a.id} 가 ${getTeam(t)?.name} 목록에 중복`);
      within.add(a.id);
      const prev = asstSeen.get(a.id);
      if (prev && prev !== t) fail(s, `${where}: 코치 ${a.id} 가 두 팀 소속 (${getTeam(prev)?.name} & ${getTeam(t)?.name})`);
      asstSeen.set(a.id, t);
      if (a.teamId !== t) fail(s, `${where}: 코치 ${a.id}(${getTeam(t)?.name}) teamId=${a.teamId} 불일치`);
      // 감독겸코치?
      if (headSeen.has(a.id)) fail(s, `${where}: ${a.id} 가 감독이면서 동시에 코치`);
    }
  }

  // ── 스카우터 ──
  const scoutSeen = new Map<string, string>();
  for (const t of teamIds) {
    for (const sc of teamScouts(t)) {
      const prev = scoutSeen.get(sc.id);
      if (prev && prev !== t) fail(s, `${where}: 스카우터 ${sc.id} 가 두 팀 (${getTeam(prev)?.name} & ${getTeam(t)?.name})`);
      scoutSeen.set(sc.id, t);
    }
  }

  // ── 선수 ──
  const ownById = new Map<string, string>();
  for (const t of teamIds) {
    const seen = new Set<string>();
    for (const id of rosters[t] ?? []) {
      if (seen.has(id)) fail(s, `${where}: 선수 ${id} 가 ${getTeam(t)?.name} 로스터 중복`);
      seen.add(id);
      const prev = ownById.get(id);
      if (prev && prev !== t) fail(s, `${where}: 선수 ${id} 가 두 팀 (${getTeam(prev)?.name} & ${getTeam(t)?.name})`);
      ownById.set(id, t);
    }
  }
}

const recentRankOrders: string[][] = [];
let firedCnt = 0, hiredCnt = 0, asstHireCnt = 0, scoutHireCnt = 0;

for (let s = 1; s <= N; s++) {
  // ── (1) AI 감독 생애주기(오프시즌) ──
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
  const bottomYears: Record<string, number> = {};
  for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);
  const assignedHead: Record<string, string> = {};
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }

  const ctx = buildDraftContext(myTeam, {}, {}, [], false, [], s);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
  const legendIds = new Set<string>(); // 레전드 가산은 dup 검증과 무관

  const pool = currentCoachPool();
  const res = advanceCoaches(s, pool, assignedHead, retiredPlayers, legendIds, rankOrder, bottomYears, myTeam);
  commitCoachPool(res.coaches, res.assistants);
  for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
  reconcileStaff();
  checkInvariants(s, '생애주기후', ctx.rosters);

  // ── (2) 내 팀 능동 영입(감독·코치·스카우터) — 영입 함수 직접 스트레스 ──
  // 감독: 가끔 경질 후 프리 감독 영입(또는 그냥 영입 시도)
  if (rnd() < 0.35) {
    const cur = getTeamCoach(myTeam);
    if (cur && !cur.id.startsWith('acting_')) { fireCoach(myTeam); firedCnt++; }
  }
  if (rnd() < 0.7) {
    const free = availableCoaches();
    if (free.length) { if (hireHeadCoach(myTeam, free[Math.floor(rnd() * free.length)].id)) hiredCnt++; }
  }
  // 코치: 슬롯 여유 시 영입, 가끔 방출
  if (rnd() < 0.3) { const mine = teamAssistants(myTeam); if (mine.length) releaseAssistant(myTeam, mine[Math.floor(rnd() * mine.length)].id); }
  for (let k = 0; k < 3; k++) {
    if (teamAssistants(myTeam).length >= coachSlots()) break;
    const fa = availableAssistants();
    if (!fa.length) break;
    if (hireAssistant(myTeam, fa[Math.floor(rnd() * fa.length)].id)) asstHireCnt++;
  }
  // 스카우터: 가끔 영입/방출
  if (rnd() < 0.25) { const ms = teamScouts(myTeam); if (ms.length) releaseScout(myTeam, ms[0].id); }
  if (rnd() < 0.5) { const fs = availableScouts(); if (fs.length) { if (hireScout(myTeam, fs[Math.floor(rnd() * fs.length)].id)) scoutHireCnt++; } }

  checkInvariants(s, '내팀영입후', ctx.rosters);

  // ── (3) 드래프트 + 신인 → 다음 시즌 ──
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  checkInvariants(s, '드래프트후', f.rosters);

  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
    const pr = prod.get(id);
    if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
  }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

log(`\n═══ 감독·코치·선수 중복/오배정 검증 ${N}시즌 (myTeam=${getTeam(myTeam)?.name}) ═══`);
log(`내 팀 영입 스트레스: 감독 경질 ${firedCnt} · 감독 영입 ${hiredCnt} · 코치 영입 ${asstHireCnt} · 스카우터 영입 ${scoutHireCnt}`);
log(violations === 0
  ? `\n✅ 위반 0건 — 감독/코치/스카우터/선수 모두 한 사람=한 팀, 중복·오배정 없음`
  : `\n❌ 위반 ${violations}건 — 위 로그 확인`);
process.exit(violations === 0 ? 0 : 1);
