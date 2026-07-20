// 감독 생애주기 오케스트레이션 (STAFF_SYSTEM 6) — 셀렉터 계층.
// 엔진(staffLifecycle) 판정을 현재 풀에 적용해 다음 시즌 풀 + 팀 재배정을 만든다.
// 순수에 가깝게: 입력(현재 풀·은퇴 선수·순위)을 받아 새 풀을 반환. 호출측이 commit/persist.

import type { Coach, AssistantCoach, Player, TrainingFocus, CoachStyle } from '../types';
import {
  staffRetires, becomesCoach, playerToCoach, promotesToHead, headWorthiness,
  coachToHead, firedEndSeason, aiResigns, contractTerm, coachSeasonGrowth,
} from '../engine/staffLifecycle';
import { createRng, strSeed } from '../engine/rng';
import { headCoachSalary, assistantSalary, coachTypeFor, deriveHeadAxes, headOvr } from '../engine/staff';
import { interimRenown } from '../engine/reputation';
import { COACH_NAMES } from './names';
import type { CoachSpecialty } from '../types';

const EXT_SPECIALTIES: CoachSpecialty[] = ['attack', 'defense', 'stamina', 'setter', 'mental'];
/** 외부 명장 A급 유입 (STAFF §8.1 phase③ 재생성) — 은퇴자 유입만으론 상위코치 멸종을 못 막아, 매 시즌 소수 A급을
 *  풀에 결정론적으로 투입한다("해외/타 리그 출신 명장"). 빈도는 밸런스로 조정(과다=글럿 회귀). */
function makeExternalCoach(season: number): AssistantCoach {
  const rng = createRng(strSeed(`extcoach:${season}`));
  const sp = EXT_SPECIALTIES[strSeed(`extsp:${season}`) % EXT_SPECIALTIES.length];
  const rating = 80 + rng.int(0, 8); // 80~88 A급 입구
  const id = `coach-ext-s${season}`;
  return { id, name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)], age: 42 + rng.int(0, 12), specialty: sp, type: coachTypeFor(id, sp), rating, salary: assistantSalary(rating), teamId: null };
}

/** 신임(대체급) 감독 생성 — 프리 감독·승격 가능 코치가 모두 고갈됐을 때의 공급 안전장치.
 *  결정론(teamId·season 시드). 풀에 영구 합류해 공급을 보충(다음부터 이 감독도 순환). */
function makeInterimCoach(teamId: string, season: number): Coach {
  const rng = createRng(strSeed(`interim-coach:${teamId}:${season}`));
  const matchOps = 38 + rng.int(0, 18); // 구 charisma 생성식 그대로
  const styles: CoachStyle[] = ['attack', 'defense', 'balanced'];
  const id = `coach-int-${teamId}-s${season}`;
  const axes = deriveHeadAxes(id);
  const renown = interimRenown(id); // 신임=무명(8~17)
  return {
    id,
    name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)],
    age: 44 + rng.int(0, 16), matchOps, ...axes, renown, style: styles[rng.int(0, 2)],
    archetype: '신임', trainingFocus: DEFAULT_FOCUS, salary: headCoachSalary(headOvr({ matchOps, ...axes }), renown),
    teamId: null, contractYears: undefined,
  };
}

export interface CoachReassign { teamId: string; coachId: string | null } // null = 풀에 빈자리(다음 영입까지 기본 감독)

export interface LifecycleResult {
  coaches: Coach[];
  assistants: AssistantCoach[];
  reassign: CoachReassign[];        // 감독이 떠난 팀 → 새 감독 id(AI 자동) 또는 null(플레이어 팀)
  retiredCoaches: string[];         // 이번에 은퇴한 감독/코치 이름(뉴스용)
  newCoaches: string[];             // 선수 출신 신규 코치 이름
  promoted: string[];               // 감독으로 승격한 이름
  expiringForPlayer: boolean;       // 플레이어 팀 감독 계약 만료(재계약 필요) — UI 알림
  walked: string[];                 // 계약 만료로 FA가 된 감독 이름(AI 미재계약)
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
  const walked: string[] = [];
  let expiringForPlayer = false;
  const reassign: CoachReassign[] = [];

  // 떠난(은퇴/경질) 감독 id 집합 — 팀 재배정 트리거
  const leftHeadByTeam = new Map<string, string>(); // teamId → 떠난 감독 id

