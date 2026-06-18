// 서브 순간 로테이션 오버랩(overlap) 합법성 점검 — 추정 금지, 실제 좌표로 검사.
// 배구 규칙: 서브 컨택 순간 6명은 인접 기준으로 로테이션 순서를 지켜야 한다.
//   같은 열: 전위가 후위보다 네트에 가깝다 (4<5, 3<6, 2<1 — 네트거리)
//   같은 행: 좌→중→우 순서 (전위 4<3<2, 후위 5<6<1 — 좌우)
// 받는 팀(receiveFormation)·서브 팀(serveFormation) 검사. 서버(zone1)·세터(릴리즈 침투)는 면제.
// 오라클 검증: 표준 격자 zonePx는 위반 0이어야 한다(검사기 부호/로직 자기검증).
//   npx tsx tools/checkOverlap.ts
import { LEAGUE, getTeamPlayers } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { receiveFormation, serveFormation, zonePx, lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const W = 300, H = 400;

const lus = LEAGUE.teams.map((t) => buildLineup(getTeamPlayers(t.id)));

/** side별: home은 네트에 가까울수록 y작음·좌측 x작음. away는 점대칭(부호 반전). */
function violations(side: Side, posOf: (idx: number) => { x: number; y: number }, rot: number, exempt: Set<number>): string[] {
  const idxAt = (z: number) => lineupIdxAt(rot, z);
  const has = (z: number) => !exempt.has(idxAt(z));
  const X = (z: number) => posOf(idxAt(z)).x;
  const Y = (z: number) => posOf(idxAt(z)).y;
  const s = side === 'home' ? 1 : -1;
  const v: string[] = [];
  const front = (a: number, b: number, n: string) => { if (has(a) && has(b) && s * (Y(b) - Y(a)) <= 0.5) v.push(`${n} 전후역전(z${a} y=${Y(a).toFixed(0)} vs z${b} y=${Y(b).toFixed(0)})`); };
  const lr = (l: number, r: number, n: string) => { if (has(l) && has(r) && s * (X(r) - X(l)) <= 0.5) v.push(`${n} 좌우역전(z${l} x=${X(l).toFixed(0)} vs z${r} x=${X(r).toFixed(0)})`); };
  front(4, 5, '좌열'); front(3, 6, '중열'); front(2, 1, '우열');
  lr(4, 3, '전위L-C'); lr(3, 2, '전위C-R'); lr(5, 6, '후위L-C'); lr(6, 1, '후위C-R');
  return v;
}

let recvTotal = 0, recvViol = 0, servTotal = 0, servViol = 0, oracleViol = 0;
const sample: string[] = [];

for (let ti = 0; ti < LEAGUE.teams.length; ti++) {
  const lu = lus[ti];
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  for (const side of ['home', 'away'] as Side[]) {
    for (let rot = 0; rot < 6; rot++) {
      // 오라클 자기검증: 표준 격자(zonePx)는 면제 없이 0위반이어야 한다.
      oracleViol += violations(side, (i) => { const z = ((i - rot) % 6 + 6) % 6 + 1; return zonePx(side, z, W, H); }, rot, new Set()).length;

      // 받는 팀: 세터(릴리즈 침투) 면제
      const rf = receiveFormation(side, lu, rot, W, H);
      const rViol = violations(side, (i) => rf[i], rot, new Set([setterIdx]));
      recvTotal++; if (rViol.length) { recvViol++; if (sample.length < 10) sample.push(`[받기 t${ti} ${side} rot${rot}] ${rViol.join(' · ')}`); }

      // 서브 팀: 서버(zone1) 면제
      const sf = serveFormation(side, lu, rot, W, H);
      const serverIdx = lineupIdxAt(rot, 1);
      const sViol = violations(side, (i) => sf[i], rot, new Set([serverIdx]));
      servTotal++; if (sViol.length) { servViol++; if (sample.length < 20) sample.push(`[서브 t${ti} ${side} rot${rot}] ${sViol.join(' · ')}`); }
    }
  }
}

log(`\n═══ 서브 순간 오버랩 합법성 ═══\n`);
log(`▸ 오라클 자기검증(zonePx 표준격자): 위반 ${oracleViol} (0이어야 정상 — 검사기 신뢰)`);
log(`▸ 받는 팀(receiveFormation, 세터 면제): ${recvViol}/${recvTotal} 대형 위반`);
log(`▸ 서브 팀(serveFormation, 서버 면제): ${servViol}/${servTotal} 대형 위반`);
if (sample.length) { log(`\n샘플:`); for (const s of sample) log(`  ${s}`); }

// ── 시각 확인: 격자가 아니라 자유분방한가? (홈=하단 대문자, 네트=상단) ──
function render(title: string, pos: Record<number, { x: number; y: number }>, lu: ReturnType<typeof buildLineup>, rot: number, serverIdx = -1): void {
  const COLS = 34, ROWS = 13;
  const g: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill('·'));
  for (let c = 0; c < COLS; c++) g[0][c] = '─'; // 네트(상단)
  for (let i = 0; i < 6; i++) {
    const p = pos[i]; if (!p) continue;
    const c = Math.max(0, Math.min(COLS - 1, Math.round((p.x / W) * (COLS - 1))));
    // 홈 하단 절반(y 0.5~1.0)을 13행에 매핑
    const r = Math.max(0, Math.min(ROWS - 1, Math.round(((p.y / H) - 0.5) * 2 * (ROWS - 1))));
    const ch = i === serverIdx ? 'Σ' : (lu.six[i]?.position ?? '?')[0];
    g[r][c] = ch;
  }
  log(`\n  ${title} (rot ${rot}, 네트=맨위):`);
  for (const row of g) log('  ' + row.join(''));
}

const lu0 = lus[0];
const setter0 = lu0.six.findIndex((p) => p.position === 'S');
for (const rot of [0, 2, 4]) render(`받기 대형`, receiveFormation('home', lu0, rot, W, H), lu0, rot, setter0 /*세터 표시용 아님*/ && -1);
render(`서브 대형`, serveFormation('home', lu0, 0, W, H), lu0, 0, lineupIdxAt(0, 1));
log('');
