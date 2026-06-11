// 드래프트 컨텍스트 — 드래프트 직전 상태 + 순번 + 클래스. 결정론.
// 드래프트 센터와 store.endSeason 이 동일 함수로 미리보기=결과 보장.

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { ROSTER_IDEAL } from '../engine/aiGM';
import { buildDraftOrder, lotteryRound1 } from '../engine/draft';
import { generateDraftClass } from './draftClass';
import { resolvePreDraft } from './offseason';
import { standingsWorstFirst } from './standings';

const ROSTER_TOTAL = Object.values(ROSTER_IDEAL).reduce((a, b) => a + b, 0); // 16

export interface DraftContext {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;     // 드래프트 전
  prevTeamOf: Record<string, string>;
  retired: string[];                      // 오프시즌 은퇴자 id(명예의전당)
  order: string[];                        // 슬롯별 teamId
  cls: Player[];                          // 드래프트 클래스
  myHoles: number;
  myPickSlots: number[];                  // order 내 내 지명 순번(0-based)
}

export function buildDraftContext(
  myTeam: string,
  resignDecisions: Record<string, boolean>,
  overrides: Record<string, Contract>,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: import('../engine/owner').OwnerFx,
): DraftContext {
  const pre = resolvePreDraft(myTeam, resignDecisions, overrides, faSignings, aggressive, protectedIds, nextSeason, ownerFx);
  const holes: Record<string, number> = {};
  for (const t of Object.keys(pre.rosters)) holes[t] = Math.max(0, ROSTER_TOTAL - pre.rosters[t].length);
  const totalHoles = Object.values(holes).reduce((a, b) => a + b, 0);

  const r1 = lotteryRound1(standingsWorstFirst(), createRng(60000 + nextSeason * 331));
  const order = buildDraftOrder(r1, holes, totalHoles);
  const cls = generateDraftClass(nextSeason, totalHoles + 8); // 여유분(미지명 풀)

  const myPickSlots: number[] = [];
  order.forEach((t, i) => {
    if (t === myTeam) myPickSlots.push(i);
  });

  return {
    snapshot: pre.snapshot,
    rosters: pre.rosters,
    prevTeamOf: pre.prevTeamOf,
    retired: pre.retired,
    order,
    cls,
    myHoles: holes[myTeam] ?? 0,
    myPickSlots,
  };
}
