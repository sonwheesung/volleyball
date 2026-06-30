// 플레이어 업적 (ACHIEVEMENT_SYSTEM) — 구단주의 장기 성취를 트로피로.
// 마일스톤과 동일: 새 시뮬 없이 기존 누적 산출물(archive/hof/milestones/cash/fanScore)을 읽어 판정.
// 달성 여부는 저장하지 않고 세이브 상태에서 재계산한다(결정론·세이브 다이어트). React/스토어 무의존.

import type { HofEntry, Milestone, Position, SeasonArchive, SeasonAwards } from '../types';

export type AchCategory = '우승' | '시상' | '레전드' | '기록' | '서사' | '단장' | '통산' | '운영';

/** 단장 통산 액션(업적용) — 경기 리플레이로 파생 불가, 스토어가 액션마다 누적 */
export interface CareerLog { faSigns: number; coachHires: number; staffHires: number; interviews: number }
/** 내 팀 통산 경기 기록(업적용) — 스토어가 매 시즌 누적 */
export interface CareerTotals { points: number; aces: number; setsWon: number; setsLost: number; matchWins: number; matchLosses: number }

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  category: AchCategory;
  target: number; // 진행바 목표(1 = 단발 달성)
}

export interface AchInput {
  myTeamId: string;
  archive: SeasonArchive[];
  hof: HofEntry[];
  milestones: Milestone[];
  cash: number;       // 만원
  fanScore: number;   // 0~100
  careerLog?: CareerLog;       // 단장 액션 누적(없으면 0 취급 — 구세이브·시뮬)
  careerTotals?: CareerTotals; // 통산 경기 기록(없으면 0 취급)
}

export interface AchStatus {
  ach: Achievement;
  cur: number;        // 현재 진행치
  unlocked: boolean;
}

const A = (id: string, title: string, desc: string, category: AchCategory, target = 1): Achievement =>
  ({ id, title, desc, category, target });

