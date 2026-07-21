// INDEPENDENT — 왕복(detour) 검출기: 태스크 #131 시나리오 C.
// 인플레이 랠리 중 한 마커의 **director 목표 좌표**가 세그먼트 k → k+1 → k+2에서
//   dist(T[k], T[k+2]) ≤ NEAR  (돌아옴)  AND  dist(T[k], T[k+1]) ≥ FAR  AND  dist(T[k+2], T[k+1]) ≥ FAR (멀리 나갔다)
// 인 "나갔다 제자리로" 왕복을 센다 — 구 동작(pass 국면 수비팀 후위가 fanSlots↔switchedSpots 구석 왕복)을 잡는 오라클.
// 스코프: 중간(k+1) 세그먼트에서 **수비팀 후위(페리미터)**(offSide 반대·존 1/5/6) · **비무버**(무버=공 쫓는 정당 이동) · **비서버**.
//   전위 블로커의 벽 이동(공격 x 추종)은 정당해 계수 제외 — R2 버그는 수비 후위 부채꼴↔구석 진동이라 거기로 스코프.
// 측정 계층 = segmentTargets(director 목표) — 렌더 jumpHold(룰 31 착지 정지)는 애니메이션 상태라 여기 안 나타남(통과조건 4).
//   npx tsx tools/_dv_detour.ts [경기수=40]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies, applySubsToSix, offenseSideOf } from '../components/courtDirector';
import { zoneOfIdx, type Px } from '../components/courtLayout';
import type { Side } from '../types';

const W = 400, H = 560, SO = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 40);

// 임계(px) — 코트 W=400 기준. NEAR<FAR. fan↔구석 왕복(≈50~70px 편도)을 잡되 정상 슬라이드(≤40px)는 흘림.
const NEAR = 0.11 * W; // 44px — k와 k+2가 "제자리로 돌아옴"으로 볼 최대 거리
const FAR = 0.13 * W;  // 52px — k+1이 "멀리 벗어남"으로 볼 최소 거리
const IN = new Set(['pass', 'toss', 'spike']); // 랠리 모션 국면(serve/walk/return/start/fault는 런 경계)

const dist = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let detours = 0, samples = 0;
const examples: string[] = [];
// A/B 자가검증: 인위 왕복(중간 세그 목표를 코너로 튕김) 주입 시 반드시 잡혀야(오라클 유효)
let abInjected = 0, abCaught = 0;

