// 영입 무결성 감사 엔진 (QA) — FA·드래프트·외인 트라이아웃·감독/코치/스카우터 영입을
// N시즌 굴려 "한 사람 = 한 팀" 불변식을 전수 검사한다. 라이브 세이브를 건드리지 않게
// snapshot/restore 로 격리 실행. CLI(tools/)와 인앱 QA 화면(app/audit.tsx)이 공유.
// SOLID: UI → 이 셀렉터 → 엔진. 결정론(시드 의사난수)로 재현 가능.

import {
  resetLeagueBase, snapshotLeagueState, restoreLeagueState, LEAGUE, getTeam, teamScoutReveal,
  commitPlayerBase, commitRosters, currentCoachPool, commitCoachPool, assignCoach, reconcileStaff,
  getTeamCoach, getCoach, getStaffState, availableCoaches, availableAssistants, availableScouts,
  hireHeadCoach, hireAssistant, releaseAssistant, hireScout, releaseScout, fireCoach, coachSlots,
  teamAssistants, teamScouts,
} from './league';
import { buildDraftContext } from './draftSetup';
import { faMarketPreview } from './offseason';
import { computeStandings } from './standings';
import { leagueProduction } from './production';
import { advanceCoaches } from './staffLifecycle';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from './rookies';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { bottomStreak } from '../engine/staffLifecycle';
import { overall } from '../engine/overall';

export interface AuditCheck {
  key: string;
  name: string;
  pass: boolean;
  violations: number;
  samples: string[]; // 위반 예시(최대 5)
}
export interface AuditReport {
  seasons: number;
  ok: boolean;
  checks: AuditCheck[];
  stats: { faSigned: number; coachFired: number; coachHired: number; asstHired: number; scoutHired: number };
}

const BIG_CASH = 99_999_999;
const SAMPLE_CAP = 5;

/**
 * 영입 무결성 감사를 N시즌 실행. 라이브 상태를 스냅샷→격리 실행→복원하므로 진행 중 세이브에 안전.
 * @param seasons 검사 시즌 수(클수록 철저·느림). 인앱 기본 12~20, CLI는 100+.
 */
