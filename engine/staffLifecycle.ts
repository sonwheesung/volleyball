// 감독 생애주기 (STAFF_SYSTEM 6장) — 노쇠·은퇴·은퇴선수→코치·승격·경질 판정.
// 순수 함수 + 시드 결정론(id 해시). 오프시즌(data/offseason)이 호출. 선수 은퇴와 같은 계층.

import type { Coach, AssistantCoach, CoachSpecialty, CoachStyle, Player, Position } from '../types';
import { createRng, strSeed } from './rng';
import { overall } from './overall';
import { headCoachSalary, assistantSalary } from './staff';

// ── 6.1 노쇠·은퇴 ──
/** 감독 은퇴 확률 — 현장직은 선수보다 늦게(60대까지). 나이만의 함수. */
export function coachRetireChance(age: number): number {
  if (age <= 55) return 0;
  if (age <= 60) return 0.06;
  if (age <= 65) return 0.18;
  if (age <= 70) return 0.4;
  if (age <= 75) return 0.7;
  return 0.95;
}

/** 감독/코치 은퇴 판정 — id 시드 결정론(나이 포함해 매 시즌 독립). */
export function staffRetires(id: string, age: number, season: number): boolean {
  return createRng(strSeed(`coachretire:${id}:${season}`)).next() < coachRetireChance(age);
}

// ── 6.2 은퇴 선수 → 전문 코치 ──
/** 포지션 → 코치 분야 (현실 매핑). 세터=세터코치, 미들/리베로=수비, 윙=공격. */
const POS_SPECIALTY: Record<Position, CoachSpecialty> = {
  S: 'setter', MB: 'defense', L: 'defense', OH: 'attack', OP: 'attack',
};

const COACH_VQ_MIN = 72; // 이 미만 VQ면 지도자 자질 부족(전환 안 됨)

/** 은퇴 선수가 지도자(전문 코치)로 전환되는가 — 고VQ일수록↑. 명성(레전드)도 가산.
 *  공급 균형: 감독 풀 유지엔 은퇴 선수의 상당수가 지도자로 가야 한다(고VQ 절반 이상). */
export function becomesCoach(p: Player, isLegend: boolean, season: number): boolean {
  if (p.vq < COACH_VQ_MIN) return false;
  // VQ 72→0.30, 90→0.75 + 레전드 +0.2.
  const base = Math.max(0, (p.vq - COACH_VQ_MIN) / 18) * 0.45 + 0.3 + (isLegend ? 0.2 : 0);
  return createRng(strSeed(`tocoach:${p.id}:${season}`)).next() < Math.min(0.9, base);
}

/** 은퇴 선수 → 전문 코치(assistant) 객체. id는 staff:{playerId} 시드 결정론. */
export function playerToCoach(p: Player, isLegend: boolean): AssistantCoach {
  const rng = createRng(strSeed(`staff:${p.id}`));
  const specialty = POS_SPECIALTY[p.position];
  // 역량 = VQ 주도 + 위치선정/반응(지도 능력 근사) + 명성 보너스, 약간의 시드 변동
  const skillAvg = (p.vq + p.positioning + p.reaction) / 3;
  const rating = clamp(Math.round(skillAvg * 0.8 + (isLegend ? 8 : 0) + rng.range(-4, 4)), 45, 95);
  return { id: `coach_${p.id}`, name: p.name, age: p.age + 1, specialty, rating, salary: assistantSalary(rating), teamId: null };
}

// ── 6.3 코치 → 감독 승격 ──
/** 전문 코치의 명성(0~100) — 코치 경력 성과(coachRep) + 본래 스타성(starRep). */
export function headWorthiness(rating: number, coachRep: number, starRep: number): number {
  return clamp(rating * 0.4 + coachRep * 0.4 + starRep * 0.2, 0, 100);
}

/** 승격 판정 — 명성이 임계를 넘고 시드 통과 시 감독 풀로. (공급 균형: 은퇴 감독을 메울 만큼) */
export function promotesToHead(coachId: string, worthiness: number, season: number): boolean {
  if (worthiness < 52) return false;
  const p = Math.min(0.42, (worthiness - 52) / 30 * 0.35 + 0.12);
  return createRng(strSeed(`promote:${coachId}:${season}`)).next() < p;
}

/** 전문 코치 → 감독(head) 객체. 스타성으로 카리스마, 분야로 성향 편향. */
export function coachToHead(c: AssistantCoach, starRep: number, focus: Coach['trainingFocus'], style: CoachStyle): Coach {
  const rng = createRng(strSeed(`head:${c.id}`));
  const charisma = clamp(Math.round(c.rating * 0.6 + starRep * 0.3 + rng.range(-5, 5)), 45, 95);
  return {
    id: `head_${c.id}`, name: c.name, age: c.age, charisma, style,
    archetype: '선수 출신', trainingFocus: focus, salary: headCoachSalary(charisma), teamId: null,
  };
}

// ── 6.4 경질 ──
/** 시즌 후 AI 경질 — 최하위(또는 하위+부진)면 감독 교체. rank/teamCount는 1-based. */
export function firedEndSeason(rank: number, teamCount: number, recentBottomYears: number): boolean {
  if (rank === teamCount) return true;                 // 꼴찌 = 경질
  if (rank >= teamCount - 1 && recentBottomYears >= 2) return true; // 하위권 2년 연속 = 경질
  return false;
}

/** 시즌 중 경질 임계 — 일정 경기 이상 치렀고 승률이 바닥이면(대행 전환). */
export function firedMidSeason(wins: number, losses: number): boolean {
  const games = wins + losses;
  if (games < 12) return false;             // 충분한 표본 후에만
  return wins / games < 0.2;                // 승률 20% 미만 = 시즌 중 경질
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

// 표시/검증용 재노출
export { overall };
