// OVR↔실전력 정밀 진단 (대표본) — 리그를 K번 리시드해 각 팀의 표시 OVR과 실제 승률(더블
// 라운드로빈 R회)을 모은다. ovrCheck(N=7 단일리그)의 한계를 넘어 강건한 상관 + 원인 분리.
//
//   npx tsx tools/ovrDiag.ts [리시드=120] [라운드로빈반복=4]
//
// 측정: ① r(teamOverall, 승률) 풀링(N=7×K팀) ② 같은 OVR 팀의 승률 분산(해상도)
//       ③ 잔차(승률−OVR예측)가 무엇과 상관되나 — 세터 세팅(승수 가설)·실제 선발 라인업 평균
//       ·공격 코어. 잔차 상관이 큰 항목 = OVR이 놓치는 요인.
import { LEAGUE, reseedLeague, getEvolvedTeamPlayers, coachInfoOf } from '../data/league';
import { simulateMatch } from '../engine/match';
import { teamOverall, teamOverallRaw, overall, displayOvr } from '../engine/overall';
import { deriveRatings } from '../engine/ratings';
import { buildLineup } from '../engine/lineup';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const K = Math.max(1, Number(process.argv[2]) || 120);
const R = Math.max(1, Number(process.argv[3]) || 4);

interface Row { ovr: number; win: number; setRtg: number; startAvg: number; atkCore: number; }
const rows: Row[] = [];
const rawOvr: number[] = [];     // 원시 표시 OVR(중심화 전) — 분포 폭(해상도) 측정
const rawWin: number[] = [];     // 원시 승률
let leagueOvrRangeSum = 0;       // 리그별 OVR(max-min) 평균 — 7팀이 몇 점 밴드에 깔리나
let sameOvrSpreadSum = 0, sameOvrGroups = 0; // 같은 OVR(정수, raw) 팀들의 승률 max-min 평균
let dispSpreadSum = 0, dispGroups = 0;       // 같은 표시 OVR(스트레치) 팀들의 승률 max-min 평균
let totalMatches = 0;

for (let k = 0; k < K; k++) {
  reseedLeague(1000 + k * 13, 777);
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, Player[]> = {};
  for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);
  const wins: Record<string, number> = {};
  for (const id of ids) wins[id] = 0;

  let seed = (k + 1) * 100003;
  for (let r = 0; r < R; r++) {
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      seed += 7;
      const sim = simulateMatch(seed, sq[ids[i]], sq[ids[j]], { home: coachInfoOf(ids[i]), away: coachInfoOf(ids[j]) });
      if (sim.homeSets > sim.awaySets) wins[ids[i]]++; else wins[ids[j]]++;
      totalMatches++;
    }
  }
  const gamesPer = R * (ids.length - 1) * 2;

  const tRows = ids.map((id) => {
    const pl = sq[id];
    const setters = pl.filter((p) => p.position === 'S');
    const setRtg = setters.length ? Math.max(...setters.map((p) => deriveRatings(p).set)) : 0;
    const lu = buildLineup(pl);
    const startAvg = lu.six.reduce((a, p) => a + overall(p), 0) / lu.six.length;
    const atk = pl.filter((p) => p.position === 'OH' || p.position === 'OP')
      .map((p) => deriveRatings(p).spike).sort((a, b) => b - a);
    const atkCore = atk.slice(0, 3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, atk.length));
    return { id, ovr: teamOverall(pl), ovrRaw: teamOverallRaw(pl), win: wins[id] / gamesPer, setRtg, startAvg, atkCore };
  });

  // 같은 정수 OVR 그룹의 승률 분산(해상도) — raw 정수 vs 연속값 스트레치(displayOvr)
  const byOvr: Record<number, number[]> = {};
  for (const t of tRows) (byOvr[t.ovr] ??= []).push(t.win);
  for (const v of Object.values(byOvr)) if (v.length >= 2) { sameOvrSpreadSum += Math.max(...v) - Math.min(...v); sameOvrGroups++; }
  const byDisp: Record<number, number[]> = {};
  for (const t of tRows) (byDisp[displayOvr(t.ovrRaw)] ??= []).push(t.win); // 연속값을 스트레치 후 정수화
  for (const v of Object.values(byDisp)) if (v.length >= 2) { dispSpreadSum += Math.max(...v) - Math.min(...v); dispGroups++; }
  leagueOvrRangeSum += Math.max(...tRows.map((t) => t.ovr)) - Math.min(...tRows.map((t) => t.ovr));
  for (const t of tRows) { rawOvr.push(t.ovr); rawWin.push(t.win); }

  // 리그 내 평균 중심화(승률은 리그 상대치 → 크로스리그 스케일 제거)
  const mean = (f: (r: typeof tRows[0]) => number) => tRows.reduce((a, r) => a + f(r), 0) / tRows.length;
  const mO = mean((r) => r.ovr), mW = mean((r) => r.win), mS = mean((r) => r.setRtg), mSt = mean((r) => r.startAvg), mA = mean((r) => r.atkCore);
  for (const r of tRows) rows.push({ ovr: r.ovr - mO, win: r.win - mW, setRtg: r.setRtg - mS, startAvg: r.startAvg - mSt, atkCore: r.atkCore - mA });
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}

