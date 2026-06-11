// 시즌 다이내믹스 (TRANSACTION_SYSTEM 핵심). 부상 + 시즌 중 이동을 하나의 결정론 forward-pass로.
// 매치데이 순서로: (a) 플레이어 거래 적용 (b) 레그 경계 AI 영입 (c) 그날 라인업으로 부상 판정.
// 경기 결과 무의존 → simMatch와 무순환. 과거 경기는 그때 명단으로 고정(리플레이 안전).

import type { Player, Position } from '../types';
import { createRng, strSeed } from '../engine/rng';
import { injuryRisk, rollSeverity, CONCURRENT_CAP, type Severity } from '../engine/injury';
import { buildLineup } from '../engine/lineup';
import { healthyByPos, shortagePositions, pickSigning } from '../engine/transactions';
import { formFactor, applyForm, FORM_WINDOW } from '../engine/form';
import type { BenchDirective } from '../engine/owner';
import { marketValue } from '../engine/salary';
import { LEAGUE_CAP } from '../engine/cap';
import { baseVersion, currentRosters, getPlayer, evolveOnDay, LEAGUE, SEASON } from './league';

const GAME_INTERVAL = 4;
const LEGS = 6;

export type TxKind = 'sign' | 'release';
export interface Tx { day: number; teamId: string; playerId: string; kind: TxKind }
export interface InjurySpan {
  playerId: string; teamId: string; from: number; to: number; severity: Severity; missMatches: number;
}

// ── 거래 컨텍스트(스토어가 주입; sim은 비움) ──
let playerTx: Tx[] = [];
let faPoolSeed: string[] = [];   // 오프시즌 미계약 FA(시즌 시작 풀)
let myTeamId = '';               // 플레이어 팀(AI 자동영입 제외)
let txVersion = 0;
export function setTxContext(tx: Tx[], faPool: string[], myTeam: string): void {
  playerTx = [...tx]; faPoolSeed = [...faPool]; myTeamId = myTeam; txVersion++;
}
export function getTxContext(): { playerTx: Tx[]; faPoolSeed: string[]; myTeamId: string } {
  return { playerTx: [...playerTx], faPoolSeed: [...faPoolSeed], myTeamId };
}
/** 거래 컨텍스트 버전 — standings/production 등 tx 인지 파생 캐시의 키 성분 */
export const currentTxVersion = (): number => txVersion;

// ── 구단주 컨텍스트(OWNER_SYSTEM) — 벤치 지시. 부상과 같은 "그날 출전 후보" 필터 ──
let benchDirectives: BenchDirective[] = [];
export function setOwnerContext(bench: BenchDirective[]): void {
  benchDirectives = [...bench]; txVersion++; // 파생 캐시(순위·생산·dyn) 일괄 무효화
}
const benchedOn = (day: number): Set<string> =>
  new Set(benchDirectives.filter((b) => b.fromDay <= day).map((b) => b.playerId));

interface Dyn {
  injuries: InjurySpan[]; txLog: Tx[];
  played: Map<string, number[]>;      // playerId → 출전 매치데이(오름차순) — 경기감각 재료
  teamDays: Map<string, number[]>;    // teamId → 치른 매치데이(오름차순)
}
let cache: { key: string; dyn: Dyn } | null = null;

/** 레그(라운드 묶음) 경계 = 각 레그 첫 매치데이 */
function legBoundaryDays(): Set<number> {
  const rounds = [...new Set(SEASON.map((f) => f.round))].sort((a, b) => a - b);
  const rpl = Math.max(1, Math.round(rounds.length / LEGS));
  const firstDayOfLeg = new Map<number, number>();
  for (const f of SEASON) {
    const leg = Math.min(LEGS - 1, Math.floor(f.round / rpl));
    const cur = firstDayOfLeg.get(leg);
    if (cur === undefined || f.dayIndex < cur) firstDayOfLeg.set(leg, f.dayIndex);
  }
  return new Set(firstDayOfLeg.values());
}