/** 업적 카탈로그 (v2). 순서 = 화면 표시 순서(카테고리별). */
export const ACHIEVEMENTS: Achievement[] = [
  // ── 우승 ──
  A('first_title', '첫 우승', '우리 구단의 첫 챔피언 등극', '우승'),
  A('titles_3', '도전자', '통산 3회 우승', '우승', 3),
  A('titles_5', '명문 구단', '통산 5회 우승', '우승', 5),
  A('titles_10', '불멸의 명가', '통산 10회 우승', '우승', 10),
  A('titles_15', '리그의 지배자', '통산 15회 우승', '우승', 15),
  A('titles_20', '전설의 구단', '통산 20회 우승', '우승', 20),
  A('back_to_back', '왕좌 수성', '2시즌 연속 우승', '우승'),
  A('three_peat', '왕조의 시작', '3시즌 연속 우승', '우승'),
  A('five_peat', '대왕조', '5시즌 연속 우승', '우승'),
  // ── 시상 ──
  A('make_mvp', '리그 최고', '우리 선수가 정규리그 MVP 수상', '시상'),
  A('mvp_3', 'MVP 명가', '우리 선수 MVP 통산 3회', '시상', 3),
  A('mvp_5', 'MVP 군단', '우리 선수 MVP 통산 5회', '시상', 5),
  A('mvp_b2b', '절대 강자', '우리 선수가 MVP 2시즌 연속 수상', '시상'),
  A('make_finals_mvp', '결승의 주인공', '우리 선수가 챔피언결정전 MVP', '시상'),
  A('make_rookie', '미래를 키우다', '우리 선수가 신인상 수상', '시상'),
  A('rookie_3', '신인 명가', '우리 선수 신인상 통산 3회', '시상', 3),
  A('make_improved', '성장의 증명', '우리 선수가 기량발전상 수상', '시상'),
  A('make_scoring_king', '득점 기계', '우리 선수가 득점왕 등극', '시상'),
  A('title_kings_5', '타이틀 컬렉터', '우리 선수의 부문 기록왕 통산 5회', '시상', 5),
  A('title_kings_15', '타이틀 수집가', '우리 선수의 부문 기록왕 통산 15회', '시상', 15),
  A('sweep4_titles', '부문 장악', '한 시즌 부문 기록왕 4개 석권', '시상', 4),
  A('best7_trio', '베스트7 군단', '한 시즌 베스트7에 우리 선수 3명', '시상', 3),
  A('best7_10', '베스트7 단골', '베스트7 선정 통산 10회', '시상', 10),
  A('award_sweep', '시상식 싹쓸이', '한 시즌 MVP·신인상·기량발전상 동시 석권', '시상'),
  A('round_mvp_5', '라운드의 지배자', '라운드 MVP 통산 5회', '시상', 5),
  // ── 레전드 ──
  A('first_hof', '명예의 전당', '우리 출신 HOF 선수 배출', '레전드'),
  A('hof_3', '레전드의 요람', 'HOF 선수 3명 배출', '레전드', 3),
  A('hof_5', '레전드 사관학교', 'HOF 선수 5명 배출', '레전드', 5),
  A('hof_10', '전설의 산실', 'HOF 선수 10명 배출', '레전드', 10),
  A('make_legend', '헌액 레전드', 'legend급(헌액 번호) 선수 배출', '레전드'),
  A('legend_3', '불멸의 군단', '헌액 레전드 3명 배출', '레전드', 3),
  A('hof_all_pos', '다재다능한 명가', '서로 다른 3개 포지션 HOF 배출', '레전드', 3),
  A('hof_8000', '불세출의 에이스', '통산 8000득점 HOF 배출', '레전드'),
  A('hof_longevity', '철인 레전드', '15시즌 이상 뛴 HOF 배출', '레전드'),
  // ── 기록 ──
  A('league_record', '리그를 새로 쓰다', '우리 선수가 리그 역대 기록 수립', '기록'),
  A('big_milestone', '역사를 넘어서', '레전드 추월·역대 진입(헤드라인 기록)', '기록'),
  A('big_milestone_5', '역사의 산증인', '헤드라인 기록 통산 5회', '기록', 5),
  A('club_record', '구단 신기록', '우리 선수가 구단 부문 기록 수립', '기록'),
  A('milestones_20', '기록의 보고', '우리 선수 기록 경신 통산 20회', '기록', 20),
  // ── 서사(순위·연승/연패) ──
  A('win_streak_10', '파죽지세', '한 시즌 10연승', '서사', 10),
  A('win_streak_15', '무적함대', '한 시즌 15연승', '서사', 15),
  A('lose_streak_10', '악몽의 시즌', '한 시즌 10연패', '서사', 10),
  A('all_ranks', '산전수전', '1위부터 꼴찌까지 모든 순위 경험', '서사', 7),
  A('worst_to_first', '최하위의 반란', '꼴찌 이듬해 가을야구(3위 이내) 복귀', '서사'),
  A('last_3peat', '암흑기', '3시즌 연속 최하위', '서사', 3),
  A('runner_up_3', '만년 2위', '정규리그 2위 통산 3회', '서사', 3),
  A('podium_10', '가을 단골', '정규리그 3위 이내 통산 10회', '서사', 10),
  A('podium_streak_5', '꾸준한 강호', '3위 이내 5시즌 연속', '서사', 5),
  A('reverse_sweep', '대역전극', '챔프전 2패 후 3연승 우승(리버스 스윕)', '서사'),
  A('sweep_title', '완벽한 대관식', '챔프전 3-0 스윕 우승', '서사'),
  A('blown_lead', '통한의 준우승', '챔프전 2승 후 3연패(역스윕 당함)', '서사'),
  A('perfect_season', '무패의 전설', '정규리그 전승으로 시즌 마무리', '서사'),
  A('wins_30', '압도적 시즌', '한 시즌 30승 이상', '서사'),
  A('wins_20s', '강호의 반열', '한 시즌 20승대(20~29승) 마무리', '서사'),
  A('wins_10s', '평범한 한 해', '한 시즌 10승대(10~19승) 마무리', '서사'),
  A('wins_single', '다사다난', '한 시즌 한 자릿수 승(1~9승) 마무리', '서사'),
  A('winless_season', '굴욕의 시즌', '정규리그 무승으로 시즌 마무리', '서사'),
  // ── 단장(GM 액션) ──
  A('first_draft', '첫 드래프트', '첫 신인 드래프트 완료', '단장'),
  A('draft_veteran', '드래프트 베테랑', '드래프트 10회 진행', '단장', 10),
  A('first_fa', '첫 영입', 'FA·외부 영입 1명', '단장'),
  A('fa_mogul', '영입의 큰손', 'FA·외부 영입 통산 15명', '단장', 15),
  A('first_coach', '감독 선임', '감독을 직접 선임', '단장'),
  A('coach_collector', '명장 편력', '감독 통산 5회 선임', '단장', 5),
  A('first_staff', '프런트 강화', '전문 코치·스카우터 영입', '단장'),
  A('first_interview', '첫 면담', '선수와 첫 면담', '단장'),
  A('interview_master', '소통의 달인', '선수 면담 통산 20회', '단장', 20),
  // ── 통산(경기 기록) ──
  A('first_point', '첫 득점', '구단 통산 첫 득점', '통산'),
  A('first_concede', '첫 실점', '구단 통산 첫 실점', '통산'),
  A('first_ace', '첫 서브 에이스', '구단 통산 첫 서브 에이스', '통산'),
  A('first_set_win', '첫 세트 승리', '구단 통산 첫 세트 획득', '통산'),
  A('first_set_loss', '첫 세트 패배', '구단 통산 첫 세트 내줌', '통산'),
  A('first_match_win', '첫 경기 승리', '구단 통산 첫 승', '통산'),
  A('first_match_loss', '첫 경기 패배', '구단 통산 첫 패', '통산'),
  A('points_100', '백 점 돌파', '구단 통산 100득점', '통산', 100),
  A('points_1k', '천 점 클럽', '구단 통산 1,000득점', '통산', 1000),
  A('points_10k', '만 점의 탑', '구단 통산 10,000득점', '통산', 10000),
  A('points_100k', '십만 득점', '구단 통산 100,000득점', '통산', 100000),
  A('points_1m', '백만 득점', '구단 통산 1,000,000득점', '통산', 1000000),
  // ── 운영 ──
  A('cash_200k', '흑자 경영', '운영자금 20억 보유', '운영', 200000),
  A('cash_500k', '탄탄한 곳간', '운영자금 50억 보유', '운영', 500000),
  A('cash_1m', '재벌 구단', '운영자금 100억 보유', '운영', 1000000),
  A('fan_70', '지역 명문', '팬심 70 도달', '운영', 70),
  A('fan_90', '국민 구단', '팬심 90 도달', '운영', 90),
  A('seasons_10', '한 세대', '10시즌 운영', '운영', 10),
  A('seasons_50', '반세기 명가', '50시즌 운영', '운영', 50),
  A('seasons_100', '백년 구단', '100시즌 운영', '운영', 100),
];

