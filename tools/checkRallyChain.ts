// 랠리 안무 체인 검증 — 디그(첫 터치) → 토스(다른 선수) → 스파이크(전위 공격수) 3터치 규칙.
//   npx tsx tools/checkRallyChain.ts [경로수 배수=200]
// 실제 보드 코드(courtPath.ballPath)를 헤드리스로 수만 회 돌려 검사:
//   ① 토스는 첫 터치(리시브/디그)한 선수가 아님(더블터치 금지)
//   ② 세터가 디그했으면 다른 선수(센터 등)가 토스
//   ③ 스파이커 ≠ 토스한 선수, 스파이커는 전위(존 2/3/4)
//   ④ 시퀀스 문법: serve→pass→toss→spike(→pass(디그)→toss→spike…)
//   ⑤ 디그 지점은 수비 진영 안

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Mover } from '../components/courtPath';
import { zoneOfIdx } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const issues: string[] = [];
let paths = 0, hops = 0, digTransitions = 0, setterDugCases = 0;
const altTosserPos: Record<string, number> = {}; // 세터 디그 시 대체 토서 포지션 분포
const atkDist: Record<string, number> = {};      // 공격 종류 분포(보드 연출)

resetLeagueBase();
const L = {
  home: buildLineup(getEvolvedTeamPlayers(LEAGUE.teams[0].id, 0)),
  away: buildLineup(getEvolvedTeamPlayers(LEAGUE.teams[1].id, 0)),
};
const setterIdxOf = (side: Side) => (side === 'home' ? L.home : L.away).six.findIndex((p) => p.position === 'S');

const mult = Math.max(1, Number(process.argv[2]) || 200);

