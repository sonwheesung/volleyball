// 플레이어 업적 (ACHIEVEMENT_SYSTEM) — 구단주의 장기 성취를 트로피로.
// 마일스톤과 동일: 새 시뮬 없이 기존 누적 산출물(archive/hof/milestones/cash/fanScore)을 읽어 판정.
// 달성 여부는 저장하지 않고 세이브 상태에서 재계산한다(결정론·세이브 다이어트). React/스토어 무의존.

import type { HofEntry, Milestone, SeasonAwards } from '../types';

export type AchCategory = '우승' | '시상' | '레전드' | '기록' | '운영';

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  category: AchCategory;
  target: number; // 진행바 목표(1 = 단발 달성)
}

export interface AchInput {
  myTeamId: string;
  archive: { season: number; championId: string; awards?: SeasonAwards }[];
  hof: HofEntry[];
  milestones: Milestone[];
  cash: number;       // 만원
  fanScore: number;   // 0~100
}

export interface AchStatus {
  ach: Achievement;
  cur: number;        // 현재 진행치
  unlocked: boolean;
}

const A = (id: string, title: string, desc: string, category: AchCategory, target = 1): Achievement =>
  ({ id, title, desc, category, target });

/** 업적 카탈로그 (v1). 순서 = 화면 표시 순서(카테고리별). */
export const ACHIEVEMENTS: Achievement[] = [
  // 우승
  A('first_title', '첫 우승', '우리 구단의 첫 챔피언 등극', '우승'),
  A('back_to_back', '왕좌 수성', '2시즌 연속 우승', '우승'),
  A('three_peat', '왕조의 시작', '3시즌 연속 우승', '우승'),
  A('titles_5', '명문 구단', '통산 5회 우승', '우승', 5),
  A('titles_10', '불멸의 명가', '통산 10회 우승', '우승', 10),
  // 시상
  A('make_mvp', '리그 최고', '우리 선수가 정규리그 MVP 수상', '시상'),
  A('make_rookie', '미래를 키우다', '우리 선수가 신인상 수상', '시상'),
  A('make_improved', '성장의 증명', '우리 선수가 기량발전상 수상', '시상'),
  A('title_kings_5', '타이틀 컬렉터', '우리 선수의 부문 기록왕 통산 5회', '시상', 5),
  A('best7_trio', '베스트7 군단', '한 시즌 베스트7에 우리 선수 3명', '시상', 3),
  // 레전드
  A('first_hof', '명예의 전당', '우리 출신 HOF 선수 배출', '레전드'),
  A('make_legend', '영구결번', 'legend급(영구결번) 선수 배출', '레전드'),
  A('hof_5', '레전드 사관학교', 'HOF 선수 5명 배출', '레전드', 5),
  // 기록
  A('league_record', '리그를 새로 쓰다', '우리 선수가 리그 역대 기록 수립', '기록'),
  A('big_milestone', '역사를 넘어서', '레전드 추월·역대 진입(헤드라인 기록)', '기록'),
  // 운영
  A('cash_200k', '흑자 경영', '운영자금 20억 보유', '운영', 200000),
  A('fan_90', '국민 구단', '팬심 90 도달', '운영', 90),
  A('seasons_10', '한 세대', '10시즌 운영', '운영', 10),
  A('seasons_50', '백년 구단', '50시즌 운영', '운영', 50),
];

/** 직전 세트(연속 우승) 최장 길이 — championId === my 가 연속한 최대 구간 */
function longestTitleStreak(archive: AchInput['archive'], my: string): number {
  const sorted = archive.slice().sort((a, b) => a.season - b.season);
  let best = 0, run = 0, prevSeason = -999;
  for (const a of sorted) {
    const won = a.championId === my;
    if (won && a.season === prevSeason + 1) run += 1;
    else run = won ? 1 : 0;
    if (won) prevSeason = a.season;
    if (run > best) best = run;
  }
  return best;
}

/** 한 시즌 베스트7에 내 팀 선수가 가장 많이 든 수 */
function maxBest7InSeason(archive: AchInput['archive'], my: string): number {
  let best = 0;
  for (const a of archive) {
    const n = (a.awards?.best7 ?? []).filter((s) => s.winner?.teamId === my).length;
    if (n > best) best = n;
  }
  return best;
}

/** 부문 기록왕(득점·공격·블로킹·서브·디그·세트) 내 팀 누적 횟수 */
function titleKingCount(archive: AchInput['archive'], my: string): number {
  let n = 0;
  for (const a of archive) {
    const t = a.awards?.titles;
    if (!t) continue;
    for (const w of [t.scoring, t.spike, t.block, t.serve, t.dig, t.set]) if (w?.teamId === my) n += 1;
  }
  return n;
}

const countAwards = (archive: AchInput['archive'], my: string, pick: (a: SeasonAwards) => { teamId: string } | null): number =>
  archive.reduce((s, a) => s + (a.awards && pick(a.awards)?.teamId === my ? 1 : 0), 0);

/** 업적별 현재 진행치 + 달성 여부 산출 (순수). */
export function evalAchievements(input: AchInput): AchStatus[] {
  const { myTeamId: my, archive, hof, milestones, cash, fanScore } = input;
  const titles = archive.filter((a) => a.championId === my).length;
  const streak = longestTitleStreak(archive, my);
  const myHof = hof.filter((h) => h.teamId === my);
  const seasonsRun = archive.length;

  const cur: Record<string, number> = {
    first_title: titles > 0 ? 1 : 0,
    back_to_back: streak >= 2 ? 1 : 0,
    three_peat: streak >= 3 ? 1 : 0,
    titles_5: titles,
    titles_10: titles,
    make_mvp: countAwards(archive, my, (a) => a.mvp) > 0 ? 1 : 0,
    make_rookie: countAwards(archive, my, (a) => a.rookie) > 0 ? 1 : 0,
    make_improved: countAwards(archive, my, (a) => a.mostImproved) > 0 ? 1 : 0,
    title_kings_5: titleKingCount(archive, my),
    best7_trio: maxBest7InSeason(archive, my),
    first_hof: myHof.length > 0 ? 1 : 0,
    make_legend: myHof.some((h) => h.legend) ? 1 : 0,
    hof_5: myHof.length,
    league_record: milestones.some((m) => m.teamId === my && m.kind === 'league') ? 1 : 0,
    big_milestone: milestones.some((m) => m.teamId === my && m.big) ? 1 : 0,
    cash_200k: Math.max(0, cash),
    fan_90: Math.round(fanScore),
    seasons_10: seasonsRun,
    seasons_50: seasonsRun,
  };

  return ACHIEVEMENTS.map((ach) => {
    const c = cur[ach.id] ?? 0;
    return { ach, cur: Math.min(c, ach.target), unlocked: c >= ach.target };
  });
}

/** 달성/전체 요약. */
export function achievementSummary(statuses: AchStatus[]): { done: number; total: number } {
  return { done: statuses.filter((s) => s.unlocked).length, total: statuses.length };
}