const ovrA = rows.map((r) => r.ovr), winA = rows.map((r) => r.win);
const rOvr = corr(ovrA, winA);
const rStart = corr(rows.map((r) => r.startAvg), winA);
const rSet = corr(rows.map((r) => r.setRtg), winA);
const rAtk = corr(rows.map((r) => r.atkCore), winA);

// 잔차: win ~ b·ovr (중심화돼 절편 0), 잔차의 다른 요인 상관
const b = ovrA.reduce((a, _, i) => a + ovrA[i] * winA[i], 0) / ovrA.reduce((a, x) => a + x * x, 0);
const resid = rows.map((r) => r.win - b * r.ovr);
const rResSet = corr(resid, rows.map((r) => r.setRtg));
const rResStart = corr(resid, rows.map((r) => r.startAvg));
const rResAtk = corr(resid, rows.map((r) => r.atkCore));

const std = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, y) => s + (y - m) ** 2, 0) / a.length); };
const ovrStd = std(rawOvr), winStd = std(rawWin);
const ovrMin = Math.min(...rawOvr), ovrMax = Math.max(...rawOvr);

log(`\n═══ OVR↔실전력 정밀 진단 — 리시드 ${K} × 라운드로빈 ${R}회 (팀 표본 ${rows.length}, 경기 ${totalMatches.toLocaleString()}) ═══\n`);
log(`▸ 표시 OVR 분포(해상도)`);
log(`  전체 OVR 범위 ${ovrMin}~${ovrMax} · 표준편차 ${ovrStd.toFixed(2)}점`);
log(`  리그(7팀) 내 OVR 밴드 평균 = ${(leagueOvrRangeSum / K).toFixed(1)}점  (이 안에 승률 0~100%가 다 들어감)`);
log(`  승률 표준편차 ${(winStd * 100).toFixed(1)}%p → OVR 1점당 ≈ ${(winStd ? (1 / (ovrStd / (winStd * 100))) : 0).toFixed(1)}%p 승률 (정수 반올림 ±0.5점=±${(0.5 * (winStd * 100) / ovrStd).toFixed(1)}%p 분해불가)`);

log(`▸ 표시 OVR(teamOverall, 상위7평균)의 승률 예측력`);
log(`  r(OVR, 승률)             = ${rOvr.toFixed(3)}`);
log(`  같은 정수 OVR 팀 승률 격차: raw ${(sameOvrSpreadSum / Math.max(1, sameOvrGroups) * 100).toFixed(1)}%p(${sameOvrGroups}그룹) → 표시스트레치 ${(dispSpreadSum / Math.max(1, dispGroups) * 100).toFixed(1)}%p(${dispGroups}그룹)`);
log(`\n▸ 대안 추정치의 예측력 (무엇이 더 잘 맞나)`);
log(`  r(실제 선발6 OVR평균, 승률) = ${rStart.toFixed(3)}`);
log(`  r(세터 세팅레이팅, 승률)    = ${rSet.toFixed(3)}`);
log(`  r(공격코어 top3, 승률)     = ${rAtk.toFixed(3)}`);
log(`\n▸ 잔차 분석 (OVR로 설명 못한 승률이 무엇과 상관 — OVR이 놓치는 요인)`);
log(`  r(잔차, 세터 세팅)        = ${rResSet.toFixed(3)}`);
log(`  r(잔차, 선발6 평균)       = ${rResStart.toFixed(3)}`);
log(`  r(잔차, 공격코어)         = ${rResAtk.toFixed(3)}`);
log('');
