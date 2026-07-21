// INDEPENDENT — 인플레이 포지션 종합 가드: 공격 스프레드 + 블록 정렬 + 페리미터 수비(2026-06-24).
// 서브/리시브 국면은 _dv_overlap·_dv_receive·auditBoard 가 담당. 이 도구는 **토스(공격 전개) 국면**을 본다.
// 핵심 교훈(룰57 후속): 인시스템(정식 세터가 토스)만 검사하고, **세트 받으러 접근 중인 공격수(mover)는 핀에서
// 벗어나는 게 정상**이라 제외 — "대기 공격수"가 자기 핀(switchedSpots)에 있는지만 본다. 측정 결과(24경기):
//   대기 공격수 핀 일치 100%(dev 0.000) · 블록↔공격 0.000 · 페리미터 폭 0.56. (OOS·mover는 정상 변형)
//   npx tsx tools/_dv_position.ts [경기수=24]
import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE, coachInfoOf } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';
import { segmentTargets, reconstructRallies, applySubsToSix } from '../components/courtDirector';
import { ballPath } from '../components/courtPath';
import { switchedSpots, type Px } from '../components/courtLayout';
import type { Side } from '../types';

const W = 400, H = 560, SO = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const nM = Math.max(1, Number(process.argv[2]) || 24);
resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const med = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const fy = (side: Side, v: number) => side === 'home' ? v / H : 1 - v / H;

const devStill: number[] = [];          // 대기 공격수 ↔ 자기 핀 거리(분수, 0이어야)
let stillN = 0, stillAtPin = 0, abFail = 0; // A/B: 일부러 핀을 틀리게 주면 잡혀야
const blockGap: number[] = [];          // 블록 중심 ↔ 공격 도착 x(분수, 작아야)
const perimW: number[] = [];            // 후위 3명 가로 폭(분수, 넓어야)
let tosses = 0, oos = 0;

for (let m = 0; m < nM; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 3) % teams.length]; if (hId === aId) continue;
  const hs = getEvolvedTeamPlayers(hId, 0), as = getEvolvedTeamPlayers(aId, 0);
  const sim = simulateMatch(1000 + m * 31, hs, as, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);
  const base = { home: buildLineup(hs, coachInfoOf(hId)?.dvPhilosophy ?? 0), away: buildLineup(as, coachInfoOf(aId)?.dvPhilosophy ?? 0) }; // 엔진 six와 동일 인자(육성철학) — subEvents 재생 슬롯 정합
  const byId = new Map<string, any>(); for (const p of hs) byId.set(p.id, p); for (const p of as) byId.set(p.id, p);
  const eff = (i: number) => ({ home: { ...base.home, six: applySubsToSix(base.home.six, 'home', sim.subEvents, i, byId) }, away: { ...base.away, six: applySubsToSix(base.away.six, 'away', sim.subEvents, i, byId) } });
  for (let ri = 0; ri < rallies.length; ri++) {
    const rally = rallies[ri]; const lu = eff(ri);
    let prevLast: Px | undefined; if (ri > 0) { const pp = ballPath(rallies[ri - 1], 1000 + m * 31, eff(ri - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(rally, 1000 + m * 31, lu, W, H, SO, prevLast);
    const stage = { serving: rally.serving, homeRot: rally.homeRot, awayRot: rally.awayRot };
    for (let s = 0; s < path.length - 1; s++) {
      const seg = { from: path[s], to: path[s + 1] }; if (seg.to.kind !== 'toss') continue;
      tosses++;
      const att: Side = seg.to.side, def: Side = att === 'home' ? 'away' : 'home';
      const aLu = att === 'home' ? lu.home : lu.away;
      const aRot = att === 'home' ? stage.homeRot : stage.awayRot, dRot = def === 'home' ? stage.homeRot : stage.awayRot;
      const sIdx = aLu.six.findIndex((p) => p.position === 'S');
      const tg = segmentTargets(seg, stage, lu, W, H, SO);
      // ── 블록·페리미터(인/아웃 무관) ──
      const dFront = [2, 3, 4].map((z) => (dRot + z - 1) % 6);
      const atNet = dFront.map((i) => ({ x: (tg[`${def}-${i}`]?.x ?? 0) / W, y: fy(def, tg[`${def}-${i}`]?.y ?? 0) })).filter((p) => p.y <= 0.12);
      if (atNet.length) blockGap.push(Math.abs(atNet.reduce((a, b) => a + b.x, 0) / atNet.length - seg.to.x / W));
      const dBack = [1, 5, 6].map((z) => (dRot + z - 1) % 6).map((i) => (tg[`${def}-${i}`]?.x ?? 0) / W);
      perimW.push(Math.max(...dBack) - Math.min(...dBack));
      // ── 공격 스프레드: 인시스템·세터후위만, 대기 공격수(비mover)가 핀에 있나 ──
      if (seg.from.idx !== sIdx) { oos++; continue; }
      const front = [2, 3, 4].map((z) => (aRot + z - 1) % 6).filter((i) => i !== sIdx);
      if (front.length < 3) continue;
      const ideal = switchedSpots(att, aLu, aRot, true, W, H).pos;
      const movers = new Set((seg.to.movers ?? []).filter((mv: any) => mv.side === att).map((mv: any) => mv.idx));
      for (const i of front) {
        if (movers.has(i)) continue; // 접근 중은 핀에서 벗어나는 게 정상
        const dev = Math.abs((tg[`${att}-${i}`]?.x ?? 0) - ideal[i].x) / W;
        devStill.push(dev); stillN++; if (dev <= 0.06) stillAtPin++;
        // A/B 자가검증: 실제 위치를 0.15 옮기면 dev>0.06로 "벗어남" 잡혀야(오라클 유효). 잡힘=정상.
        if (Math.abs(((tg[`${att}-${i}`]?.x ?? 0) + 0.15 * W) - ideal[i].x) / W <= 0.06) abFail++; // 옮겼는데도 핀근처면 둔감
      }
    }
  }
}

const okAtk = med(devStill) <= 0.02 && stillAtPin / Math.max(1, stillN) >= 0.95;
const okBlk = med(blockGap) <= 0.12, okPer = med(perimW) >= 0.45;
log(`═══ 인플레이 포지션 가드 (${nM}경기 · 토스 ${tosses}개 · 인시스템 검사 / OOS ${oos} 제외) ═══`);
log(`[공격] 대기 공격수 핀 일치: dev 중앙값 ${med(devStill).toFixed(3)} · 핀근처 ${stillAtPin}/${stillN} (${(100 * stillAtPin / Math.max(1, stillN)).toFixed(0)}%)  ${okAtk ? '✅' : '⚠'}`);
log(`[블록] 블록 중심 ↔ 공격 도착 x: ${med(blockGap).toFixed(3)}  ${okBlk ? '✅' : '⚠'}`);
log(`[페리미터] 후위 3명 가로 폭: ${med(perimW).toFixed(2)}  ${okPer ? '✅' : '⚠'}`);
log(`\nA/B 자가검증(0.15 옮기면 잡히나): 정상 ${stillAtPin}/${stillN} · 0.15 옮긴 것 중 여전히 핀근처 ${abFail} → ${abFail < stillN * 0.02 ? '✅ 오라클 유효(옮기면 잡힘)' : '⚠ 오라클 둔감'}`);
log(okAtk && okBlk && okPer ? '\n결론: ✅ 공격 스프레드·블록·페리미터 모두 정상' : '\n결론: ⚠ 점검 필요');
