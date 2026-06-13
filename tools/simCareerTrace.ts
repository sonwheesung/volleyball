// 개별 이력 추적 — 감독·코치·선수 한 명씩 "언제 어디로 이적/FA, 연봉 얼마"를 타임라인으로.
//   npx tsx tools/simCareerTrace.ts [시즌=16] [선수표시=12]
// 매 시즌 시작 상태(소속·연봉·잔여계약)를 기록하고, 연속 시즌을 비교해 이적/FA/입단/은퇴 이벤트를 만든다.
// 영입 감사와 동일한 진행(FA·드래프트·외인·감독 생애주기 + 내 팀 능동 영입)을 굴린다.

import {
  resetLeagueBase, setMyTeamStaff, LEAGUE, getTeam, getPlayer, getCoach, teamScoutReveal, currentRosters,
  commitPlayerBase, commitRosters, currentCoachPool, commitCoachPool, assignCoach, reconcileStaff,
  getTeamCoach, getStaffState, availableCoaches, availableAssistants, hireHeadCoach, hireAssistant,
  releaseAssistant, fireCoach, coachSlots, teamAssistants,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { faMarketPreview } from '../data/offseason';
import { computeStandings } from '../data/standings';
import { leagueProduction } from '../data/production';
import { advanceCoaches } from '../data/staffLifecycle';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { bottomStreak } from '../engine/staffLifecycle';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(2, Number(process.argv[2]) || 16);
const SHOW_PLAYERS = Math.max(1, Number(process.argv[3]) || 12);
resetLeagueBase();

const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);
const teamIds = LEAGUE.teams.map((t) => t.id);
const tname = (id: string) => getTeam(id)?.name ?? id;
const money = (v: number) => `${(v / 10000).toFixed(2)}억`; // 만원 → 억

// 기록: id → 시즌별 상태
interface PSnap { team: string; salary: number; rem: number }
const pHist = new Map<string, Map<number, PSnap>>(); // 선수
const pMeta = new Map<string, { name: string; pos: string; foreign: boolean }>();
interface CSnap { team: string; salary: number }
const cHist = new Map<string, Map<number, CSnap>>(); // 감독
const cMeta = new Map<string, { name: string }>();
const aHist = new Map<string, Map<number, CSnap>>(); // 보조코치
const aMeta = new Map<string, { name: string }>();
const retiredAt = new Map<string, number>(); // 선수 은퇴 시즌

let rngState = 99887766;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

function capture(s: number) {
  const rs = currentRosters();
  for (const t of teamIds) {
    for (const id of rs[t] ?? []) {
      const p = getPlayer(id); if (!p) continue;
      if (!pHist.has(id)) pHist.set(id, new Map());
      pHist.get(id)!.set(s, { team: t, salary: p.contract.salary, rem: p.contract.remaining });
      if (!pMeta.has(id)) pMeta.set(id, { name: p.name, pos: p.position, foreign: !!p.isForeign });
    }
    const head = getTeamCoach(t);
    if (head) {
      if (!cHist.has(head.id)) cHist.set(head.id, new Map());
      cHist.get(head.id)!.set(s, { team: t, salary: head.salary });
      if (!cMeta.has(head.id)) cMeta.set(head.id, { name: head.name });
    }
    for (const a of teamAssistants(t)) {
      if (!aHist.has(a.id)) aHist.set(a.id, new Map());
      aHist.get(a.id)!.set(s, { team: t, salary: a.salary });
      if (!aMeta.has(a.id)) aMeta.set(a.id, { name: a.name });
    }
  }
}

