// 구단주 레이어 셀렉터 (OWNER_SYSTEM) — 불만 파생·면담 대사·컨디션. UI와 store가 공유.
// 불만은 저장하지 않는다: FA 성향과 현실(순위·출전·연봉)의 불일치에서 그때그때 파생.

import type { Player, SeasonAwards } from '../types';
import { discontentOf, popularityOf, fanbase, playerFans, fanOverlapRatio, type DiscontentTopic, type Fanbase } from '../engine/owner';
import { prefWeightsOf } from '../engine/faMarket';
import { marketValue } from '../engine/salary';
import { formFactor, formGrade } from '../engine/form';
import { awardHistoryOf } from './awards';
import { computeStandings } from './standings';
import { leagueProduction } from './production';
import { formFactorOnDay, rosterIdsOnDay, seasonScandals } from './dynamics';
import { SCANDAL_POP_FACTOR } from '../engine/scandal';
import { evolveOnDay } from './league';

const GAME_EVERY = 4.6;
const SEASON_END_DAY = 164;

/** 선수의 현재 불만(주제+동기 강도) — 시즌 진행 시점(day) 기준 */
export function discontentNow(p: Player, myTeamId: string, day: number): { topic: DiscontentTopic | null; weight: number } {
  const refDay = day > 0 ? day : Number.MAX_SAFE_INTEGER;
  const standings = computeStandings(refDay);
  const rank = Math.max(1, standings.findIndex((s) => s.teamId === myTeamId) + 1);
  const prod = leagueProduction(refDay).get(p.id);
  const games = Math.max(1, Math.round((day > 0 ? day : SEASON_END_DAY) / GAME_EVERY));
  const topic = discontentOf(p, {
    recentRankAvg: rank,
    teamCount: standings.length,
    playRatio: Math.min(1, (prod?.matches ?? 0) / games),
    salaryRatio: p.contract.salary / Math.max(1, marketValue(p)),
    myTeamId,
  });
  if (!topic) return { topic: null, weight: 0 };
  const w = prefWeightsOf(p);
  const weight = topic === 'win' ? w.win : topic === 'minutes' ? w.play : topic === 'money' ? w.money : w.home;
  return { topic, weight };
}

/** 면담 장면에서 선수가 하는 말 */
export const TOPIC_SPEECH: Record<DiscontentTopic, string> = {
  win: '"구단주님, 저는 우승이 하고 싶습니다. 지금 우리 순위로는…"',
  minutes: '"주전으로 뛰고 싶습니다. 기회만 주시면 증명하겠습니다."',
  money: '"제 가치를 인정받고 싶습니다. 시장은 저를 다르게 평가합니다."',
  hometown: '"고향 팀에서 뛰는 게 오랜 꿈이었습니다."',
};

export const TOPIC_BADGE: Record<DiscontentTopic, string> = {
  win: '우승 갈망', minutes: '출전 불만', money: '연봉 불만', hometown: '연고 향수',
};

/** 선수 인기(0~100) — 통산·수상·근속·올해 활약에서 파생. 이번 시즌 사고 치면 팬이 떠난다(×0.6) */
export function popularityNow(p: Player, day: number, archive: { season: number; awards?: SeasonAwards }[]): number {
  const prod = leagueProduction(day > 0 ? day : Number.MAX_SAFE_INTEGER).get(p.id);
  const pop = popularityOf(p.career.points, awardHistoryOf(archive, p.id).length, p.clubTenure, prod?.points ?? 0);
  return seasonScandals().some((s) => s.playerId === p.id) ? Math.round(pop * SCANDAL_POP_FACTOR) : pop;
}

/** 구단 팬덤(명) — 팀팬 + 선수팬 − 겹침. top: 팬 많은 선수 3인(개인 팬·겹침 비율) */
export function teamFanbaseNow(
  teamId: string, day: number, fan: number,
  archive: { season: number; awards?: SeasonAwards }[],
): Fanbase & { top: { name: string; fans: number; overlap: number }[] } {
  const roster = rosterIdsOnDay(teamId, day)
    .map((id) => evolveOnDay(id, day))
    .filter((p): p is Player => !!p);
  const entries = roster.map((p) => ({ p, pop: popularityNow(p, day, archive) }));
  const fb = fanbase(teamId, fan, entries.map((e) => ({ pop: e.pop, tenure: e.p.clubTenure })));
  const top = entries
    .map((e) => ({ name: e.p.name, fans: playerFans(e.pop), overlap: fanOverlapRatio(e.p.clubTenure) }))
    .sort((a, b) => b.fans - a.fans)
    .slice(0, 3);
  return { ...fb, top };
}

/** 컨디션(경기감각) — 점 색·라벨. factor는 formFactorOnDay 결과 */
export function conditionOf(teamId: string, playerId: string, day: number): { factor: number; grade: ReturnType<typeof formGrade>; color: string; label: string } {
  const factor = day > 0 ? formFactorOnDay(teamId, playerId, day) : formFactor(1, 1);
  const grade = formGrade(factor);
  return {
    factor, grade,
    color: grade === 'sharp' ? '#4ade80' : grade === 'dull' ? '#fbbf24' : '#f87171',
    label: grade === 'sharp' ? '경기감각 좋음' : grade === 'dull' ? '감각 살짝 무뎌짐' : '실전 감각 녹슮',
  };
}
