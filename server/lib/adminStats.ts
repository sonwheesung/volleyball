// 관리자 통계 순수 집계 (BACKEND_SYSTEM §13.30 G) — DB 무의존. `/api/admin/stats` 라우트의 유저 버킷팅을 여기로 뽑았다.
//
// 왜 분리했나: 내부(운영자) 계정 제외가 **라우트 안에 인라인으로 흩어지면 검증이 불가능**하다.
//   순수 함수로 있어야 가드(`server/tools/_dv_internal.ts`)가 DB 없이 A/B(내부 1명 섞기 → 제외 전후 차이)를 돌린다.
//   CLAUDE §11 SOLID(단일 책임 · 계약 타입에만 의존)와 같은 결 — 라우트는 "가져오기+응답", 여기는 "세기".
//
// ★ 규약: 이 파일은 Date·숫자만 다룬다. drizzle·next·env를 import하지 않는다(그래야 가드가 그냥 돌아간다).
// ★ 내부 계정(§13.30): 기본 **제외**. `includeInternal`이면 포함. 제외한 인원수는 `internalExcluded`로 되돌려
//   화면이 "내부 n명 제외"를 **고지**한다 — 숫자가 조용히 달라지는 게 가장 위험하다.

// dates.ts 는 순수 날짜 산술(db·next·env 무의존)이라 이 모듈의 'DB 무의존' 계약을 깨지 않는다.
import { kstYmd, kstHour } from './dates';

/** 집계 입력 — users 테이블에서 뽑는 최소 필드(계약). */
export interface UserRow {
  createdAt: Date | null;
  lastSeenAt: Date | null;
  internal: boolean;
}

export interface AggregateOpts {
  now: number;          // 기준 시각(ms)
  dayStartMs: number;   // 오늘 00:00 UTC(ms) — 라우트와 동일 규약(§13.15: 날짜 경계 UTC)
  dayKeys: string[];    // 14일 시계열 키(YYYY-MM-DD, 과거→오늘)
  includeInternal: boolean;
}

export interface UserAgg {
  totalUsers: number;
  active30m: number;
  dauToday: number;
  mau: number;
  wau: number;
  newToday: number;
  inactive: number;
  newUsers: number[];
  dau: number[];
  hourly: number[];
  retDen: Record<number, number>;
  retNum: Record<number, number>;
  /** 이번 집계에서 제외된 내부 계정 수(includeInternal이면 항상 0). 화면 고지용. */
  internalExcluded: number;
}

/** 리텐션 근사 구간(일) — §13.15: lastSeenAt 기반 근사이지 정밀 코호트가 아니다. */
export const RET_DAYS = [1, 3, 7, 14, 30] as const;

// KST 기준(§13.15 시간대 정정) — 라우트가 넘기는 dayKeys 도 KST 날짜라 여기서 같은 규약을 써야 맞물린다.
const YMD = kstYmd;

/**
 * 내부 계정을 걸러야 하는가 — 원장/이벤트처럼 userId만 있는 행에 쓴다.
 * 라우트마다 `!includeInternal && internalIds.has(u)`를 손으로 다시 쓰면 한 군데를 빠뜨린다(§13.30 G②의 회귀 대상).
 */
export function isExcludedUser(userId: string, internalIds: ReadonlySet<string>, includeInternal: boolean): boolean {
  return !includeInternal && internalIds.has(userId);
}

/** 유저 행 → KPI·시계열 버킷. 순수(입력만 읽고 아무것도 안 건드림). */
export function aggregateUsers(rows: readonly UserRow[], opts: AggregateOpts): UserAgg {
  const { now, dayStartMs, dayKeys, includeInternal } = opts;
  const DAYS = dayKeys.length;
  const idx = new Map(dayKeys.map((k, i) => [k, i]));

  const m30 = now - 30 * 60 * 1000;
  const mauFrom = now - 30 * 86400000;
  const wauFrom = now - 7 * 86400000;
  const inactBefore = now - 14 * 86400000;

  const newUsers = new Array(DAYS).fill(0);
  const dau = new Array(DAYS).fill(0);
  const hourly = new Array(24).fill(0);
  const retDen: Record<number, number> = { 1: 0, 3: 0, 7: 0, 14: 0, 30: 0 };
  const retNum: Record<number, number> = { 1: 0, 3: 0, 7: 0, 14: 0, 30: 0 };

  let totalUsers = 0, active30m = 0, dauToday = 0, newToday = 0, inactive = 0, mau = 0, wau = 0, internalExcluded = 0;

  for (const r of rows) {
    if (r.internal && !includeInternal) { internalExcluded++; continue; } // ← §13.30 단일 제외 지점
    totalUsers++;

    if (r.createdAt) {
      const ct = r.createdAt.getTime();
      const i = idx.get(YMD(r.createdAt));
      if (i !== undefined) newUsers[i]++;
      if (ct >= dayStartMs) newToday++;
      for (const k of RET_DAYS) {
        const thresh = ct + k * 86400000;
        if (now >= thresh) { retDen[k]++; if (r.lastSeenAt && r.lastSeenAt.getTime() >= thresh) retNum[k]++; }
      }
    }

    if (r.lastSeenAt) {
      const lt = r.lastSeenAt.getTime();
      if (lt >= m30) active30m++;
      if (lt >= dayStartMs) dauToday++;
      if (lt >= mauFrom) mau++;
      if (lt >= wauFrom) wau++;
      if (lt < inactBefore) inactive++;
      const i = idx.get(YMD(r.lastSeenAt));
      if (i !== undefined) dau[i]++;
      hourly[kstHour(r.lastSeenAt)]++; // KST 시(0~23)
    }
  }

  return { totalUsers, active30m, dauToday, mau, wau, newToday, inactive, newUsers, dau, hourly, retDen, retNum, internalExcluded };
}

/** 리텐션 % (분모 0이면 null = 표본 부족). */
export function retentionPct(agg: UserAgg, k: number): number | null {
  const den = agg.retDen[k] ?? 0;
  return den > 0 ? Math.round(((agg.retNum[k] ?? 0) / den) * 1000) / 10 : null;
}
