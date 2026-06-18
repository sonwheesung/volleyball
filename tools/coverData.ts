// 커버 관련 데이터 조사 — 블록 커버(오늘 추가) + 스파이크 커버 위치를 종합 측정(추정 금지).
//   npx tsx tools/coverData.ts [경기수=20]
// 블록 커버 = 소프트 블록된 공을 공격팀이 자기 코트에서 살려 재공격(보드 연출, courtPath).
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type WP } from '../components/courtPath';
import { reconstructRallies, segmentTargets } from '../components/courtDirector';
import type { Side } from '../types';

const W = 360, H = 500, SO = 22, NETY = 0.5 * H, M = 9 / W;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 20);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const depthOf = (side: Side, y: number) => (side === 'home' ? (y - NETY) : (NETY - y)) / (0.5 * H); // 0=네트,1=엔드라인

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let matches = 0, sets = 0, rallies = 0;
let coversHome = 0, coversAway = 0;
const perRally: number[] = [];                 // 랠리별 커버 수
let ralliesWithCover = 0;
const coverDepth: number[] = [];               // 커버 낙구 깊이(공격팀 코트)
const coverTravel: number[] = [];              // 커버 디거 이동 거리(px)
const softBlockEvents = { cover: 0, defTrans: 0 };
// 스파이크 커버(스터프 시 공격팀 커버 다이브)
const stuffCoverTravel: number[] = [];
const stuffCoverGap: number[] = [];            // 커버 최근접 → 리바운드 거리(m)

for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  matches++; sets += sim.homeSets + sim.awaySets;
  const rs = reconstructRallies(sim);
  let prev: { x: number; y: number } | undefined;
  for (const r of rs) {
    rallies++;
    const path = ballPath(r, seed, L, W, H, SO, prev);
    prev = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prev;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    let coversThis = 0;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1];
      // 블록 직후(spike 블록터치=def 쪽) → 다음 pass
      if (a.kind === 'spike' && b.kind === 'pass' && a.aim) {
        if (a.side !== b.side) {
          // 커버: 블록터치 side(def) ≠ pass side(att=공격팀이 살림)
          softBlockEvents.cover++;
          coversThis++;
          if (b.side === 'home') coversHome++; else coversAway++;
          coverDepth.push(depthOf(b.side, b.y));
          // 커버 디거 이동 = pass mover의 출발(직전 구간)→도착
          const mv = (b.movers ?? [])[0];
          if (mv) {
            const before = segmentTargets({ from: path[Math.max(0, k - 1)], to: a }, stage, L, W, H, SO);
            const from = before[`${mv.side}-${mv.idx}`];
            if (from) coverTravel.push(dist(from, { x: mv.x, y: mv.y }));
          }
        } else {
          softBlockEvents.defTrans++;
        }
      }
    }
    perRally.push(coversThis);
    if (coversThis > 0) ralliesWithCover++;

    // 스터프 시 공격팀 커버 다이브(마지막 fault movers)
    if (r.how === 'stuff') {
      let fi = -1; for (let k = path.length - 1; k >= 1; k--) if (path[k].kind === 'fault') { fi = k; break; }
      if (fi >= 1) {
        const seg = { from: path[fi - 1], to: path[fi] };
        const before = segmentTargets({ from: path[Math.max(0, fi - 2)], to: path[fi - 1] }, stage, L, W, H, SO);
        const after = segmentTargets(seg, stage, L, W, H, SO, before);
        const ball = { x: path[fi].x, y: path[fi].y };
        let nearest = Infinity;
        for (const mv of seg.to.movers ?? []) {
          const from = before[`${mv.side}-${mv.idx}`] ?? { x: mv.x, y: mv.y };
          stuffCoverTravel.push(dist(from, { x: mv.x, y: mv.y }));
          nearest = Math.min(nearest, dist({ x: mv.x, y: mv.y }, ball));
        }
        if (nearest < Infinity) stuffCoverGap.push(nearest * M);
      }
    }
  }
}

const stat = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { med: s[Math.floor(s.length / 2)] ?? 0, p90: s[Math.floor(s.length * 0.9)] ?? 0, min: s[0] ?? 0, max: s[s.length - 1] ?? 0, mean: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length) }; };
const pct = (n: number, d: number) => (n / Math.max(1, d) * 100).toFixed(1) + '%';

log(`\n═══ 커버 데이터 조사 — ${matches}경기 / ${sets}세트 / ${rallies}랠리 ═══`);

log(`\n▸ 블록 커버 (공격팀이 막힌 공 살려 재공격 — 오늘 추가)`);
const totalCover = coversHome + coversAway;
log(`  총 ${totalCover}회  ·  세트당 ${(totalCover / sets).toFixed(2)}  ·  경기당 ${(totalCover / matches).toFixed(1)}  ·  랠리당 ${(totalCover / rallies).toFixed(3)}`);
log(`  커버 있는 랠리 비율: ${pct(ralliesWithCover, rallies)}  (랠리당 분포: ${[0, 1, 2, 3].map((k) => `${k}회 ${pct(perRally.filter((x) => (k === 3 ? x >= 3 : x === k)).length, rallies)}`).join(' · ')})`);
log(`  홈/원정 대칭: ${coversHome} / ${coversAway} (${pct(coversHome, totalCover)} / ${pct(coversAway, totalCover)})`);
log(`  소프트블록 중 커버 실현율: ${pct(softBlockEvents.cover, softBlockEvents.cover + softBlockEvents.defTrans)} (설정 BLOCK_COVER_RATE=42%)`);
{ const s = stat(coverDepth); log(`  커버 낙구 깊이: 중앙값 ${s.med.toFixed(2)} (0=네트·0.33=3m라인) — 네트 앞 살림`); }
{ const s = stat(coverTravel); log(`  커버 디거 이동: 중앙값 ${(s.med * M).toFixed(1)}m · 범위 ${(s.min * M).toFixed(1)}~${(s.max * M).toFixed(1)}m`); }

log(`\n▸ 스파이크 커버 (스터프 당할 때 공격팀 커버 다이브)`);
{ const s = stat(stuffCoverTravel); log(`  커버 다이브 이동: 중앙값 ${(s.med * M).toFixed(1)}m · p90 ${(s.p90 * M).toFixed(1)}m`); }
{ const s = stat(stuffCoverGap); log(`  커버 최근접 → 리바운드 거리: 중앙값 ${s.med.toFixed(1)}m · 범위 ${s.min.toFixed(1)}~${s.max.toFixed(1)}m (못 살림이 정상=스터프)`); }
log('');