for (let seed = 1; seed <= mult; seed++) {
  for (const serving of ['home', 'away'] as Side[]) {
    for (let hr = 0; hr < 6; hr++) for (let ar = 0; ar < 6; ar++) {
      for (const scorer of ['home', 'away'] as Side[]) {
        const r = { setNo: 1 + (seed % 5), home: seed % 25, away: (seed * 7) % 25, scorer, serving, homeRot: hr, awayRot: ar };
        const wp = ballPath(r, seed * 1009, L, W, H, SERVE_OUT);
        paths++;
        const ctx = `seed${seed}/${serving}서브/rot${hr}-${ar}/${scorer}승`;

        // 시퀀스 파싱 — 사이드별 firstTouch 추적
        let firstTouch: { side: Side; idx: number } | null = null;
        // 서브 수신자 = 'serve' WP
        for (let k = 0; k < wp.length; k++) {
          const w = wp[k];
          if (w.kind === 'serve') firstTouch = { side: w.side, idx: w.idx };

          if (w.kind === 'pass' && w.idx >= 0) {
            hops++;
            const att = w.side;
            const rot = att === 'home' ? hr : ar;
            const tosser = w.idx;
            // ① 더블터치: 토스 ≠ 첫 터치(같은 사이드일 때)
            if (firstTouch && firstTouch.side === att && tosser === firstTouch.idx) {
              issues.push(`${ctx}: 더블터치 — idx${tosser}가 리시브/디그 후 토스까지`);
            }
            // ② 세터가 첫 터치 → 토스는 비세터여야
            const sIdx = setterIdxOf(att);
            if (firstTouch && firstTouch.side === att && firstTouch.idx === sIdx) {
              setterDugCases++;
              if (tosser === sIdx) issues.push(`${ctx}: 세터 디그 후 세터 토스(더블터치)`);
              else {
                const lu = att === 'home' ? L.home : L.away;
                const tp = lu.six[tosser]?.position ?? '?';
                altTosserPos[tp] = (altTosserPos[tp] ?? 0) + 1;
              }
            }
            // 다음 toss WP = 공격수
            const tossW = wp[k + 1];
            if (!tossW || tossW.kind !== 'toss') {
              issues.push(`${ctx}: pass 다음이 toss 아님(${tossW?.kind})`);
              continue;
            }
            const atkIdx = tossW.idx;
            // ③ 공격수 ≠ 토서 + 공격 종류별 적격(속공=전위 센터 / 백어택=후위 OH·OP / 오픈=전위)
            if (atkIdx === tosser) issues.push(`${ctx}: 토스한 선수가 스파이크(idx${atkIdx})`);
            const z = zoneOfIdx(rot, atkIdx);
            const atkKind = tossW.atk ?? 'open';
            atkDist[atkKind] = (atkDist[atkKind] ?? 0) + 1;
            const luA = att === 'home' ? L.home : L.away;
            const aPos = luA.six[atkIdx]?.position;
            if (atkKind === 'back') {
              if (z === 2 || z === 3 || z === 4) issues.push(`${ctx}: 백어택인데 전위(zone${z})`);
              if (aPos !== 'OH' && aPos !== 'OP') issues.push(`${ctx}: 백어택을 ${aPos}가(OH/OP여야 — 리베로 표시 슬롯 금지)`);
              // 커버 형태: 백어택 리바운드는 타점 앞(네트 쪽)에 떨어짐 — 측면 커버가 타점보다 앞에 있어야
              const covers = (tossW.movers ?? []).filter((m: Mover) => m.side === att && m.idx !== atkIdx);
              const hasFrontCover = covers.some((m: Mover) => (att === 'home' ? m.y < tossW.y - 2 : m.y > tossW.y + 2));
              if (!hasFrontCover) issues.push(`${ctx}: 백어택 커버가 전부 타점 뒤(네트 앞 리바운드 무방비)`);
            } else {
              if (z !== 2 && z !== 3 && z !== 4) issues.push(`${ctx}: ${atkKind} 스파이커 idx${atkIdx}가 후위(zone${z})`);
              if ((atkKind === 'quick' || atkKind === 'tempo') && aPos !== 'MB') issues.push(`${ctx}: 속공/시간차를 ${aPos}가(센터여야)`);
            }
            // ④ toss 다음 spike
            const spikeW = wp[k + 2];
            if (!spikeW || (spikeW.kind !== 'spike')) issues.push(`${ctx}: toss 다음이 spike 아님(${spikeW?.kind})`);

            // ⑤ 디그 전환: spike 뒤 디그 — 디거 기록·진영 확인.
            //   랠리가 계속될 때(다음 WP가 pass)만 디그로 인정(킬의 추격 무버와 구분)
            if (spikeW && spikeW.kind === 'spike') {
              const after = wp[k + 3];
              const continues = !!after && after.kind === 'pass';
              const dm: Mover | undefined = spikeW.movers?.find((m: Mover) => m.side !== att);
              if (continues && dm) {
                // 클린 디그: spike WP의 movers[0] = 디거(수비측)
                digTransitions++;
                firstTouch = { side: dm.side, idx: dm.idx };
                const ownHalf = dm.side === 'home' ? dm.y >= 0.5 * H : dm.y <= 0.5 * H;
                if (!ownHalf) issues.push(`${ctx}: 디그 위치가 상대 진영 (${dm.x.toFixed(0)},${dm.y.toFixed(0)})`);
              } else if (continues && after.idx < 0 && after.movers?.length) {
                // 원터치 디그 패스(idx=-1): movers[0] = 디거 (빌드업 패스 idx≥0와 구분!)
                digTransitions++;
                firstTouch = { side: after.movers[0].side, idx: after.movers[0].idx };
              }
            }
          }
        }
      }
    }
  }
}

log(`\n═══ 랠리 안무 체인 검증 — ${paths.toLocaleString()}개 경로 / ${hops.toLocaleString()}개 공격 빌드업 ═══`);
log(`디그 전환 ${digTransitions.toLocaleString()}회 · 세터가 첫 터치한 케이스 ${setterDugCases.toLocaleString()}회`);
const totAtk = Object.values(atkDist).reduce((a, b) => a + b, 0);
if (totAtk) {
  const d = (['quick', 'tempo', 'open', 'back'] as const)
    .map((k) => `${k} ${(((atkDist[k] ?? 0) / totAtk) * 100).toFixed(1)}%`).join(' · ');
  log(`공격 종류(보드 연출): ${d}  (엔진 실측: 속공 ~12·시간차 ~7·백어택 ~19%)`);
}
if (setterDugCases > 0) {
  const dist = Object.entries(altTosserPos).sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${((n / setterDugCases) * 100).toFixed(0)}%`).join(' · ');
  log(`세터 디그 시 대체 토서: ${dist}`);
}
if (issues.length === 0) log(`✅ 위반 0건 — 더블터치 금지·세터 디그 시 대체 토서·전위 스파이커·시퀀스 문법·디그 진영 모두 정상`);
else {
  log(`❌ 위반 ${issues.length}건 (앞 30):`);
  for (const m of issues.slice(0, 30)) log(`  · ${m}`);
}
