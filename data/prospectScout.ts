// 스카우터 부분 포텐 공개 (FA_SYSTEM §3.3 스카우팅 2.0 3단계) — 순수 파생.
//
// 확정 스펙: 스카우터 레벨(reveal 0~1)↑ → 유망주의 **개별 능력 잠재력(미래 윗단 rating)을 몇 개** 공개.
//   - **포지션 핵심 스탯부터** 공개(MB=블록·공격 / L=디그·리시브 …).
//   - **개수 + 정밀도 둘 다**: 범위로 표시하되 등급↑일수록 축소 → 최상급은 정확치(현재 OVR 안개와 동일 패턴).
//   - **최고 스카우터라도 전체의 ~50%만**(윗단 6개 중 ≤3개) 공개 — 나머지는 끝까지 은닉(도박 유지).
// 집계 포텐 별(★)은 제거하고 이 부분공개가 대체. 표시(app/draft)·AI 평가(pickWithReason 동일정보)가 공유.
import type { Player, Position } from '../types';
import { deriveRatings, type Ratings } from '../engine/ratings';

type RKey = keyof Ratings; // spike·block·dig·receive·set·serve
const RATING_LABEL: Record<RKey, string> = { spike: '공격', block: '블로킹', dig: '디그', receive: '리시브', set: '세팅', serve: '서브' };

// 포지션 핵심 윗단 rating 우선순위(CLAUDE 5.3 가중치) — 앞에서부터 공개.
const POS_KEY: Record<Position, RKey[]> = {
  S: ['set', 'dig', 'serve'],
  OH: ['spike', 'receive', 'serve'],
  OP: ['spike', 'serve', 'block'],
  MB: ['block', 'spike', 'serve'],
  L: ['dig', 'receive'],
};

const REVEAL_CAP = 3; // 윗단 6개 중 최대 3개(~50%)

/** reveal → 공개 스탯 개수(0.2 미만=0, 최고=3, ≤포지션 키수). */
export function revealedCount(position: Position, reveal: number): number {
  if (reveal < 0.2) return 0;
  const n = Math.min(REVEAL_CAP, Math.max(1, Math.round(reveal * 3.3)));
  return Math.min(n, POS_KEY[position].length);
}

export interface RevealedStat { key: RKey; label: string; value: number; text: string; exact: boolean }

/** 스카우터가 공개한 부분 포텐(미래 윗단 rating) — 포지션 핵심부터 count개, 범위→등급↑ 축소→최상급 정확. */
export function revealedPotential(p: Player, reveal: number): RevealedStat[] {
  const count = revealedCount(p.position, reveal);
  if (count === 0) return [];
  const potR = deriveRatings({ ...p, ...p.potential }); // 미래 윗단(전 스탯이 천장일 때)
  const w = reveal >= 0.92 ? 0 : Math.max(2, Math.round((1 - reveal) * 12)); // 범위폭(정밀=0)
  const out: RevealedStat[] = [];
  for (let i = 0; i < count; i++) {
    const rk = POS_KEY[p.position][i];
    const v = Math.round(potR[rk]);
    out.push({
      key: rk, label: RATING_LABEL[rk], value: v, exact: w === 0,
      text: w === 0 ? `${v}` : `${Math.max(0, v - w)}~${Math.min(99, v + w)}`,
    });
  }
  return out;
}

/** AI 평가·검증용 — 공개된 부분 포텐의 평균(0~100). 아무것도 안 공개면 null(천장 못 봄). ※표시 금지(비스칼라 원칙)·내부용. */
export function revealedPotentialAvg(p: Player, reveal: number): number | null {
  const rs = revealedPotential(p, reveal);
  if (!rs.length) return null;
  return rs.reduce((s, r) => s + r.value, 0) / rs.length;
}
