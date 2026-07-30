// /api/admin/telemetry — 시즌 종료 행동 텔레메트리 분석(§13.27). requireAdmin(fail-closed §13.15).
//   원천: season_telemetry(비식별 행동 카운트 jsonb). 결정론 격리 유지(통계 메타 — 시드/리플레이 무관).
//   반환: 전체 집계(agg) + 사용자별 롤업(users, 각 유저의 시즌별 payload 추이). payload는 클라(§13.27) v1 스키마.
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { seasonTelemetry, users } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

const FETCH_CAP = 5000;      // 집계 대상 행 상한(1행/유저/시즌 — 넉넉)
const USERS_CAP = 200;       // 롤업 반환 유저 상한(리포트 많은 순)
const SEASONS_PER_USER = 120; // 유저별 시즌 payload 상한(추이 표)

type P = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const subOf = (p: P): P => (typeof p.subs === 'object' && p.subs ? (p.subs as P) : {});

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    // 최신순으로 상한까지 조회(유저 표시명 조인). payload는 작아 JS 집계가 저렴.
    const rows = await db
      .select({
        userId: seasonTelemetry.userId,
        name: users.displayName,
        provider: users.provider,
        season: seasonTelemetry.season,
        payload: seasonTelemetry.payload,
        createdAt: seasonTelemetry.createdAt,
      })
      .from(seasonTelemetry)
      .leftJoin(users, eq(users.id, seasonTelemetry.userId))
      .where(eq(seasonTelemetry.projCode, PROJ_CODE))
      .orderBy(desc(seasonTelemetry.createdAt))
      .limit(FETCH_CAP);

    // ── 전체 집계 ──
    const total = rows.length;
    let sumRank = 0, rankN = 0, champions = 0, coachModeOn = 0;
    let sumTimeouts = 0, sumInterv = 0, sumLineup = 0, sumReleases = 0, sumExpels = 0, sumCamp = 0;
    let sumSubsManual = 0, sumSubsPinch = 0;
    const focusCount: Record<string, number> = {};
    for (const r of rows) {
      const p = (r.payload ?? {}) as P;
      const s = subOf(p);
      if (typeof p.finalRank === 'number') { sumRank += p.finalRank; rankN++; }
      if (p.champion === true) champions++;
      if (p.coachMode === true) coachModeOn++;
      sumTimeouts += num(p.timeouts);
      sumInterv += num(p.interventions);
      sumLineup += num(p.lineupChanges);
      sumReleases += num(p.releases);
      sumExpels += num(p.expels);
      sumCamp += num(p.campCount);
      sumSubsManual += num(s.manual);
      sumSubsPinch += num(s.pinch);
      const f = typeof p.trainingFocus === 'string' ? p.trainingFocus : '(감독 기본)';
      focusCount[f] = (focusCount[f] ?? 0) + 1;
    }
    const avg = (sum: number, n: number) => (n > 0 ? Math.round((sum / n) * 100) / 100 : 0);
    const agg = {
      reports: total,
      avgFinalRank: avg(sumRank, rankN),
      championRate: total > 0 ? Math.round((champions / total) * 1000) / 10 : 0,
      coachModeRate: total > 0 ? Math.round((coachModeOn / total) * 1000) / 10 : 0,
      avgTimeouts: avg(sumTimeouts, total),
      avgInterventions: avg(sumInterv, total),
      avgLineupChanges: avg(sumLineup, total),
      avgReleases: avg(sumReleases, total),
      avgExpels: avg(sumExpels, total),
      avgCamp: avg(sumCamp, total),
      avgSubsManual: avg(sumSubsManual, total),
      avgSubsPinch: avg(sumSubsPinch, total),
      topFocus: Object.entries(focusCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, n]) => ({ code, n })),
    };

    // ── 사용자별 롤업(시즌별 payload 추이) ──
    const byUser = new Map<string, { userId: string; name: string | null; provider: string | null; seasons: Array<{ season: number; createdAt: unknown; payload: P }> }>();
    for (const r of rows) {
      let u = byUser.get(r.userId);
      if (!u) { u = { userId: r.userId, name: r.name ?? null, provider: r.provider ?? null, seasons: [] }; byUser.set(r.userId, u); }
      if (u.seasons.length < SEASONS_PER_USER) u.seasons.push({ season: r.season, createdAt: r.createdAt, payload: (r.payload ?? {}) as P });
    }
    const usersOut = Array.from(byUser.values())
      .map((u) => ({ ...u, seasons: u.seasons.sort((a, b) => a.season - b.season) }))
      .sort((a, b) => b.seasons.length - a.seasons.length)
      .slice(0, USERS_CAP);

    return NextResponse.json({ ok: true, distinctUsers: byUser.size, agg, users: usersOut });
  } catch (e) {
    reportError(e, 'admin/telemetry');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
