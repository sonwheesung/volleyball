// 구단주 레이어 셀렉터 (OWNER_SYSTEM) — 불만 파생·면담 대사·컨디션. UI와 store가 공유.
// 불만은 저장하지 않는다: FA 성향과 현실(순위·출전·연봉)의 불일치에서 그때그때 파생.

import type { Player, SeasonAwards, FAArchetype } from '../types';
import {
  discontentOf, moodOf, popularityOf, fanbase, playerFans, fanOverlapRatio,
  interviewEffects, refuseResignProb, sustainedBenchRefuse, sinkingShipBias,
  type DiscontentTopic, type Mood, type SitCause, type Fanbase, type InterviewLog, type OwnerFx,
} from '../engine/owner';
import { prefWeightsOf } from '../engine/faMarket';
import { buildLineup } from '../engine/lineup';
import { overall } from '../engine/overall';
import { marketValue } from '../engine/salary';
import { formFactor, formGrade } from '../engine/form';
import { awardHistoryOf } from './awards';
import { computeStandings } from './standings';
import { leagueProduction } from './production';
import { formFactorOnDay, rosterIdsOnDay, seasonScandals, injuredOnDay, suspendedOnDay, availableTeamPlayers } from './dynamics';
import { restedOnDay } from './rotation';
import { SCANDAL_POP_FACTOR } from '../engine/scandal';
import { evolveOnDay } from './league';

const GAME_EVERY = 4.6;
const SEASON_END_DAY = 164;

/** 선수가 코트에 못/안 나오는 사유 판정 (ROTATION_MORALE B) — 부상·징계·구단주벤치·실력밀림·주전.
 *  'rested'(#3 휴식)는 restedOnDay 구현 후 추가. 실제 경기 라인업(availableTeamPlayers→buildLineup)과 일치. */
export function benchCauseOf(p: Player, myTeamId: string, day: number): SitCause {
  const d = day > 0 ? day : 0;
  if (injuredOnDay(d).has(p.id)) return 'injured';
  if (suspendedOnDay(d).has(p.id)) return 'suspended';
  const avail = availableTeamPlayers(myTeamId, d);
  if (!avail.some((x) => x.id === p.id)) return 'ownerBenched'; // 부상·징계 아닌데 가용 명단 밖 = 벤치 지시
  const rest = restedOnDay(myTeamId, d); // 로드매니지먼트(#3) — 순위 굳어 감독이 쉬게 한 선수
  if (rest.has(p.id)) return 'rested';
  const lu = buildLineup(avail.filter((x) => !rest.has(x.id))); // 휴식 제외한 실제 출전 라인업
  const starters = new Set<string>([...lu.six.map((x) => x.id), ...(lu.libero ? [lu.libero.id] : [])]);
  return starters.has(p.id) ? 'starter' : 'outclassed';
}

const EXPECT_GAP = 9; // 동포지션 최약 주전보다 OVR 이만큼 아래면 '아직 못 뛴다'고 받아들임(기대치≈0)

/** 주전 기대치 0..1 — 동포지션 최약 주전과의 OVR 격차 + 경력. 약체 후보(기대치≈0)는 벤치를 당연히 받아들임.
 *  → 사용자 지적: OVR 낮고 경력 짧은 선수가 출전율만 낮다고 불만 품는 비현실 차단. */
export function expectsPlayOf(p: Player, myTeamId: string, day: number): number {
  const d = day > 0 ? day : 0;
  const avail = availableTeamPlayers(myTeamId, d);
  const lu = buildLineup(avail);
  const starters = [...lu.six, ...(lu.libero ? [lu.libero] : [])].filter((s) => s.position === p.position);
  if (!starters.length) return 0.5;
  const weakest = Math.min(...starters.map((s) => overall(s)));
  let e = Math.max(0, Math.min(1, 1 - (weakest - overall(p)) / EXPECT_GAP)); // 양수 격차=내가 더 약함→기대↓
  if (p.career.seasons >= 6) e = Math.max(e, 0.5); // 베테랑은 역할 기대
  if (p.career.seasons <= 1) e *= 0.5;             // 신인은 배우는 자세(기대↓)
  return e;
}

/** 사유+기분 → UI 한 줄(선수가 자기 상황을 어떻게 받아들이는가) */
function moodLabel(cause: SitCause, mood: Mood, topic: DiscontentTopic | null): string {
  if (mood === 'discontent') {
    if (topic === 'minutes') return cause === 'ownerBenched' ? '구단주 벤치 — 출전 불만' : '주전 경쟁서 밀림 — 출전 불만';
    if (topic === 'win') return '우승 갈망 — 성적 불만';
    if (topic === 'money') return '연봉 불만';
    return '연고 향수 — 고향 팀 그리움';
  }
  if (mood === 'positive') return '주전 활약 — 만족';
  switch (cause) { // neutral(무감정) — 사유별 받아들임
    case 'injured': return '부상 결장 — 묵묵히 복귀 준비';
    case 'suspended': return '징계 결장 — 자숙 중';
    case 'rested': return '체력 안배 — 관리 양해';
    case 'outclassed': return '주전 경쟁 — 묵묵히 준비';
    default: return '특별한 동요 없음';
  }
}