function compute(): Dyn {
  const byDay = new Map<number, typeof SEASON>();
  for (const f of SEASON) { const a = byDay.get(f.dayIndex) ?? []; a.push(f); byDay.set(f.dayIndex, a); }
  const matchdays = [...byDay.keys()].sort((a, b) => a - b);
  const legDays = legBoundaryDays();

  // 가변 상태
  const roster = new Map<string, string[]>();
  for (const t of LEAGUE.teams) roster.set(t.id, [...(currentRosters()[t.id] ?? [])]);
  const faAvail = new Set<string>(faPoolSeed);
  const injuries: InjurySpan[] = [];
  const txLog: Tx[] = [];
  const played = new Map<string, number[]>();   // 경기감각 재료 — 누가 어느 매치데이에 뛰었나
  const teamDays = new Map<string, number[]>();
  // 그날까지의 출전 이력 → 감각 계수(시간 순 진행이라 순환 없음 — 오늘의 감각은 어제까지의 출전)
  const formOf = (teamId: string, playerId: string, d: number): number => {
    const days = (teamDays.get(teamId) ?? []).slice(-FORM_WINDOW);
    if (!days.length) return 1;
    const pl = played.get(playerId);
    const cnt = pl ? days.filter((x) => pl.includes(x)).length : 0;
    return formFactor(cnt, days.length);
  };
  const pendingPlayerTx = [...playerTx].sort((a, b) => a.day - b.day);
  let pi = 0;

  const injuredOn = (d: number, teamId: string) =>
    new Set(injuries.filter((s) => s.teamId === teamId && s.from <= d && d <= s.to).map((s) => s.playerId));
  const activeInjCount = (d: number, teamId: string) =>
    injuries.reduce((n, s) => n + (s.teamId === teamId && s.from <= d && d <= s.to ? 1 : 0), 0);
  const payrollOf = (teamId: string) =>
    (roster.get(teamId) ?? []).reduce((s, id) => s + (getPlayer(id)?.contract.salary ?? 0), 0);

  const applyTx = (tx: Tx) => {
    const arr = roster.get(tx.teamId) ?? [];
    if (tx.kind === 'release') { roster.set(tx.teamId, arr.filter((id) => id !== tx.playerId)); faAvail.add(tx.playerId); }
    else { if (!arr.includes(tx.playerId)) roster.set(tx.teamId, [...arr, tx.playerId]); faAvail.delete(tx.playerId); }
    txLog.push(tx);
  };

  // AI 영입: 구멍 포지션을 FA로 (캡·정원·해당 포지션 한정)
  const aiSign = (teamId: string, d: number) => {
    const injured = injuredOn(d, teamId);
    let ids = (roster.get(teamId) ?? []).filter((id) => !injured.has(id));
    let healthy = healthyByPos(ids.map((id) => evolveOnDay(id, d)).filter((p): p is Player => !!p));
    // 현재 부상 중인 FA는 영입 대상 제외 — 구멍을 메우려는 영입인데 출전 불가면 무의미
    const injAll = new Set(injuries.filter((s) => s.from <= d && d <= s.to).map((s) => s.playerId));
    for (const pos of shortagePositions(healthy)) {
      const pool = [...faAvail].filter((id) => !injAll.has(id)).map((id) => evolveOnDay(id, d)).filter((p): p is Player => !!p);
      const pick = pickSigning(pos, pool, (roster.get(teamId) ?? []).length, payrollOf(teamId), (p) => marketValue(p), LEAGUE_CAP);
      if (!pick) continue;
      applyTx({ day: d, teamId, playerId: pick.id, kind: 'sign' });
      ids = (roster.get(teamId) ?? []).filter((id) => !injured.has(id));
      healthy = healthyByPos(ids.map((id) => evolveOnDay(id, d)).filter((p): p is Player => !!p));
    }
  };

  for (const d of matchdays) {
    while (pi < pendingPlayerTx.length && pendingPlayerTx[pi].day <= d) applyTx(pendingPlayerTx[pi++]);
    if (legDays.has(d)) for (const t of LEAGUE.teams) if (t.id !== myTeamId) aiSign(t.id, d);

    for (const f of byDay.get(d)!) {
      for (const teamId of [f.homeTeamId, f.awayTeamId]) {
        const injured = injuredOn(d, teamId);
        let availIds = (roster.get(teamId) ?? []).filter((id) => !injured.has(id));
        // 벤치 지시(구단주→감독) — 단, 출전 7인 미만이 되면 그 경기 한정 무시(부상 우선, 경기 성립)
        const benched = benchedOn(d);
        if (benched.size) {
          const wo = availIds.filter((id) => !benched.has(id));
          if (wo.length >= 7) availIds = wo;
        }
        const avail = availIds
          .map((id) => evolveOnDay(id, d)).filter((p): p is Player => !!p)
          .map((p) => applyForm(p, formOf(teamId, p.id, d))); // 경기감각 — 결장 누적자는 무뎌진 채 평가
        if (!avail.length) continue; // 빈 명단(가드 우회 주입 등 비정상) — 부상 굴림 생략, 전진 패스는 계속
        const lu = buildLineup(avail);
        const onCourt = lu.libero ? [...lu.six, lu.libero] : lu.six;
        teamDays.set(teamId, [...(teamDays.get(teamId) ?? []), d]);
        for (const p of onCourt) played.set(p.id, [...(played.get(p.id) ?? []), d]);
        let concurrent = injured.size;
        for (const p of onCourt) {
          if (concurrent >= CONCURRENT_CAP) break;
          const rng = createRng(strSeed(`injury:${p.id}:${p.age}:${d}`));
          if (rng.next() < injuryRisk(p.age, p.staminaMax, p.traits)) {
            const inj = rollSeverity(rng);
            const from = d + GAME_INTERVAL;
            const to = inj.severity === 'season' ? Number.MAX_SAFE_INTEGER : from + (inj.missMatches - 1) * GAME_INTERVAL;
            injuries.push({ playerId: p.id, teamId, from, to, severity: inj.severity, missMatches: inj.missMatches });
            concurrent++;
          }
        }
      }
    }
  }
  while (pi < pendingPlayerTx.length) applyTx(pendingPlayerTx[pi++]);
  return { injuries, txLog, played, teamDays };
}

