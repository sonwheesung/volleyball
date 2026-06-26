// 선수 인간관계망 — affinity(친구/라이벌). 순수·결정론. docs/RELATIONSHIP_SYSTEM.
// affinity = innate(id 시드·무저장) + bond(영속·함께한 세월) + posRivalry(같은 포지션 경쟁·파생). 외인 제외.
import type { Player } from '../types';
import { createRng, strSeed } from './rng';
import { overallRaw } from './overall';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const BOND_MAX = 0.3;    // 함께한 세월 우정 상한
export const BOND_GROW = 0.06;  // 시즌당 같은 팀 우정 증가(Phase 1b endSeason)
export const BOND_DECAY = 0.92; // 떨어진 시즌 감쇠(옛정 — 완전소멸 안 함)
const POS_RIVAL_K = 0.3;        // 같은 포지션 경쟁 라이벌 기저(은은)

/** 순서 무관 쌍 키(대칭) */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 고정 성향(id 시드, 무저장) ∈ {-0.65,-0.35,0,+0.35,+0.7} — 대부분(60%) 중립 */
export function innateAffinity(a: string, b: string): number {
  if (a === b) return 0;
  const r = createRng(strSeed(`rel:${pairKey(a, b)}`)).next();
  if (r < 0.06) return 0.7;   // 절친 6%
  if (r < 0.18) return 0.35;  // 친함 12%
  if (r < 0.78) return 0;     // 중립 60%
  if (r < 0.92) return -0.35; // 불편 14%
  return -0.65;               // 라이벌 8%
}

/**
 * 두 국내 선수 affinity ∈ [-1,+1]. 외인이면 0(관계망 밖).
 * @param bond 영속 누적 우정(0~BOND_MAX, 없으면 0)
 * @param sameTeam 현재 같은 팀(포지션 라이벌 강도)
 */
export function affinity(a: Player, b: Player, bond = 0, sameTeam = false): number {
  if (a.id === b.id || a.isForeign || b.isForeign) return 0;
  const bd = clamp(bond, 0, BOND_MAX);
  let v = innateAffinity(a.id, b.id) + bd; // 함께한 세월은 우정(+)
  if (a.position === b.position) {
    // 같은 포지션 = 주전 경쟁 라이벌. 같은 팀 + OVR 근접일수록 강하게(직접 경쟁).
    let rival = POS_RIVAL_K * (sameTeam ? clamp(1 - Math.abs(overallRaw(a) - overallRaw(b)) / 12, 0.2, 1) : 0.4);
    rival *= Math.max(0, 1 - bd / BOND_MAX); // 전우애(bond)가 라이벌 완화 — 라이벌이자 전우
    v -= rival;
  }
  return clamp(v, -1, 1);
}
