// 형제오류 사냥(sibling hunt) — 스코어박스 "리시브" 칸: 보드가 보여주는 리시버 ↔ 박스 귀속 리시버 일치?
// recvId 배선 후 per-event 검증: 각 랠리에서 보드가 그린 서브-리시버 == 엔진 recvId(박스 recvAtt 귀속자)?
//   리베로 리시버는 보드가 후위 MB 슬롯을 리베로로 표시하므로(display-equivalence) 그 경우도 일치로 친다.
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
const N = parseInt(process.argv[2] || '200', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
// 실앱(MatchCourt)과 동일하게 **작전 교체 반영 라인업(applySubsToSix)** 으로 보드 재생 —
// 정적 six로 재생하면 교체 투입 리시버(recvId)가 six에 없어 근접 폴백→불일치로 잘못 계측(2026-07-06 진단).
const baseL: Lineups = { home: buildLineup(A), away: buildLineup(B) };
const byIdMap = new Map<string, Player>();
for (const p of [...A, ...B]) byIdMap.set(p.id, p);
const effAt = (sim: any, i: number): Lineups => ({
  home: { ...baseL.home, six: applySubsToSix(baseL.home.six, 'home', sim.subEvents, i, byIdMap) },
  away: { ...baseL.away, six: applySubsToSix(baseL.away.six, 'away', sim.subEvents, i, byIdMap) },
});
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

// 두 버킷으로 정직하게 나눈다:
//  (A) 클린 리시브(보드가 서브 처리자를 그림, idx≥0) → 그 선수 == 박스 recvId 여야 함(100% 목표).
//  (B) 노클린(보드 idx -1) → 에이스(네트인 등). 박스는 지정 리시버를 recvErr로 기장하지만 코트엔
//      클린 터치가 없다(공이 닿을 수 없는 곳). 이건 불일치가 아니라 "에이스" — 단, how가 'ace'가 아니면
//      (kill/tip 등 클린 리시브가 있어야 할 종결인데 처리자 미렌더) 그건 진짜 버그 → 별도 카운트.
let clean = 0, cleanMatch = 0, cleanMis = 0;
let ace = 0, aceLeak = 0; // aceLeak = idx -1인데 how!=ace (있으면 안 됨)
const misBy: Record<string, number> = {};
const SHUFFLE = process.argv[3] === 'shuffle'; // A/B: recvId를 한 칸 밀어 비교(허위 오라클 차단 — 100%면 안 됨)

for (let s = 1; s <= N; s++) {
  const box: BoxSink = new Map();
  const sim = simulateMatch(s, A, B, { ...base, box });
  const rallies = reconstructRallies(sim);
  const recvIds = sim.points.map((p) => p.recvId);
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    const recvId = SHUFFLE ? recvIds[(i + 1) % recvIds.length] : recvIds[i];
    if (!recvId) continue; // 리시브 없음(서브 범실 등) → 박스 recvAtt 없음 → 비교 대상 아님
    const L = effAt(sim, i);
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, effAt(sim, i - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(r, s, L, W, H, SO, prevLast);
    const sv = path.find((w) => w.kind === 'serve' && w.idx >= 0); // 클린 서브 리시브 처리자
    if (!sv) { // (B) 노클린 — 에이스여야 함
      ace++;
      if (sim.points[i]?.how !== 'ace') aceLeak++;
      continue;
    }
    // (A) 클린 리시브 — 처리자 == 박스 recvId?
    clean++;
    const lu = sv.side === 'home' ? L.home : L.away;
    const slot = lu.six[sv.idx];
    const ok = !!slot && (slot.id === recvId || (slot.position === 'MB' && !!lu.libero && lu.libero.id === recvId)); // 리베로=후위 MB 표시 display-equivalence
    if (ok) cleanMatch++;
    else { cleanMis++; if (slot) misBy[slot.position] = (misBy[slot.position] ?? 0) + 1; }
  }
}

const pct = clean ? (cleanMatch / clean * 100) : 0;
log(`시드 ${N} · 클린 리시브 ${clean}건 · 노클린(에이스) ${ace}건`);
log(`(A) 클린 리시브 처리자 == 박스 recvId : ${cleanMatch}/${clean} = ${pct.toFixed(1)}%`);
if (cleanMis) log(`    불일치 ${cleanMis}건, 보드 슬롯 포지션별: ${JSON.stringify(misBy)}`);
log(`(B) 노클린=에이스 ${ace}건 중 how!=ace 누수: ${aceLeak}건 (0이어야 정상 — 박스는 지정 리시버 recvErr로 기장)`);
const okAll = pct >= 99.5 && aceLeak === 0;
log(okAll ? '✅ 리시브 귀속 일치(클린=보드=박스 100% · 노클린은 전부 에이스)' : '❌ 리시브 sibling 불일치/누수 잔존');
process.exit(okAll ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
