// 추첨/드래프트 순번 분포 상비 가드 (FA_SYSTEM §3 · FOREIGN_SYSTEM §1).
// 검증·실측=Fable 5 / 가드=Opus 에이전트, 2026-07-07.
//   npx tsx tools/_dv_lottery.ts      (engine only, DB 없음, N=20000 결정론 시드)
//
// 게임에는 서로 반대되는 **두 개의 추첨 모델**이 있고, 이 가드는 둘의 "위치 분포"가
// 설계대로인지 상시 감시한다(기존 외인/드래프트 가드는 풀·계약·FA누수·아키타입만 보고
// 순번 POSITION 분포는 아무도 안 봤다 — 그 사각을 닫는다):
//
//   ① 드래프트 1R 순번 = engine/draft.ts lotteryRound1(worstFirst, rng)
//      → **가중 추첨**. 꼴찌(worstFirst[0])가 최고 가중(worstFirst.length - i). 경쟁 균형:
//        하위 팀이 평균적으로 먼저 뽑되 보장은 아님(worst≈best 아님 — 확률적 우대).
//   ② 외인 트라이아웃 순번 = engine/foreign.ts tryoutOrder(season, teamIds, tag)
//      → **균등 셔플**(Fisher-Yates, seed=`tag:season`), **성적 무관**(설계: "꼴찌도 1픽 못 받는
//        비정함", FOREIGN_SYSTEM §1). 모든 팀이 모든 위치에 균등하게 떨어져야 한다.
//
// Fable 실측(이 가드가 재현/단언하는 값 — N=20000, 7팀 t0=꼴찌..t6=1위):
//   · 드래프트: 평균 픽위치(0=1픽) t0→t6 단조 증가 1.88…4.79 · 1픽률 t0=25.0% ≫ t6=3.6%
//   · 외인: 전 팀 평균순번 ≈3.00(스프레드 0.063<0.15) · 1픽률 ≈14.3%=1/7(스프레드 1.0%p<2%p)
//
// A/B 자가검증(허위 오라클 금지 — 두 검사기가 "가중 vs 균등"을 실제로 구별하는가):
//   (a) 균등 셔플(tryoutOrder식) 분포를 "가중 단조" 검사기에 넣으면 → 평평한 평균·worst≈best로
//       반드시 FAIL (드래프트 검사기가 가중을 진짜로 감지함을 증명).
//   (b) 가중 lotteryRound1 분포를 "균등" 검사기에 넣으면 → 큰 스프레드로 반드시 FAIL
//       (외인 검사기가 균등 아님을 진짜로 감지함을 증명).
//   [mutant 실측] (a) 균등→isMonotonicWeighted=false(avg 전부≈3.0·worst 1픽률≈best) ·
//                 (b) 가중→isUniform=false(avg 스프레드≈2.9≫0.15). 두 검사기 교차 증명됨.
//   exit 0=PASS / 1=FAIL.

import { createRng, strSeed } from '../engine/rng';
import { lotteryRound1 } from '../engine/draft';
import { tryoutOrder } from '../engine/foreign';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

const N = 20000;
// 7팀, 인덱스 0=꼴찌(worst)..6=1위(best). worstFirst 규약과 일치(하위가 앞).
const TEAMS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];

interface Dist { avg: number[]; firstRate: number[]; }

/** 순번 생성기를 N번 돌려 팀별 평균 위치(0=1픽)와 1픽률을 집계. teams 순서대로 반환. */
function tally(draw: (s: number) => string[], teams: string[]): Dist {
  const posSum: Record<string, number> = {};
  const firstCnt: Record<string, number> = {};
  for (const t of teams) { posSum[t] = 0; firstCnt[t] = 0; }
  for (let s = 0; s < N; s++) {
    draw(s).forEach((id, i) => { posSum[id] += i; if (i === 0) firstCnt[id]++; });
  }
  return {
    avg: teams.map((t) => posSum[t] / N),
    firstRate: teams.map((t) => firstCnt[t] / N),
  };
}

const spread = (a: number[]) => Math.max(...a) - Math.min(...a);

/** 검사기 A — 가중 단조: 평균 픽위치가 (꼴찌→1위)로 **엄격 증가** AND 꼴찌 1픽률 > 1위 1픽률.
 *  teams가 worst..best 순으로 정렬돼 있다고 가정(TEAMS 규약). */
function isMonotonicWeighted(d: Dist): boolean {
  for (let i = 1; i < d.avg.length; i++) if (!(d.avg[i] > d.avg[i - 1])) return false;
  return d.firstRate[0] > d.firstRate[d.firstRate.length - 1];
}