// ── 다이아 보상 (MONETIZATION §11) — 업적 달성 시 1회 지급(스토어가 claimed 추적). 난이도 7단계 10~1000.
//    미지정 업적은 기본 30(보통). 특별훈련 300 기준 큰 업적 1개 ≈ 1~3회분. ※소비성 재화(안티과금 기둥 반전, 사용자 결정).
export const ACH_REWARD: Record<string, number> = {
  // 우승
  first_title: 60, titles_3: 250, titles_5: 250, titles_10: 500, titles_15: 500, titles_20: 1000,
  back_to_back: 120, three_peat: 250, five_peat: 500,
  // 시상
  make_mvp: 30, mvp_3: 120, mvp_5: 250, mvp_b2b: 120, make_finals_mvp: 30, make_rookie: 30, rookie_3: 120,
  make_improved: 30, make_scoring_king: 30, title_kings_5: 120, title_kings_15: 250, sweep4_titles: 250,
  best7_trio: 120, best7_10: 250, award_sweep: 250, round_mvp_5: 60,
  // 레전드
  first_hof: 60, hof_3: 250, hof_5: 500, hof_10: 1000, make_legend: 120, legend_3: 500, hof_all_pos: 250,
  hof_8000: 250, hof_longevity: 250,
  // 기록
  league_record: 60, big_milestone: 60, big_milestone_5: 250, club_record: 60, milestones_20: 250,
  // 서사
  win_streak_10: 60, win_streak_15: 120, lose_streak_10: 10, all_ranks: 120, worst_to_first: 120, last_3peat: 30,
  runner_up_3: 60, podium_10: 250, podium_streak_5: 250, reverse_sweep: 250, sweep_title: 120, blown_lead: 10,
  perfect_season: 1000, wins_30: 250, wins_20s: 30, wins_10s: 10, wins_single: 10, winless_season: 10,
  // 단장
  first_draft: 10, draft_veteran: 120, first_fa: 10, fa_mogul: 120, first_coach: 10, coach_collector: 60,
  first_staff: 10, first_interview: 10, interview_master: 60,
  // 통산
  first_point: 10, first_concede: 10, first_ace: 10, first_set_win: 10, first_set_loss: 10,
  first_match_win: 10, first_match_loss: 10, points_100: 10, points_1k: 30, points_10k: 120, points_100k: 500, points_1m: 1000,
  // 운영
  cash_200k: 30, cash_500k: 60, cash_1m: 250, fan_70: 30, fan_90: 120, seasons_10: 30, seasons_50: 500, seasons_100: 1000,
};
/** 업적 다이아 보상(미지정=30). */
export const achReward = (id: string): number => ACH_REWARD[id] ?? 30;