function dyn(): Dyn {
  const key = `${baseVersion()}:${txVersion}`;
  if (cache && cache.key === key) return cache.dyn;
  const d = compute();
  cache = { key, dyn: d };
  return d;
}

// ── 공개 셀렉터 ──
export function injuredOnDay(day: number): Set<string> {
  const out = new Set<string>();
  for (const s of dyn().injuries) if (s.from <= day && day <= s.to) out.add(s.playerId);
  return out;
}

/** day 시점 팀 명단 id(시작명단 ± txDay≤day 거래) */
export function rosterIdsOnDay(teamId: string, day: number): string[] {
  const ids = [...(currentRosters()[teamId] ?? [])];
  const set = new Set(ids);
  for (const tx of dyn().txLog) {
    if (tx.teamId !== teamId || tx.day > day) continue;
    if (tx.kind === 'release') set.delete(tx.playerId);
    else set.add(tx.playerId);
  }
  // 순서 보존 + 신규 영입 뒤에
  return [...ids.filter((id) => set.has(id)), ...[...set].filter((id) => !ids.includes(id))];
}

/** day 시점 출전 가능 선수(날짜 명단 − 부상자) — production·standings·playoffs 공용 */
/** day 시점 경기감각 계수 — 그 팀의 직전 FORM_WINDOW 매치데이 중 출전 비율(forward-pass와 동일 규칙) */
export function formFactorOnDay(teamId: string, playerId: string, day: number): number {
  const dn = dyn();
  const days = (dn.teamDays.get(teamId) ?? []).filter((x) => x < day).slice(-FORM_WINDOW);
  if (!days.length) return 1;
  const pl = dn.played.get(playerId);
  const cnt = pl ? days.filter((x) => pl.includes(x)).length : 0;
  return formFactor(cnt, days.length);
}

export function availableTeamPlayers(teamId: string, day: number): Player[] {
  const injured = injuredOnDay(day);
  let ids = rosterIdsOnDay(teamId, day).filter((id) => !injured.has(id));
  // 벤치 지시 — 출전 7인 미만이 되면 그 경기 한정 무시(forward-pass와 동일 가드)
  const benched = benchedOn(day);
  if (benched.size) {
    const wo = ids.filter((id) => !benched.has(id));
    if (wo.length >= 7) ids = wo;
  }
  return ids
    .map((id) => evolveOnDay(id, day))
    .filter((p): p is Player => !!p)
    .map((p) => applyForm(p, formFactorOnDay(teamId, p.id, day))); // 경기감각 반영
}

/** day 시점 영입 가능 FA id(시작 풀 + txDay≤day 방출자 − 영입된 자) */
export function availableFAsOnDay(day: number): string[] {
  const set = new Set(faPoolSeed);
  for (const tx of dyn().txLog) {
    if (tx.day > day) continue;
    if (tx.kind === 'release') set.add(tx.playerId);
    else set.delete(tx.playerId);
  }
  return [...set];
}

export function teamInjuriesOn(teamId: string, day: number): InjurySpan[] {
  return dyn().injuries.filter((s) => s.teamId === teamId && s.from <= day && day <= s.to);
}
export const seasonInjuryReport = (): InjurySpan[] => dyn().injuries;
export const seasonTxLog = (): Tx[] => dyn().txLog;

export function seasonInjuryDays(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of dyn().injuries) m.set(s.playerId, (m.get(s.playerId) ?? 0) + s.missMatches);
  return m;
}
