// /api/admin/stats — 운영 대시보드 지표(BACKEND_SYSTEM §13.15, #46). requireAdmin(fail-closed).
// 가용 실데이터로 산출: KPI(총가입·최근접속·DAU·신규·탈퇴·비활성·결제전환) + 14일 시계열(신규가입·DAU·매출·광고) + 시간대별 접속.
//   ※ lastSeenAt은 로그인 시 갱신(하트비트 미구현) → "실시간/시간대별 접속"은 로그인 기준 근사. 매출은 statsDaily(결제 #43 연동 전 0).
//   ※ 업적 달성율은 클라이언트 계산(결정론 격리 — 서버 미보유). 별도 텔레메트리 필요.
//   ※ 유저/원장을 fetch해 JS 버킷팅 — 대규모 시 SQL group by로 전환(TODO). 관리자 전용·저빈도라 허용.
import { NextResponse } from 'next/server';
import { and, eq, isNull, isNotNull, gte, count } from 'drizzle-orm';
import { db } from '../../../../db';
import { users, statsDaily, walletLedger } from '../../../../db/schema';
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
    const inact = new Date(now - 14 * 86400000); // 14일+ 미접속 = 비활성
    const win = new Date(dayStart.getTime() - (DAYS - 1) * 86400000); // 14일 시계열 시작

    const days: { key: string; label: string }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) { const d = new Date(dayStart.getTime() - i * 86400000); days.push({ key: YMD(d), label: MD(d) }); }
    const idx = new Map(days.map((d, i) => [d.key, i]));

    // 유저(현재 non-deleted) — 신규가입/DAU/시간대/비활성 버킷 원천
    const rows = await db.select({ c: users.createdAt, l: users.lastSeenAt }).from(users)
      .where(and(eq(users.projCode, PROJ_CODE), isNull(users.deletedAt)));
    const newUsers = new Array(DAYS).fill(0), dau = new Array(DAYS).fill(0), hourly = new Array(24).fill(0);
    let totalUsers = 0, active30m = 0, dauToday = 0, newToday = 0, inactive = 0;
    for (const r of rows) {
      totalUsers++;
      if (r.c) { const i = idx.get(YMD(new Date(r.c))); if (i !== undefined) newUsers[i]++; if (r.c.getTime() >= dayStart.getTime()) newToday++; }
      if (r.l) {
        const lt = r.l.getTime();
        if (lt >= m30.getTime()) active30m++;
        if (lt >= dayStart.getTime()) dauToday++;
        if (lt < inact.getTime()) inactive++;
        const i = idx.get(YMD(new Date(r.l))); if (i !== undefined) dau[i]++;
        hourly[new Date(r.l).getUTCHours()]++;
      }
    }

    // 탈퇴(소프트삭제) 수
    const [wd] = await db.select({ n: count() }).from(users).where(and(eq(users.projCode, PROJ_CODE), isNotNull(users.deletedAt)));
    const withdrawn = wd?.n ?? 0;

    // 매출 시계열(statsDaily, 결제 #43 연동 전 0)
    const sd = await db.select().from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), gte(statsDaily.day, days[0].key)));
    const revenue = new Array(DAYS).fill(0);
    for (const s of sd) { const i = idx.get(String(s.day)); if (i !== undefined) revenue[i] = s.revenueKrw; }

    // 광고 시청(원장 reason='ad', 각 +50) — 14일 시계열 + 오늘 건수/시청자
    const adRows = await db.select({ c: walletLedger.createdAt, u: walletLedger.userId }).from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'ad'), gte(walletLedger.createdAt, win)));
    const adSeries = new Array(DAYS).fill(0);
    let adToday = 0; const adUsersToday = new Set<string>();
    for (const r of adRows) { const i = idx.get(YMD(new Date(r.c))); if (i !== undefined) adSeries[i]++; if (r.c.getTime() >= dayStart.getTime()) { adToday++; adUsersToday.add(r.u); } }

    // 결제 전환율(원장 reason='purchase' 고유 결제자 / 총가입) — 결제 #43 전엔 0
    const payerRows = await db.selectDistinct({ u: walletLedger.userId }).from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'purchase')));
    const payers = payerRows.length;
    const conversion = totalUsers > 0 ? Math.round((payers / totalUsers) * 1000) / 10 : 0; // %

    return NextResponse.json({
      ok: true,
      kpi: {
        totalUsers, active30m, dauToday, newToday, withdrawn, inactive,
        revenueToday: revenue[DAYS - 1] ?? 0, adToday, adUsersToday: adUsersToday.size, payers, conversion,
      },
      labels: days.map((d) => d.label),
      series: { newUsers, dau, revenue, ad: adSeries },
      hourly,
    });
  } catch (e) {
    reportError(e, 'admin/stats');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
