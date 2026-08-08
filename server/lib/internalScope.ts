// 내부(운영자·QA·지인 = **실유저로 셀 수 없는**) 계정 제외 스코프 — 관리자 **집계** 라우트의 공용 진입점 (BACKEND_SYSTEM §13.30).
//
// 왜 공용인가: 라우트마다 `internal=false` 조건과 `internalIds` Set을 손으로 다시 쓰면
//   **반드시 한 곳을 빠뜨린다**(실제로 Phase 1에서 stats만 적용해 업적·BM·시계열에 내부 계정이 남았고,
//   사용자가 화면에서 발견했다). 스코프 계산을 여기 한 곳으로 모으고, 가드가 "모든 집계 라우트가 이걸 쓰는가"를 봉인한다.
//
// ★ 적용 경계(설계 결정)
//   · **집계·지표**(stats·achievements·series·bm) → 제외한다. 이게 "우리 게임이 어떻게 되고 있나"를 왜곡하기 때문.
//   · **개별 레코드 목록**(users·payments·payment-events·tickets·mail) → **제외하지 않는다.**
//     운영자는 내부 계정의 실제 행을 봐야 한다(내 테스트 결제가 원장에 제대로 꽂혔나). 대신 목록에 '내부' 표시를 단다.
//   · **텔레메트리** → 제외 **불가**. analyticsId가 HMAC 가명이라 users와 조인 자체가 안 된다(§13.27 가명화의 의도된 대가).
//   · **매출(statsDaily)** → 제외 **불가**. userId 없는 사전 롤업.
//
// ★ 이 축은 재화·결제·게임플레이에 일절 무관하다(순수 조회 필터).
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { PROJ_CODE } from './proj';

export interface InternalScope {
  /** ?includeInternal=1 이면 true — 내부 계정을 관찰해야 할 때만 쓴다. */
  includeInternal: boolean;
  /** 내부 계정 id 집합(includeInternal이면 비어 있음). 원장·이벤트처럼 userId만 있는 행을 거를 때. */
  ids: Set<string>;
  /** 제외된 내부 계정 수 — 화면 고지 배지용(숨김이 아니라 제외+고지). */
  excluded: number;
}

/** 요청에서 내부 제외 스코프를 만든다. 집계 라우트는 맨 앞에서 이걸 한 번 부른다. */
export async function internalScope(req: Request): Promise<InternalScope> {
  const includeInternal = new URL(req.url).searchParams.get('includeInternal') === '1';
  if (includeInternal) return { includeInternal: true, ids: new Set(), excluded: 0 };
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.projCode, PROJ_CODE), eq(users.internal, true)));
  const ids = new Set(rows.map((r) => r.id));
  return { includeInternal: false, ids, excluded: ids.size };
}

/** 이 userId 행을 집계에서 빼야 하는가. */
export function isExcluded(scope: InternalScope, userId: string | null | undefined): boolean {
  return !scope.includeInternal && !!userId && scope.ids.has(userId);
}

/**
 * 응답에 실을 고지 블록. `notApplied`는 **이 라우트에서 제외가 닿지 않는 지표**를 적는다
 * (조용한 불일치 금지 — 화면이 그대로 각주로 띄운다).
 */
export function internalMeta(scope: InternalScope, notApplied: string[] = []) {
  return { excluded: scope.excluded, included: scope.includeInternal, notApplied };
}
