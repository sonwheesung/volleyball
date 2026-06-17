// 표시 OVR 분포 측정 — displayOvr 스트레치 파라미터(피벗·기울기·클램프)를 추측 없이 정하기 위해
// 선수 개인 overall()과 팀 teamOverall()의 분위수를 대표본(리시드 K)으로 수집.
//   npx tsx tools/ovrDist.ts [리시드=300]
import { LEAGUE, reseedLeague, getEvolvedTeamPlayers } from '../data/league';
import { overall, teamOverall, displayOvr } from '../engine/overall';
import type { Player, Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const K = Math.max(1, Number(process.argv[2]) || 300);

const players: number[] = [];
const teams: number[] = [];
const byPos: Record<string, number[]> = {};

for (let k = 0; k < K; k++) {
  reseedLeague(2000 + k * 17, 777);
  for (const t of LEAGUE.teams) {
    const pl: Player[] = getEvolvedTeamPlayers(t.id, 0);
    teams.push(teamOverall(pl));
    for (const p of pl) {
      const o = overall(p);
      players.push(o);
      (byPos[p.position] ??= []).push(o);
    }
  }
}

function stats(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
  return { n: a.length, m, sd, min: s[0], max: s[s.length - 1], p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99) };
}
const fmt = (x: number) => x.toFixed(1);
function line(label: string, a: number[]) {
  const s = stats(a);
  log(`  ${label.padEnd(14)} n=${String(s.n).padStart(6)}  평균 ${fmt(s.m)} ±${fmt(s.sd)}  범위 ${s.min}~${s.max}  [p5 ${s.p5} · p25 ${s.p25} · p50 ${s.p50} · p75 ${s.p75} · p95 ${s.p95}]`);
}

log(`\n═══ 표시 OVR 분포 — 리시드 ${K} ═══\n`);
log(`▸ 팀 (teamOverall, 상위7평균)`);
line('팀 raw', teams);
line('팀 표시', teams.map(displayOvr));
log(`\n▸ 선수 개인 (overall)`);
line('전체 raw', players);
line('전체 표시', players.map(displayOvr));
for (const pos of ['S', 'OH', 'OP', 'MB', 'L'] as Position[]) if (byPos[pos]) line(pos, byPos[pos]);
const clampLo = players.map(displayOvr).filter((x) => x <= 40).length;
const clampHi = players.map(displayOvr).filter((x) => x >= 99).length;
log(`\n  표시 클램프: 하한(40) ${(clampLo / players.length * 100).toFixed(1)}% · 상한(99) ${(clampHi / players.length * 100).toFixed(1)}%`);
log('');