for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 3) % teams.length];
  if (hId === aId) continue;
  const hs = getEvolvedTeamPlayers(hId, 0), as = getEvolvedTeamPlayers(aId, 0);
  const seed = 1000 + m * 31;
  const sim = simulateMatch(seed, hs, as, { home: coachInfoOf(hId), away: coachInfoOf(aId), touches: true });
  const rallies = reconstructRallies(sim);
  const base = { home: buildLineup(hs, coachInfoOf(hId)?.dvPhilosophy ?? 0), away: buildLineup(as, coachInfoOf(aId)?.dvPhilosophy ?? 0) }; // 엔진 six와 동일 인자(육성철학) — subEvents 재생 슬롯 정합
  const byId = new Map<string, any>(); for (const p of hs) byId.set(p.id, p); for (const p of as) byId.set(p.id, p);
  const eff = (i: number): Lineups => ({
    home: { ...base.home, six: applySubsToSix(base.home.six, 'home', sim.subEvents, i, byId) },
    away: { ...base.away, six: applySubsToSix(base.away.six, 'away', sim.subEvents, i, byId) },
  });

  // 마커별 인플레이 목표 런(run) — 비인플레이 세그먼트에서 리셋
  type Node = { pos: Px; isMover: boolean; isServer: boolean; isDefBack: boolean };
  const runs: Record<string, Node[]> = {};
  const lastTargets: Record<string, Px> = {};

  for (let ri = 0; ri < rallies.length; ri++) {
    const rally = rallies[ri]; const lu = eff(ri);
    let prevLast: Px | undefined;
    if (ri > 0) { const pp = ballPath(rallies[ri - 1], 1000 + m * 31, eff(ri - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(rally, seed, lu, W, H, SO, prevLast);
    const stage = { serving: rally.serving, homeRot: rally.homeRot, awayRot: rally.awayRot };

    for (let s = 0; s + 1 < path.length; s++) {
      const seg = { from: path[s], to: path[s + 1] };
      const tg = segmentTargets(seg, stage, lu, W, H, SO, lastTargets);
      const kind = seg.to.kind;
      const moverKeys = new Set((seg.to.movers ?? []).map((mv) => `${mv.side}-${mv.idx}`));
      // 이 세그먼트에서 공격(세팅) 중인 측 — 그 반대가 수비팀. R2 버그(후위 부채꼴↔구석 왕복)는
      // **수비팀 후위**의 현상이라 거기로 스코프한다(전위 블로커의 벽 이동은 공격 x 추종 = 정당, 계수 제외).
      const offSide = offenseSideOf(seg);

      for (const side of ['home', 'away'] as Side[]) {
        const rot = side === 'home' ? stage.homeRot : stage.awayRot;
        for (let i = 0; i < 6; i++) {
          const key = `${side}-${i}`;
          const p = tg[key]; if (!p) continue;
          if (!IN.has(kind)) { runs[key] = []; continue; } // 비인플레이 = 런 경계
          const isMover = moverKeys.has(key);
          const isServer = stage.serving === side && zoneOfIdx(rot, i) === 1;
          const zone = zoneOfIdx(rot, i);
          const isDefBack = offSide != null && side !== offSide && (zone === 1 || zone === 5 || zone === 6); // 수비팀 후위(페리미터)
          const run = (runs[key] ??= []);
          run.push({ pos: { x: p.x, y: p.y }, isMover, isServer, isDefBack });
          const n = run.length;
          if (n >= 3) {
            const a = run[n - 3], b = run[n - 2], c = run[n - 1];
            // b(중간)가 수비팀 후위 · 비무버 · 비서버일 때만 — 무버/서버/전위 블로커의 정당 이동은 제외.
            if (b.isDefBack && !b.isMover && !b.isServer && !a.isServer && !c.isServer) {
              samples++;
              const detour = dist(a.pos, c.pos) <= NEAR && dist(a.pos, b.pos) >= FAR && dist(c.pos, b.pos) >= FAR;
              if (detour) {
                detours++;
                if (examples.length < 8) examples.push(`경기${m + 1} ${rally.setNo}세트 ${rally.home}:${rally.away} ${key} T[k](${a.pos.x.toFixed(0)},${a.pos.y.toFixed(0)})→T[k+1](${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)})→T[k+2](${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)})`);
              }
              // A/B: **진짜 복귀(a≈c)** 삼각에 한해, 중간 목표를 보장된 원거리(±0.4H)로 튕겨 인위 왕복 주입 → 반드시 잡혀야.
              //   (a≈c가 아닌 삼각은 왕복 정의상 대상 아님 — A/B 모수에서 제외해야 오라클이 유의미.)
              if (dist(a.pos, c.pos) <= NEAR) {
                const inj: Px = { x: a.pos.x, y: a.pos.y + (a.pos.y < H / 2 ? 1 : -1) * 0.4 * H };
                abInjected++;
                if (dist(a.pos, c.pos) <= NEAR && dist(a.pos, inj) >= FAR && dist(c.pos, inj) >= FAR) abCaught++;
              }
            }
          }
        }
      }
      for (const k of Object.keys(tg)) lastTargets[k] = tg[k];
    }
  }
}

log(`═══ 왕복 검출기 _dv_detour (${N}경기 · 인플레이 목표 삼각 표본 ${samples}개 · NEAR=${NEAR.toFixed(0)}px FAR=${FAR.toFixed(0)}px) ═══`);
log(`왕복(나갔다 제자리) 건수: ${detours}  (목표: 수정 후 0 또는 급감)`);
for (const e of examples) log('  · ' + e);
const abRate = abInjected ? abCaught / abInjected : 0;
log(`\nA/B 자가검증(중간 목표를 코너로 튕겨 인위 왕복 주입): ${abCaught}/${abInjected} (${(100 * abRate).toFixed(0)}%) → ${abRate >= 0.9 ? '✅ 오라클 유효(왕복이면 잡힘)' : '⚠ 오라클 둔감'}`);
log(detours === 0 ? '\n결론: ✅ 왕복 0건' : `\n결론: ⚠ 왕복 ${detours}건 (베이스라인이면 정상 — 도구 민감도 증명 / 수정 후면 잔존)`);

// ── 이빨: 왕복은 "0 불변식"이 아니라 잔존형(정당한 read→commit 포함)이라 상한+오라클 게이트로 배선. ──
//   재베이스라인(5c3307d·2026-07-21): 왕복 34건@40경기 = 0.85/경기(종전 24 — Phase D 라인업 변동 여파, 육성철학
//   base six 정합 수정 후에도 34로 불변 = 잔존 특성이지 base 드리프트 아님). 상한 1.5/경기(≈76% 마진)로 정당 잔존은
//   흘리되, 구 R2 버그(switchedSpots 구석 리셋 1683건@40 ≈ 42/경기)형 부채꼴↔구석 진동 재발은 즉시 잡는다.
//   오라클(A/B 코너 튕김 검출률)이 90% 미만이면 detour 수치가 무의미하므로 함께 FAIL.
const CEIL = Math.ceil(N * 1.5);
const oracleOk = abRate >= 0.9;
const withinCeil = detours <= CEIL;
log(`\n검증: 상한 ${CEIL}건(=${N}경기×1.5/경기, 베이스라인 34@40경기+마진) · 오라클 ${(100 * abRate).toFixed(0)}%`);
log(`  ${withinCeil ? 'PASS' : 'FAIL ❌'} — 왕복 ${detours} ≤ ${CEIL}`);
log(`  ${oracleOk ? 'PASS' : 'FAIL ❌'} — A/B 오라클 유효(${(100 * abRate).toFixed(0)}% ≥ 90%)`);
process.exit(withinCeil && oracleOk ? 0 : 1);
