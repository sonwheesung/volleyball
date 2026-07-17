// 다이아 광고 쿨다운 경계 유닛 (MONETIZATION §11.1 · 2026-07-17 사용자 결정 — 30분→2시간).
// canWatchAd는 순수(nowMs 주입) — 경계 시각을 직접 넣어 1h59m 불가·2h1m 가능을 못박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWatchAd, grantAd, FRESH_AD_STATE, AD_COOLDOWN_MS } from './diamonds';

const T0 = 19675 * 86_400_000; // UTC 자정 정렬(경계 테스트가 같은 UTC 날짜 안에 머물게 — 2h < 24h)

test('광고 쿨다운 상수 = 2시간(2026-07-17 사용자 결정, 구 30분)', () => {
  assert.equal(AD_COOLDOWN_MS, 2 * 60 * 60 * 1000);
});

test('canWatchAd 2시간 경계: 1시간 59분 불가(cooldown) · 2시간 1분 가능', () => {
  const g = grantAd(FRESH_AD_STATE, T0); // 방금 시청 → lastAdAt=T0
  const at1h59 = canWatchAd(g.adState, T0 + (1 * 60 + 59) * 60 * 1000);
  assert.equal(at1h59.ok, false, '1h59m엔 아직 쿨다운');
  assert.equal(at1h59.reason, 'cooldown');

  const at2h01 = canWatchAd(g.adState, T0 + (2 * 60 + 1) * 60 * 1000);
  assert.equal(at2h01.ok, true, '2h01m엔 다시 가능');
});

test('canWatchAd 쿨다운 정각 경계: 2시간-1ms 불가 · 정확히 2시간 가능', () => {
  const g = grantAd(FRESH_AD_STATE, T0);
  assert.equal(canWatchAd(g.adState, T0 + AD_COOLDOWN_MS - 1).ok, false, '만료 1ms 전엔 불가');
  assert.equal(canWatchAd(g.adState, T0 + AD_COOLDOWN_MS).ok, true, '정확히 2시간이면 가능(msLeft=0)');
});
