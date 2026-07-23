// 다이아 이코노미 순수 로직 (MONETIZATION §11) — 광고 게이트 · 업적 수령 · 전지훈련 적용.
// 락된 수치: 전지훈련 300/부위 · 광고 50/2시간쿨다운(2026-07-17 사용자 결정, 구 30분)/하루8 · 업적 10~1000(ACH_REWARD).
// adState는 메타(시드/결정론 무관) — Date.now()는 호출부(store/UI)가 nowMs로 넘겨 순수 유지.
import type { Player, TrainableStat } from '../types';
import { achReward, type AchStatus } from './achievements';

export const CAMP_PER_STAT = 300;             // 전지훈련 부위당 다이아
export const AD_REWARD = 50;                   // 광고 1회 다이아
export const AD_COOLDOWN_MS = 2 * 60 * 60 * 1000;  // 2시간 쿨다운(2026-07-17 사용자 결정 — 구 30분. 서버 백스톱 server/lib/econ AD_COOLDOWN_MS와 일치)
export const AD_DAILY_CAP = 8;                 // 하루 상한
export const WELCOME_DIAMONDS = 1000;          // 첫 전지훈련 진입 환영 선물(계정당 1회 — 서버 econ WELCOME_DIAMONDS와 일치)

// ── 다이아 출석 패스 클라 표시 미러(ATTENDANCE_PASS_SYSTEM §2.1·§10 — 서버 server/lib/econ 손복제) ──
// 지급량·창·리셋·유예의 **진실은 서버**(§13.12). 여기 값은 표시/게이팅용 미러이며, 드리프트는 가드 `tools/_dv_walletauth`가
//   engine↔server 대조로 못 박는다(광고·CAMP 미러 패턴과 동일). 결정(수령·창 판정)은 절대 이 값으로 하지 않는다(서버 라우트 권위).
export const PASS_DAILY_REWARD = 100;                                 // 하루 수령 💎(dayIndex 슬롯당)
export const PASS_DURATION_DAYS = 28;                                 // 창 길이(dayIndex 0~27 = 28슬롯)
export const PASS_MAX_TOTAL = PASS_DAILY_REWARD * PASS_DURATION_DAYS; // 2800 — 28일 완주 파생(표시 상한)
export const PASS_PRICE_KRW = 9900;                                   // 표시가(스토어 등록값이 실청구 정본)
export const PASS_RESET_HOUR_KST = 0;                                 // Q6 재확정(2026-07-23) — 일일 리셋 KST 00:00(자정). 우편 30일 보존이 04시 보호를 대체
// PASS_GRACE_DAYS 폐기(Q5 재확정 2026-07-23) — 일일 지급이 스케줄러 우편 발송으로 바뀌며 미수령 유예 개념 소멸(우편 30일 보관이 대체).

/** 'YYYY-MM-DD' 사이 정수 일수(표시용 순수 산술 — UTC 자정 앵커라 타임존 무관, 서버 dates.diffDays 미러). */
export function passDaysBetween(fromStr: string, toStr: string): number {
  const a = Date.parse(`${fromStr}T00:00:00Z`);
  const b = Date.parse(`${toStr}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export interface PassView {
  dayNumber: number;     // 현재 며칠차(1~28, 클램프)
  daysRemaining: number; // 창 종료까지 남은 일수(D-N 표시, 만료 후 0)
  expired: boolean;      // 오늘 > endDate(창 종료 후)
  expiringSoon: boolean; // 만료 임박(D-3부터 — 인앱 배너 유도, §UI.1)
}

/** 활성 패스 표시 뷰(순수) — endDate(서버 진실)와 today(리셋보정, UI가 계산해 주입)로 며칠차·남은일을 파생.
 *  start = endDate − (DURATION−1). 결정이 아니라 표시(캡션·스탬프·배너 게이트)만. today는 lib/passClient.todayKstReset()이 준다.
 *  유예(graceLeft) 폐기(2026-07-23) — 미수령분은 우편함 30일 보존이 담당(스케줄러 우편 전환). */
export function passView(endDate: string, today: string): PassView {
  const start = addDaysStr(endDate, -(PASS_DURATION_DAYS - 1));
  const off = passDaysBetween(start, today);          // 시작 이후 경과 오프셋(만료 후 27 초과 가능)
  const dayNumber = Math.min(PASS_DURATION_DAYS, Math.max(1, off + 1));
  const toEnd = passDaysBetween(today, endDate);      // 종료까지(음수면 만료)
  const daysRemaining = Math.max(0, toEnd + 1);        // 오늘 포함 남은일(오늘=endDate면 1)
  const expired = toEnd < 0;
  const expiringSoon = !expired && daysRemaining <= 3;
  return { dayNumber, daysRemaining, expired, expiringSoon };
}

/** 'YYYY-MM-DD'에 n일(표시용 순수 — 서버 dates.addDays 미러). */
function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface AdState { dayIdx: number; count: number; lastAdAt: number }
export const FRESH_AD_STATE: AdState = { dayIdx: 0, count: 0, lastAdAt: 0 };

const dayOf = (ms: number): number => Math.floor(ms / 86_400_000);

/** 지금 광고를 볼 수 있나 — 2시간 쿨다운 + 하루 8회 상한. msLeft=다음 광고까지 남은 ms. */
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
export const CAMP_COURSE_COST = 200;   // 코스 정액 200(2026-07-17 사용자 결정 — 구 300; 앞서 2026-07-06 900→300). CAMP_PER_STAT(구 부위모델 300, 레거시 재적용 전용)와 분리. 서버 미러 server/lib/econ.CAMP_COST
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