const recentRankOrders: string[][] = [];
for (let s = 1; s <= N; s++) {
  capture(s);

  // FA 영입(상위 4명) — 내 팀
  const peek = faMarketPreview(myTeam, {}, {}, [], true, [], s, undefined, 9_999_999);
  const wishlist = [...peek.pool].map((id) => peek.snapshot[id]).filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => overall(b) - overall(a)).slice(0, 4).map((p) => p.id);

  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
  const bottomYears: Record<string, number> = {};
  for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);
  const assignedHead: Record<string, string> = {};
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }

  const ctx = buildDraftContext(myTeam, {}, {}, wishlist, true, [], s, undefined, 9_999_999);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const rid of ctx.retired) if (!retiredAt.has(rid)) retiredAt.set(rid, s);
  const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
  const res = advanceCoaches(s, currentCoachPool(), assignedHead, retiredPlayers, new Set(), rankOrder, bottomYears, myTeam);
  commitCoachPool(res.coaches, res.assistants);
  for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
  reconcileStaff();

  // 내 팀 능동 영입(감독·코치) — 이적 이벤트 생성
  if (rnd() < 0.3) { const cur = getTeamCoach(myTeam); if (cur && !cur.id.startsWith('acting_')) fireCoach(myTeam); }
  if (rnd() < 0.6) { const free = availableCoaches(myTeam); if (free.length) hireHeadCoach(myTeam, free[Math.floor(rnd() * free.length)].id); }
  for (let k = 0; k < 2; k++) { if (teamAssistants(myTeam).length >= coachSlots()) break; const fa = availableAssistants(); if (!fa.length) break; hireAssistant(myTeam, fa[Math.floor(rnd() * fa.length)].id); }
  if (rnd() < 0.25) { const m = teamAssistants(myTeam); if (m.length) releaseAssistant(myTeam, m[0].id); }

  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}
capture(N + 1); // 마지막 상태(이적 마무리 관찰용)

// ── 타임라인 렌더 ──
const seasonsOf = (h: Map<number, { team: string; salary: number }>) => [...h.keys()].sort((a, b) => a - b);

function renderEntity(name: string, hist: Map<number, { team: string; salary: number }>, opts: { retire?: number; rem?: Map<number, number> } = {}): string[] {
  const ss = seasonsOf(hist);
  const lines: string[] = [];
  let prevTeam = '', prevSalary = -1, lastSeen = -1;
  for (const s of ss) {
    const cur = hist.get(s)!;
    if (cur.team !== prevTeam) {
      if (prevTeam === '') lines.push(`   S${s} ${tname(cur.team)} 입단 · ${money(cur.salary)}`);
      else {
        if (lastSeen >= 0 && s - lastSeen > 1) lines.push(`   S${lastSeen + 1} → FA (미소속)`);
        lines.push(`   S${s} → ${tname(cur.team)} 이적 · ${money(cur.salary)}`);
      }
    } else if (cur.salary !== prevSalary) {
      lines.push(`   S${s} 연봉 ${money(prevSalary)}→${money(cur.salary)}`);
    }
    prevTeam = cur.team; prevSalary = cur.salary; lastSeen = s;
  }
  if (opts.retire) lines.push(`   S${opts.retire} 은퇴`);
  else if (lastSeen >= 0 && lastSeen <= N && hist.size && !hist.has(N + 1)) lines.push(`   S${lastSeen + 1} → FA/이탈(명단에서 사라짐)`);
  return [`${name}`, ...lines];
}

log(`═══ 개별 이력 추적 ${N}시즌 (내 팀=${tname(myTeam)}) ═══`);

// 감독 전원
log(`\n■ 감독 (역대 ${cHist.size}명)`);
for (const [id, hist] of [...cHist.entries()].sort((a, b) => seasonsOf(a[1])[0] - seasonsOf(b[1])[0])) {
  for (const l of renderEntity(`▷ ${cMeta.get(id)!.name} [${id}]`, hist)) log(l);
}

// 보조코치 — 이적/방출 이벤트 있던 사람만(전원은 너무 많음)
const movedAsst = [...aHist.entries()].filter(([, h]) => new Set([...h.values()].map((v) => v.team)).size > 1 || !h.has(N + 1));
log(`\n■ 전문 코치 (이적/방출 이력자 ${movedAsst.length}명)`);
for (const [id, hist] of movedAsst.slice(0, 10)) for (const l of renderEntity(`▷ ${aMeta.get(id)!.name} [${id}]`, hist)) log(l);

