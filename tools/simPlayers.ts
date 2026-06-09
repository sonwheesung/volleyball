// 선수 운용 진단 — 신인이 잘 크는지 / 잘 큰 선수가 팀을 옮기는지 / 재계약하는지.
// 시즌마다 전 선수의 OVR·나이·소속·계약을 스냅샷해 생애 궤적을 추적(결정론, 전 구단 AI).
//
//   npx tsx tools/simPlayers.ts [시즌수=60]
//
// store.endSeason 오케스트레이션을 재현(advanceOffseason)해 N시즌을 돌리고,
// (1) 신인 성장 곡선 (2) 잘 큰 선수의 이동 (3) FA 자격 선수 거취(재계약/이적/은퇴)를 집계.

import {
  getTeam, resetLeagueBase, commitPlayerBase, commitRosters,
  currentBasePlayers, currentRosters, teamScoutReveal,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { accrueCareer } from '../engine/production';
import { applyMatchXp } from '../engine/experience';
import { overall } from '../engine/overall';
import type { Position } from '../types';

/** 한 시즌 오프시즌 진행 — store.endSeason 재현. 은퇴 명예의전당 등재 후보 반환(검증용). */
function advanceOffseason(season: number): { name: string; points: number; seasons: number; legend: boolean }[] {
  const nextSeason = season + 1;
  const my = '';
  const ctx = buildDraftContext(my, {}, {}, [], false, [], nextSeason);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], nextSeason);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      const pr = seasonProd.get(id);
      if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
    }
  }
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      const prev = ctx.prevTeamOf[id];
      if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
    }
  }
  // 은퇴 명예의전당 등재(store.endSeason 3.6 재현) — 검증용 반환
  const hof: { name: string; points: number; seasons: number; legend: boolean }[] = [];
  for (const id of ctx.retired) {
    const base = snapshot[id];
    if (!base) continue;
    const c = accrueCareer(base, seasonProd.get(id)).career;
    if (c.points >= 4000) hof.push({ name: base.name, points: c.points, seasons: c.seasons, legend: c.points >= 9000 });
  }

  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  return hof;
}

interface Obs {
  season: number; ovr: number; age: number; team: string;
  pos: Position; career: number; remaining: number; isForeign: boolean;
}

const pct = (x: number, d: number) => (d > 0 ? (x / d * 100) : 0).toFixed(1) + '%';
const f1 = (x: number) => x.toFixed(1);
const log = (m: string) => process.stdout.write(m + '\n');
const tierOf = (ovr: number) => (ovr >= 80 ? 'star' : ovr >= 72 ? 'reg' : 'fringe');

