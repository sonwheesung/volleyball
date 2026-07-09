// 엔진 계약 상수 — 변이 테스트(§1.G)가 드러낸 미검증 상수들을 고정(값이 바뀌면 잡힌다).
// 이 상수들은 함수 동작이 아니라 *문서화된 설정값*이라, 동작 테스트 대신 계약 단언으로 핀다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER_MAX, ROSTER_MIN, STARTER_NEED } from './transactions';
import { COACH_SLOTS } from './staff';
import { POS_FLOOR } from './training';
import { SCANDAL_PROB } from './scandal';
import { ROSTER_IDEAL } from './aiGM';
import type { Position } from '../types';
import { ROSTER } from '../data/seed';

test('로스터 정원 계약: 계약 상한(MAX) 20 · MIN 10', () => {
  assert.equal(ROSTER_MAX, 20); // 계약 보유 상한(FA_SYSTEM §1.5, Phase 1) — 구 18 → 20. ROSTER_CONTRACT_CAP 별칭.
  assert.equal(ROSTER_MIN, 10);
});

test('스태프 코치 슬롯 = 3', () => {
  assert.equal(COACH_SLOTS, 3);
});

test('훈련 포지션 성장 바닥 = 0.14 (감독 선호 무관 핵심 스탯 성장 보장 — §1.8 C에서 0.24→0.14 하향)', () => {
  // TRAINING_SYSTEM §1.8 C(2026-07-01): 감독핵심 coachShare 0.25가 바닥보다 확실히 빨라야
  // 감독선호가 속도차(개성)를 만든다 — 바닥이 0.24면 감독 무관 saturate(죽은 기능).
  assert.equal(POS_FLOOR, 0.14);
});

test('사건 확률은 드물게(<1%)', () => {
  assert.ok(SCANDAL_PROB > 0 && SCANDAL_PROB < 0.01, `SCANDAL_PROB=${SCANDAL_PROB}`);
});

test('선발 구성 계약: STARTER_NEED = 1S·2OH·1OP·2MB·1L (production.ON_COURT·lineup 공유 출처)', () => {
  // K5: production.ON_COURT 와 lineup.buildLineup 이 이 상수를 직접 참조 → 드리프트 불가. 값 자체를 핀다.
  assert.deepEqual(STARTER_NEED, { S: 1, OH: 2, OP: 1, MB: 2, L: 1 });
});

test('시드 로스터 구성 == AI 이상 구성(ROSTER_IDEAL) — 포지션별 개수 일치', () => {
  // K6: data/seed.ROSTER(16인 템플릿, 생성 순서=시드 소비 순서라 재구성 불가) 의 포지션별 개수가
  //     engine/aiGM.ROSTER_IDEAL 과 일치하는지 정적 단언(수동 미러 드리프트 방지).
  const counts: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const pos of ROSTER) counts[pos]++;
  assert.deepEqual(counts, ROSTER_IDEAL);
});