// 선수 — 내 팀 S1 로스터 + 이적 많은 선수
const s1my = [...(pHist.entries())].filter(([, h]) => h.get(1)?.team === myTeam).map(([id]) => id);
const transfers = (id: string) => { const h = pHist.get(id)!; const ts = [...h.values()].map((v) => v.team); return new Set(ts).size; };
const sample = [...new Set([...s1my, ...[...pHist.keys()].sort((a, b) => transfers(b) - transfers(a))])].slice(0, SHOW_PLAYERS);
log(`\n■ 선수 타임라인 (내 팀 출발 + 다이내믹한 이력 ${sample.length}명)`);
for (const id of sample) {
  const meta = pMeta.get(id)!; const hist = pHist.get(id)!;
  for (const l of renderEntity(`▷ ${meta.name} (${meta.pos}) [${id}]`, hist, { retire: retiredAt.get(id) })) log(l);
}

// 외인 잔류(재계약 연속성) 점검 — 잘하는 용병은 여러 시즌 잔류해야(설계: 3~5시즌 ~63%)
const foreignIds = [...pMeta.entries()].filter(([, m]) => m.foreign).map(([id]) => id);
const tenureOf = (id: string) => { // 같은 팀 최장 연속 시즌
  const h = pHist.get(id)!; const ss = [...h.keys()].sort((a, b) => a - b);
  let best = 1, run = 1;
  for (let i = 1; i < ss.length; i++) { const cont = ss[i] === ss[i - 1] + 1 && h.get(ss[i])!.team === h.get(ss[i - 1])!.team; run = cont ? run + 1 : 1; best = Math.max(best, run); }
  return best;
};
const tenures = foreignIds.map(tenureOf);
const dist: Record<number, number> = {};
for (const t of tenures) dist[t] = (dist[t] ?? 0) + 1;
log(`\n■ 외인 재계약 연속성 (역대 외인 ${foreignIds.length}명)`);
log(`   최장 잔류 분포(시즌→인원): ${Object.entries(dist).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}→${v}`).join(' · ')}`);
log(`   평균 최장 잔류 ${(tenures.reduce((a, b) => a + b, 0) / Math.max(1, tenures.length)).toFixed(2)}시즌 · 최대 ${Math.max(1, ...tenures)}시즌`);
log(`   ${Math.max(1, ...tenures) >= 2 ? '✅ 다년 잔류 외인 존재(재계약 작동)' : '❌ 모든 외인이 1시즌만 — 재계약 미작동 의심'}`);

// 좀비 검증 — 은퇴한 선수가 이후 시즌 명단에 재등장하면 안 됨(교차 시즌 불변식)
let zombies = 0;
for (const [id, rs] of retiredAt) {
  const h = pHist.get(id); if (!h) continue;
  const after = [...h.keys()].filter((s) => s > rs);
  if (after.length) { zombies++; if (zombies <= 10) log(`   ❌ 좀비: ${pMeta.get(id)?.name ?? id} 은퇴 S${rs} 후 S${after.join(',')} 명단 재등장`); }
}
log(`\n■ 은퇴 후 재등장(좀비) 검증: ${zombies === 0 ? '✅ 없음' : `❌ ${zombies}건`}`);

// 요약
let totTransfer = 0, totFA = 0;
for (const [id, h] of pHist) { const ts = [...h.values()].map((v) => v.team); totTransfer += new Set(ts).size - 1; if (!h.has(N + 1) && !retiredAt.has(id)) totFA++; }
log(`\n요약: 선수 이적 총 ${totTransfer}건 · 은퇴 ${retiredAt.size}명 · 감독 역대 ${cHist.size}명`);
