// 다이아 이코노미 순수 로직 (MONETIZATION §11) — 광고 게이트 · 업적 수령 · 전지훈련 적용.
// 락된 수치(2026-06-30): 전지훈련 300/부위 · 광고 50/30분쿨다운/하루8 · 업적 10~1000(ACH_REWARD).
// adState는 메타(시드/결정론 무관) — Date.now()는 호출부(store/UI)가 nowMs로 넘겨 순수 유지.
import type { Player, TrainableStat } from '../types';
import { achReward, type AchStatus } from './achievements';

export const CAMP_PER_STAT = 300;             // 전지훈련 부위당 다이아
export const AD_REWARD = 50;                   // 광고 1회 다이아
export const AD_COOLDOWN_MS = 30 * 60 * 1000;  // 30분 쿨다운
export const AD_DAILY_CAP = 8;                 // 하루 상한

export interface AdState { dayIdx: number; count: number; lastAdAt: number }
export const FRESH_AD_STATE: AdState = { dayIdx: 0, count: 0, lastAdAt: 0 };

const dayOf = (ms: number): number => Math.floor(ms / 86_400_000);

/** 지금 광고를 볼 수 있나 — 30분 쿨다운 + 하루 8회 상한. msLeft=다음 광고까지 남은 ms. */
export function canWatchAd(s: AdState, nowMs: number): { ok: boolean; reason?: 'cooldown' | 'cap'; msLeft: number; todayCount: number } {
  const today = dayOf(nowMs);
  const todayCount = s.dayIdx === today ? s.count : 0; // 날짜 바뀌면 카운트 리셋
  const msLeft = Math.max(0, AD_COOLDOWN_MS - (nowMs - s.lastAdAt));
  if (todayCount >= AD_DAILY_CAP) return { ok: false, reason: 'cap', msLeft: 0, todayCount };
  if (msLeft > 0) return { ok: false, reason: 'cooldown', msLeft, todayCount };
  return { ok: true, msLeft: 0, todayCount };
}

/** 광고 시청 1회 반영 — 새 adState + 지급 다이아(canWatchAd 통과 가정). */
export function grantAd(s: AdState, nowMs: number): { adState: AdState; reward: number } {
  const today = dayOf(nowMs);
  const todayCount = s.dayIdx === today ? s.count : 0;
  return { adState: { dayIdx: today, count: todayCount + 1, lastAdAt: nowMs }, reward: AD_REWARD };
}

/** 새로 달성됐는데 미수령인 업적 → 수령할 id들 + 다이아 합(1회 지급용). */
export function unclaimedReward(statuses: AchStatus[], claimed: Iterable<string>): { ids: string[]; total: number } {
  const claimedSet = new Set(claimed);
  const ids = statuses.filter((s) => s.unlocked && !claimedSet.has(s.ach.id)).map((s) => s.ach.id);
  const total = ids.reduce((sum, id) => sum + achReward(id), 0);
  return { ids, total };
}

/** 전지훈련 비용 — 부위당 300. */
export const campCost = (stats: TrainableStat[]): number => CAMP_PER_STAT * stats.length;

/** 전지훈련 적용 — 선택 부위 각 현재 +1·포텐 +1(최대 99). 불변(클론). 이미 99인 부위는 그 칸만 변화 없음. */
export function applyCamp(p: Player, stats: TrainableStat[]): Player {
  const next: Player = { ...p, potential: { ...p.potential } };
  const cur = next as unknown as Record<string, number>;
  for (const s of stats) {
    cur[s] = Math.min(99, (cur[s] ?? 0) + 1);
    next.potential[s] = Math.min(99, (next.potential[s] ?? cur[s]) + 1);
  }
  return next;
}

/** 아직 올릴 여지가 있는(현재<99 또는 포텐<99) 부위만 — 화면 선택 가드. */
export const upgradableStats = (p: Player, stats: TrainableStat[]): TrainableStat[] =>
  stats.filter((s) => (p as unknown as Record<string, number>)[s] < 99 || (p.potential[s] ?? 99) < 99);
