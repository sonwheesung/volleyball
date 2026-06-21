// Shared invariant battery for game-robustness testing.
// Pure checks over the live league registry + a store snapshot. Returns violations.
import { LEAGUE, currentRosters, getPlayer, evolveOnDay, getTeamCoach, currentCoachPool,
  teamAssistants, teamScouts, coachSlots, getTeam } from '../data/league';
import { rosterIdsOnDay, availableFAsOnDay, seasonTxLog } from '../data/dynamics';
import { ROSTER_MIN, ROSTER_MAX } from '../engine/transactions';
import { LEAGUE_CAP } from '../engine/cap';
import { buildLineup } from '../engine/lineup';
import { overall } from '../engine/overall';
import { domesticPayroll } from '../data/roster';
import { computeStandings } from '../data/standings';
import type { Player } from '../types';

export interface Violation { check: string; msg: string; }

const isFinitePos = (v: any, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function numbersOk(p: Player, V: Violation[], where: string) {
  const o = overall(p);
  if (!Number.isFinite(o)) V.push({ check: 'num', msg: `${where}: ${p.id} overall=${o}` });
  if (!isFinitePos(p.age, 14, 60)) V.push({ check: 'num', msg: `${where}: ${p.id} age=${p.age}` });
  if (!isFinitePos(p.contract?.salary, 1, LEAGUE_CAP)) V.push({ check: 'num', msg: `${where}: ${p.id} salary=${p.contract?.salary}` });
  if (!isFinitePos(p.contract?.remaining, 0, 12)) V.push({ check: 'num', msg: `${where}: ${p.id} remaining=${p.contract?.remaining}` });
  for (const k of ['jump','agility','staminaMax','reaction','positioning','focus','consistency','vq','skSpike','skBlock','skDig','skReceive','skSet','skServe','height'] as const) {
    const v = (p as any)[k];
    if (v !== undefined && (!Number.isFinite(v))) V.push({ check: 'num', msg: `${where}: ${p.id} ${k}=${v}` });
  }
}

/** Static roster invariants on the committed rosters (season-boundary state). */
export function checkCommittedRosters(label: string): Violation[] {
  const V: Violation[] = [];
  const rs = currentRosters();
  const owner = new Map<string, string>();
  for (const t of LEAGUE.teams) {
    const ids = rs[t.id] ?? [];
    const seen = new Set<string>();
    let foreignCnt = 0;
    for (const id of ids) {
      if (seen.has(id)) V.push({ check: 'dupInRoster', msg: `${label}: ${id} dup in ${t.id}` });
      seen.add(id);
      const prev = owner.get(id);
      if (prev && prev !== t.id) V.push({ check: 'twoTeams', msg: `${label}: ${id} on ${prev} & ${t.id}` });
      owner.set(id, t.id);
      const p = getPlayer(id);
      if (!p) { V.push({ check: 'ghostId', msg: `${label}: ${id} in ${t.id} not in registry` }); continue; }
      if (p.isForeign) foreignCnt++;
      numbersOk(p, V, label);
    }
    if (foreignCnt > 2) V.push({ check: 'foreignSlots', msg: `${label}: ${t.id} foreign=${foreignCnt}` }); // 외인1+아시아쿼터1=2 허용
    if (ids.length < ROSTER_MIN || ids.length > ROSTER_MAX) V.push({ check: 'rosterSize', msg: `${label}: ${t.id} size=${ids.length}` });
    const dom = domesticPayroll(ids, getPlayer);
    if (dom > LEAGUE_CAP * 1.1) V.push({ check: 'cap', msg: `${label}: ${t.id} domestic=${dom} > cap*1.1` });
    // buildLineup must succeed for any committed roster
    try {
      const lu = buildLineup(ids.map((id) => getPlayer(id)).filter((q): q is Player => !!q));
      if (lu.six.length !== 6) V.push({ check: 'lineup', msg: `${label}: ${t.id} six=${lu.six.length}` });
      if (lu.six.some((q) => !q)) V.push({ check: 'lineup', msg: `${label}: ${t.id} undefined slot` });
    } catch (e: any) {
      V.push({ check: 'lineup', msg: `${label}: ${t.id} buildLineup threw: ${e?.message}` });
    }
  }
  return V;
}

/** Day-aware invariants (in-season tx) — single ownership across the league on a given day. */
export function checkDayOwnership(label: string, day: number): Violation[] {
  const V: Violation[] = [];
  const owner = new Map<string, string>();
  for (const t of LEAGUE.teams) {
    const ids = rosterIdsOnDay(t.id, day);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) V.push({ check: 'dupDay', msg: `${label} d${day}: ${id} dup in ${t.id}` });
      seen.add(id);
      const prev = owner.get(id);
      if (prev && prev !== t.id) V.push({ check: 'twoTeamsDay', msg: `${label} d${day}: ${id} on ${prev} & ${t.id}` });
      owner.set(id, t.id);
    }
  }
  for (const fa of availableFAsOnDay(day)) {
    if (owner.has(fa)) V.push({ check: 'faOwned', msg: `${label} d${day}: FA ${fa} also on ${owner.get(fa)}` });
  }
  return V;
}

/** Staff invariants — single team per coach/asst, slots, AI supply. */
export function checkStaff(label: string, myTeam: string): Violation[] {
  const V: Violation[] = [];
  const headSeen = new Map<string, string>();
  for (const t of LEAGUE.teams) {
    const c = getTeamCoach(t.id);
    if (c) {
      const prev = headSeen.get(c.id);
      if (prev && prev !== t.id) V.push({ check: 'coach2team', msg: `${label}: coach ${c.id} on ${prev} & ${t.id}` });
      headSeen.set(c.id, t.id);
    }
    if (t.id !== myTeam && !c) V.push({ check: 'coachSupply', msg: `${label}: ${t.id} has no coach` });
  }
  const asstSeen = new Map<string, string>();
  for (const t of LEAGUE.teams) {
    const list = teamAssistants(t.id);
    if (list.length > coachSlots()) V.push({ check: 'slots', msg: `${label}: ${t.id} asst ${list.length}>${coachSlots()}` });
    for (const a of list) {
      const prev = asstSeen.get(a.id);
      if (prev && prev !== t.id) V.push({ check: 'asst2team', msg: `${label}: asst ${a.id} on ${prev} & ${t.id}` });
      asstSeen.set(a.id, t.id);
      if (headSeen.has(a.id)) V.push({ check: 'coachIsAsst', msg: `${label}: ${a.id} both coach & asst` });
    }
  }
  return V;
}

/** Standings sanity: played==wins+losses, set/point sums non-negative finite. */
export function checkStandings(label: string): Violation[] {
  const V: Violation[] = [];
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  for (const s of table) {
    if (s.played !== s.wins + s.losses) V.push({ check: 'standPlayed', msg: `${label}: ${s.teamId} played ${s.played}!=${s.wins}+${s.losses}` });
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number' && !Number.isFinite(v)) V.push({ check: 'standNaN', msg: `${label}: ${s.teamId} ${k}=${v}` });
    }
    if (s.wins < 0 || s.losses < 0 || s.points < 0) V.push({ check: 'standNeg', msg: `${label}: ${s.teamId} neg w/l/pts` });
  }
  return V;
}

export function checkAll(label: string, myTeam: string, day: number): Violation[] {
  return [
    ...checkCommittedRosters(label),
    ...checkDayOwnership(label, day),
    ...checkStaff(label, myTeam),
    ...checkStandings(label),
  ];
}
