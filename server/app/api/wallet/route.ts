// GET /api/wallet — 현재 잔액 + 최근 원장. (인증은 마일스톤3 — 지금은 dev 유저)
import { NextResponse } from 'next/server';
import { ensureDevUser, getWallet } from '../../../lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await ensureDevUser();
    const w = await getWallet(userId);
    return NextResponse.json({ ok: true, ...w });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
