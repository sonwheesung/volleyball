// 서브 팀 전위(네트 밀착) 측정 — 사용자 보고: "서브할 때 서브하는 팀 전위는 블로킹 라인에
// 가까이 붙어있어야 하는데, 겹쳐 보이고(뒷통수에 손) 위치가 바뀐다."
// 프레임 정확 모델(auditBoard와 동일 cur/anim/posAt)로 서브 국면 동안 서브 팀 전위 3명의
//   ① 네트와의 거리(px)  ② 같은 팀 전위 최소 간격(겹침)  ③ 서브 컨택→상대 토스까지 좌우 순서 뒤집힘
// 을 잰다.  npx tsx tools/checkServeFront.ts [경기수=12]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, SEG_DUR, markerTravelMs, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import { lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, SPEED = 2, NET_Y = 0.5 * H, M = 9 / W;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 12);
type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

const netGapContact: number[] = []; // 서브 컨택 순간 전위 평균 네트 거리(px)
const minSepContact: number[] = []; // 서브 컨택 순간 전위 최소 간격(px)
let serves = 0, overlapFrames = 0, totalServePhaseFrames = 0, crossings = 0, transitions = 0;
const examples: string[] = [];

for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 515151 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);

  const cur: Record<string, Pt> = {};
  const anim: Record<string, { from: Pt; to: Pt; t0: number; dur: number }> = {};
  const lastTargets: Record<string, Pt> = {};
  let prevLast: Pt | undefined; let tNow = 0;
  const posAt = (key: string, t: number): Pt => {
    const a = anim[key]; if (!a) return cur[key];
    const u = Math.max(0, Math.min(1, (t - a.t0) / a.dur));
    return lerp(a.from, a.to, easeOut(u));
  };

  for (const r of rallies) {
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    const sv: Side = r.serving;
    const svRot = sv === 'home' ? stage.homeRot : stage.awayRot;
    const front = [2, 3, 4].map((z) => lineupIdxAt(svRot, z)); // 서브 팀 전위 슬롯
    const netGap = (p: Pt) => (sv === 'home' ? p.y - NET_Y : NET_Y - p.y); // 네트로부터 거리(px, +면 자기 코트)

    // 서브 국면: serve 구간부터 상대 toss 직전까지(이 동안 서브 팀은 전위를 네트에 붙이고 수비 전환)
    let inServePhase = false;
    let contactDone = false;

    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] };
      const targets = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);

      if (seg.to.kind === 'serve' && !contactDone) {
        contactDone = true; inServePhase = true; serves++;
        const fp = front.map((i) => targets[`${sv}-${i}`]).filter(Boolean) as Pt[];
        if (fp.length === 3) {
          netGapContact.push(fp.reduce((s, p) => s + netGap(p), 0) / 3);
          let mn = Infinity;
          for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) mn = Math.min(mn, dist(fp[a], fp[b]));
          minSepContact.push(mn);
        }
      }
      if (seg.to.kind === 'toss' && seg.to.side !== sv) inServePhase = false; // 상대가 공격 조직 = 국면 종료

      // 애니메이션 진행(프레임 모델)
      for (const [key, tgt] of Object.entries(targets)) {
        if (!cur[key]) { cur[key] = { ...tgt }; continue; }
        const prevTgt = anim[key]?.to ?? cur[key];
        if (Math.round(prevTgt.x) !== Math.round(tgt.x) || Math.round(prevTgt.y) !== Math.round(tgt.y)) {
          const fromP = posAt(key, tNow);
          anim[key] = { from: fromP, to: { ...tgt }, t0: tNow, dur: markerTravelMs(dist(fromP, tgt)) };
        }
        lastTargets[key] = tgt;
      }
      const segDur = (seg.to.dur ?? SEG_DUR[seg.to.kind]) * SPEED;

      // 서브 국면 동안 프레임별 전위 겹침 측정
      if (inServePhase) {
        const steps = Math.max(1, Math.round(segDur / 40));
        for (let s = 1; s <= steps; s++) {
          const t = tNow + s * 40;
          totalServePhaseFrames++;
          const fp = front.map((i) => posAt(`${sv}-${i}`, t));
          let mn = Infinity;
          for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) mn = Math.min(mn, dist(fp[a], fp[b]));
          if (mn < 24) { // 마커 지름 30px → 24px 미만이면 시각적으로 겹쳐 보임
            overlapFrames++;
            if (examples.length < 6) examples.push(`경기${m + 1} ${r.setNo}세트 ${r.home}:${r.away} ${sv} 전위 최소간격 ${mn.toFixed(0)}px (${seg.to.kind})`);
          }
        }
      }
      tNow += segDur;
      for (const key of Object.keys(cur)) cur[key] = posAt(key, tNow);
    }
  }
}

const stat = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { med: s[Math.floor(s.length / 2)] ?? 0, p10: s[Math.floor(s.length * 0.1)] ?? 0, p90: s[Math.floor(s.length * 0.9)] ?? 0, min: s[0] ?? 0, max: s[s.length - 1] ?? 0 }; };

log(`\n═══ 서브 팀 전위 — ${N}경기 / 서브 ${serves}회 ═══`);
{ const s = stat(netGapContact); log(`▸ 서브 컨택 순간 전위 네트 거리(px): 중앙값 ${s.med.toFixed(0)} · p10 ${s.p10.toFixed(0)} · p90 ${s.p90.toFixed(0)} (${(s.med * M).toFixed(2)}m, 작을수록 네트 밀착)`); }
{ const s = stat(minSepContact); log(`▸ 서브 컨택 순간 전위 최소 간격(px): 중앙값 ${s.med.toFixed(0)} · 최소 ${s.min.toFixed(0)} (마커 지름 30 — 24 미만이면 겹침)`); }
log(`▸ 서브 국면 전위 겹침 프레임: ${overlapFrames} / ${totalServePhaseFrames} (${(100 * overlapFrames / Math.max(1, totalServePhaseFrames)).toFixed(2)}%)`);
for (const e of examples) log('  · ' + e);
log('완료.');
