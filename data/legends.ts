// 헌액 번호 계보 셀렉터 — 같은 구단·같은 헌액 번호를 단 과거 레전드를 '사실로만' 나열.
// 순수 파생(hallOfFame 위). 가짜 인과 금지: '계승'이 아니라 '같은 번호를 단 과거 레전드'(docs/BROADCAST §8.3).
import type { HofEntry } from '../types';
import { jerseyNumber } from '../engine/jersey';

/**
 * teamId·number 와 같은 헌액 번호를 단 과거 레전드(excludeId 본인 제외, 그보다 먼저 은퇴).
 * @param hallOfFame 전체 명예의전당
 * @param teamId 헌액 구단(마지막 소속)
 * @param number 헌액 번호
 * @param excludeId 본인(이 헌액의 주인)
 * @param beforeSeason 이 시즌보다 먼저 은퇴한 레전드만(있으면). 없으면 전체 과거.
 * @returns 통산점 내림차순 레전드들
 */
export function numberLineage(
  hallOfFame: HofEntry[], teamId: string, number: number, excludeId: string, beforeSeason?: number,
): HofEntry[] {
  return hallOfFame
    .filter((h) =>
      h.legend &&
      h.id !== excludeId &&
      h.teamId === teamId &&
      jerseyNumber(h.id) === number &&
      (beforeSeason === undefined || h.retiredSeason < beforeSeason))
    .sort((a, b) => b.points - a.points);
}
