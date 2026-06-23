// 형제오류 사냥(sibling hunt) — 스코어박스 "리시브" 칸: 보드가 보여주는 리시버 ↔ 박스 귀속 리시버 일치?
// byId(종결 공격수/블로커/서버)만 보드-박스를 묶었고, 디그/세트/리시브 "선택"은 보드 자체 로직(proximity)이라
// 박스(boxRng pickRecv) 귀속과 따로 굴 가능성 → 측정. 보드 서브-리시버 분포 vs 박스 recvAtt 분포 겹침률.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies } from '../components/courtDirector';
import { ballPath, type Lineups } from '../components/courtPath';
import { buildLineup } from '../engine/lineup';
import type { BoxSink } from '../engine/rally';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const W = 360, H = 500, SO = 22;
const N = parseInt(process.argv[2] || '200', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const L: Lineups = { home: buildLineup(A), away: buildLineup(B) };
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

const boardCnt = new Map<string, number>();   // 보드가 서브-리시브 처리자로 보여준 선수
const boxCnt = new Map<string, number>();      // 박스가 recvAtt 귀속한 선수
const add = (m: Map<string, number>, id: string, v = 1) => m.set(id, (m.get(id) ?? 0) + v);

for (let s = 1; s <= N; s++) {
  const box: BoxSink = new Map();
  const sim = simulateMatch(s, A, B, { ...base, box });
  const rallies = reconstructRallies(sim);
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, L, W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(r, s, L, W, H, SO, prevLast);
    const sv = path.find((w) => w.kind === 'serve' && w.idx >= 0); // 서브 리시브 처리자
    if (sv) { const p = (sv.side === 'home' ? L.home : L.away).six[sv.idx]; if (p) add(boardCnt, p.id); }
  }
  for (const [id, l] of box) if (l.recvAtt > 0) add(boxCnt, id, l.recvAtt);
}

// 분포 겹침률 — Σ min(board_p, box_p) / Σ box_p (보드가 박스와 같은 선수에게 리시브를 몰아주는 비율)
const ids = new Set([...boardCnt.keys(), ...boxCnt.keys()]);
let overlap = 0, boardTot = 0, boxTot = 0;
for (const id of ids) { overlap += Math.min(boardCnt.get(id) ?? 0, boxCnt.get(id) ?? 0); boardTot += boardCnt.get(id) ?? 0; boxTot += boxCnt.get(id) ?? 0; }
// 정규화(보드는 서브리시브만·박스는 모든 리시브시도라 총량이 달라 — 분포 비율로 비교)
const norm = (m: Map<string, number>, tot: number) => new Map([...m].map(([k, v]) => [k, v / tot]));
const bnd = norm(boardCnt, boardTot), bx = norm(boxCnt, boxTot);
let distOverlap = 0;
for (const id of ids) distOverlap += Math.min(bnd.get(id) ?? 0, bx.get(id) ?? 0);

log(`시드 ${N} · 보드 서브리시브 ${boardTot}건 · 박스 recvAtt ${boxTot}건`);
log(`리시버 분포 겹침률(보드 vs 박스): ${(distOverlap * 100).toFixed(1)}%  (100%면 같은 선수에게 동일 비율 귀속)`);
log(`→ 100%에서 모자란 만큼이 "보드가 보여준 리시버 ≠ 박스 귀속 리시버"(스코어박스 리시브 칸 sibling 불일치)`);
log(`\n참고: 득점/블록/서브는 byId로 보드-박스 100% 묶임. 디그/세트/리시브는 미묶임(보드 자체 선택).`);
