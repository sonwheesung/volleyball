// /api/admin/stats — 운영 대시보드 지표(BACKEND_SYSTEM §13.15, #46). requireAdmin(fail-closed).
// 가용 실데이터로 산출: KPI(총가입·최근접속·DAU·신규) + 14일 시계열(신규가입·DAU·매출) + 시간대별 접속.
//   ※ lastSeenAt은 로그인 시 갱신(하트비트 미구현) → "실시간/시간대별 접속"은 로그인 기준 근사. 매출은 statsDaily(결제 #43 연동 전 0).
//   ※ 현재 non-deleted 유저를 fetch해 JS 버킷팅 — 대규모 시 SQL group by로 전환(TODO). 관리자 전용·저빈도라 허용.
import { NextResponse } from 'next/server';
import { and, eq, isNull, gte } from 'drizzle-orm';
import { db } from '../../../../db';
import { users, statsDaily } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

const DAYS = 14;
const MD = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const YMD = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const now = Date.now();
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const m30 = new Date(now - 30 * 60 * 1000);

    // 14일 날짜 버킷(UTC, 과거→오늘)
    const days: { key: string; label: string }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) { const d = new Date(dayStart.getTime() - i * 86400000); days.push({ key: YMD(d), label: MD(d) }); }
    const idx = new Map(days.map((d, i) => [d.key, i]));

    // 유저 타임스탬프(현재 non-deleted) — 신규가입/DAU/시간대 버킷 원천
    const rows = await db.select({ c: users.createdAt, l: users.lastSeenAt }).from(users)
      .where(and(eq(users.projCode, PROJ_CODE), isNull(users.deletedAt)));

    const newUsers = new Array(DAYS).fill(0);
    const dau = new Array(DAYS).fill(0);
    const hourly = new Array(24).fill(0);
    let totalUsers = 0, active30m = 0, dauToday = 0, newToday = 0;
    for (const r of rows) {
      totalUsers++;
      if (r.c) { const k = YMD(new Date(r.c)); const i = idx.get(k); if (i !== undefined) newUsers[i]++; if (r.c.getTime() >= dayStart.getTime()) newToday++; }
      if (r.l) {
        const lt = r.l.getTime();
        if (lt >= m30.getTime()) active30m++;
        if (lt >= dayStart.getTime()) dauToday++;
        const k = YMD(new Date(r.l)); const i = idx.get(k); if (i !== undefined) dau[i]++;
        hourly[new Date(r.l).getUTCHours()]++;
      }
    }

    // 매출 시계열(statsDaily, 결제 #43 연동 전엔 0) — 최근 14일
    const sd = await db.select().from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), gte(statsDaily.day, days[0].key)));
    const revenue = new Array(DAYS).fill(0);
    for (const s of sd) { const i = idx.get(String(s.day)); if (i !== undefined) revenue[i] = s.revenueKrw; }
    const revenueToday = revenue[DAYS - 1] ?? 0;

    return NextResponse.json({
      ok: true,
      kpi: { totalUsers, active30m, dauToday, newToday, revenueToday },
      labels: days.map((d) => d.label),
      series: { newUsers, dau, revenue },
      hourly,
    });
  } catch (e) {
    reportError(e, 'admin/stats');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
