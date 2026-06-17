// 종합 능력치(OVR) 산출 — 포지션 가중치(CLAUDE.md 5.3)로 윗단 스탯을 블렌딩.
// 카드/목록 표시용 단일 숫자. 계수는 placeholder.

import type { Player, Position } from '../types';
import { deriveRatings, type Ratings } from './ratings';

// 가중치 순서: [spike, block, dig, receive, set, serve]
const WEIGHTS: Record<Position, [number, number, number, number, number, number]> = {
  S: [0, 1, 2, 1, 3, 2],
  OH: [3, 2, 2, 3, 1, 3],
  OP: [3, 2, 1, 0, 0, 3],
  MB: [3, 3, 1, 1, 1, 2],
  L: [0, 0, 3, 3, 1, 0],
};

/** 연속(반올림 전) 개인 OVR — 표시 스트레치(displayOvr)가 해상도를 살리려면 정수가 아닌 연속값이 필요. */
export function overallRaw(p: Player): number {
  const r: Ratings = deriveRatings(p);
  const w = WEIGHTS[p.position];
  const vals = [r.spike, r.block, r.dig, r.receive, r.set, r.serve];
  let num = 0;
  let den = 0;
  for (let i = 0; i < vals.length; i++) {
    num += w[i] * vals[i];
    den += w[i];
  }
  const base = den === 0 ? 50 : num / den;
  // 멘탈을 소폭 가미
  const mental = (p.focus + p.consistency) / 2;
  return Math.max(40, Math.min(99, base * 0.85 + mental * 0.15));
}

/** 정수 개인 OVR — 엔진·AI 정렬·은퇴/aiGM 절대 임계값·기존 표시 텍스트용(기존 동작 유지). */
export function overall(p: Player): number {
  return Math.round(overallRaw(p));
}

/** 연속(반올림 전) 팀 OVR — 상위 7인 연속 평균. displayOvr로 표시. */
export function teamOverallRaw(players: Player[]): number {
  if (players.length === 0) return 0;
  const ovrs = players.map(overallRaw).sort((a, b) => b - a);
  const top = ovrs.slice(0, 7);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

export function teamOverall(players: Player[]): number {
  return Math.round(teamOverallRaw(players));
}

// 표시 전용 OVR 스트레치 — overall()/teamOverall()(엔진·AI 정렬·은퇴/aiGM·스케줄 절대 임계값용)은
// 그대로 두고, UI 카드/목록 표시에만 적용한다. 표시 OVR이 좁은 밴드(팀 66~77·선수 56~84)에 압축돼
// 1점 ≈ 8%p 승률, 정수 반올림으로 ±4%p가 분해 불가했던 문제를 펴서 해상도를 높인다.
// ★ 입력은 반드시 "연속값"(overallRaw/teamOverallRaw) — 정수를 넣으면 같은 정수 팀이 안 갈라져 무의미.
// 단조 선형이라 순위·상관(r=0.897) 불변, 반올림 전 연속값을 펴므로 같은-정수 병합도 해소.
// (tools/ovrDist·ovrDiag 측정 근거)
const OVR_PIVOT = 69;
const OVR_STRETCH = 2.6;
export function displayOvr(rawContinuous: number): number {
  return Math.round(Math.max(40, Math.min(99, OVR_PIVOT + (rawContinuous - OVR_PIVOT) * OVR_STRETCH)));
}
