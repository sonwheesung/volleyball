// /api/save-backup — 시즌 종료 세이브 백업(§13.26). POST=업로드(롤링 5개·同시즌 교체·3MB 캡)·GET=목록(payload 미포함).
// 서버는 payload를 **불투명 blob으로 보관만**(게임플레이 불개입·결정론 격리 §1·§8) — 봉투(app/kind)만 검증, 내용(state)은 신뢰 안 함.
// requireUserId(fail-closed·익명 폴백 금지 §13.17 P0-5), proj 스코프(§13.2).
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { saveBackups } from '../../../db/schema';
import { requireUserId } from '../../../lib/auth';
import { ensureProj } from '../../../lib/wallet';
import { PROJ_CODE } from '../../../lib/proj';

export const dynamic = 'force-dynamic';

const MAX_PAYLOAD = 3 * 1024 * 1024; // 3MB — payload 바이트 상한(§13.26)
const KEEP = 5; // 유저당 보관 개수(롤링)

/** 봉투 검증 — app==='baeknyeon' && kind==='save-export'. 통과 시 version(문자열화) 반환, 실패 시 null. 내용(state)은 신뢰 안 함. */
function envelopeVersion(payload: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null; // JSON 파싱 실패
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as { app?: unknown; kind?: unknown; version?: unknown };
  if (env.app !== 'baeknyeon' || env.kind !== 'save-export') return null; // 봉투 불일치
  // version은 있으면 문자열화(목록 표시용), 없으면 null(봉투는 통과)
  if (env.version === undefined || env.version === null) return '';
  return String(env.version).slice(0, 64);
}

export async function POST(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  // Content-Length 조기 컷(대용량 바디를 메모리에 다 읽기 전 방어) — 봉투 오버헤드 감안 여유(payload 3MB + 슬랙).
  const cl = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(cl) && cl > MAX_PAYLOAD + 65536) {
    return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 });
  }

  try {
    const b = (await req.json()) as { season?: unknown; payload?: unknown };

    // season 정수 검증
    if (typeof b.season !== 'number' || !Number.isInteger(b.season)) {
      return NextResponse.json({ ok: false, reason: 'bad-season' }, { status: 400 });
    }
    const season = b.season;

    // payload 문자열 + 3MB 캡(바이트 기준)
    if (typeof b.payload !== 'string' || b.payload.length === 0) {
      return NextResponse.json({ ok: false, reason: 'bad-payload' }, { status: 400 });
    }
    const payload = b.payload;
    const sizeBytes = Buffer.byteLength(payload, 'utf8');
    if (sizeBytes > MAX_PAYLOAD) {
      return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 });
    }

    // 봉투 검증(app/kind) — 불일치 시 400. version 추출(목록 표시용).
    const version = envelopeVersion(payload);
    if (version === null) {
      return NextResponse.json({ ok: false, reason: 'bad-envelope' }, { status: 400 });
    }
    const saveVersion = version === '' ? null : version;

    await ensureProj();

    // 트랜잭션: 同시즌 교체(삭제 후 삽입) → 5개 초과분(최고령) 삭제.
    const result = await db.transaction(async (tx) => {
      // 같은 season 재업로드 = 교체(중복 행 방지 — UNIQUE 하드가드와 정합)
      await tx
        .delete(saveBackups)
        .where(and(eq(saveBackups.projCode, PROJ_CODE), eq(saveBackups.userId, userId), eq(saveBackups.season, season)));

      const ins = await tx
        .insert(saveBackups)
        .values({ projCode: PROJ_CODE, userId, season, payload, sizeBytes, saveVersion })
        .returning({ id: saveBackups.id });

      // 롤링: created_at 오름차순으로 훑어 5개 초과분(가장 오래된 것부터) 삭제
      const rows = await tx
        .select({ id: saveBackups.id })
        .from(saveBackups)
        .where(and(eq(saveBackups.projCode, PROJ_CODE), eq(saveBackups.userId, userId)))
        .orderBy(asc(saveBackups.createdAt));
      if (rows.length > KEEP) {
        const stale = rows.slice(0, rows.length - KEEP).map((r) => r.id);
        await tx.delete(saveBackups).where(inArray(saveBackups.id, stale));
      }
      return { id: ins[0].id, keptCount: Math.min(rows.length, KEEP) };
    });

    return NextResponse.json({ ok: true, id: result.id, keptCount: result.keptCount });
  } catch (e) {
    reportError(e, 'save-backup');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const rows = await db
      .select({
        id: saveBackups.id,
        season: saveBackups.season,
        createdAt: saveBackups.createdAt,
        sizeBytes: saveBackups.sizeBytes,
        saveVersion: saveBackups.saveVersion,
      })
      .from(saveBackups)
      .where(and(eq(saveBackups.projCode, PROJ_CODE), eq(saveBackups.userId, userId)))
      .orderBy(desc(saveBackups.createdAt))
      .limit(KEEP + 5); // 방어(정상은 KEEP개 이하)
    return NextResponse.json({ ok: true, backups: rows });
  } catch (e) {
    reportError(e, 'save-backup');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
