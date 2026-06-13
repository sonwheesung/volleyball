import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coachRetireChance, staffRetires, becomesCoach, playerToCoach,
  headWorthiness, promotesToHead, firedEndSeason, firedMidSeason,
} from './staffLifecycle';
import { advanceCoaches } from '../data/staffLifecycle';
import type { Coach, Player, TrainableStat } from '../types';

function mkPlayer(over: Partial<Player> = {}): Player {
  const potential = {} as Record<TrainableStat, number>;
  const base = {
    jump: 60, agility: 60, staminaMax: 60, staminaRegen: 60, reaction: 70, positioning: 70,
    focus: 60, consistency: 60, vq: 80,
    skSpike: 60, skBlock: 60, skDig: 60, skReceive: 60, skSet: 60, skServe: 60,
  };
  return {
    id: 'p1', name: '김코치', age: 35, position: 'S', isForeign: false, height: 180, ...base,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 0, years: 1, remaining: 1, signedAtAge: 35 }, clubTenure: 5, peakAge: 28,
    career: { seasons: 10, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
    ...over,
  };
}

test('감독 은퇴 확률 — 나이 단조 증가, 55세 이하 0', () => {
  assert.equal(coachRetireChance(50), 0);
  assert.ok(coachRetireChance(62) > coachRetireChance(58));
  assert.ok(coachRetireChance(76) >= 0.95);
});

test('은퇴 판정 — 결정론(같은 id·나이·시즌 = 같은 결과)', () => {
  assert.equal(staffRetires('c1', 68, 5), staffRetires('c1', 68, 5));
});

test('선수→코치 전환 — 저VQ는 안 됨, 고VQ는 가능', () => {
  const dumb = mkPlayer({ id: 'd', vq: 60 });
  assert.equal(becomesCoach(dumb, false, 1), false); // VQ 72 미만
  // 고VQ + 레전드는 충분히 높은 확률 — 여러 시즌 시도하면 전환됨
  const smart = mkPlayer({ id: 's', vq: 90 });
  let any = false;
  for (let yr = 0; yr < 20; yr++) if (becomesCoach(smart, true, yr)) any = true;
  assert.ok(any, '고VQ 레전드는 언젠가 코치가 된다');
});

test('선수→코치 — 포지션이 분야로, 속성 파생', () => {
  const setter = playerToCoach(mkPlayer({ position: 'S', vq: 85 }), false);
  assert.equal(setter.specialty, 'setter');
  assert.equal(setter.teamId, null);
  assert.ok(setter.rating >= 45 && setter.rating <= 95);
  const mb = playerToCoach(mkPlayer({ position: 'MB' }), false);
  assert.equal(mb.specialty, 'defense');
  const oh = playerToCoach(mkPlayer({ position: 'OH' }), false);
  assert.equal(oh.specialty, 'attack');
  // 레전드는 역량 보너스
  const legend = playerToCoach(mkPlayer({ id: 'L', vq: 85 }), true);
  const normal = playerToCoach(mkPlayer({ id: 'L', vq: 85 }), false);
  assert.ok(legend.rating >= normal.rating);
});

test('승격 — 명성 임계 + 결정론', () => {
  assert.equal(promotesToHead('c', headWorthiness(50, 20, 10), 1), false); // 명성 낮음
  // 고역량+고성과+스타는 명성 높아 언젠가 승격
  const w = headWorthiness(90, 90, 90);
  assert.ok(w >= 60);
  let promoted = false;
  for (let yr = 0; yr < 30; yr++) if (promotesToHead('star', w, yr)) promoted = true;
  assert.ok(promoted, '명성 높은 코치는 언젠가 감독으로');
});

const mkCoach = (id: string, cha: number, teamId: string | null, firedFrom?: string[]): Coach => ({
  id, name: id, age: 50, charisma: cha, style: 'balanced',
  archetype: 'x', trainingFocus: { primary: [4, 6], secondary: [1, 10, 12] }, salary: 8000, teamId, firedFrom,
});

test('엣지: 경질한 감독은 그 팀에 즉시 재배정 안 됨', () => {
  const coaches = [mkCoach('star', 95, 't_bot'), mkCoach('low', 50, null)];
  // bottomYears=2로 확정 경질(꼴찌 1년은 확률적이라)
  const r = advanceCoaches(1, { coaches, assistants: [] }, { t_bot: 'star' }, [], new Set(), ['a', 'b', 'c', 'd', 'e', 'f', 't_bot'], { t_bot: 2 }, 'P');
  const bot = r.reassign.find((x) => x.teamId === 't_bot');
  assert.notEqual(bot?.coachId, 'star', '경질한 star가 t_bot에 도로 가면 안 됨');
  assert.ok(r.coaches.find((c) => c.id === 'star')?.firedFrom?.includes('t_bot'), 'firedFrom 기록');
});

test('엣지: firedFrom 팀엔 영구 배제, 다른 팀엔 부임 가능', () => {
  const ex = () => mkCoach('ex', 95, null, ['t_bot']);
  const sameTeam = advanceCoaches(2, { coaches: [ex(), mkCoach('low', 50, null)], assistants: [] }, { t_bot: 'gone' }, [], new Set(), ['a', 'b', 'c', 'd', 'e', 'f', 't_bot'], {}, 'P');
  assert.notEqual(sameTeam.reassign.find((x) => x.teamId === 't_bot')?.coachId, 'ex', 'firedFrom 팀 배제');
  const otherTeam = advanceCoaches(3, { coaches: [ex(), mkCoach('low', 50, null)], assistants: [] }, { t_oth: 'gone' }, [], new Set(), ['a', 'b', 'c', 'd', 'e', 'f', 't_oth'], {}, 'P');
  assert.equal(otherTeam.reassign.find((x) => x.teamId === 't_oth')?.coachId, 'ex', '다른 팀엔 부임 가능');
});

test('엣지: 두 팀 동시 공석 — 같은 감독 이중 배정 없음', () => {
  const r = advanceCoaches(4, { coaches: [mkCoach('f1', 70, null), mkCoach('f2', 65, null)], assistants: [] }, { A: 'deadA', B: 'deadB' }, [], new Set(), ['A', 'B', 'c', 'd', 'e', 'f', 'g'], {}, 'P');
  const a = r.reassign.find((x) => x.teamId === 'A')?.coachId;
  const b = r.reassign.find((x) => x.teamId === 'B')?.coachId;
  assert.ok(a && b && a !== b, '서로 다른 감독');
});

test('경질 — 하위권 2년 연속 확정·중상위 안전·꼴찌 1년 확률', () => {
  assert.equal(firedEndSeason(6, 7, 2), true);       // 하위 2년연속 = 확정
  assert.equal(firedEndSeason(7, 7, 2), true);       // 꼴찌 2년연속 = 확정
  assert.equal(firedEndSeason(3, 7, 5), false);      // 중상위는 안전(2년연속이어도 순위 안전)
  assert.equal(firedEndSeason(5, 7, 0), false);      // 5위(teamCount-2)는 안전
  // 꼴찌 1년은 확률(45%) — 시드별로 갈림. 일부 시즌은 경질, 일부는 인내
  let fires = 0; for (let s = 0; s < 100; s++) if (firedEndSeason(7, 7, 0, s, 'c')) fires++;
  assert.ok(fires > 20 && fires < 70, `꼴찌 1년 경질 ${fires}/100(확률적)`);
  assert.equal(firedMidSeason(2, 14), true);         // 16경기 12.5% 승률
  assert.equal(firedMidSeason(2, 6), false);         // 표본 부족(8경기)
  assert.equal(firedMidSeason(10, 8), false);        // 승률 양호
});