const POSITIONS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
type Arch = AchInput['archive'];

/** championId === my 가 연속한 최대 구간 */
function longestTitleStreak(archive: Arch, my: string): number {
  const sorted = archive.slice().sort((a, b) => a.season - b.season);
  let best = 0, run = 0, prev = -999;
  for (const a of sorted) {
    const won = a.championId === my;
    run = won && a.season === prev + 1 ? run + 1 : (won ? 1 : 0);
    if (won) prev = a.season;
    if (run > best) best = run;
  }
  return best;
}

/** 특정 수상(pick)을 내 팀이 받은 시즌이 연속한 최대 구간 */
function longestAwardStreak(archive: Arch, my: string, pick: (a: SeasonAwards) => { teamId: string } | null): number {
  const sorted = archive.slice().sort((a, b) => a.season - b.season);
  let best = 0, run = 0, prev = -999;
  for (const a of sorted) {
    const got = !!a.awards && pick(a.awards)?.teamId === my;
    run = got && a.season === prev + 1 ? run + 1 : (got ? 1 : 0);
    if (got) prev = a.season;
    if (run > best) best = run;
  }
  return best;
}

const countAwards = (archive: Arch, my: string, pick: (a: SeasonAwards) => { teamId: string } | null): number =>
  archive.reduce((s, a) => s + (a.awards && pick(a.awards)?.teamId === my ? 1 : 0), 0);

const TITLE_KEYS: (keyof SeasonAwards['titles'])[] = ['scoring', 'spike', 'block', 'serve', 'dig', 'set'];

/** 부문 기록왕 내 팀 누적 횟수 */
function titleKingCount(archive: Arch, my: string): number {
  let n = 0;
  for (const a of archive) if (a.awards) for (const k of TITLE_KEYS) if (a.awards.titles[k]?.teamId === my) n += 1;
  return n;
}

/** 한 시즌 부문 기록왕 내 팀이 가장 많이 가져간 수 */
function maxTitlesInSeason(archive: Arch, my: string): number {
  let best = 0;
  for (const a of archive) {
    if (!a.awards) continue;
    const n = TITLE_KEYS.filter((k) => a.awards!.titles[k]?.teamId === my).length;
    if (n > best) best = n;
  }
  return best;
}

/** 한 시즌 베스트7 내 팀 최다 수 */
function maxBest7InSeason(archive: Arch, my: string): number {
  let best = 0;
  for (const a of archive) {
    const n = (a.awards?.best7 ?? []).filter((s) => s.winner?.teamId === my).length;
    if (n > best) best = n;
  }
  return best;
}

const best7CumCount = (archive: Arch, my: string): number =>
  archive.reduce((s, a) => s + (a.awards?.best7 ?? []).filter((b) => b.winner?.teamId === my).length, 0);

const roundMvpCount = (archive: Arch, my: string): number =>
  archive.reduce((s, a) => s + (a.awards?.roundMvps ?? []).filter((w) => w?.teamId === my).length, 0);

/** 한 시즌 MVP·신인상·기량발전상을 모두 내 팀이 — 가능 시즌 존재 여부 */
const hasAwardSweep = (archive: Arch, my: string): boolean =>
  archive.some((a) => a.awards && a.awards.mvp?.teamId === my && a.awards.rookie?.teamId === my && a.awards.mostImproved?.teamId === my);

