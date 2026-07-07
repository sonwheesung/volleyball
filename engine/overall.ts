// 종합 능력치(OVR) 산출 — 포지션 가중치(CLAUDE.md 5.3)로 윗단 스탯을 블렌딩.
// 카드/목록 표시용 단일 숫자. 계수는 placeholder.

import type { Player, Position } from '../types';
import { deriveRatings, type Ratings } from './ratings';

/** 전 포지션 열거(런타임 배열) — 고정 순서 S·OH·OP·MB·L. 포지션 순회의 단일 출처.
 *  ※ 다른 순서가 필요한 곳(awards BEST7_SLOTS·draftClass POS_DIST 등)은 이걸 쓰지 말 것. */
export const ALL_POSITIONS: readonly Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

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

// ── 시대(era) 상대 앵커 — 단일 출처 (2026-07-02, EC-FA-06·SALARY 2장) ──
// 성장 곡선 개편(성장 C 등)으로 리그 OVR 분포가 이동하면 절대 OVR 임계(잔류 62·82, 연봉 앵커 55)가
// 암묵적으로 강/약화된다. 소비자는 medianOvr(리그 국내 중앙값)를 받아 MED_REF와의 차만큼 평행이동한다.

/** 상대 앵커 보정 기준 — 성장 C 직전(cf60ed6) 리그 국내 OVR 중앙값 실측(12시즌 안정 ~72, 2026-07-02). */
export const MED_REF = 72;

/** 국내 로스터 OVR 중앙값(상대 앵커 입력) — 분포 이동(성장 곡선 개편 등)에 잔류율·연봉 스케일이 견고하도록. */
export function medianOvr(players: Player[]): number {
  if (!players.length) return MED_REF;
  const v = players.map((p) => overall(p)).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

// 표시 전용 OVR 스케일 — overall()/teamOverall()(엔진·AI 정렬·은퇴/aiGM·스케줄 절대 임계값용)은
// 그대로 두고, UI 카드/목록 표시에만 적용한다. 원시 OVR이 좁은 밴드(선수 56~84, 평균 69)에 압축돼
// "프로답지 않게" 낮아 보이던 것을, 프로 스케일(신입 ~70 · 평균 ~80 · 최고 90+)로 옮긴다.
//   원시 평균 69 → 표시 80, 기울기 1.15(OVR_SLOPE). 90+는 원시 ~80↑(상위 ~2%) = 리그 2~3명, 황금기 5+·침체기 0
//   (고정 매핑 + 원시 분포의 자연 변동 → 시대별 천재 수가 알아서 출렁임). 100년 무드리프트.
// ★ 입력은 "연속값"(overallRaw/teamOverallRaw) — 정수 넣으면 같은 값끼리 안 갈라짐. 단조라 순위·상관 불변.
// (tools/ovrDist 측정 근거)
const OVR_PIVOT_RAW = 69;   // 원시 평균
const OVR_PIVOT_DISP = 80;  // → 표시 평균
const OVR_SLOPE = 1.15;     // 90+를 상위 ~2%(리그 2~3명)로, 신입/약체는 하한 69 근처로
export function displayOvr(rawContinuous: number): number {
  return Math.round(Math.max(69, Math.min(99, OVR_PIVOT_DISP + (rawContinuous - OVR_PIVOT_RAW) * OVR_SLOPE)));
}

// ─── 스카우팅 안개(공개도) — 내 팀 외(타 구단 선수·드래프트 유망주) 능력을 스카우터 공개도(reveal 0~1)만큼만 보여줌.
//   내 팀은 항상 reveal=1(전부 보임, 포텐까지). 표시 전용·결정론 무관(엔진 scoutMult는 별개로 유지).
//   STAFF_SYSTEM(스카우터 역할)·UI_RULES. draft.tsx도 이 헬퍼를 공유(중복 제거).

// 스카우팅 공개도 임계(단일 출처) — 모든 fog 게이트가 공유(리터럴 산재 방지, EC-DR-03 계열).
export const REVEAL_PRECISE = 0.92; // 이 이상 = 정밀(정확치 노출)
export const REVEAL_MID = 0.5;      // 이 이상 = 중간(대략치), 미만 = 물음표

/** 표시 OVR을 공개도로 흐리게 — 정밀(≥REVEAL_PRECISE)이면 정확값, 아니면 범위("78~84"). 입력=displayOvr 값.
 *  fogOvr 정본(단일 구현) — data/prospectScout(유망주)·app 트라이아웃이 이 함수를 공유한다. */
export function fogOvr(displayValue: number, reveal: number): string {
  if (reveal >= REVEAL_PRECISE) return `${displayValue}`;
  const w = Math.max(2, Math.round((1 - reveal) * 14));
  const lo = Math.max(50, displayValue - w);
  const hi = Math.min(99, displayValue + w);
  return `${lo}~${hi}`;
}

/** 0~100 스탯을 공개도로 흐리게. fill=막대 채움(null=불명), text=표시 숫자. 정밀(≥PRECISE)=정확, 중간(≥MID)=대략(~70), 낮음=물음표. */
export function fogStat(value: number, reveal: number): { fill: number | null; text: string; exact: boolean } {
  if (reveal >= REVEAL_PRECISE) return { fill: value, text: `${value}`, exact: true };
  if (reveal >= REVEAL_MID) { const coarse = Math.round(value / 10) * 10; return { fill: coarse, text: `~${coarse}`, exact: false }; }
  return { fill: null, text: '?', exact: false };
}