/** 검사기 B — 균등: 평균순번 스프레드 < 0.15 AND 1픽률 스프레드 < 0.02(=2%p). 성적 무관 균등. */
function isUniform(d: Dist): boolean {
  return spread(d.avg) < 0.15 && spread(d.firstRate) < 0.02;
}

const pct = (x: number) => (100 * x).toFixed(1);
function printDist(label: string, d: Dist): void {
  log(`  ${label}`);
  log(`    평균위치: ${TEAMS.map((t, i) => `${t}=${d.avg[i].toFixed(2)}`).join(' ')}`);
  log(`    1픽률   : ${TEAMS.map((t, i) => `${t}=${pct(d.firstRate[i])}%`).join(' ')}`);
}

// ── ① 드래프트 1R = 가중 추첨(lotteryRound1) ──
log(`① 드래프트 1R 순번 — 가중 추첨 lotteryRound1(worstFirst, rng) · N=${N}`);
const draftDist = tally(
  (s) => lotteryRound1(TEAMS, createRng(strSeed(`draft-lottery:${s}`))),
  TEAMS,
);
printDist('가중 분포(꼴찌 우대):', draftDist);
check(isMonotonicWeighted(draftDist),
  `가중 단조: 평균 픽위치 꼴찌→1위 증가(${draftDist.avg[0].toFixed(2)}→${draftDist.avg[6].toFixed(2)}) AND 꼴찌 1픽률(${pct(draftDist.firstRate[0])}%) > 1위(${pct(draftDist.firstRate[6])}%)`);

// ── ② 외인 트라이아웃 = 균등 셔플(tryoutOrder), 성적 무관 ──
log('');
log(`② 외인 트라이아웃 순번 — 균등 셔플 tryoutOrder(season, teamIds) · 성적 무관 · N=${N}`);
const foreignDist = tally((s) => tryoutOrder(s, TEAMS), TEAMS);
printDist('균등 분포(전 팀 동일):', foreignDist);
check(isUniform(foreignDist),
  `균등: 평균순번 스프레드 ${spread(foreignDist.avg).toFixed(3)} < 0.15 AND 1픽률 스프레드 ${(100 * spread(foreignDist.firstRate)).toFixed(1)}%p < 2%p`);

// ── A/B 자가검증(허위 오라클 금지): 두 검사기가 가중/균등을 실제로 구별하는가 ──
log('');
log('A/B 교차 자가검증 (검사기 이빨 증명):');
// (a) 균등 셔플을 "가중 단조" 검사기에 → 반드시 FAIL. 같은 7팀 위 tryoutOrder식 균등 추첨.
const uniformMut = tally((s) => tryoutOrder(s, TEAMS, 'lottery-mutant-uniform'), TEAMS);
const mutA = isMonotonicWeighted(uniformMut);
log(`  (a) 균등 분포 → isMonotonicWeighted = ${mutA} (avg 스프레드 ${spread(uniformMut.avg).toFixed(3)}·1픽률 스프레드 ${(100 * spread(uniformMut.firstRate)).toFixed(1)}%p)`);
check(mutA === false, `mutant(a) 감지: 균등 셔플은 "가중 단조" 검사를 FAIL시킴 (드래프트 검사기가 가중을 진짜 감지)`);
// (b) 가중 분포를 "균등" 검사기에 → 반드시 FAIL.
const mutB = isUniform(draftDist);
log(`  (b) 가중 분포 → isUniform = ${mutB} (avg 스프레드 ${spread(draftDist.avg).toFixed(3)} ≫ 0.15)`);
check(mutB === false, `mutant(b) 감지: 가중 lotteryRound1은 "균등" 검사를 FAIL시킴 (외인 검사기가 균등아님을 진짜 감지)`);

log('');
const total = 4;
const passed = total - fails.length;
if (fails.length) { log(`LOTTERY FAIL (${passed}/${total}) — ${fails.join(' / ')}`); process.exit(1); }
log(`LOTTERY PASS (${passed}/${total}) — ① 드래프트 가중 단조(1픽률 ${pct(draftDist.firstRate[0])}%≫${pct(draftDist.firstRate[6])}%·평균 ${draftDist.avg[0].toFixed(2)}→${draftDist.avg[6].toFixed(2)}) · ② 외인 균등(스프레드 ${spread(foreignDist.avg).toFixed(3)}·1픽률 ${(100 * spread(foreignDist.firstRate)).toFixed(1)}%p) · A/B 교차 mutant 자가검증`);
process.exit(0);