/** 내 팀의 시즌별 정규리그 최종 순위(1-based) + 그 시즌 팀 수 — standings 있는 시즌만, 시즌 오름차순 */
function rankHistory(archive: Arch, my: string): { season: number; rank: number; teams: number }[] {
  return archive.slice().sort((a, b) => a.season - b.season)
    .filter((a) => a.standings && a.standings.includes(my))
    .map((a) => ({ season: a.season, rank: a.standings!.indexOf(my) + 1, teams: a.standings!.length }));
}

/** 조건을 만족하는 시즌이 연속한 최대 구간 */
function longestSeasonRun(hist: { season: number; rank: number; teams: number }[], ok: (r: { rank: number; teams: number }) => boolean): number {
  let best = 0, run = 0, prev = -999;
  for (const h of hist) {
    run = ok(h) && h.season === prev + 1 ? run + 1 : (ok(h) ? 1 : 0);
    if (ok(h)) prev = h.season;
    if (run > best) best = run;
  }
  return best;
}

/** 내 팀의 플옵 시리즈 중 특정 W/L 시퀀스가 있었던 적이 있는가 (리버스 스윕·블론 등) */
function hasSeriesPattern(archive: Arch, my: string, pattern: ('W' | 'L')[]): boolean {
  const eq = (s: ('W' | 'L')[]) => s.length === pattern.length && s.every((g, i) => g === pattern[i]);
  return archive.some((a) => (a.series?.[my] ?? []).some(eq));
}

/** 내 팀 전 시즌 최장 연승·연패(streaks 기록에서 최댓값) */
function bestMatchStreaks(archive: Arch, my: string): { win: number; lose: number } {
  let win = 0, lose = 0;
  for (const a of archive) {
    const s = a.streaks?.[my];
    if (!s) continue;
    if (s[0] > win) win = s[0];
    if (s[1] > lose) lose = s[1];
  }
  return { win, lose };
}

