// 성장 상태(추상 표시) — 선수 상세에 "성장 중/빠르게 성장 중/정체/잠재력에 근접"을 보여준다(GPT ③, 2026-07-04).
// 숫자는 숨긴 채 성장 여력을 한 눈에. 내 팀 선수만(포텐 공개). 결정론(현재 스탯·포텐·나이 파생, 저장 없음).
import type { Player } from '../types';
import { TRAINABLE_STATS } from '../engine/training';

export type OutlookTone = 'fast' | 'growing' | 'near' | 'plateau';
export interface GrowthOutlook { label: string; tone: OutlookTone }

/** 남은 성장 여력(포텐−현재 평균)과 나이로 성장 상태를 분류. */
export function growthOutlook(p: Player): GrowthOutlook {
  const stats = p as unknown as Record<string, number>;
  let headSum = 0;
  for (const s of TRAINABLE_STATS) {
    const pot = p.potential?.[s] ?? stats[s];
    headSum += Math.max(0, pot - stats[s]);
  }
  const avgHead = headSum / TRAINABLE_STATS.length; // 스탯당 평균 남은 여력

  if (avgHead < 1.2) return { label: '잠재력에 근접', tone: 'near' };       // 거의 완성 — 더 클 곳이 적다
  if (avgHead >= 4 && p.age <= 22) return { label: '빠르게 성장 중', tone: 'fast' }; // 어리고 여력 큼
  if (p.age <= 32) return { label: '성장 중', tone: 'growing' };            // 아직 성장기(기술은 30대 초까지 완만↑)
  return { label: '정체', tone: 'plateau' };                                 // 노장·여력 소진 — 신체는 하락기
}
