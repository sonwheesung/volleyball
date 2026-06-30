// INDEPENDENT — 다이아 이코노미 순수 로직 가드 (MONETIZATION §11, 2026-06-30).
// 광고 쿨다운/하루상한 · 업적 수령 1회 · 전지훈련 cap99/비용. A/B 민감도 포함(허위 오라클 차단).
//   npx tsx tools/_dv_diamonds.ts
import { canWatchAd, grantAd, unclaimedReward, applyCamp, campCost, FRESH_AD_STATE, AD_REWARD, AD_COOLDOWN_MS, AD_DAILY_CAP, CAMP_PER_STAT } from '../engine/diamonds';
import { makeProspect } from '../data/seed';
import { createRng, strSeed } from '../engine/rng';
import type { AchStatus } from '../engine/achievements';

const log = (m: string) => process.stdout.write(m + '\n');
let ok = true;
const T0 = 19675 * 86_400_000; // 고정 기준시각 = UTC 자정 정렬(상한 테스트가 하루 안에 머물게 — 8×30분=4h<24h)

// ── (1) 광고 쿨다운 ──
{
  const fresh = canWatchAd(FRESH_AD_STATE, T0);
  const g = grantAd(FRESH_AD_STATE, T0);
  const right_after = canWatchAd(g.adState, T0 + 1000);          // 1초 뒤 = 쿨다운
  const after_cd = canWatchAd(g.adState, T0 + AD_COOLDOWN_MS);   // 30분 뒤 = 가능
  const pass = fresh.ok && g.reward === AD_REWARD && !right_after.ok && right_after.reason === 'cooldown' && after_cd.ok;
  log(`[광고 쿨다운] 첫시청 가능·보상 ${g.reward} · 직후 차단(cooldown ${Math.round(right_after.msLeft / 60000)}분) · 30분뒤 가능: ${pass ? '✅' : '❌'}`);
  ok = ok && pass;
}
// ── (2) 하루 상한 8회 ──
{
  let s = FRESH_AD_STATE; let t = T0; let n = 0;
  for (let i = 0; i < 20; i++) {
    const c = canWatchAd(s, t);
    if (c.ok) { s = grantAd(s, t).adState; n++; t += AD_COOLDOWN_MS; } // 쿨다운 채우며 계속 시도
    else if (c.reason === 'cap') break;
    else t += c.msLeft;
  }
  const capPass = n === AD_DAILY_CAP;
  // 다음날 리셋
  const nextDay = canWatchAd(s, t + 86_400_000);
  log(`[하루 상한] 같은날 최대 ${n}회(=${AD_DAILY_CAP}): ${capPass ? '✅' : '❌'} · 다음날 리셋 가능: ${nextDay.ok ? '✅' : '❌'}`);
  ok = ok && capPass && nextDay.ok;
}
// ── (3) 업적 수령 1회 ──
{
  const mk = (id: string, unlocked: boolean): AchStatus => ({ ach: { id, title: id, desc: '', category: '우승', target: 1 }, cur: unlocked ? 1 : 0, unlocked });
  const statuses = [mk('first_title', true), mk('titles_20', true), mk('titles_3', false)];
  const first = unclaimedReward(statuses, []);
  const after = unclaimedReward(statuses, first.ids); // 수령 후 재호출 → 0
  // first_title 60 + titles_20 1000 = 1060, titles_3 미달성 제외
  const pass = first.ids.length === 2 && first.total === 1060 && after.ids.length === 0 && after.total === 0;
  log(`[업적 수령] 미수령 2건 합 ${first.total}(=1060) · 재호출 0건/0다이아(중복지급 없음): ${pass ? '✅' : '❌'}`);
  ok = ok && pass;
}
// ── (4) 전지훈련 적용 cap99 + 비용 ──
{
  const p0 = makeProspect(createRng(strSeed('cmp')), 'cmp', 'OH');
  const before = { sk: (p0 as any).skSpike as number, pot: p0.potential.skSpike };
  const p1 = applyCamp(p0, ['skSpike', 'skServe']);
  const cur1 = (p1 as any).skSpike as number;
  const grew = cur1 === before.sk + 1 && p1.potential.skSpike === before.pot + 1 && (p0 as any).skSpike === before.sk; // 원본 불변
  // 99 상한
  const maxed = { ...p0, skBlock: 99, potential: { ...p0.potential, skBlock: 99 } } as any;
  const p2 = applyCamp(maxed, ['skBlock']);
  const capped = (p2 as any).skBlock === 99 && p2.potential.skBlock === 99;
  const costPass = campCost(['skSpike', 'skServe', 'skDig']) === CAMP_PER_STAT * 3;
  log(`[전지훈련] 현재+1·포텐+1·원본불변: ${grew ? '✅' : '❌'} · 99상한 유지: ${capped ? '✅' : '❌'} · 비용 3부위=${CAMP_PER_STAT * 3}: ${costPass ? '✅' : '❌'}`);
  ok = ok && grew && capped && costPass;
}
// ── (5) A/B 민감도 — 쿨다운/cap 규칙이 살아있나(허위 오라클 차단) ──
{
  const g = grantAd(FRESH_AD_STATE, T0);
  const wouldPassIfBroken = canWatchAd(g.adState, T0 + 60_000).ok; // 1분 뒤 — 규칙 정상이면 false여야
  log(`[A/B] 1분 뒤 차단(정상 규칙): ${!wouldPassIfBroken ? '✅' : '❌ 쿨다운 무력'}`);
  ok = ok && !wouldPassIfBroken;
}

log(ok ? '\n결론: ✅ 광고 쿨다운/상한 · 업적 1회수령 · 전지훈련 cap99/비용 정상' : '\n결론: ❌ 점검 필요');
process.exit(ok ? 0 : 1);
