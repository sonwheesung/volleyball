// #1 검증(강화) — 보드 종결 스파이커가 엔진 귀속(byId)과 일치하는가 + 측정기 자가검증.
// 실제 앱(MatchCourt)과 동일하게 **교체 반영 라인업(applySubsToSix)** 으로 보드 재생 →
// 킬류 득점의 종결 토스 WP 공격수(=스파이크 친 선수, 중계도 이 idx로 명명)가 r.byId와 같은지.
//  (A) 실측 일치율  (B) A/B 자가검증: byId를 어긋나게(shuffle) 비교 → 무작위로 떨어져야 도구 신뢰
//  (C) 잔여 불일치 분해
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies, applySubsToSix } from '../components/courtDirector';
import { ballPath, type Lineups } from '../components/courtPath';
import { buildLineup } from '../engine/lineup';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const W = 360, H = 500, SO = 22;
const N = parseInt(process.argv[2] || '300', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const baseL = { home: buildLineup(A), away: buildLineup(B) };
const byIdMap = new Map<string, Player>();
for (const p of A) byIdMap.set(p.id, p);
for (const p of B) byIdMap.set(p.id, p);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

type Rec = { byId: string; boardId: string | null; byIdInSix: boolean; shownBySide: string | null; scorerSide: string };
const recs: Rec[] = [];

for (let s = 1; s <= N; s++) {
  const sim = simulateMatch(s, A, B, base);
  const rallies = reconstructRallies(sim);
  const effAt = (i: number): Lineups => ({
    home: { ...baseL.home, six: applySubsToSix(baseL.home.six, 'home', sim.subEvents, i, byIdMap) },
    away: { ...baseL.away, six: applySubsToSix(baseL.away.six, 'away', sim.subEvents, i, byIdMap) },
  });
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    if (!r.byId) continue;
    if (r.how !== 'kill' && r.how !== 'blockout' && r.how !== 'tip') continue; // byId=공격수인 킬류만
    const eff = effAt(i);
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, effAt(i - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(r, s, eff, W, H, SO, prevLast);
    const tosses = path.filter((w) => w.kind === 'toss' && w.idx >= 0);
    const last = tosses[tosses.length - 1]; // 종결 공격의 세트 = 마지막 토스 WP(중계도 이 idx로 명명)
    const six = (last?.side === 'home' ? eff.home : eff.away).six;
    const boardId = last ? (six[last.idx]?.id ?? null) : null;
    const inSix = (r.scorer === 'home' ? eff.home : eff.away).six.some((p) => p.id === r.byId);
    recs.push({ byId: r.byId, boardId, byIdInSix: inSix, shownBySide: last?.side ?? null, scorerSide: r.scorer });
  }
}

const n = recs.length;
// 종결 스파이크가 "득점팀"으로 그려진 경우만 = 보드가 실제로 스파이커를 보여준 케이스(rendered).
const rendered = recs.filter((x) => x.boardId !== null && x.shownBySide === x.scorerSide);
const rN = rendered.length;
const rMatch = rendered.filter((x) => x.boardId === x.byId).length;
// A/B 자가검증: rendered에서 byId를 어긋나게 비교 → 무작위로 떨어져야
const rShuf = rendered.filter((x, k) => x.boardId === rendered[(k + 7) % rN].byId).length;
const phantom = n - rN; // 종결 스파이크 미렌더(팬텀 킬) — 내 변경과 무관한 기존 보드 버그(박스는 byId로 정확)

log(`킬류 득점 ${n}건 (시드 ${N}, 교체 반영=앱과 동일)`);
log(`보드가 종결 스파이크를 득점팀으로 그린 경우: ${rN}건 (${(rN / n * 100).toFixed(1)}%) · 팬텀 킬(미렌더) ${phantom}건 (${(phantom / n * 100).toFixed(1)}%)`);
log(`(A) [그려진 스파이크] 그 선수==byId : ${rMatch}/${rN}  ${(rMatch / rN * 100).toFixed(2)}%   ← #1 핵심(화면에 보인 스파이커=박스)`);
log(`(B) A/B 자가검증 — shuffle 비교     : ${(rShuf / rN * 100).toFixed(1)}%  (실측보다 훨씬 낮아야 도구 신뢰)`);
const fixOk = (rMatch / rN) >= 0.999 && (rMatch / rN) - (rShuf / rN) >= 0.4;
log(`\n판정: ${fixOk ? '✅ PASS — 보드가 보여준 스파이커는 100% 박스 귀속(byId)과 동일. 팬텀 킬은 별개(종결 스파이크 자체 미렌더, 박스는 정확)' : '❌ CHECK'}`);
process.exit(fixOk ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
