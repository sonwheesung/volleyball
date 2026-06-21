import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formFactor, applyForm, formGrade, FORM_MAX_PENALTY, FORM_WINDOW } from './form';
import { LEAGUE } from '../data/league';
import { getEvolvedTeamPlayers } from '../data/league';

test('formFactor: 전출전 1.0 · 전결장 0.93 · 빈 창 1.0 · 부분 창', () => {
  assert.equal(formFactor(FORM_WINDOW, FORM_WINDOW), 1);
  assert.equal(formFactor(0, FORM_WINDOW), 1 - FORM_MAX_PENALTY);
  assert.equal(formFactor(0, 0), 1);                       // 개막전 — 다 같이 새 출발
  assert.equal(formFactor(1, 2), 1 - FORM_MAX_PENALTY / 2); // 시즌 초반 부분 창
  assert.equal(formFactor(9, 5), 1);                        // 과출전 clamp
});

test('applyForm: 기술치만 깎이고, 1.0이면 원본 그대로(주전 무비용)', () => {
  const p = getEvolvedTeamPlayers(LEAGUE.teams[0].id, 0)[0];
  assert.equal(applyForm(p, 1), p); // 동일 참조 — 복사 비용도 없음
  const dull = applyForm(p, 0.93);
  assert.ok(Math.abs(dull.skSpike - p.skSpike * 0.93) < 1e-9);
  assert.equal(dull.jump, p.jump);           // 몸은 그대로
  assert.equal(dull.staminaMax, p.staminaMax);
  const floor = applyForm(p, 0.5);           // 이상치 방어 — 바닥 0.93
  assert.ok(floor.skSpike >= p.skSpike * (1 - FORM_MAX_PENALTY) - 1e-9);
});

test('formGrade 구간', () => {
  assert.equal(formGrade(1), 'sharp');
  assert.equal(formGrade(0.97), 'dull');
  assert.equal(formGrade(0.93), 'rusty');
});

test('formFactor 최악(0 출전·가득 찬 창) = 0.93 (체감 −7% 상한 고정)', () => {
  // 리터럴 0.93 단언 — FORM_MAX_PENALTY가 바뀌면 이 값이 어긋나 잡힌다(상수 자체와 묶지 않음).
  assert.ok(Math.abs(formFactor(0, FORM_WINDOW) - 0.93) < 1e-9, `worst=${formFactor(0, FORM_WINDOW)}`);
});
