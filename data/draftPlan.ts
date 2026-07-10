// 드래프트 지명권 계획(보유 vs 행사 예정) — 준비 화면/라이브 헤더 정보 전달(UI_RULES DL-1·DL-2, 2026-07-10).
//   "지명권 4장인데 왜 1명만 뽑나?" 의문 제거: **보유 지명권**(권리 — 4라운드 고정, 로스터 무관)과
//   **예상 지명/PASS**(행사 예정 — 현재 선수단 기준 자동 판정)를 분리 표시.
//   순수·결정론·표시 전용(엔진/세이브 불침투 — FA_SYSTEM §3.3·§7 "엔진 격리·무저장"과 동일 패턴).
//   예상은 mySelections=[] 자연 진행(내가 개입하지 않을 때) 투영 — 라이브에서 개입하면 결과가 달라질 수 있는
//   "예상"임을 화면 문구가 유지한다(가짜 확정 금지). 실제 지명(resolveDraft)이 유일한 진실.
import type { CoachStyle, Player } from '../types';
import { resolveDraft } from '../engine/draft';
import { positionGap } from '../engine/aiGM';
import { ROSTER_CONTRACT_CAP } from '../engine/transactions';
import { getTeam, teamScoutReveal } from './league';
import { aiTargetOf } from './rosterTarget';
import type { DraftContext } from './draftSetup';

export interface DraftPlan {
  slots: number;          // 보유 지명권(= 내 order 슬롯 수 = DRAFT_ROUNDS 고정, 로스터 무관)
  slotNos: number[];      // 지명 순번(1-based order 위치)
  expectedPicks: number;  // 예상 지명 수(mySelections=[] 자연 투영)
  expectedPasses: number; // 예상 PASS 수(= slots − expectedPicks)
  passRounds: number[];   // 예상 PASS 라운드(1-based, prefix tail — 지명 뒤로 몰림)
}

const styleOf = (tid: string): CoachStyle => getTeam(tid)?.coachStyle ?? 'balanced';

/**
 * 준비 화면 투영 — 내가 개입하지 않고(mySelections 비움) 찜(wishlist)만 반영해 진행할 때 예상 지명/PASS.
 * 라이브 초기 시퀀스(mySelections=[])와 동일 입력이라 준비↔라이브 예상이 일치한다.
 */
export function myDraftPlan(ctx: DraftContext, my: string, wishlist: string[]): DraftPlan {
  const lk = (id: string): Player | undefined => ctx.snapshot[id]; // resolveDraft 내부 clsById가 신인 커버
  const res = resolveDraft(ctx.order, ctx.cls, ctx.rosters, lk, my, wishlist, styleOf, teamScoutReveal, [], aiTargetOf());
  const expectedPicks = res.sequence.filter((s) => s.teamId === my).length;
  const slots = ctx.order.filter((t) => t === my).length;
  const expectedPasses = Math.max(0, slots - expectedPicks);
  // prefix 불변식(aiShouldPass round≤2 무조건 지명 + 로스터 단조↑ + target/문턱 sticky → 지명=라운드 1..M, 나머지 PASS).
  //   _dv_draftplan 가드가 order↔sequence ground truth로 이 prefix를 교차검증(draftSummary와 같은 결).
  const passRounds: number[] = [];
  for (let r = expectedPicks + 1; r <= slots; r++) passRounds.push(r);
  const slotNos = ctx.order.reduce<number[]>((a, t, i) => (t === my ? [...a, i + 1] : a), []);
  return { slots, slotNos, expectedPicks, expectedPasses, passRounds };
}

export type PassReason = 'deep' | 'full' | 'neutral';

/**
 * 내 PASS 사유(실 지명 결과 기준) — **실제 판정 요인**(로스터 충분/가득)에서만 결정(가짜 드라마 금지).
 * PASS는 prefix tail(내 지명 뒤)이라 최종 로스터(초기 + 내 지명 전부)가 곧 PASS 시점 로스터 = 정확.
 *   full   = 계약 상한(20) 도달(로스터 가득)
 *   deep   = 팀 목표 로스터 도달 OR 포지션 구멍 없이 충분(aiShouldPass 패스 경로)
 *   neutral= 위 요인으로 설명 안 됨 → 중립 폴백(요인 날조 금지)
 */
export function passReasonFor(ctx: DraftContext, my: string, myPickedIds: string[]): PassReason {
  const clsById = new Map(ctx.cls.map((p) => [p.id, p]));
  const get = (id: string): Player | undefined => ctx.snapshot[id] ?? clsById.get(id);
  const roster = [...(ctx.rosters[my] ?? []), ...myPickedIds];
  const rosterLen = roster.length;
  if (rosterLen >= ROSTER_CONTRACT_CAP) return 'full';   // 계약 상한(20) — 로스터 가득
  if (rosterLen >= aiTargetOf()(my)) return 'deep';      // 팀 목표 로스터 도달
  const gap = positionGap(roster, get);
  const needCount = Object.values(gap).filter((g) => g > 0).length;
  return needCount === 0 ? 'deep' : 'neutral';           // 구멍 없이 충분 / 그 외 중립
}

/** PASS 사유 문구(UI). 로스터 충분/가득 → 실제 요인 문장, 그 외 → 중립 폴백(가짜 드라마 금지). */
export const PASS_REASON_COPY: Record<PassReason, string> = {
  deep: '현재 선수단이 충분하여 이번 라운드 지명을 포기했습니다',
  full: '현재 선수단이 충분하여 이번 라운드 지명을 포기했습니다',
  neutral: '로스터 상황을 고려해 이번 라운드는 지명을 진행하지 않았습니다',
};

/** 연속 라운드 배열 → "N" 또는 "N~M" 라벨(prefix tail이라 연속 보장). 빈 배열이면 ''. */
export function passRoundsLabel(passRounds: number[]): string {
  if (passRounds.length === 0) return '';
  const lo = passRounds[0], hi = passRounds[passRounds.length - 1];
  return lo === hi ? `${lo}` : `${lo}~${hi}`;
}
