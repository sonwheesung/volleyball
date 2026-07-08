// 은퇴 판정 (FA_SYSTEM 1.2). 순수 함수 + 시드 결정론.
// 나이 + 능력(OVR, 시대상대) + 대기만성/헤드룸 보호. 리그 정년 40세(하드월).
//
// 설계(2026-07-08 재정비):
//   1) age < 30            → 0
//   2) age >= RETIRE_AGE   → 1 (리그 정년 — 무조건 은퇴)
//   3) 30~39: 시대상대 기준선 HIGH = medOvr + HIGH_DELTA 기준
//        ovr >= HIGH       → 0 (기량 지키면 39세까지 은퇴 없음 — 사용자 결정)
//        ovr <  HIGH       → 연속곡선: chance = A(age) × (HIGH − ovr)
//          · A(age)는 30→39로 선형 증가(나이 많을수록 가파름)
//          · gap(=HIGH−ovr) 1점마다 항상 확률이 바뀜 → 전지훈련 +0.5 OVR이 어디서든 유효(절벽 금지)
//   4) 대기만성 특성 또는 성장 여지(비노쇠 헤드룸) 큰 선수 → ×LATE_MULT 감쇠(실데이터 기반)
//
// ★ rng 소비 불변(하드): 확률 0이든 1이든 국내 선수당 rng.chance() 정확히 1회.
//   외국인은 트라이아웃 별도 흐름 → 은퇴 루프에서 제외(rng 미소비 — 국내 스트림 불변).

import type { Player, TrainableStat } from '../types';
import type { Rng } from './rng';
import { overall } from './overall';
import { DECAY_STATS } from './aging';
import { TRAINABLE_STATS } from './training';

/** 리그 정년 — 이 나이 도달 시 무조건 은퇴(V리그 정년 로어). 계약 연한 캡의 상한이기도. */
export const RETIRE_AGE = 40;

/** 은퇴 곡선 파라미터(캘리브레이션 대상). 튜닝 시 env로 스윕 가능(앱/프로덕션은 미설정=기본값). */
export interface RetireParams {
  highDelta: number;   // HIGH = medOvr + highDelta (시대상대 기준선 — 이 이상 은퇴 0)
  aLo: number;         // age 30 기울기(gap 1점당 확률 증가분)
  aHi: number;         // age 39 기울기
  lateMult: number;    // 대기만성/헤드룸 보호 배수
  headroomSig: number; // 비노쇠 헤드룸 보호 임계(합)
  chanceCap: number;   // 확률 상한(병리적 극단에서만 발동 — 정상 범위 미접촉)
}

