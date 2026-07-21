// 형제오류 사냥(sibling hunt) — 스코어박스 "세트(어시)" 칸: 보드가 그린 종결 토서 ↔ 박스 어시 귀속 세터 일치?
// 엔진은 어시를 항상 지정 세터(setterOf)에 귀속(킬/팁/블록아웃만). 보드 토서는 인시스템이면 세터, 아웃오브시스템이면
// 근접 비세터(스크램블) → 어긋남 가능. setId(종결 세터) 배선 전후 per-event 일치율 측정 + A/B(shuffle) 자가검증.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies, applySubsToSix } from '../components/courtDirector';
import { ballPath, type Lineups } from '../components/courtPath';
import { buildLineup } from '../engine/lineup';
import type { BoxSink } from '../engine/rally';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const W = 360, H = 500, SO = 22;
const N = parseInt(process.argv[2] || '300', 10);
const SHUFFLE = process.argv[3] === 'shuffle';
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const baseL = { home: buildLineup(A, coachInfoOf(t0)?.dvPhilosophy ?? 0), away: buildLineup(B, coachInfoOf(t1)?.dvPhilosophy ?? 0) }; // 엔진 six와 동일 인자(육성철학) — subEvents 재생 슬롯 정합
const byIdMap = new Map<string, Player>();
for (const p of [...A, ...B]) byIdMap.set(p.id, p);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1), touches: true } as any; // touches: 보드가 실제 게임처럼 엔진 디그/세트 재생

let total = 0, match = 0, mismatch = 0, noTosser = 0;
const misBy: Record<string, number> = {}; // 불일치 보드 토서 포지션

for (let s = 1; s <= N; s++) {
  const box: BoxSink = new Map();
  const sim = simulateMatch(s, A, B, { ...base, box });
  const rallies = reconstructRallies(sim);
  const setIds = sim.points.map((p) => p.setId);
  const effAt = (i: number): Lineups => ({
    home: { ...baseL.home, six: applySubsToSix(baseL.home.six, 'home', sim.subEvents, i, byIdMap) },
    away: { ...baseL.away, six: applySubsToSix(baseL.away.six, 'away', sim.subEvents, i, byIdMap) },
  });
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    const setId = SHUFFLE ? setIds[(i + 1) % setIds.length] : setIds[i];
    if (!setId) continue; // 어시 없는 종결(에이스·범실·스터프 등) → 비교 대상 아님
    total++;
    const L = effAt(i);
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, effAt(i - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(r, s, L, W, H, SO, prevLast);
    // 종결 스파이크 직전의 토서(세트) 웨이포인트 — 보드는 set/토스를 kind:'pass'(또는 'toss') idx=tosserIdx로 그린다.
    const lastSpike = (() => { for (let k = path.length - 1; k >= 0; k--) if (path[k].kind === 'spike') return k; return -1; })();
    if (lastSpike < 0) { noTosser++; continue; } // 종결 스파이크 미렌더(팬텀 등) — 별도
    // 세트(토스 처리자) = 종결 스파이크 직전의 'pass' 웨이포인트(idx=tosserIdx). ('toss'는 공이 공격수에게 가는 호 — idx=공격수)
    let tw = -1;
    for (let k = lastSpike - 1; k >= 0; k--) { if (path[k].kind === 'pass' && path[k].idx >= 0) { tw = k; break; } }
    if (tw < 0) { noTosser++; continue; }
    const w = path[tw];
    const slot = (w.side === 'home' ? L.home : L.away).six[w.idx];
    if (slot && slot.id === setId) match++;
    else { mismatch++; if (slot) misBy[slot.position] = (misBy[slot.position] ?? 0) + 1; }
  }
}

const pct = total ? (match / total * 100) : 0;
log(`시드 ${N} · 비교 대상(setId 있는 종결=킬/팁/블록아웃) ${total}건${SHUFFLE ? '  [A/B shuffle]' : ''}`);
log(`보드 종결 토서 == 박스 어시 세터(setId) : ${match}/${total} = ${pct.toFixed(1)}%`);
if (noTosser) log(`(종결 토서 미렌더 ${noTosser}건 — 팬텀/경계)`);
if (mismatch) log(`불일치 ${mismatch}건, 보드 토서 포지션별: ${JSON.stringify(misBy)}`);
log(pct >= 99.5 ? '✅ 세트(어시) 귀속 일치(스코어박스 세트 칸 = 보드)' : '❌ 세트 sibling 불일치 잔존');
process.exit(pct >= 99.5 ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
