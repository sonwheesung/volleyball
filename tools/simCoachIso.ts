// 코치 단독 통제 실험 — 선수·감독·신인까지 전부 대칭, 오직 전문 코치만 차별.
//   npx tsx tools/simCoachIso.ts [시즌=100]
// 리그의 경쟁 드래프트/FA를 우회한 자체 루프:
//  · 전 팀 동일 16인으로 시작, 동일 감독(스타일·카리스마·훈련방향),
//  · 은퇴는 나이 기준(코치 무관)으로 전 팀 동시 → 빈 슬롯에 전 팀 "동일 신인" 투입,
//  · 따라서 코치가 없으면 모든 팀이 영원히 동일. 코치만 스탯을 가른다.

import { createRng } from '../engine/rng';
import { makePlayer, makeProspect } from '../data/seed';
import { simulateMatch, type CoachInfo } from '../engine/match';
import { evolvePlayer } from '../engine/progression';
import { staffEffects, assistantSalary, SPECIALTY_KO } from '../engine/staff';
import { teamOverall } from '../engine/overall';
import type { AssistantCoach, CoachSpecialty, Player, Position, TrainingFocus } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

const FIXED_FOCUS: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] }; // 전 팀 동일 감독 훈련방향
const FIXED_COACH: CoachInfo = { style: 'balanced', charisma: 70 };              // 전 팀 동일 감독(경기)
const SEASON_LEN = 164;
const RETIRE_AGE = 36;        // 나이 기준 은퇴(코치 무관 → 전 팀 동기화)
const ROSTER: Position[] = ['S', 'S', 'S', 'OH', 'OH', 'OH', 'OH', 'OH', 'OP', 'OP', 'MB', 'MB', 'MB', 'MB', 'L', 'L'];

const clone = (p: Player, id: string): Player => ({
  ...p, id, contract: { ...p.contract }, career: { ...p.career }, xp: { ...p.xp }, potential: { ...p.potential }, catTalent: { ...p.catTalent },
});

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  const NT = 7;
  const rng = createRng(424242);

  // 1) 표준 16인(전 팀 공통 원본)
  const canon: Player[] = ROSTER.map((pos, j) => makePlayer(rng, `canon_${j}`, pos, pos === 'OP' && j === 8, undefined, 0));

  // 2) 코치 투자 그래디언트 — 분야 다양 + 인원 0~3 (역량 합 = 투자). 감독·선수·신인 동일, 코치만 차별.
  const plans: CoachSpecialty[][] = [
    [],
    ['attack'],
    ['attack', 'defense'],
    ['stamina'],
    ['attack', 'defense', 'stamina'],
    ['setter', 'mental'],
    ['attack', 'defense', 'setter'],
  ];
  const mkAsst = (sp: CoachSpecialty, i: number): AssistantCoach => ({ id: `a${i}`, name: sp, age: 45, specialty: sp, rating: 85, salary: assistantSalary(85), teamId: null });

  // 팀 상태
  const teams = Array.from({ length: NT }, (_, t) => ({
    id: `T${t}`,
    roster: canon.map((p, j) => clone(p, `T${t}_s${j}`)),
    slotPos: [...ROSTER],
    asst: plans[t].map((sp, i) => mkAsst(sp, t * 10 + i)),
    eff: staffEffects(plans[t].map((sp, i) => mkAsst(sp, t * 10 + i))),
    invest: plans[t].length * 85,
    titles: 0,
    rankSum: 0,
  }));

  let seed = 900000;
  let rookieCtr = 0;

  for (let s = 0; s < seasons; s++) {
    // ── 시즌: 더블 라운드로빈, 동일 감독 정보 ──
    const wins = new Array(NT).fill(0);
    for (let i = 0; i < NT; i++) for (let j = 0; j < NT; j++) {
      if (i === j) continue;
      seed += 7;
      const r = simulateMatch(seed, teams[i].roster, teams[j].roster, { home: FIXED_COACH, away: FIXED_COACH });
      if (r.homeSets > r.awaySets) wins[i]++; else wins[j]++;
    }
    // 순위·우승
    const order = [...teams.keys()].sort((a, b) => wins[b] - wins[a]);
    order.forEach((ti, rank) => { teams[ti].rankSum += rank + 1; });
    teams[order[0]].titles++;

    // ── 오프시즌: 코치별 성장+노쇠, 나이 은퇴(전 팀 동기), 동일 신인 투입 ──
    // 은퇴 슬롯을 (코치 무관) 표준 나이로 판정 — 전 팀 동일 슬롯
    const retireSlots: number[] = [];
    for (let j = 0; j < teams[0].roster.length; j++) {
      if (teams[0].roster[j].age + 1 > RETIRE_AGE) retireSlots.push(j);
    }
    // 슬롯별 동일 신인(원본) 미리 생성
    const rookieFor: Record<number, Player> = {};
    for (const j of retireSlots) rookieFor[j] = makeProspect(rng, `rk${rookieCtr++}`, teams[0].slotPos[j]);

    for (const tm of teams) {
      const next: Player[] = [];
      for (let j = 0; j < tm.roster.length; j++) {
        if (retireSlots.includes(j)) {
          next.push(clone(rookieFor[j], `${tm.id}_s${j}_v${s}`)); // 전 팀 동일 신인
        } else {
          const grown = evolvePlayer(tm.roster[j], FIXED_FOCUS, SEASON_LEN, tm.eff); // 코치 효과 반영
          next.push({ ...grown, age: grown.age + 1 });
        }
      }
      tm.roster = next;
    }
  }

  // ── 리포트 ──
  log(`\n═══ 코치 단독 통제 — 선수·감독·신인 전부 동일, 코치만 차별 · ${seasons}시즌 ═══`);
  log('코치 없으면 전 팀이 영원히 동일. 차이는 100% 코치에서 옴.\n');
  log('팀     코치(분야·역량85)              투자  우승  평균순위  최종전력');
  for (const tm of teams) {
    const asstStr = tm.asst.map((a) => SPECIALTY_KO[a.specialty]).join(',') || '없음';
    log(`  ${tm.id}  ${asstStr.padEnd(28)} ${String(tm.invest).padStart(4)}  ${String(tm.titles).padStart(3)}회  ${(tm.rankSum / seasons).toFixed(1)}위    ${teamOverall(tm.roster)}`);
  }
  const xs = teams.map((t) => t.invest);
  log(`\n▸ 상관계수 (코치 투자 ↔ 결과):`);
  log(`  투자 ↔ 우승      r=${pearson(xs, teams.map((t) => t.titles)).toFixed(2)}`);
  log(`  투자 ↔ 최종전력  r=${pearson(xs, teams.map((t) => teamOverall(t.roster))).toFixed(2)}`);
  log(`  투자 ↔ 평균순위  r=${pearson(xs, teams.map((t) => t.rankSum / seasons)).toFixed(2)}  (음수=투자↑일수록 상위)`);
  log(`\n  무지원(T0) 우승 ${teams[0].titles}회 vs 최다투자(T6) 우승 ${teams[6].titles}회`);
}

main();
