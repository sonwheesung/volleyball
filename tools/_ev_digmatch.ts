// 2b 검증 — 보드가 그린 디그 마커(att-flip 디그)가 엔진 디그 귀속(touches dig = box digSucc 귀속자)과
// 같은 선수인가. 디그 칸의 "화면=기록"(rules 52/55/56 클래스). 보드 ballPath에 digSink를 달아 렌더된 디거를
// 뽑고, 엔진 디그 터치(독립 재유도 — touch.id를 그 시점 교체반영 라인업 슬롯에 매핑)와 순서대로 대조.
//   (A) 정렬쌍 일치율  (B) A/B 자가검증: 엔진 디그를 어긋나게(shuffle) 비교 → 무작위로 떨어져야 도구 신뢰
//   분포: 렌더된 디거 포지션 vs 엔진(박스) 디거 포지션 — 보드 분포가 박스(리베로 1위·분산)에 수렴하나.
// 사용: npx tsx tools/_ev_digmatch.ts [경기수=300] [shuffle]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies, applySubsToSix } from '../components/courtDirector';
import { ballPath, type Lineups } from '../components/courtPath';
import { buildLineup } from '../engine/lineup';
import type { Player, Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const W = 360, H = 500, SO = 22;
const N = parseInt(process.argv[2] || '300', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const baseL = { home: buildLineup(A, coachInfoOf(t0)?.dvPhilosophy ?? 0), away: buildLineup(B, coachInfoOf(t1)?.dvPhilosophy ?? 0) }; // 엔진 six와 동일 인자(육성철학) — subEvents 재생 슬롯 정합
const byIdMap = new Map<string, Player>();
for (const p of [...A, ...B]) byIdMap.set(p.id, p);
const posOf = new Map<string, string>();
const liberoIds = new Set([baseL.home.libero?.id, baseL.away.libero?.id].filter(Boolean) as string[]);
for (const p of [...A, ...B]) posOf.set(p.id, p.position);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1), touches: true } as any;

let engTot = 0, boardTot = 0;
const renderedIds: string[] = [], engAligned: string[] = []; // 정렬쌍 — 전역 셔플 A/B용
const boardPos: Record<string, number> = {}, engPos: Record<string, number> = {};
const diag = { sideMis: 0, notInSix: 0, otherPlayer: 0, countMis: 0, rallies: 0, firstDrift: [0, 0, 0, 0, 0, 0] };
const posKey = (id: string) => (liberoIds.has(id) ? 'L' : (posOf.get(id) ?? '?'));

for (let s = 1; s <= N; s++) {
  const sim = simulateMatch(s, A, B, base);
  const rallies = reconstructRallies(sim);
  const effAt = (i: number): Lineups => ({
    home: { ...baseL.home, six: applySubsToSix(baseL.home.six, 'home', sim.subEvents, i, byIdMap) },
    away: { ...baseL.away, six: applySubsToSix(baseL.away.six, 'away', sim.subEvents, i, byIdMap) },
  });
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    const engDigs = (r.touches ?? []).filter((t) => t.act === 'dig');
    if (engDigs.length === 0) continue;
    const eff = effAt(i);
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, effAt(i - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const digSink: { side: Side; idx: number }[] = [];
    ballPath(r, s, eff, W, H, SO, prevLast, digSink);
    engTot += engDigs.length;
    boardTot += digSink.length;
    if (digSink.length !== engDigs.length) diag.countMis++;
    // 첫 사이드 어긋남 위치(드리프트 시작점) 분포
    { const mm = Math.min(engDigs.length, digSink.length); for (let k = 0; k < mm; k++) { if (digSink[k].side !== engDigs[k].side) { diag.firstDrift[Math.min(k, 5)]++; break; } } }
    diag.rallies++;
    // 엔진 디거 포지션 분포(박스 기준)
    for (const e of engDigs) engPos[posKey(e.id)] = (engPos[posKey(e.id)] ?? 0) + 1;
    const m = Math.min(engDigs.length, digSink.length);
    for (let k = 0; k < m; k++) {
      const d = digSink[k];
      const lu = d.side === 'home' ? eff.home : eff.away;
      const slotP = lu.six[d.idx];
      // 보드 표시 선수 = 후위 MB 슬롯은 리베로로 표시(courtLayout.playerAtZone와 동일 display-equiv)
      const rot = d.side === 'home' ? r.homeRot : r.awayRot;
      const zone = ((d.idx - rot) % 6 + 6) % 6 + 1;
      const isBack = zone === 1 || zone === 5 || zone === 6;
      const renderedId = (isBack && lu.libero && slotP?.position === 'MB') ? lu.libero.id : (slotP?.id ?? '?');
      boardPos[posKey(renderedId)] = (boardPos[posKey(renderedId)] ?? 0) + 1;
      renderedIds.push(renderedId);
      engAligned.push(engDigs[k].id); // 독립 재유도: 엔진 디그 터치 id(순서 정렬)
      // 진단: 불일치 분해 — 사이드 어긋남 vs 엔진 디거가 보드 def six에 없음(매핑 실패) vs 다른 유효 선수
      if (renderedId !== engDigs[k].id) {
        if (d.side !== engDigs[k].side) diag.sideMis++;
        else {
          const dsix = (engDigs[k].side === 'home' ? eff.home : eff.away).six;
          const lu2 = engDigs[k].side === 'home' ? eff.home : eff.away;
          const inSix = dsix.some((p) => p.id === engDigs[k].id) || (lu2.libero?.id === engDigs[k].id);
          if (!inSix) diag.notInSix++; else diag.otherPlayer++;
        }
      }
    }
  }
}

const paired = renderedIds.length;
const OFF = 49999; // 전역 미스페어링(랠리 정렬 깨기) — 진짜 chance 베이스라인
let match = 0, shufMatch = 0;
for (let k = 0; k < paired; k++) {
  if (renderedIds[k] === engAligned[k]) match++;
  if (renderedIds[k] === engAligned[(k + OFF) % paired]) shufMatch++;
}
log(`시드 ${N} · 엔진 디그(box) ${engTot}건 · 보드 att-flip 디그 ${boardTot}건 · 정렬쌍 ${paired}건`);
log(`(A) 렌더된 디거 == 엔진 디그 귀속(순서 정렬) : ${match}/${paired} = ${(match / paired * 100).toFixed(1)}%`);
log(`(B) A/B 자가검증 — 전역 미스페어링(chance) : ${(shufMatch / paired * 100).toFixed(1)}%  (실측보다 훨씬 낮아야 도구 신뢰)`);
log(`불일치 분해: 사이드어긋남 ${diag.sideMis} · 엔진디거 보드six에 없음 ${diag.notInSix} · 다른유효선수 ${diag.otherPlayer}`);
log(`디그 수 불일치 랠리: ${diag.countMis}/${diag.rallies} · 첫 드리프트 hop별: ${diag.firstDrift.map((v, k) => `h${k}:${v}`).join(' ')}`);
const fmt = (o: Record<string, number>, tot: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(1)}%`).join(' · ');
log(`\n분포 대조:`);
log(`  엔진(박스) 디거: ${fmt(engPos, engTot)}`);
log(`  보드 렌더 디거: ${fmt(boardPos, Object.values(boardPos).reduce((a, b) => a + b, 0))}`);
const rate = match / paired;
log(`\n판정: ${rate >= 0.85 ? '✅' : '⚠'} 보드 디그 마커 ${(rate * 100).toFixed(1)}% 엔진 귀속 일치 (잔여는 보드 hop 구조 분기 — 프리볼/커버로 디그 수 어긋남, 폴백)`);
process.exit(rate >= 0.85 ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
