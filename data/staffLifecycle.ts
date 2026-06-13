// 감독 생애주기 오케스트레이션 (STAFF_SYSTEM 6) — 셀렉터 계층.
// 엔진(staffLifecycle) 판정을 현재 풀에 적용해 다음 시즌 풀 + 팀 재배정을 만든다.
// 순수에 가깝게: 입력(현재 풀·은퇴 선수·순위)을 받아 새 풀을 반환. 호출측이 commit/persist.

import type { Coach, AssistantCoach, Player, TrainingFocus } from '../types';
import {
  staffRetires, becomesCoach, playerToCoach, promotesToHead, headWorthiness,
  coachToHead, firedEndSeason,
} from '../engine/staffLifecycle';

export interface CoachReassign { teamId: string; coachId: string | null } // null = 풀에 빈자리(다음 영입까지 기본 감독)

export interface LifecycleResult {
  coaches: Coach[];
  assistants: AssistantCoach[];
  reassign: CoachReassign[];        // 감독이 떠난 팀 → 새 감독 id(AI 자동) 또는 null(플레이어 팀)
  retiredCoaches: string[];         // 이번에 은퇴한 감독/코치 이름(뉴스용)
  newCoaches: string[];             // 선수 출신 신규 코치 이름
  promoted: string[];               // 감독으로 승격한 이름
}

const DEFAULT_FOCUS: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] };

/**
 * 한 오프시즌의 감독 생태계 진행.
 * @param season 다음 시즌 번호(시드)
 * @param pool 현재 풀
 * @param assignedHead teamId → 현재 감독 id (배정된 감독, 풀에 있어야 함)
 * @param retiredPlayers 이번 오프시즌 은퇴 선수
 * @param legendIds 그중 레전드(영구결번) id
 * @param rankOrder 정규리그 최종 순위(teamId, 1위→꼴찌)
 * @param bottomYears teamId → 최근 연속 하위(경질 판정용)
 * @param myTeamId 플레이어 팀(강제 경질·자동배정 제외)
 */
export function advanceCoaches(
  season: number,
  pool: { coaches: Coach[]; assistants: AssistantCoach[] },
  assignedHead: Record<string, string>,
  retiredPlayers: Player[],
  legendIds: Set<string>,
  rankOrder: string[],
  bottomYears: Record<string, number>,
  myTeamId: string,
): LifecycleResult {
  const teamCount = rankOrder.length || 7;
  const retiredCoaches: string[] = [];
  const newCoaches: string[] = [];
  const promoted: string[] = [];
  const reassign: CoachReassign[] = [];

  // 떠난(은퇴/경질) 감독 id 집합 — 팀 재배정 트리거
  const leftHeadByTeam = new Map<string, string>(); // teamId → 떠난 감독 id

  // 1) 노쇠 +1 & 은퇴 판정
  let coaches: Coach[] = [];
  for (const c of pool.coaches) {
    const aged = { ...c, age: c.age + 1 };
    if (staffRetires(c.id, aged.age, season)) { retiredCoaches.push(c.name); continue; }
    coaches.push(aged);
  }
  let assistants: AssistantCoach[] = [];
  for (const a of pool.assistants) {
    const aged = { ...a, age: a.age + 1 };
    if (staffRetires(a.id, aged.age, season)) { retiredCoaches.push(a.name); continue; }
    assistants.push(aged);
  }

  // 2) 시즌 후 경질 — 하위 팀 감독 해촉(플레이어 팀 제외)
  for (let i = 0; i < rankOrder.length; i++) {
    const teamId = rankOrder[i];
    if (teamId === myTeamId) continue;
    const headId = assignedHead[teamId];
    if (!headId) continue;
    if (firedEndSeason(i + 1, teamCount, bottomYears[teamId] ?? 0)) {
      const fired = coaches.find((c) => c.id === headId);
      if (fired) { fired.teamId = null; leftHeadByTeam.set(teamId, headId); retiredCoaches.push(`${fired.name}(경질)`); }
    }
  }

  // 3) 배정 감독이 은퇴/사라짐 → 그 팀도 재배정 필요
  const aliveIds = new Set(coaches.map((c) => c.id));
  for (const [teamId, headId] of Object.entries(assignedHead)) {
    if (!aliveIds.has(headId) && !leftHeadByTeam.has(teamId)) leftHeadByTeam.set(teamId, headId);
  }

  // 4) 은퇴 선수 → 전문 코치 유입
  for (const p of retiredPlayers) {
    if (becomesCoach(p, legendIds.has(p.id), season)) {
      const ac = playerToCoach(p, legendIds.has(p.id));
      if (!assistants.some((a) => a.id === ac.id)) { assistants.push(ac); newCoaches.push(ac.name); }
    }
  }

  // 5) 승격 — 명성 높은 전문 코치 → 감독 풀 (스타성=레전드 출신 가산)
  const stillAsst: AssistantCoach[] = [];
  for (const a of assistants) {
    const fromLegend = a.id.startsWith('coach_') && legendIds.has(a.id.slice('coach_'.length));
    const starRep = fromLegend ? 80 : 40;
    const worth = headWorthiness(a.rating, 50, starRep); // coachRep 50 기본(성과 추적은 후속)
    if (a.teamId === null && promotesToHead(a.id, worth, season)) {
      const style = a.specialty === 'attack' ? 'attack' : a.specialty === 'defense' ? 'defense' : 'balanced';
      coaches.push(coachToHead(a, starRep, DEFAULT_FOCUS, style));
      promoted.push(a.name);
    } else stillAsst.push(a);
  }
  assistants = stillAsst;

  // 6) 빈 팀 재배정 — AI는 풀에서 최고 카리스마 자동 선임. 프리 감독이 없으면
  //    최고 역량 전문 코치를 즉시 감독 승격(공급 안전장치 — 팀은 항상 감독을 갖는다).
  for (const [teamId] of leftHeadByTeam) {
    if (teamId === myTeamId) { reassign.push({ teamId, coachId: null }); continue; }
    let free = coaches.filter((c) => c.teamId === null).sort((x, y) => y.charisma - x.charisma)[0];
    if (!free) {
      const best = assistants.filter((a) => a.teamId === null).sort((x, y) => y.rating - x.rating)[0];
      if (best) {
        const fromLegend = best.id.startsWith('coach_') && legendIds.has(best.id.slice('coach_'.length));
        const style = best.specialty === 'attack' ? 'attack' : best.specialty === 'defense' ? 'defense' : 'balanced';
        free = coachToHead(best, fromLegend ? 80 : 40, DEFAULT_FOCUS, style);
        coaches.push(free); assistants = assistants.filter((a) => a.id !== best.id); promoted.push(best.name);
      }
    }
    if (free) { free.teamId = teamId; reassign.push({ teamId, coachId: free.id }); }
    else reassign.push({ teamId, coachId: null });
  }

  return { coaches, assistants, reassign, retiredCoaches, newCoaches, promoted };
}