export function runAcquisitionAudit(seasons: number): AuditReport {
  const N = Math.max(1, Math.floor(seasons));
  const snap = snapshotLeagueState();

  const C = {
    player: { key: 'player', name: '선수 전역 유일성 (한 선수 = 한 팀)', violations: 0, samples: [] as string[] },
    foreign: { key: 'foreign', name: '외국인 1팀 1명 (보상 유출 없음)', violations: 0, samples: [] as string[] },
    faLeak: { key: 'faLeak', name: '내 영입 FA 유지 (이중배정 없음)', violations: 0, samples: [] as string[] },
    head: { key: 'head', name: '감독 1인 1팀 · 경질팀 복귀 금지', violations: 0, samples: [] as string[] },
    staff: { key: 'staff', name: '코치/스카우터 1인 1팀 · 슬롯', violations: 0, samples: [] as string[] },
  };
  const hit = (c: { violations: number; samples: string[] }, msg: string) => {
    c.violations++; if (c.samples.length < SAMPLE_CAP) c.samples.push(msg);
  };
  const stats = { faSigned: 0, coachFired: 0, coachHired: 0, asstHired: 0, scoutHired: 0 };

  try {
    resetLeagueBase();
    const myTeam = LEAGUE.teams[0].id;
    const teamIds = LEAGUE.teams.map((t) => t.id);
    const tname = (id: string) => getTeam(id)?.name ?? id;

    let rngState = 2246549; // 결정론 의사난수(내 팀 영입 행동)
    const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

    const checkStaff = (sNo: number) => {
      // 감독: 전역 유일·teamId 일치·firedFrom 복귀·고아 점유
      const headByTeam: Record<string, string> = {};
      for (const t of teamIds) { const c = getTeamCoach(t); if (c) headByTeam[t] = c.id; }
      const headSeen = new Map<string, string>();
      for (const t of teamIds) {
        const id = headByTeam[t]; if (!id) continue;
        const prev = headSeen.get(id);
        if (prev && prev !== t) hit(C.head, `S${sNo}: 감독 ${id} 두 팀 지휘(${tname(prev)}·${tname(t)})`);
        headSeen.set(id, t);
        const c = getCoach(id);
        if (!c) { hit(C.head, `S${sNo}: ${tname(t)} 감독 ${id} 풀에 없음`); continue; }
        if (c.teamId !== t) hit(C.head, `S${sNo}: 감독 ${id}(${tname(t)}) teamId=${c.teamId} 불일치`);
        if ((c.firedFrom ?? []).includes(t)) hit(C.head, `S${sNo}: 경질 감독 ${id} 가 ${tname(t)}(firedFrom) 복귀`);
      }
      for (const c of currentCoachPool().coaches) {
        if (c.teamId && !c.id.startsWith('acting_') && getTeamCoach(c.teamId)?.id !== c.id)
          hit(C.head, `S${sNo}: 감독 ${c.id} teamId=${c.teamId} 인데 그 팀 감독 아님(고아 점유)`);
      }
      // 코치·스카우터: 전역 유일·슬롯·teamId·감독겸코치
      const asstSeen = new Map<string, string>();
      for (const t of teamIds) {
        const list = teamAssistants(t);
        if (list.length > coachSlots()) hit(C.staff, `S${sNo}: ${tname(t)} 코치 ${list.length}>슬롯`);
        for (const a of list) {
          const prev = asstSeen.get(a.id);
          if (prev && prev !== t) hit(C.staff, `S${sNo}: 코치 ${a.id} 두 팀(${tname(prev)}·${tname(t)})`);
          asstSeen.set(a.id, t);
          if (a.teamId !== t) hit(C.staff, `S${sNo}: 코치 ${a.id}(${tname(t)}) teamId=${a.teamId} 불일치`);
          if (headSeen.has(a.id)) hit(C.staff, `S${sNo}: ${a.id} 감독겸코치`);
        }
      }
      const scoutSeen = new Map<string, string>();
      for (const t of teamIds) for (const sc of teamScouts(t)) {
        const prev = scoutSeen.get(sc.id);
        if (prev && prev !== t) hit(C.staff, `S${sNo}: 스카우터 ${sc.id} 두 팀(${tname(prev)}·${tname(t)})`);
        scoutSeen.set(sc.id, t);
      }
    };

    const checkRosters = (sNo: number, where: string, rosters: Record<string, string[]>, snapshot: Record<string, import('../types').Player>, retired: string[], signedByMe: string[]) => {
      const ownBy = new Map<string, string>();
      for (const t of teamIds) {
        const seen = new Set<string>();
        let foreignCnt = 0;
        for (const id of rosters[t] ?? []) {
          if (seen.has(id)) hit(C.player, `S${sNo} ${where}: 선수 ${id} ${tname(t)} 로스터 중복`);
          seen.add(id);
          const prev = ownBy.get(id);
          if (prev && prev !== t) hit(C.player, `S${sNo} ${where}: 선수 ${id} 두 팀(${tname(prev)}·${tname(t)})`);
          ownBy.set(id, t);
          if (snapshot[id]?.isForeign) foreignCnt++;
        }
        if (foreignCnt > 1) hit(C.foreign, `S${sNo} ${where}: ${tname(t)} 외인 ${foreignCnt}명`);
      }
      for (const rid of retired) if (ownBy.has(rid)) hit(C.player, `S${sNo} ${where}: 은퇴자 ${rid} 가 ${tname(ownBy.get(rid)!)} 로스터에`);
      // 내 영입 FA가 내 팀에 유지되는가(보상으로 유출되면 위반)
      const mine = new Set(rosters[myTeam] ?? []);
      for (const id of signedByMe) if (!mine.has(id)) {
        let where2 = '리그이탈';
        for (const t of teamIds) if ((rosters[t] ?? []).includes(id)) { where2 = tname(t); break; }
        hit(C.faLeak, `S${sNo} ${where}: 영입 FA ${id} 가 내 팀에 없음 → ${where2}`);
      }
    };

    const recentRankOrders: string[][] = [];
    for (let s = 1; s <= N; s++) {
      // FA 영입 대상 선정(상위 4명 공격적) + 실제 결과
      const peek = faMarketPreview(myTeam, {}, {}, [], true, [], s, undefined, BIG_CASH);
      const wishlist = [...peek.pool]
        .map((id) => peek.snapshot[id]).filter((p): p is NonNullable<typeof p> => !!p)
        .sort((a, b) => overall(b) - overall(a)).slice(0, 4).map((p) => p.id);
      const outcome = faMarketPreview(myTeam, {}, {}, wishlist, true, [], s, undefined, BIG_CASH);
      const signedByMe = [...outcome.signedByMe];
      stats.faSigned += signedByMe.length;

      // 감독 생애주기(AI)
      const table = computeStandings(Number.MAX_SAFE_INTEGER);
      const rankOrder = table.map((r) => r.teamId);
      recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
      const bottomYears: Record<string, number> = {};
      for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);
      const assignedHead: Record<string, string> = {};
      for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }

      const ctx = buildDraftContext(myTeam, {}, {}, wishlist, true, [], s, undefined, BIG_CASH);
      const snapshot = ctx.snapshot;
      const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
      const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
      const res = advanceCoaches(s, currentCoachPool(), assignedHead, retiredPlayers, new Set(), rankOrder, bottomYears, myTeam);
      commitCoachPool(res.coaches, res.assistants);
      for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
      reconcileStaff();
      checkStaff(s);
      checkRosters(s, '생애주기후', ctx.rosters, snapshot, ctx.retired, signedByMe);

      // 내 팀 능동 영입(감독·코치·스카우터)
      if (rnd() < 0.35) { const cur = getTeamCoach(myTeam); if (cur && !cur.id.startsWith('acting_')) { fireCoach(myTeam); stats.coachFired++; } }
      if (rnd() < 0.7) { const free = availableCoaches(myTeam); if (free.length && hireHeadCoach(myTeam, free[Math.floor(rnd() * free.length)].id)) stats.coachHired++; }
      if (rnd() < 0.3) { const m = teamAssistants(myTeam); if (m.length) releaseAssistant(myTeam, m[Math.floor(rnd() * m.length)].id); }
      for (let k = 0; k < 3; k++) {
        if (teamAssistants(myTeam).length >= coachSlots()) break;
        const fa = availableAssistants(); if (!fa.length) break;
        if (hireAssistant(myTeam, fa[Math.floor(rnd() * fa.length)].id)) stats.asstHired++;
      }
      if (rnd() < 0.25) { const ms = teamScouts(myTeam); if (ms.length) releaseScout(myTeam, ms[0].id); }
      if (rnd() < 0.5) { const fs = availableScouts(); if (fs.length && hireScout(myTeam, fs[Math.floor(rnd() * fs.length)].id)) stats.scoutHired++; }
      checkStaff(s);

      // 드래프트 + 신인 → 다음 시즌
      const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
      const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
      for (const p of d.picked) snapshot[p.id] = p;
      const f = fillRosters(d.rosters, (id) => snapshot[id], s);
      for (const p of f.newPlayers) snapshot[p.id] = p;
      checkRosters(s, '드래프트후', f.rosters, snapshot, ctx.retired, signedByMe);

      for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
        const pr = prod.get(id);
        if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
      }
      commitPlayerBase(snapshot); commitRosters(f.rosters);
    }

    const checks: AuditCheck[] = Object.values(C).map((c) => ({
      key: c.key, name: c.name, pass: c.violations === 0, violations: c.violations, samples: c.samples,
    }));
    return { seasons: N, ok: checks.every((c) => c.pass), checks, stats };
  } finally {
    restoreLeagueState(snap); // 라이브 세이브 복원 — 감사가 진행 중 게임을 오염시키지 않음
  }
}