function main(): void {
  const seasons = Math.max(5, Number(process.argv[2]) || 60);
  resetLeagueBase();

  // 시즌별 전 선수 관측 기록
  const hist = new Map<string, Obs[]>();
  const hof: { name: string; points: number; seasons: number; legend: boolean }[] = [];
  for (let s = 0; s < seasons; s++) {
    const base = currentBasePlayers();
    const rosters = currentRosters();
    const teamOf: Record<string, string> = {};
    for (const t of Object.keys(rosters)) for (const id of rosters[t]) teamOf[id] = t;
    for (const p of base) {
      const arr = hist.get(p.id) ?? [];
      arr.push({
        season: s, ovr: overall(p), age: p.age, team: teamOf[p.id] ?? '?',
        pos: p.position, career: p.career.seasons, remaining: p.contract.remaining, isForeign: p.isForeign,
      });
      hist.set(p.id, arr);
    }
    hof.push(...advanceOffseason(s));
  }

  log(`\n═══ 선수 운용 진단 · ${seasons}시즌 (고정 시드, 전 구단 AI) ═══`);

  // ── (0) 리그 평균 OVR 추이 — 육성이 시드 전력을 유지하는가(붕괴 진단) ──
  const ovrBySeason: number[] = [];
  for (let s = 0; s < seasons; s++) {
    const vals: number[] = [];
    for (const h of hist.values()) { const o = h.find((x) => x.season === s); if (o) vals.push(o.ovr); }
    ovrBySeason.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  const ck = (s: number) => `${s}시즌 ${f1(ovrBySeason[s] ?? 0)}`;
  log(`\n[0] 리그 평균 OVR 추이: ${ck(0)} → ${ck(Math.floor(seasons / 2))} → ${ck(seasons - 1)}`);

  // ── (1) 신인 성장: 어릴 때(첫 관측 age≤20) 진입한 국내 선수 코호트 ──
  const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
  const rookies = [...hist.values()].filter((h) => !h[0].isForeign && h[0].age <= 20 && h[0].season > 0);
  // season>0: 시드(0시즌 일괄생성) 제외, 실제 드래프트/충원으로 들어온 신인만
  let sumEntry = 0, sumPeak = 0, sumGrowth = 0, sumPeakAge = 0;
  const peakTier = { star: 0, reg: 0, fringe: 0 };
  const byPos: Record<Position, { n: number; entry: number; peak: number; peakAge: number }> = {
    S: { n: 0, entry: 0, peak: 0, peakAge: 0 }, OH: { n: 0, entry: 0, peak: 0, peakAge: 0 },
    OP: { n: 0, entry: 0, peak: 0, peakAge: 0 }, MB: { n: 0, entry: 0, peak: 0, peakAge: 0 },
    L: { n: 0, entry: 0, peak: 0, peakAge: 0 },
  };
  for (const h of rookies) {
    const entry = h[0].ovr;
    let peak = h[0].ovr, peakAge = h[0].age;
    for (const o of h) if (o.ovr > peak) { peak = o.ovr; peakAge = o.age; }
    sumEntry += entry; sumPeak += peak; sumGrowth += peak - entry; sumPeakAge += peakAge;
    peakTier[tierOf(peak)]++;
    const b = byPos[h[0].pos]; b.n++; b.entry += entry; b.peak += peak; b.peakAge += peakAge;
  }
  const nR = rookies.length;
  log(`\n[1] 신인 성장 (어린 국내 신인 ${nR}명 — 첫 관측 age≤20)`);
  log(`  진입 OVR 평균 ${f1(sumEntry / nR)} → 전성기 OVR 평균 ${f1(sumPeak / nR)}  (성장 +${f1(sumGrowth / nR)}, 전성기 평균 ${f1(sumPeakAge / nR)}세)`);
  log(`  전성기 도달 등급:  스타(≥80) ${pct(peakTier.star, nR)}  ·  주전(72~79) ${pct(peakTier.reg, nR)}  ·  미달(<72) ${pct(peakTier.fringe, nR)}`);
  log(`  포지션별 진입→전성기 OVR (전성기 나이):`);
  for (const pos of POS) {
    const b = byPos[pos];
    if (!b.n) continue;
    log(`    ${pos.padEnd(3)} ${b.n}명  ${f1(b.entry / b.n)} → ${f1(b.peak / b.n)}  (${f1(b.peakAge / b.n)}세)`);
  }

  // ── (2) 잘 큰 신인의 이동: 전성기 OVR 티어별 "한 팀에서만 뛰었나" ──
  // 충분히 커리어가 진행된(관측 8시즌+) 국내 선수만, 전성기 티어로 분류
  const longCareer = [...hist.values()].filter((h) => !h[0].isForeign && h.length >= 8);
  const moveStat = {
    star: { n: 0, oneClub: 0, teams: 0 }, reg: { n: 0, oneClub: 0, teams: 0 }, fringe: { n: 0, oneClub: 0, teams: 0 },
  };
  for (const h of longCareer) {
    let peak = 0; for (const o of h) peak = Math.max(peak, o.ovr);
    const teams = new Set(h.map((o) => o.team).filter((t) => t !== '?'));
    const t = moveStat[tierOf(peak)];
    t.n++; t.teams += teams.size; if (teams.size <= 1) t.oneClub++;
  }
  log(`\n[2] 잘 큰 선수가 팀을 옮기나 (커리어 8시즌+ 국내선수, 전성기 등급별)`);
  log(`  등급        인원   한 팀에서만(원클럽)   평균 소속팀 수`);
  for (const k of ['star', 'reg', 'fringe'] as const) {
    const t = moveStat[k];
    if (!t.n) continue;
    const label = k === 'star' ? '스타(≥80)' : k === 'reg' ? '주전(72~79)' : '미달(<72)';
    log(`  ${label.padEnd(12)} ${String(t.n).padStart(3)}명   ${pct(t.oneClub, t.n).padStart(6)}            ${f1(t.teams / t.n)}`);
  }

  // ── (3) FA 자격 선수 거취: 재계약(잔류) / 이적 / 은퇴 — OVR 티어별 ──
  // 시즌 s에 FA 자격(career≥6, remaining≤1)인 선수가 s+1에 잔류/이적/은퇴했는지
  const fate = {
    star: { n: 0, stay: 0, move: 0, retire: 0 },
    reg: { n: 0, stay: 0, move: 0, retire: 0 },
    fringe: { n: 0, stay: 0, move: 0, retire: 0 },
  };
  for (const h of hist.values()) {
    for (let i = 0; i < h.length; i++) {
      const o = h[i];
      const eligible = o.career >= 6 && o.remaining <= 1;
      if (!eligible) continue;
      const t = fate[tierOf(o.ovr)];
      t.n++;
      const nxt = h[i + 1];
      if (!nxt || nxt.season !== o.season + 1) t.retire++;       // 다음 시즌 사라짐 = 은퇴
      else if (nxt.team !== o.team) t.move++;                     // 팀 변경 = 이적
      else t.stay++;                                             // 잔류 = 재계약
    }
  }
  log(`\n[3] FA 자격 선수 거취 (career≥6 & 계약만료, OVR 티어별)`);
  log(`  등급        건수   재계약(잔류)   이적     은퇴`);
  for (const k of ['star', 'reg', 'fringe'] as const) {
    const t = fate[k];
    if (!t.n) continue;
    const label = k === 'star' ? '스타(≥80)' : k === 'reg' ? '주전(72~79)' : '미달(<72)';
    log(`  ${label.padEnd(12)} ${String(t.n).padStart(4)}   ${pct(t.stay, t.n).padStart(6)}       ${pct(t.move, t.n).padStart(6)}   ${pct(t.retire, t.n).padStart(6)}`);
  }

  // [4] 통산 기록 누적 검증 — 현역 선수 통산 득점 상위(시드값보다 커지면 누적 작동)
  const finalBase = currentBasePlayers();
  const topCareer = [...finalBase].sort((a, b) => b.career.points - a.career.points).slice(0, 5);
  log(`\n[4] 통산 기록 누적 (현역 통산 득점 상위 5)`);
  for (const p of topCareer) {
    log(`  ${p.name.padEnd(10)} ${p.position.padEnd(2)} ${p.age}세 — 통산 득점 ${p.career.points}  블록 ${p.career.blocks}  디그 ${p.career.digs}  (${p.career.seasons}시즌 ${p.career.matches}경기)`);
  }

  // [5] 명예의전당 — 은퇴 레전드 보존 검증
  const legends = hof.filter((h) => h.legend).length;
  log(`\n[5] 명예의전당 등재(은퇴 통산 4000점+) ${hof.length}명 (영구결번 ${legends}명)`);
  for (const h of [...hof].sort((a, b) => b.points - a.points).slice(0, 5)) {
    log(`  ${h.legend ? '🎖️' : '🏅'} ${h.name.padEnd(10)} 통산 ${h.points}점 (${h.seasons}시즌)`);
  }
}

main();
