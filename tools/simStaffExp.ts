// 통제 실험 — 전 팀 "동일 선수진", 스태프(감독 훈련선호·전문코치 투자·스카우터)만 다르게.
// N시즌 후 우승·전력이 스태프 투자에 따라 갈리는지 측정(스태프가 장기적으로 의미 있나).
//   npx tsx tools/simStaffExp.ts [시즌=100]
// 주의: 스카우터는 단장 드래프트 '표시'만 바꾸므로 전 구단 AI 시뮬에선 효과 없음(명시).

import {
  LEAGUE, getTeam, getPlayer, resetLeagueBase, commitPlayerBase, commitRosters,
  setFocusOverride, hireAssistant, hireScout, availableAssistants, availableScouts,
  getEvolvedTeamPlayers, teamAssistants,
} from '../data/league';
import { runUniverse } from './simLeague';
import { teamOverall } from '../engine/overall';
import { SPECIALTY_KO } from '../engine/staff';
import { ARCHETYPES } from '../data/seed';
import type { CoachSpecialty, Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
const clone = (p: Player, id: string): Player => ({
  ...p, id, contract: { ...p.contract }, career: { ...p.career }, xp: { ...p.xp }, potential: { ...p.potential }, catTalent: { ...p.catTalent },
});

function setup(): { ids: string[]; plan: { asst: CoachSpecialty[]; scouts: number }[] } {
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);

  // 1) 전 팀을 t0의 선수진으로 통일(동일 스탯, 팀별 고유 id)
  const canon = (LEAGUE.teams[0].players).map((pid) => getPlayer(pid)!).filter(Boolean);
  const base: Record<string, Player> = {};
  const rosters: Record<string, string[]> = {};
  for (const tid of ids) {
    rosters[tid] = canon.map((p, j) => {
      const id = `${tid}__${j}`;
      base[id] = clone(p, id);
      return id;
    });
  }
  commitPlayerBase(base);
  commitRosters(rosters);

  // 2) 통제: 훈련 '방향'(감독 선호)은 전 팀 동일하게 고정 → 변수는 '전문 코치 투자'뿐.
  //    코치 인원·역량이 클수록 투자↑(같은 분야 최고1명만 적용되므로 분야 분산). 단조 증가 그래디언트.
  const FIXED_FOCUS = ARCHETYPES[1].focus; // 기본기파(공격4+리시브6) — 전 팀 공통
  const plan: { asst: CoachSpecialty[]; scouts: number }[] = [
    { asst: [], scouts: 0 },                                    // 0 무지원
    { asst: ['attack'], scouts: 0 },                            // 1 코치1
    { asst: ['attack', 'defense'], scouts: 0 },                 // 2 코치2
    { asst: ['attack', 'defense', 'stamina'], scouts: 0 },      // 3 코치3
    { asst: ['attack', 'defense', 'stamina'], scouts: 1 },      // 4 코치3+스카우터(참고)
    { asst: ['attack', 'defense', 'setter'], scouts: 1 },       // 5 코치3
    { asst: ['attack', 'defense', 'stamina'], scouts: 2 },      // 6 풀스태프
  ];
  ids.forEach((tid, i) => {
    setFocusOverride(tid, FIXED_FOCUS); // 전 팀 동일 훈련방향(통제)
    for (const sp of plan[i].asst) {
      const cand = availableAssistants().filter((a) => a.specialty === sp).sort((a, b) => b.rating - a.rating)[0];
      if (cand) hireAssistant(tid, cand.id);
    }
    for (let k = 0; k < plan[i].scouts; k++) {
      const sc = availableScouts().sort((a, b) => b.scouting - a.scouting)[0];
      if (sc) hireScout(tid, sc.id);
    }
  });
  return { ids, plan };
}

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  const { ids } = setup();

  // 스태프 요약 + 투자 점수(코치 역량 합 + 스카우터)
  const boostScore: Record<string, number> = {};
  const startOvr: Record<string, number> = {};
  log(`\n═══ 통제 실험: 전 팀 동일 선수진 · 스태프만 차별 · ${seasons}시즌 ═══`);
  log('전 팀 동일 16인(t0 복제) · 훈련 방향 동일 고정. 변수=전문 코치 투자(역량 합)+스카우터.\n');
  log('팀                전문코치(분야·역량)                  투자  시작전력');
  for (const tid of ids) {
    const score = teamAssistants(tid).reduce((s, a) => s + a.rating, 0); // 코치 역량 합 = 투자
    boostScore[tid] = score;
    startOvr[tid] = teamOverall(getEvolvedTeamPlayers(tid, 164));
    const asstStr = teamAssistants(tid).map((a) => `${SPECIALTY_KO[a.specialty]}${a.rating}`).join(',') || '없음';
    log(`  ${getTeam(tid)?.name.padEnd(14)} ${asstStr.padEnd(30)} ${String(score).padStart(4)}   ${startOvr[tid]}`);
  }

  // N시즌 진행(전 구단 AI). 스태프·focusOverride는 시즌 간 유지됨.
  process.stderr.write(`▶ ${seasons}시즌 진행…\n`);
  const u = runUniverse(seasons, (s) => { if ((s + 1) % 25 === 0) process.stderr.write(`  …${s + 1}/${seasons}\n`); });

  // 결과: 우승·평균순위·최종전력
  log(`\n▸ 결과 (스태프 투자 순):`);
  log('팀                부스트  우승   평균순위  최종전력  전력Δ');
  const rows = [...ids].sort((a, b) => boostScore[b] - boostScore[a]);
  const finalOvr: Record<string, number> = {};
  for (const tid of ids) finalOvr[tid] = teamOverall(getEvolvedTeamPlayers(tid, 164));
  for (const tid of rows) {
    const d = finalOvr[tid] - startOvr[tid];
    log(`  ${getTeam(tid)?.name.padEnd(14)} ${boostScore[tid].toFixed(2)}   ${String(u.titles[tid]).padStart(3)}회  ${(u.rankSum[tid] / seasons).toFixed(1)}위    ${finalOvr[tid]}     ${d >= 0 ? '+' : ''}${d}`);
  }

  // 상관: 스태프 투자 vs 우승 / 최종전력
  const xs = ids.map((t) => boostScore[t]);
  log(`\n▸ 상관계수 (스태프 투자 ↔ 결과):`);
  log(`  부스트 ↔ 우승수    r=${pearson(xs, ids.map((t) => u.titles[t])).toFixed(2)}`);
  log(`  부스트 ↔ 최종전력  r=${pearson(xs, ids.map((t) => finalOvr[t])).toFixed(2)}`);
  log(`  부스트 ↔ 평균순위  r=${pearson(xs, ids.map((t) => u.rankSum[t] / seasons)).toFixed(2)}  (음수=투자↑일수록 상위)`);
  log(`\n  (r→+1: 스태프 투자가 성공을 강하게 예측 / r→0: 스태프 무의미 / 평균순위는 음수가 좋음)`);
  log(`  최장 왕조: ${getTeam(u.longestTeam)?.name} ${u.longestStreak}연패`);
}

main();
