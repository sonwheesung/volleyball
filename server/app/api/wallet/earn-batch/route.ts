// POST /api/wallet/earn-batch — 업적 보상 **배치** 적립(§4·§13.12). body: { items: [{ amount, idempotencyKey, ref? }] }
// 업적 수령 전용: reason은 서버에서 'achievement'로 **강제**(ad/welcome/purchase 캡을 스코프 밖으로 격리 — 임의 reason 안 받음).
//
// WHY(성능): 단건 /api/wallet/earn을 업적 수마다 순차 await하면 N × (HTTPS+콜드스타트+requireUserId+트랜잭션) ≈ 40s.
//   이 라우트는 **requireUserId 1회 + db.transaction 1개** 안에서 N개의 값싼 in-tx statement로 처리(≈2~4s).
// 보존: 멱등키(achKey별 계정평생 dedup)·평생합 캡(원장 sum baseline + grantedSoFar 누적)·금액 서버권위(achievement 클램프)는 그대로.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { reportError } from '../../../../lib/observability';
import { applyWalletTx, sumReason } from '../../../../lib/wallet';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { earnAmount, allocateAchGrants } from '../../../../lib/econ';
import { requireUserId } from '../../../../lib/auth';
import { walletIdemKey } from '../../../../lib/walletKey';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 64; // 배치 상한(작업량 바운드) — 업적 카탈로그 86개라도 한 수령에 이 이하로 충분.

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items?: Array<{ amount?: number; idempotencyKey?: string; ref?: string }> };
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    // 아이템별 검증 + 서버 권위 금액(achievement 강제 클램프 [1,1000]). 하나라도 손상되면 전체 400(부분 처리 안 함).
    const wanted: number[] = [];
    for (const it of items) {
      if (!it || typeof it.idempotencyKey !== 'string' || !it.idempotencyKey) {
        return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
      }
      const a = earnAmount('achievement', Number(it.amount));
      if (a === null || !Number.isFinite(a) || a <= 0) {
        return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
      }
      wanted.push(a);
    }
    // 익명 폴백 금지(#6·§13.17 P0-5) — 유효 Bearer 없으면 401. 레이트리밋 불필요(인증·저빈도).
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

    // 평생합 baseline 1회 조회(단건 라우트와 동일 — 원장 진실). 이후 캡 배분은 순수 함수로.
    const used = await sumReason(userId, 'achievement');
    const alloc = allocateAchGrants(used, wanted);

    // 단일 트랜잭션 — 아이템별 applyWalletTx(멱등·잔액게이트)를 같은 커넥션에서 원자 합성(쿠폰 redeem 패턴).
    const out = await db.transaction(async (tx) => {
      const results: Array<{ applied: boolean; capped?: boolean }> = [];
      for (let i = 0; i < items.length; i++) {
        const { grant, capped } = alloc[i];
        if (grant <= 0) {
          results.push({ applied: false, capped: true }); // 평생합 캡 소진 — 지급 0(단건 409 cap과 동의). applyWalletTx 미호출.
          continue;
        }
        const idemKey = walletIdemKey(userId, items[i].idempotencyKey as string); // 저장키 = <userId>:ach:<userId>:<achId> (교차유저 선점 차단·achId 멱등)
        const r = await applyWalletTx(tx, userId, grant, 'achievement', idemKey, items[i].ref);
        if (!r.ok) throw new Error('earn-batch applyWalletTx failed'); // no-user/error → 롤백 → 500(클라 폴백)
        results.push({ applied: r.applied }); // capped:false(부분 지급 포함) → applied만
      }
      // 최종 잔액 — 전부 캡(applyWalletTx 미호출)이어도 정확히 반환.
      const u = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
      return { results, balance: u.length ? u[0].balance : 0 };
    });
    return NextResponse.json({ ok: true, results: out.results, balance: out.balance });
  } catch (e) {
    reportError(e, 'wallet/earn-batch');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