  // 1) 노쇠 +1 & 은퇴 판정
  let coaches: Coach[] = [];
  for (const c of pool.coaches) {
    if (c.id.startsWith('acting_')) { coaches.push(c); continue; } // 대행은 임시 — 노쇠·은퇴 안 함(플레이어가 정식 영입으로 해소)
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

  // 1.5) 배정 코치 성장(경력+성과) — 팀을 맡은 감독/코치가 지난 시즌 성적 따라 성장(STAFF §8.1 phase②).
  //   상위코치 멸종(실측) 처방: 오래 잘 지도한 코치가 A/S로 올라와 풀 tier를 유지시킨다.
  //   정수 저장(표시 정합) — 성장분<0.5 구간은 자연 정체(성과별 성장 상한: 상위팀 ~A·하위팀 ~B, S는 재생성/엘리트만).
  const rankPos = (teamId: string) => { const i = rankOrder.indexOf(teamId); return i < 0 ? teamCount : i + 1; };
  for (const c of coaches) if (c.teamId) c.matchOps = Math.round(coachSeasonGrowth(c.matchOps, rankPos(c.teamId), teamCount));
  for (const a of assistants) if (a.teamId) a.rating = Math.round(coachSeasonGrowth(a.rating, rankPos(a.teamId), teamCount));

  // 2) 시즌 후 경질 — 하위 팀 감독 해촉(플레이어 팀 제외)
  for (let i = 0; i < rankOrder.length; i++) {
    const teamId = rankOrder[i];
    if (teamId === myTeamId) continue;
    const headId = assignedHead[teamId];
    if (!headId) continue;
    if (firedEndSeason(i + 1, teamCount, bottomYears[teamId] ?? 0, season, headId)) {
      const fired = coaches.find((c) => c.id === headId);
      if (fired) {
        fired.teamId = null; fired.contractYears = undefined; // FA로 — 계약 잔여 비움(stale 방지)
        fired.firedFrom = [...(fired.firedFrom ?? []), teamId]; // 그 팀엔 다시 안 감(영구)
        leftHeadByTeam.set(teamId, headId); retiredCoaches.push(`${fired.name}(경질)`);
      }
    }
  }

  // 2.5) 계약 진행 — 배정 감독 잔여 연수 −1, 만료 시 재계약(AI)/FA/플레이어 알림
  const rankOf = (teamId: string) => { const i = rankOrder.indexOf(teamId); return i < 0 ? teamCount : i + 1; };
  for (const [teamId, headId] of Object.entries(assignedHead)) {
    if (leftHeadByTeam.has(teamId) || headId.startsWith('acting_')) continue; // 경질된 팀·대행 체제 제외
    const c = coaches.find((x) => x.id === headId);
    if (!c) continue;
    c.contractYears = (c.contractYears ?? 1) - 1;
    if (c.contractYears > 0) continue; // 계약 남음
    if (teamId === myTeamId) { expiringForPlayer = true; c.contractYears = 0; continue; } // 플레이어가 재계약 결정(유지)
    if (aiResigns(rankOf(teamId), teamCount, c.age, season, c.id)) {
      c.contractYears = contractTerm(c.id, season); // AI 재계약
    } else {
      c.teamId = null; c.contractYears = undefined; leftHeadByTeam.set(teamId, headId); walked.push(c.name); // FA로 풀려남
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
  // 4.5) 외부 명장 A급 유입(phase③ 재생성) — 2시즌마다 1명("소수" — 빈도가 상위 공급 튜닝 손잡이, 과다=글럿 회귀).
  if (season % 2 === 0) {
    const ext = makeExternalCoach(season);
    if (!assistants.some((a) => a.id === ext.id)) { assistants.push(ext); newCoaches.push(ext.name); }
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

  // 방금 떠난(경질·은퇴 후 살아있는) 감독은 이번 오프시즌 재배정 제외 — 경질당한 팀에 도로 가거나
  //   같은 시즌 다른 팀에 바로 취직하지 않는다(현실: 경질된 감독은 한 시즌 쉰다).
  const justLeft = new Set(leftHeadByTeam.values());
  // 6) 빈 팀 재배정 — AI는 풀에서 최고 카리스마 자동 선임. 프리 감독이 없으면
  //    최고 역량 전문 코치를 즉시 감독 승격(공급 안전장치 — 팀은 항상 감독을 갖는다).
  for (const [teamId] of leftHeadByTeam) {
    if (teamId === myTeamId) { reassign.push({ teamId, coachId: null }); continue; }
    // 프리 감독 중: 이번에 떠난 사람 제외(한 시즌 휴식) + 이 팀에서 경질된 적 없는 사람만(영구 배제)
    let free = coaches.filter((c) => c.teamId === null && !justLeft.has(c.id) && !(c.firedFrom ?? []).includes(teamId))
      .sort((x, y) => y.matchOps - x.matchOps)[0];
    if (!free) {
      const best = assistants.filter((a) => a.teamId === null).sort((x, y) => y.rating - x.rating)[0];
      if (best) {
        const fromLegend = best.id.startsWith('coach_') && legendIds.has(best.id.slice('coach_'.length));
        const style = best.specialty === 'attack' ? 'attack' : best.specialty === 'defense' ? 'defense' : 'balanced';
        free = coachToHead(best, fromLegend ? 80 : 40, DEFAULT_FOCUS, style);
        coaches.push(free); assistants = assistants.filter((a) => a.id !== best.id); promoted.push(best.name);
      } else {
        // 프리 감독·승격 코치 모두 고갈 → 신임 감독을 신규 영입(공급 안전장치 — 팀은 절대 무감독이 되지 않는다)
        free = makeInterimCoach(teamId, season);
        coaches.push(free); newCoaches.push(free.name);
      }
    }
    if (free) { free.teamId = teamId; free.contractYears = contractTerm(free.id, season); reassign.push({ teamId, coachId: free.id }); }
    else reassign.push({ teamId, coachId: null });
  }

  return { coaches, assistants, reassign, retiredCoaches, newCoaches, promoted, expiringForPlayer, walked };
}