const envNum = (k: string, d: number): number => {
  const v = typeof process !== 'undefined' && process.env ? process.env[k] : undefined;
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

// 락된 기본값(2026-07-08 캘리브레이션 — simLeague A/B, δ 스윕 3/5/7 중 7 채택: 평균연령·신인유입·왕조 최건강).
//   aLo/aHi는 나이×gap 곡선 기울기 — 30~32 저OVR ≈6~21% / 39 저OVR ≈60% 목표에 맞춰 튜닝(실측 tools/_dv_retire_curve.ts). env는 스윕 전용(앱 미설정).
export const RETIRE_PARAMS: RetireParams = {
  highDelta: envNum('RT_DELTA', 7),
  aLo: envNum('RT_ALO', 0.008),
  aHi: envNum('RT_AHI', 0.065),
  lateMult: envNum('RT_LATE', 0.5),
  headroomSig: envNum('RT_HEAD', 78),
  chanceCap: envNum('RT_CAP', 0.97),
};

const NONDECAY_STATS: TrainableStat[] = TRAINABLE_STATS.filter((s) => !DECAY_STATS.includes(s));

/** 비노쇠(경험형) 스탯 성장 여지 합 = Σ max(0, 포텐−현재). 대기만성/미실현 잠재의 코스 프록시.
 *  ※ TRAIN_GAP(12) 때문에 30대 대부분 큰 값 → 보호는 상위 아웃라이어(headroomSig)만 잡도록 높게 설정. */
export function growthHeadroom(p: Player): number {
  let h = 0;
  for (const s of NONDECAY_STATS) h += Math.max(0, (p.potential[s] ?? 0) - ((p as unknown as Record<string, number>)[s] ?? 0));
  return h;
}

/** 은퇴 확률(0~1). medOvr = 리그 국내 OVR 중앙값(시대 앵커, offseason이 계산해 전달). */
export function retireChance(age: number, ovr: number, medOvr: number, P: RetireParams = RETIRE_PARAMS): number {
  if (age < 30) return 0;
  if (age >= RETIRE_AGE) return 1;                 // 리그 정년 — 하드월
  const high = medOvr + P.highDelta;
  if (ovr >= high) return 0;                        // 기량 지키면 은퇴 없음(39세까지)
  const gap = high - ovr;                           // > 0
  const ageT = (age - 30) / (RETIRE_AGE - 1 - 30);  // 30..39 → 0..1
  const slope = P.aLo + (P.aHi - P.aLo) * ageT;     // 나이 많을수록 가파름
  const chance = slope * gap;                        // gap 1점마다 항상 변화(절벽 없음)
  return Math.max(0, Math.min(P.chanceCap, chance));
}

/** 대기만성 특성 또는 큰 성장 여지 → 보호(실데이터 기반, 가짜 드라마 아님) */
export function retireProtect(p: Player, P: RetireParams = RETIRE_PARAMS): boolean {
  return !!p.traits?.includes('lateBloomer') || growthHeadroom(p) >= P.headroomSig;
}

/** 선수 1명의 은퇴 판정 — rng 정확히 1회 소비(확률 0/1 무관). */
export function retires(p: Player, rng: Rng, medOvr: number, P: RetireParams = RETIRE_PARAMS): boolean {
  let c = retireChance(p.age, overall(p), medOvr, P);
  if (c > 0 && c < 1 && retireProtect(p, P)) c *= P.lateMult; // 0/1 극단은 보호 무의미(정년·완전보전)
  return rng.chance(c);
}

/**
 * 롤오버 후 로스터에서 은퇴자를 제거한 새 로스터 + 은퇴자 id 목록.
 * snapshot = 나이 반영된 선수들(레지스트리). 순수.
 * ★ 외국인은 은퇴 루프에서 제외(트라이아웃 별도 흐름) — rng 미소비, keep 유지(하류 returningForeign이 분리).
 */
export function applyRetirements(
  rosters: Record<string, string[]>,
  snapshot: Record<string, Player>,
  rng: Rng,
  medOvr: number,
  P: RetireParams = RETIRE_PARAMS,
): { rosters: Record<string, string[]>; retired: string[] } {
  const nextRosters: Record<string, string[]> = {};
  const retired: string[] = [];
  for (const teamId of Object.keys(rosters)) {
    const keep: string[] = [];
    for (const id of rosters[teamId]) {
      const p = snapshot[id];
      if (p && p.isForeign) { keep.push(id); continue; } // 외인 제외(rng 미소비) — 국내 결정론 스트림 불변
      if (p && retires(p, rng, medOvr, P)) retired.push(id);
      else keep.push(id);
    }
    nextRosters[teamId] = keep;
  }
  return { rosters: nextRosters, retired };
}

/** 계약 연한 정년 캡 — firstSeasonAge(계약 첫 시즌 나이)부터 39세까지만 뛴다 → years ≤ RETIRE_AGE − firstSeasonAge.
 *  renewedContract/FA는 롤오버된 나이(=첫 시즌 나이)를, 인시즌 재계약(resignOptions)은 age+1을 넘긴다. 최소 1. */
export function capContractYears(firstSeasonAge: number, years: number): number {
  return Math.max(1, Math.min(years, RETIRE_AGE - firstSeasonAge));
}
