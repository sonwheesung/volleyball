// 감독 생애주기 (STAFF_SYSTEM 6장) — 노쇠·은퇴·은퇴선수→코치·승격·경질 판정.
// 순수 함수 + 시드 결정론(id 해시). 오프시즌(data/offseason)이 호출. 선수 은퇴와 같은 계층.

import type { Coach, AssistantCoach, CoachSpecialty, CoachStyle, Player, Position } from '../types';
import { createRng, strSeed } from './rng';
import { overall } from './overall';
import { headCoachSalary, assistantSalary, coachTypeFor } from './staff';

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

// ── 6.1b 코치 성장 (STAFF_SYSTEM §8.1 phase② — 실측 붕괴 처방) ──
/** 배정된(팀 맡은) 코치가 경력+성과로 시즌마다 소폭 성장. 상한(92) 근처 둔화 → A/S는 오래·성적 좋아야 도달.
 *  값 기반 결정론(rng 없음). 반환=성장 후 새 값(fractional 누적 — 반올림은 표시에서). rankPos 1=1위. */
export function coachSeasonGrowth(cur: number, rankPos: number, teamCount: number): number {
  const perf = rankPos <= Math.ceil(teamCount / 2) ? 1 : 0.4; // 상위 절반=성과 보너스
  const room = Math.max(0, 92 - cur) / 92;                     // 상한 근처 둔화(수렴)
  const g = (1.5 + perf * 2.5) * room;                         // 상위팀 코치 ~+4/시즌(상한 근처 축소)
  return Math.min(92, cur + g);
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
  // 역량 = VQ 주도 + 위치선정/반응(지도 능력 근사) + **엘리트 보너스**(피지도자였을수록 명장 소질) + 명성.
  //   STAFF §8.1 phase③(재생성): skillAvg×0.8 단독은 우수 은퇴자도 C로 강등→풀 붕괴. 엘리트일수록 A/S로 유입시켜 상위 공급 유지.
  const skillAvg = (p.vq + p.positioning + p.reaction) / 3;
  const elite = Math.max(0, (skillAvg - 74) / 22) * 14; // skillAvg 74→+0 · 88→+9 · 96→+14 (상위 은퇴자가 A/S로)
  const rating = clamp(Math.round(skillAvg * 0.85 + elite + (isLegend ? 8 : 0) + rng.range(-4, 4)), 45, 95);
  const id = `coach_${p.id}`;
  return { id, name: p.name, age: p.age + 1, specialty, type: coachTypeFor(id, specialty), rating, salary: assistantSalary(rating), teamId: null };
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
/** 시즌 후 AI 경질 — 부진 시 감독 교체. rank/teamCount는 1-based.
 *  꼴찌 1년은 확률(인내심), 하위권 2년 연속은 확정. 매 시즌 꼴찌마다 경질하면 과도한 churn. */
export function firedEndSeason(rank: number, teamCount: number, recentBottomYears: number, season = 0, coachId = ''): boolean {
  if (rank < teamCount - 1) return false;              // 중상위는 안전
  if (recentBottomYears >= 2) return true;             // 하위권 2년 연속 = 확정 경질
  if (rank === teamCount) return createRng(strSeed(`fire:${coachId}:${season}`)).next() < 0.45; // 꼴찌 1년 = 45%
  return false;
}

/** 최근 연속 하위권(꼴찌권=teamCount-1 이하) 연수 — rankOrder 배열들(과거→현재)에서 팀 기준 산출. */
export function bottomStreak(recentRankOrders: string[][], teamId: string): number {
  let n = 0;
  for (let i = recentRankOrders.length - 1; i >= 0; i--) {
    const order = recentRankOrders[i];
    const rank = order.indexOf(teamId) + 1;
    if (rank > 0 && rank >= order.length - 1) n++; else break;
  }
  return n;
}

/** 시즌 중 경질 임계 — 일정 경기 이상 치렀고 승률이 바닥이면(대행 전환). */
export function firedMidSeason(wins: number, losses: number): boolean {
  const games = wins + losses;
  if (games < 12) return false;             // 충분한 표본 후에만
  return wins / games < 0.2;                // 승률 20% 미만 = 시즌 중 경질
}

// ── 6.6 계약·재계약(감독 FA) ──
// (미사용 상수 NEW_CONTRACT_YEARS 제거 2026-07-15 — 실제 계약 연수는 아래 contractTerm(2~4년 시드)이 부여. 어디서도 참조 안 됨.)
/** 영입/재계약 시 부여할 계약 연수 — id·시즌 시드로 2~4년 변동(결정론). */
export function contractTerm(id: string, season: number): number {
  return 2 + Math.floor(createRng(strSeed(`contract:${id}:${season}`)).next() * 3); // 2~4
}
/** AI 재계약 결정 — 계약 만료 감독을 붙잡을지. 성적 좋고 너무 늙지 않으면 재계약, 아니면 FA로 놓아준다. */
export function aiResigns(rank: number, teamCount: number, coachAge: number, season: number, coachId: string): boolean {
  // 상위권일수록·젊을수록 재계약. 기본 확률 + 순위 보정 − 노령 보정.
  const rankFactor = 1 - (rank - 1) / Math.max(1, teamCount - 1); // 1위=1, 꼴찌=0
  const p = clamp(0.45 + 0.4 * rankFactor - Math.max(0, coachAge - 62) * 0.06, 0.1, 0.95);
  return createRng(strSeed(`resign:${coachId}:${season}`)).next() < p;
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

// 표시/검증용 재노출
export { overall };