/** 선수의 현재 마음 — 사유(왜 벤치인가)+성격으로 불만/무감정/긍정 + 면담용 주제·가중. 시즌 진행 시점(day) 기준 */
export function discontentNow(
  p: Player, myTeamId: string, day: number,
): { topic: DiscontentTopic | null; weight: number; mood: Mood; cause: SitCause; label: string; playRatio: number } {
  const refDay = day > 0 ? day : Number.MAX_SAFE_INTEGER;
  const standings = computeStandings(refDay);
  const rank = Math.max(1, standings.findIndex((s) => s.teamId === myTeamId) + 1);
  const prod = leagueProduction(refDay).get(p.id);
  const games = Math.max(1, Math.round((day > 0 ? day : SEASON_END_DAY) / GAME_EVERY));
  const playRatio = Math.min(1, (prod?.matches ?? 0) / games);
  const cause = benchCauseOf(p, myTeamId, day);
  const ctx = {
    recentRankAvg: rank,
    teamCount: standings.length,
    playRatio,
    salaryRatio: p.contract.salary / Math.max(1, marketValue(p)),
    myTeamId,
    sitCause: cause,
    expectsPlay: expectsPlayOf(p, myTeamId, day),
  };
  const topic = discontentOf(p, ctx);
  const mood = moodOf(ctx, topic);
  const w = prefWeightsOf(p);
  const weight = !topic ? 0 : topic === 'win' ? w.win : topic === 'minutes' ? w.play : topic === 'money' ? w.money : w.home;
  return { topic, weight, mood, cause, label: moodLabel(cause, mood, topic), playRatio };
}

/** 시즌말 FA 판정용 ownerFx 조립 — store.endSeason과 FA/드래프트 센터 미리보기가 공유(미리보기=결과) */
export function buildOwnerFx(interviews: InterviewLog[], season: number, myTeamId: string, fanScore: number): OwnerFx {
  const fx = interviewEffects(interviews, season);
  const refuseProb: Record<string, number> = {};
  for (const id of rosterIdsOnDay(myTeamId, SEASON_END_DAY)) {
    const p = evolveOnDay(id, SEASON_END_DAY);
    if (!p || p.contract.remaining > 1) continue; // 이번 오프시즌 만료자만 거부권 행사
    const { topic, weight, playRatio } = discontentNow(p, myTeamId, SEASON_END_DAY);
    // 누적(C.4): 시즌 내내 부당하게 앉아있던 만큼(낮은 출전율) 정 떨어져 거부↑. 출전 불만일 때만.
    const accum = topic === 'minutes' ? sustainedBenchRefuse(playRatio, weight) : 0;
    const prob = refuseResignProb(topic, weight, fx.refuseBias[id] ?? 0) + sinkingShipBias(fanScore) + accum;
    if (prob > 0) refuseProb[id] = Math.min(0.95, prob);
  }
  return { refuseProb, offerBias: fx.offerBias };
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

/** 선수 성격(FA 동기 아키타입) 표시 라벨 + 벤치 태도 설명 — "왜 이 마음인지" 가독성용(OWNER_SYSTEM).
 *  화면에 성격을 드러내 "얘는 충성형이라 백업도 수용 / 출전형이라 벤치에 민감"이 한눈에 보이게. */
export const ARCHETYPE_KO: Record<FAArchetype, { label: string; emoji: string; note: string }> = {
  money:    { label: '연봉 중시', emoji: '💰', note: '보상이 1순위 — 대우만 맞으면 역할은 받아들이는 편.' },
  winnow:   { label: '우승 갈망', emoji: '🏆', note: '우승이 1순위 — 강팀이라면 벤치도 감수한다.' },
  loyal:    { label: '팀 충성', emoji: '🤝', note: '소속감이 1순위 — 팀에 헌신하며 백업도 묵묵히 받아들인다.' },
  minutes:  { label: '출전 갈망', emoji: '🔥', note: '코트가 1순위 — 어디서든 주전을 원한다. 주전급인데 벤치면 불만이 크다.' },
  hometown: { label: '연고 애착', emoji: '🏠', note: '연고가 1순위 — 역할보다 어디서 뛰는지를 더 본다.' },
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