/** 업적별 현재 진행치 + 달성 여부 산출 (순수). */
export function evalAchievements(input: AchInput): AchStatus[] {
  const { myTeamId: my, archive, hof, milestones, cash, fanScore } = input;
  const log = input.careerLog ?? { faSigns: 0, coachHires: 0, staffHires: 0, interviews: 0 };
  const tot = input.careerTotals ?? { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 };
  const titles = archive.filter((a) => a.championId === my).length;
  const streak = longestTitleStreak(archive, my);
  const myHof = hof.filter((h) => h.teamId === my);
  const myMs = milestones.filter((m) => m.teamId === my);
  const seasonsRun = archive.length;
  const hofPositions = new Set(myHof.map((h) => h.position)).size;
  // 서사(순위·연승연패)
  const hist = rankHistory(archive, my);
  const distinctRanks = new Set(hist.map((h) => h.rank)).size;
  const isLast = (r: { rank: number; teams: number }) => r.rank === r.teams;
  const lastStreak = longestSeasonRun(hist, isLast);
  const podiumStreak = longestSeasonRun(hist, (r) => r.rank <= 3);
  const runnerUps = hist.filter((h) => h.rank === 2).length;
  const podiums = hist.filter((h) => h.rank <= 3).length;
  const streaks = bestMatchStreaks(archive, my);
  // 시즌 승수 브래킷 — record 있는 시즌의 내 팀 승/패
  const myRecords = archive.map((a) => a.record?.[my]).filter((r): r is [number, number] => !!r);
  const seasonWin = (ok: (w: number, l: number) => boolean) => myRecords.some(([w, l]) => (w + l > 0) && ok(w, l));
  // 최하위의 반란: 꼴찌한 시즌 바로 다음 시즌 가을야구(3위 이내)
  const rankBySeason = new Map(hist.map((h) => [h.season, h.rank]));
  const worstToFirst = hist.some((h) => isLast(h) && (rankBySeason.get(h.season + 1) ?? 99) <= 3);

  const b = (x: boolean) => (x ? 1 : 0);
  const cur: Record<string, number> = {
    // 우승
    first_title: b(titles > 0), titles_3: titles, titles_5: titles, titles_10: titles, titles_15: titles, titles_20: titles,
    back_to_back: b(streak >= 2), three_peat: b(streak >= 3), five_peat: b(streak >= 5),
    // 시상
    make_mvp: b(countAwards(archive, my, (a) => a.mvp) > 0),
    mvp_3: countAwards(archive, my, (a) => a.mvp),
    mvp_5: countAwards(archive, my, (a) => a.mvp),
    mvp_b2b: b(longestAwardStreak(archive, my, (a) => a.mvp) >= 2),
    make_finals_mvp: b(countAwards(archive, my, (a) => a.finalsMvp) > 0),
    make_rookie: b(countAwards(archive, my, (a) => a.rookie) > 0),
    rookie_3: countAwards(archive, my, (a) => a.rookie),
    make_improved: b(countAwards(archive, my, (a) => a.mostImproved) > 0),
    make_scoring_king: b(countAwards(archive, my, (a) => a.titles.scoring) > 0),
    title_kings_5: titleKingCount(archive, my), title_kings_15: titleKingCount(archive, my),
    sweep4_titles: maxTitlesInSeason(archive, my),
    best7_trio: maxBest7InSeason(archive, my), best7_10: best7CumCount(archive, my),
    award_sweep: b(hasAwardSweep(archive, my)),
    round_mvp_5: roundMvpCount(archive, my),
    // 레전드
    first_hof: b(myHof.length > 0), hof_3: myHof.length, hof_5: myHof.length, hof_10: myHof.length,
    make_legend: b(myHof.some((h) => h.legend)),
    legend_3: myHof.filter((h) => h.legend).length,
    hof_all_pos: hofPositions,
    hof_8000: b(myHof.some((h) => h.points >= 8000)),
    hof_longevity: b(myHof.some((h) => h.seasons >= 15)),
    // 기록
    league_record: b(myMs.some((m) => m.kind === 'league')),
    big_milestone: b(myMs.some((m) => m.big)), big_milestone_5: myMs.filter((m) => m.big).length,
    club_record: b(myMs.some((m) => m.kind === 'club')),
    milestones_20: myMs.length,
    // 서사
    win_streak_10: streaks.win, win_streak_15: streaks.win, lose_streak_10: streaks.lose,
    all_ranks: distinctRanks, worst_to_first: b(worstToFirst), last_3peat: lastStreak,
    runner_up_3: runnerUps, podium_10: podiums, podium_streak_5: podiumStreak,
    reverse_sweep: b(hasSeriesPattern(archive, my, ['L', 'L', 'W', 'W', 'W'])),
    sweep_title: b(hasSeriesPattern(archive, my, ['W', 'W', 'W'])),
    blown_lead: b(hasSeriesPattern(archive, my, ['W', 'W', 'L', 'L', 'L'])),
    perfect_season: b(seasonWin((_w, l) => l === 0)),
    wins_30: b(seasonWin((w) => w >= 30)),
    wins_20s: b(seasonWin((w) => w >= 20 && w <= 29)),
    wins_10s: b(seasonWin((w) => w >= 10 && w <= 19)),
    wins_single: b(seasonWin((w) => w >= 1 && w <= 9)),
    winless_season: b(seasonWin((w) => w === 0)),
    // 단장(GM 액션 — careerLog + 드래프트는 시즌수 파생)
    first_draft: b(seasonsRun >= 1), draft_veteran: seasonsRun,
    first_fa: b(log.faSigns >= 1), fa_mogul: log.faSigns,
    first_coach: b(log.coachHires >= 1), coach_collector: log.coachHires,
    first_staff: b(log.staffHires >= 1),
    first_interview: b(log.interviews >= 1), interview_master: log.interviews,
    // 통산(경기 기록)
    first_point: b(tot.points >= 1), first_concede: b(tot.matchWins + tot.matchLosses >= 1),
    first_ace: b(tot.aces >= 1),
    first_set_win: b(tot.setsWon >= 1), first_set_loss: b(tot.setsLost >= 1),
    first_match_win: b(tot.matchWins >= 1), first_match_loss: b(tot.matchLosses >= 1),
    points_100: tot.points, points_1k: tot.points, points_10k: tot.points, points_100k: tot.points, points_1m: tot.points,
    // 운영
    cash_200k: Math.max(0, cash), cash_500k: Math.max(0, cash), cash_1m: Math.max(0, cash),
    fan_70: Math.round(fanScore), fan_90: Math.round(fanScore),
    seasons_10: seasonsRun, seasons_50: seasonsRun, seasons_100: seasonsRun,
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
