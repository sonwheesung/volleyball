// 영입 무결성 감사 엔진 (QA) — FA·드래프트·외인 트라이아웃·감독/코치/스카우터 영입을
// N시즌 굴려 "한 사람 = 한 팀" 불변식을 전수 검사한다. 라이브 세이브를 건드리지 않게
// snapshot/restore 로 격리 실행. CLI(tools/)와 인앱 QA 화면(app/audit.tsx)이 공유.
// SOLID: UI → 이 셀렉터 → 엔진. 결정론(시드 의사난수)로 재현 가능.

import {
  resetLeagueBase, snapshotLeagueState, restoreLeagueState, LEAGUE, SEASON, getTeam, teamScoutReveal,
  commitPlayerBase, commitRosters, currentRosters, getPlayer, currentCoachPool, commitCoachPool, assignCoach, reconcileStaff,
  getTeamCoach, getCoach, getStaffState, availableCoaches, availableAssistants, availableScouts,
  hireHeadCoach, hireAssistant, releaseAssistant, hireScout, releaseScout, fireCoach, coachSlots,
  teamAssistants, teamScouts,
} from './league';
import { setTxContext, rosterIdsOnDay, availableFAsOnDay, type Tx } from './dynamics';
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
import { LEAGUE_CAP } from '../engine/cap';
import { ROSTER_MIN, ROSTER_MAX } from '../engine/transactions';
import { domesticPayroll } from './roster';

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
    roster: { key: 'roster', name: `정원 한도 (${ROSTER_MIN}~${ROSTER_MAX}명)`, violations: 0, samples: [] as string[] },
    cap: { key: 'cap', name: `샐러리캡 (국내 연봉 ≤ ${LEAGUE_CAP})`, violations: 0, samples: [] as string[] },
    salary: { key: 'salary', name: '연봉·계약 정상치 (NaN·음수·0 없음)', violations: 0, samples: [] as string[] },
    supply: { key: 'supply', name: 'AI 팀 감독 공백 없음 (공급 고갈)', violations: 0, samples: [] as string[] },
    newid: { key: 'newid', name: '신규 id 충돌 없음 (신인·외인 ↔ 기존)', violations: 0, samples: [] as string[] },
    intx: { key: 'intx', name: '시즌 중 거래 단일 소속 (이중영입 차단)', violations: 0, samples: [] as string[] },
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
      // 감독·코치 연봉/계약 정상치 — 음수·NaN·비정상 연봉(예전 사용자 우려) + 계약연수 음수
      const okNum = (v: number | undefined, lo: number, hi: number) => v === undefined || (Number.isFinite(v) && v >= lo && v <= hi);
      for (const c of currentCoachPool().coaches) {
        if (!okNum(c.salary, 0, 99999)) hit(C.salary, `S${sNo}: 감독 ${c.id} 연봉 비정상 ${c.salary}`);
        if (!okNum(c.contractYears, 0, 10)) hit(C.salary, `S${sNo}: 감독 ${c.id} 계약연수 비정상 ${c.contractYears}`);
        if (c.teamId === null && c.contractYears !== undefined) hit(C.salary, `S${sNo}: FA 감독 ${c.id} 인데 계약연수 ${c.contractYears} 남음`);
      }
      for (const a of currentCoachPool().assistants) {
        if (!okNum(a.salary, 0, 99999)) hit(C.salary, `S${sNo}: 코치 ${a.id} 연봉 비정상 ${a.salary}`);
        if (!okNum(a.contractYears, 0, 10)) hit(C.salary, `S${sNo}: 코치 ${a.id} 계약연수 비정상 ${a.contractYears}`);
      }
      // AI 팀(내 팀 제외 — 내 팀은 경질 후 공석 가능)은 항상 감독을 가져야 한다(공급 고갈 탐지)
      for (const t of teamIds) if (t !== myTeam && !getTeamCoach(t)) hit(C.supply, `S${sNo}: ${tname(t)} 감독 공백(공급 고갈)`);
    };

    const okNum = (v: number | undefined, lo: number, hi: number) => v !== undefined && Number.isFinite(v) && v >= lo && v <= hi;
    const checkRosters = (sNo: number, where: string, rosters: Record<string, string[]>, snapshot: Record<string, import('../types').Player>, retired: string[], signedByMe: string[], final: boolean) => {
      const ownBy = new Map<string, string>();
      for (const t of teamIds) {
        const seen = new Set<string>();
        let foreignCnt = 0;
        const ids = rosters[t] ?? [];
        for (const id of ids) {
          if (seen.has(id)) hit(C.player, `S${sNo} ${where}: 선수 ${id} ${tname(t)} 로스터 중복`);
          seen.add(id);
          const prev = ownBy.get(id);
          if (prev && prev !== t) hit(C.player, `S${sNo} ${where}: 선수 ${id} 두 팀(${tname(prev)}·${tname(t)})`);
          ownBy.set(id, t);
          const p = snapshot[id];
          if (p?.isForeign) foreignCnt++;
          // 연봉·계약 정상치
          if (p) {
            if (!okNum(p.contract?.salary, 1, LEAGUE_CAP)) hit(C.salary, `S${sNo} ${where}: ${tname(t)} ${id} 연봉 비정상 ${p.contract?.salary}`);
            if (!okNum(p.contract?.remaining, 0, 10)) hit(C.salary, `S${sNo} ${where}: ${tname(t)} ${id} 잔여계약 비정상 ${p.contract?.remaining}`);
          }
        }
        if (foreignCnt > 1) hit(C.foreign, `S${sNo} ${where}: ${tname(t)} 외인 ${foreignCnt}명`);
        // 샐러리캡(국내 연봉) — 영입/재계약이 캡을 넘기면 안 됨. 단 드래프트는 의무적 신인 수급(저가 슬롯)이라
        //   캡 직전 팀도 정원을 채우려면 신인을 받아야 한다 → 신인 루키 예외(현실 캡과 동일). 따라서 캡 불변식은
        //   FA·재계약 직후(드래프트 전) 단계에서만 강제. 드래프트 후엔 명백한 과다(>110%)만 잡는다.
        const dom = domesticPayroll(ids, (id) => snapshot[id]);
        const capLimit = final ? LEAGUE_CAP * 1.1 : LEAGUE_CAP;
        if (dom > capLimit) hit(C.cap, `S${sNo} ${where}: ${tname(t)} 국내연봉 ${dom} > ${final ? '캡×1.1(신인수급 예외 후)' : '캡'} ${Math.round(capLimit)}`);
        // 정원 한도 — 최종(드래프트 후) 명단만 하한 검사(중간 단계는 구멍이 정상)
        if (final && (ids.length < ROSTER_MIN || ids.length > ROSTER_MAX)) hit(C.roster, `S${sNo} ${where}: ${tname(t)} 정원 ${ids.length} (허용 ${ROSTER_MIN}~${ROSTER_MAX})`);
        else if (!final && ids.length > ROSTER_MAX) hit(C.roster, `S${sNo} ${where}: ${tname(t)} 정원 ${ids.length} > ${ROSTER_MAX}`);
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
      checkRosters(s, '생애주기후', ctx.rosters, snapshot, ctx.retired, signedByMe, false);

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
      const preDraftIds = new Set<string>(Object.values(ctx.rosters).flat()); // 드래프트 전 모든 소속 선수
      const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
      const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
      // 신인/외인 신규 id가 기존 소속 선수 id와 충돌하면 레지스트리를 덮어써 선수가 증발한다
      const draftedSeen = new Set<string>();
      for (const p of d.picked) {
        if (preDraftIds.has(p.id)) hit(C.newid, `S${s}: 신인 ${p.id} 가 기존 소속 선수와 id 충돌`);
        if (draftedSeen.has(p.id)) hit(C.newid, `S${s}: 신인 ${p.id} 가 같은 드래프트에서 중복 지명`);
        draftedSeen.add(p.id);
        snapshot[p.id] = p;
      }
      const f = fillRosters(d.rosters, (id) => snapshot[id], s);
      for (const p of f.newPlayers) {
        if (preDraftIds.has(p.id) || draftedSeen.has(p.id)) hit(C.newid, `S${s}: 충원 신인 ${p.id} 가 기존/지명 선수와 id 충돌`);
        draftedSeen.add(p.id);
        snapshot[p.id] = p;
      }
      checkRosters(s, '드래프트후', f.rosters, snapshot, ctx.retired, signedByMe, true);

      for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
        const pr = prod.get(id);
        if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
      }
      commitPlayerBase(snapshot); commitRosters(f.rosters);
    }

    // ── 시즌 중 거래(in-season) 단일 소속 검사 — 깨끗한 시즌에 방출/적대적 이중영입 churn 주입 ──
    {
      resetLeagueBase();
      const rs = currentRosters();
      const mday = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
      let fId = '', fTeam = '';
      for (const t of teamIds) { const fp = (rs[t] ?? []).find((id) => getPlayer(id)?.isForeign); if (fp) { fId = fp; fTeam = t; break; } }
      const txs: Tx[] = [];
      for (const ti of [1, 2, 3]) {
        const t = teamIds[ti];
        for (const id of (rs[t] ?? []).filter((id) => !getPlayer(id)?.isForeign).slice(0, 2)) txs.push({ day: 4, teamId: t, playerId: id, kind: 'release' });
      }
      if (fId) txs.push({ day: 4, teamId: fTeam, playerId: fId, kind: 'release' }); // 외인 방출 → 리그 이탈해야(재등장 금지)
      // 적대적 이중영입: 방출 선수를 두 팀이 다른 날 영입 시도 → 먼저 잡은 팀만 유효해야
      const dbl = (rs[teamIds[2]] ?? []).filter((id) => !getPlayer(id)?.isForeign)[0];
      if (dbl) { txs.push({ day: 8, teamId: myTeam, playerId: dbl, kind: 'sign' }); txs.push({ day: 12, teamId: teamIds[4], playerId: dbl, kind: 'sign' }); }
      setTxContext(txs, [], myTeam);
      const relForeign = fId;
      const relDom = new Map<string, number>();
      for (const tx of txs) if (tx.kind === 'release') relDom.set(tx.playerId, tx.day);
      for (const d of mday) {
        const owner = new Map<string, string>();
        for (const t of teamIds) for (const id of rosterIdsOnDay(t, d)) {
          const prev = owner.get(id);
          if (prev && prev !== t) hit(C.intx, `day${d}: 선수 ${id} 두 팀 동시 소속(${tname(prev)}·${tname(t)})`);
          owner.set(id, t);
        }
        for (const fa of availableFAsOnDay(d)) if (owner.has(fa)) hit(C.intx, `day${d}: FA ${fa} 가 ${tname(owner.get(fa)!)} 소속인데 FA 풀에도`);
        if (relForeign && d > 4 && owner.has(relForeign)) hit(C.intx, `day${d}: 방출 외인 ${relForeign} 재등장(리그 이탈 위반)`);
      }
      setTxContext([], [], myTeam); // 컨텍스트 정리
    }

    const checks: AuditCheck[] = Object.values(C).map((c) => ({
      key: c.key, name: c.name, pass: c.violations === 0, violations: c.violations, samples: c.samples,
    }));
    return { seasons: N, ok: checks.every((c) => c.pass), checks, stats };
  } finally {
    restoreLeagueState(snap); // 라이브 세이브 복원 — 감사가 진행 중 게임을 오염시키지 않음
  }
}
