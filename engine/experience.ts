// 경기 출전·생산 → 성장 경험치 (TRAINING_SYSTEM 연계). 순수 함수.
// 시즌 생산(득점/블록/서브/디그/세트)을 관련 기술 스탯 XP로, 출전수를 VQ·위치선정으로.
// 훈련과 같은 XP 바·포텐 상한·나이 배수를 공유. 시즌말 1회 적립("천천히").

import type { Player, TrainableStat } from '../types';
import type { ProdLine } from './production';
import { ageMul, talentFor } from './training';

const K_SKILL = 0.008; // 생산 1당 효율(튜닝)
const K_EXP = 0.02;    // 출전 1경기당 VQ·위치선정

const MAP: [keyof ProdLine, TrainableStat][] = [
  ['spikes', 'skSpike'],
  ['blocks', 'skBlock'],
  ['aces', 'skServe'],
  ['digs', 'skDig'],
  ['assists', 'skSet'],
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 한 선수의 시즌 생산을 경험치로 적립한 새 선수(불변). */
export function applyMatchXp(p: Player, prod: ProdLine | undefined): Player {
  if (!prod || prod.matches <= 0) return p;
  const next = { ...p } as Player;
  const stats = next as unknown as Record<TrainableStat, number>;
  const xp: Partial<Record<TrainableStat, number>> = { ...p.xp };

  const add = (stat: TrainableStat, effort: number) => {
    if (effort <= 0) return;
    const cur = stats[stat];
    const pot = p.potential[stat] ?? cur;
    if (cur >= pot) return;
    const head = clamp01((pot - cur) / 12);
    if (head <= 0) return;
    const gain = effort * head * talentFor(p, stat) * ageMul(p.age, stat);
    let bar = (xp[stat] ?? 0) + gain;
    let value = cur;
    while (bar >= 1 && value < pot) {
      value += 1;
      bar -= 1;
    }
    if (value > cur) stats[stat] = value;
    xp[stat] = value >= pot ? 0 : bar;
  };

  for (const [k, stat] of MAP) add(stat, (prod[k] || 0) * K_SKILL);
  add('vq', prod.matches * K_EXP);
  add('positioning', prod.matches * K_EXP);

  next.xp = xp;
  return next;
}
