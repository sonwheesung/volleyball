// 오프시즌 재정 정산 미리보기 — FA 센터가 "영입에 쓸 수 있는 실제 자금"을 정확히 보여주기 위함.
// 문제: store.cash 는 직전 시즌 정산값(이번 시즌 모기업 지원·관중 수입 미반영)이라, FA 센터에서
//   현재 cash 로 영입 가능액을 판단하면 endSeason 의 settled.cash(=cash+이번시즌 net)와 어긋난다
//   (모기업 지원만 14~28억이라 차이가 크다 → "영입 불가"로 오표시). 이 셀렉터로 settled.cash 를 미리 산출.
// endSeason 의 settleSeason 입력과 동일하게 계산(같은 셀렉터·같은 day 기준) → 미리보기=결과.

import type { SeasonAwards } from '../types';
import { settleSeason, applyNet } from '../engine/finance';
import { computeStandings } from './standings';
import { buildPlayoffs } from './playoffs';
import { teamFanbaseNow } from './owner';
import { rosterIdsOnDay } from './dynamics';
import { evolveOnDay, staffSpend } from './league';

const SEASON_END_DAY = 164;

/** 이번 시즌 정산 후 운영 자금(= cash + 이번 시즌 net, 모기업 보전 floor 0). FA 영입 지갑의 정확한 기준. */
export function projectSettledCash(
  my: string,
  season: number,
  cash: number,
  fanScore: number,
  archive: { season: number; awards?: SeasonAwards }[],
): number {
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const myRow = standings.find((r) => r.teamId === my);
  const winRate = myRow ? myRow.wins / Math.max(1, myRow.wins + myRow.losses) : 0.5;
  const po = buildPlayoffs(season);
  const runnerUpId = po.final ? (po.final.hiId === po.championId ? po.final.loId : po.final.hiId) : null;
  const rank = Math.max(1, standings.findIndex((r) => r.teamId === my) + 1);
  const fb = teamFanbaseNow(my, SEASON_END_DAY, fanScore, archive);
  const payroll = rosterIdsOnDay(my, Number.MAX_SAFE_INTEGER)
    .reduce((s, id) => s + (evolveOnDay(id, SEASON_END_DAY)?.contract.salary ?? 0), 0);
  const finance = settleSeason({
    teamId: my, rank, teamCount: standings.length,
    champion: po.championId === my, runnerUp: runnerUpId === my,
    winRate, fan: fanScore, fanTotal: fb.total, playerFansTotal: fb.playerFansTotal,
    payroll, staff: staffSpend(my), cashBefore: cash,
  });
  return applyNet(cash, finance.net).cash;
}
