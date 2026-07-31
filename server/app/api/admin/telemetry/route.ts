// /api/admin/telemetry — 시즌 종료 행동 텔레메트리 분석(§13.27). requireAdmin(fail-closed §13.15).
//   원천: season_telemetry(비식별 행동 카운트 jsonb). 결정론 격리 유지(통계 메타 — 시드/리플레이 무관).
//   반환: 전체 집계(agg) + 사용자별 롤업(users, 각 유저의 시즌별 payload 추이). payload는 클라(§13.27) v1 스키마.
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { seasonTelemetry, users, walletLedger } from '../../../../db/schema';
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
// v1/v2 graceful: 필드가 유한수일 때만 true(옛 payload엔 v2 필드 없음 → 그 행은 v2 집계 분모에서 제외).
const hasNum = (p: P, k: string): boolean => typeof p[k] === 'number' && Number.isFinite(p[k] as number);

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
    let intervenedReports = 0;                 // 개입 1회+ 리포트 수(플레이 탭 interveneRate)
    const rankBuckets: Record<number, number> = {}; // finalRank 히스토그램(경기 탭 rankDist)
    // ── v2 집계(분모=해당 v2 필드 보유 행만, v1 저장분 자연 제외) ──
    let rosterN = 0, sumRosterSize = 0, sumRosterAge = 0, sumRosterOvr = 0, sumForeign = 0, sumRetire = 0;
    let winsN = 0, sumWins = 0, sumLosses = 0, sumSetsW = 0, sumSetsL = 0;
    const focusCount: Record<string, number> = {};
    for (const r of rows) {
      const p = (r.payload ?? {}) as P;
      const s = subOf(p);
      if (typeof p.finalRank === 'number') { sumRank += p.finalRank; rankN++; rankBuckets[p.finalRank] = (rankBuckets[p.finalRank] ?? 0) + 1; }
      if (p.champion === true) champions++;
      if (p.coachMode === true) coachModeOn++;
      sumTimeouts += num(p.timeouts);
      sumInterv += num(p.interventions);
      if (num(p.interventions) > 0) intervenedReports++;
      sumLineup += num(p.lineupChanges);
      sumReleases += num(p.releases);
      sumExpels += num(p.expels);
      sumCamp += num(p.campCount);
      sumSubsManual += num(s.manual);
      sumSubsPinch += num(s.pinch);
      const f = typeof p.trainingFocus === 'string' ? p.trainingFocus : '(감독 기본)';
      focusCount[f] = (focusCount[f] ?? 0) + 1;
      // v2 로스터 구성 — rosterSize 보유 = v2 payload
      if (hasNum(p, 'rosterSize')) { rosterN++; sumRosterSize += num(p.rosterSize); sumRosterAge += num(p.avgAge); sumRosterOvr += num(p.avgOvr); sumForeign += num(p.foreignCount); sumRetire += num(p.retirements); }
      // v2 정규시즌 전적 — wins 보유 = v2 payload
      if (hasNum(p, 'wins')) { winsN++; sumWins += num(p.wins); sumLosses += num(p.losses); sumSetsW += num(p.setsWon); sumSetsL += num(p.setsLost); }
    }
    const avg = (sum: number, n: number) => (n > 0 ? Math.round((sum / n) * 100) / 100 : 0);
    const totalWL = sumWins + sumLosses;

    // ── 전지훈련 즉시 집계(원장 권위, §13.27) — campCount(텔레메트리)는 "시즌 종료 시"에만 전송돼 랙이 크다.
    //   전지훈련은 다이아 지출(reason='camp')이라 원장에 즉시 남으므로, 유저 수·총 횟수·소모 다이아를 원장에서 바로 뽑는다.
    //   (텔레메트리 avgCamp = 완료 시즌당 평균 — 부차 지표로 유지. 서로 다른 렌즈: 원장=실제 발생, 텔레메트리=완료 시즌 표본)
    const [campLed] = await db
      .select({
        events: sql<number>`count(*)::int`,
        users: sql<number>`count(distinct ${walletLedger.userId})::int`,
        diamonds: sql<number>`coalesce(-sum(${walletLedger.delta}), 0)::int`, // 지출은 음수 delta → 양수 소모량으로
      })
      .from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'camp')));

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
      // 전지훈련 원장 즉시 집계(랙 없음 — 다이아 지출 발생 즉시). OffseasonTab 주 지표.
      campLedgerEvents: campLed?.events ?? 0,   // 총 전지훈련 횟수(=선수당 오프시즌 1회이므로 연인원)
      campLedgerUsers: campLed?.users ?? 0,     // 전지훈련한 고유 유저 수
      campDiamonds: campLed?.diamonds ?? 0,     // 전지훈련 소모 다이아 합
      avgSubsManual: avg(sumSubsManual, total),
      avgSubsPinch: avg(sumSubsPinch, total),
      // 플레이 탭: 개입 1회+ 리포트 비율(%)
      interveneRate: total > 0 ? Math.round((intervenedReports / total) * 1000) / 10 : 0,
      // 경기 탭: 최종순위 히스토그램(1~N위) — 오름차순
      rankDist: Object.entries(rankBuckets).map(([rank, n]) => ({ rank: Number(rank), n })).sort((a, b) => a.rank - b.rank),
      topFocus: Object.entries(focusCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, n]) => ({ code, n })),
      // ── v2(선수 탭 · 경기 탭 승패). *N=해당 필드 보유 리포트 수(v1 저장분 제외). N=0이면 화면이 "다음 빌드부터" 노트. ──
      rosterReports: rosterN,
      avgRosterSize: avg(sumRosterSize, rosterN),
      avgRosterAge: avg(sumRosterAge, rosterN),
      avgRosterOvr: avg(sumRosterOvr, rosterN),
      avgForeignCount: avg(sumForeign, rosterN),
      avgRetirements: avg(sumRetire, rosterN),
      matchReports: winsN,
      avgWins: avg(sumWins, winsN),
      avgLosses: avg(sumLosses, winsN),
      winRate: totalWL > 0 ? Math.round((sumWins / totalWL) * 1000) / 10 : 0,
      avgSetsWon: avg(sumSetsW, winsN),
      avgSetsLost: avg(sumSetsL, winsN),
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
