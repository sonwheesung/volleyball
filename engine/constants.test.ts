// 엔진 계약 상수 — 변이 테스트(§1.G)가 드러낸 미검증 상수들을 고정(값이 바뀌면 잡힌다).
// 이 상수들은 함수 동작이 아니라 *문서화된 설정값*이라, 동작 테스트 대신 계약 단언으로 핀다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER_MAX, ROSTER_MIN } from './transactions';
import { COACH_SLOTS } from './staff';
import { POS_FLOOR } from './training';
import { SCANDAL_PROB } from './scandal';

test('로스터 정원 계약: MAX 18 · MIN 10', () => {
  assert.equal(ROSTER_MAX, 18); // 오프시즌 충원 상한(EC-RM-01 가드와 짝)
  assert.equal(ROSTER_MIN, 10);
});

test('스태프 코치 슬롯 = 3', () => {
  assert.equal(COACH_SLOTS, 3);
});

test('훈련 포지션 성장 바닥 = 0.24 (감독 선호 무관 핵심 스탯 성장 보장)', () => {
  assert.equal(POS_FLOOR, 0.24);
});

test('사건 확률은 드물게(<1%)', () => {
  assert.ok(SCANDAL_PROB > 0 && SCANDAL_PROB < 0.01, `SCANDAL_PROB=${SCANDAL_PROB}`);
});
