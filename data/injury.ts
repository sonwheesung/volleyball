// 부상 타임라인 (INJURY_SYSTEM, 시즌 계층). 결정론 forward-pass로 시즌 부상 구간을 산출.
// production·standings·playoffs 가 "출전 가능 명단"을 이 모듈로 깎는다(같은 명단 → 결과 일치).
// 부상은 매치 결과가 아니라 "선발(출전)"에만 의존 → simMatch 와 무순환.

import type { Player } from '../types';
import { createRng, strSeed } from '../engine/rng';
import { injuryRisk, rollSeverity, CONCURRENT_CAP, type Severity } from '../engine/injury';
import { buildLineup } from '../engine/lineup';
import { baseVersion, getEvolvedTeamPlayers, SEASON } from './league';

const GAME_INTERVAL = 4; // season.ts 매치데이 간격과 동일

export interface InjurySpan {
  playerId: string;
  teamId: string;
  from: number;          // 결장 시작 dayIndex(부상 다음 매치데이)
  to: number;            // 결장 종료(포함). 시즌아웃 = MAX
  severity: Severity;
  missMatches: number;
}

let cache: { key: number; spans: InjurySpan[] } | null = null;

/** 결정론 forward-pass — 매치데이 순서로 선발을 굴리며 부상 구간 누적 */
function computeTimeline(): InjurySpan[] {
  const byDay = new Map<number, typeof SEASON>();
  for (const f of SEASON) { const a = byDay.get(f.dayIndex) ?? []; a.push(f); byDay.set(f.dayIndex, a); }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const spans: InjurySpan[] = [];
  const activeCount = (day: number, teamId: string) =>
    spans.reduce((n, s) => n + (s.teamId === teamId && s.from <= day && day <= s.to ? 1 : 0), 0);
  const injuredIdsOn = (day: number, teamId: string) =>
    new Set(spans.filter((s) => s.teamId === teamId && s.from <= day && day <= s.to).map((s) => s.playerId));

  for (const d of days) {
    for (const f of byDay.get(d)!) {
      for (const teamId of [f.homeTeamId, f.awayTeamId]) {
        const injured = injuredIdsOn(d, teamId);
        const avail = getEvolvedTeamPlayers(teamId, d).filter((p) => !injured.has(p.id));
        const lu = buildLineup(avail);
        const onCourt = lu.libero ? [...lu.six, lu.libero] : lu.six;
        let concurrent = injured.size;
        for (const p of onCourt) {
          if (concurrent >= CONCURRENT_CAP) break;
          // 시드: 선수 id + 나이 + 매치데이 — 시즌 내 고정, 시즌 간(나이↑) 탈상관. baseVersion 무의존.
          const rng = createRng(strSeed(`injury:${p.id}:${p.age}:${d}`));
          if (rng.next() < injuryRisk(p.age, p.staminaMax, p.traits)) {
            const inj = rollSeverity(rng);
            const from = d + GAME_INTERVAL; // 이 경기는 뛰고, 다음 매치데이부터 결장
            const to = inj.severity === 'season' ? Number.MAX_SAFE_INTEGER : from + (inj.missMatches - 1) * GAME_INTERVAL;
            spans.push({ playerId: p.id, teamId, from, to, severity: inj.severity, missMatches: inj.missMatches });
            concurrent++;
          }
        }
      }
    }
  }
  return spans;
}

function timeline(): InjurySpan[] {
  const key = baseVersion();
  if (cache && cache.key === key) return cache.spans;
  const spans = computeTimeline();
  cache = { key, spans };
  return spans;
}

/** day 시점 부상 결장 선수 id 집합 */
export function injuredOnDay(day: number): Set<string> {
  const out = new Set<string>();
  for (const s of timeline()) if (s.from <= day && day <= s.to) out.add(s.playerId);
  return out;
}

/** day 시점 출전 가능 선수(진화 적용 − 부상자) — production·standings·playoffs 공용 */
export function availableTeamPlayers(teamId: string, day: number): Player[] {
  const injured = injuredOnDay(day);
  return getEvolvedTeamPlayers(teamId, day).filter((p) => !injured.has(p.id));
}

/** day 시점 내 팀 부상자 + 복귀 예정일(UI·뉴스) */
export function teamInjuriesOn(teamId: string, day: number): InjurySpan[] {
  return timeline().filter((s) => s.teamId === teamId && s.from <= day && day <= s.to);
}

export const seasonInjuryReport = (): InjurySpan[] => timeline();

/** 선수별 이번 시즌 결장 매치 합(만성 노쇠·서사용) */
export function seasonInjuryDays(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of timeline()) m.set(s.playerId, (m.get(s.playerId) ?? 0) + s.missMatches);
  return m;
}
