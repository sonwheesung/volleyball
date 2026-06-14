import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rollScandal, rollExpulsion, SCANDAL_MISS, SCANDAL_PROB, EXPEL_PROB,
  SCANDAL_KO, EXPEL_KO, type ScandalKind, type ExpelKind,
} from './scandal';

test('출장정지·제명 모두 결정론(같은 id·나이 → 동일)', () => {
  for (const id of ['p1', 'p2', 'p99']) for (const age of [22, 30]) {
    assert.deepEqual(rollScandal(id, age), rollScandal(id, age));
    assert.deepEqual(rollExpulsion(id, age), rollExpulsion(id, age));
  }
});

test('출장정지 경기 수 = KOVO 스케일(경미<중대), 전 종류 라벨 존재', () => {
  // SNS 2 < 무단이탈 4 < 폭행 12 < 음주 18 < 도박 30 (단조 증가 = 경중 정렬)
  assert.ok(SCANDAL_MISS.sns < SCANDAL_MISS.awol);
  assert.ok(SCANDAL_MISS.awol < SCANDAL_MISS.assault);
  assert.ok(SCANDAL_MISS.assault < SCANDAL_MISS.dui);
  assert.ok(SCANDAL_MISS.dui < SCANDAL_MISS.gambling);
  assert.equal(SCANDAL_MISS.dui, 18);          // KBO 70/144경기 ≈ 반시즌(36) 스케일
  assert.ok(SCANDAL_MISS.gambling <= 36);      // 한 시즌(36경기)을 넘지 않음
  for (const k of ['sns', 'awol', 'assault', 'dui', 'gambling'] as ScandalKind[]) assert.ok(SCANDAL_KO[k].length > 0);
});

test('출장정지 빈도 ~SCANDAL_PROB, 분포는 경미 우세(SNS 최다·도박 최소)', () => {
  const N = 60000;
  let hit = 0;
  const cnt: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const r = rollScandal(`x${i}`, 25);
    if (r) { hit++; cnt[r.kind] = (cnt[r.kind] ?? 0) + 1; }
  }
  // 발생률이 설계 확률의 ±25% 안
  const rate = hit / N;
  assert.ok(rate > SCANDAL_PROB * 0.75 && rate < SCANDAL_PROB * 1.25, `rate ${rate}`);
  // SNS가 가장 흔하고 도박이 가장 드물다
  assert.ok((cnt.sns ?? 0) > (cnt.gambling ?? 0), `sns ${cnt.sns} > gambling ${cnt.gambling}`);
  assert.ok((cnt.sns ?? 0) >= (cnt.awol ?? 0));
});

test('영구제명 매우 희소(~EXPEL_PROB)·승부조작/학폭 두 종류', () => {
  const N = 200000;
  let hit = 0;
  const cnt: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const r = rollExpulsion(`y${i}`, 27);
    if (r) { hit++; cnt[r.kind] = (cnt[r.kind] ?? 0) + 1; }
  }
  const rate = hit / N;
  assert.ok(rate > EXPEL_PROB * 0.6 && rate < EXPEL_PROB * 1.4, `expel rate ${rate}`);
  // 출장정지(0.0035)보다 훨씬 드물다
  assert.ok(EXPEL_PROB < SCANDAL_PROB / 5);
  for (const k of ['matchfix', 'violence'] as ExpelKind[]) assert.ok(EXPEL_KO[k].length > 0);
  assert.ok((cnt.matchfix ?? 0) > 0 && (cnt.violence ?? 0) > 0);
});
