// 다이아 이코노미 순수 로직 (MONETIZATION §11) — 광고 게이트 · 업적 수령 · 전지훈련 적용.
// 락된 수치(2026-06-30): 전지훈련 300/부위 · 광고 50/30분쿨다운/하루8 · 업적 10~1000(ACH_REWARD).
// adState는 메타(시드/결정론 무관) — Date.now()는 호출부(store/UI)가 nowMs로 넘겨 순수 유지.
import type { Player, TrainableStat } from '../types';
import { achReward, type AchStatus } from './achievements';

export const CAMP_PER_STAT = 300;             // 전지훈련 부위당 다이아
export const AD_REWARD = 50;                   // 광고 1회 다이아
export const AD_COOLDOWN_MS = 30 * 60 * 1000;  // 30분 쿨다운
export const AD_DAILY_CAP = 8;                 // 하루 상한
export const WELCOME_DIAMONDS = 1000;          // 첫 전지훈련 진입 환영 선물(계정당 1회 — 서버 econ WELCOME_DIAMONDS와 일치)

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

/** (구 모델, 2026-06-30~07-01) 전지훈련 비용 — 부위당 300. 신규 사용 금지 — 구 campLog(stats[]) 재적용 전용. */
export const campCost = (stats: TrainableStat[]): number => CAMP_PER_STAT * stats.length;

/** (구 모델) 전지훈련 적용 — 선택 부위 각 현재 +1·포텐 +1(최대 99). 불변(클론).
 *  ※ 코스형 개편(§11.2, 2026-07-02) 후에도 유지 — 구 campLog 엔트리(stats[])의 시드 폴백 재적용이
 *  원 모델(+1/+1) 그대로 재현돼야 결정론이 보존된다(H3 — 과다적용 차단). */
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

// ── 코스형 전지훈련 (MONETIZATION §11.2 개편, 2026-07-02 — 독립리뷰 H1 반영) ──
// 15스탯 개별선택(+1/+1, OVR +0.06/부위 = 죽은 기능) → 5코스 택1(3스탯 현재+3·포텐+3, 2026-07-08~).
// H1: reaction은 스파이크/서브 레이팅 0기여(죽은 스탯) → 공격·서브 코스는 consistency로 교체.
//     블로킹 코스의 reaction은 블록 레이팅 0.18 기여라 유지.
export type CampCourse = 'attack' | 'defense' | 'block' | 'setter' | 'serve';
export const CAMP_COURSE_COST = 300;   // 코스 정액 300(2026-07-06 사용자 결정 — 구 900=3스탯×300에서 정액 인하). CAMP_PER_STAT(구 모델)와 분리
export const CAMP_CUR_GAIN = 3;        // 현재 +3 (사용자 결정 2026-07-08 — 구 +2. 포텐과 대칭, 즉효 체감 우선)
export const CAMP_POT_GAIN = 3;        // 포텐 +3 (사용자 결정 2026-07-08 — 구 +7이 오버밸런스라 현재와 동일 +3. 성장 후 실현 폭은 축소, 대신 3스탯 즉시 +3 체감을 선택)
// 소급 보존(H3): 이미 구매된 구 코스 엔트리(cur/pot 미임베드)는 구 산식으로 재적용해야 결정론이 깨지지 않는다.
// 신규 구매는 엔트리에 {cur,pot}를 임베드(applyCampLocal) → 미래 리밸런스도 소급 무영향(임베드 우선, 미존재 시 레거시 폴백).
export const CAMP_LEGACY_CUR_GAIN = 2; // 구 코스 엔트리(2026-07-02~07-07, cur/pot 필드 없음) 재적용용 — 소급 +2 보존
export const CAMP_LEGACY_POT_GAIN = 7; // 구 코스 엔트리 재적용용 — 소급 +7 보존

export const CAMP_COURSES: Record<CampCourse, { label: string; desc: string; stats: [TrainableStat, TrainableStat, TrainableStat]; forPos: string[] }> = {
  attack:  { label: '공격 특별훈련',  desc: '스파이크 결정력 집중 — 타점과 한 방의 안정감', stats: ['skSpike', 'jump', 'consistency'], forPos: ['OH', 'OP', 'MB'] },
  defense: { label: '수비 특별훈련',  desc: '디그·리시브 집중 — 코트를 넓게 커버',       stats: ['skDig', 'skReceive', 'agility'],   forPos: ['L', 'OH'] },
  block:   { label: '블로킹 특별훈련', desc: '네트 앞 벽 — 높이와 타이밍',               stats: ['skBlock', 'jump', 'reaction'],     forPos: ['MB', 'OP', 'OH'] },
  setter:  { label: '세터 특별훈련',  desc: '토스웍과 경기 읽기 — 팀 공격의 두뇌',        stats: ['skSet', 'focus', 'vq'],            forPos: ['S'] },
  serve:   { label: '서브 특별훈련',  desc: '서브 한 방 — 흐름을 끊는 무기',             stats: ['skServe', 'focus', 'consistency'], forPos: ['OH', 'OP', 'MB', 'S'] },
};

/** 코스 적용 — 3스탯 각 현재 +curGain·포텐 +potGain(최대 99). 불변(클론). 이미 99인 칸만 변화 없음.
 *  기본값 = 현행 상수(3/3, 신규 구매). 소급 재적용은 임베드된 {cur,pot} 또는 레거시(2/7)를 명시 전달해
 *  구 세이브가 원 산식대로 재현되게 한다(H3 결정론 — 미래 리밸런스도 소급 무영향). */
export function applyCampCourse(p: Player, course: CampCourse, curGain = CAMP_CUR_GAIN, potGain = CAMP_POT_GAIN): Player {
  const next: Player = { ...p, potential: { ...p.potential } };
  const cur = next as unknown as Record<string, number>;
  for (const s of CAMP_COURSES[course].stats) {
    cur[s] = Math.min(99, (cur[s] ?? 0) + curGain);
    next.potential[s] = Math.min(99, (next.potential[s] ?? cur[s]) + potGain);
  }
  return next;
}

/** 코스가 아직 의미 있나 — 3스탯 중 하나라도 현재<99 또는 포텐<99면 보낼 가치 있음(화면 가드). */
export const courseUpgradable = (p: Player, course: CampCourse): boolean =>
  CAMP_COURSES[course].stats.some((s) => (p as unknown as Record<string, number>)[s] < 99 || (p.potential[s] ?? 99) < 99);
