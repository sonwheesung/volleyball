// 디그 귀속 분포 진단 + 가드 — 박스 digSucc가 포지션별로 어떻게 갈리나(2026-06-24 현실 분산 재모델 후
// pickByDig 가중 추첨, 전역 best-dig 독식 폐기). 사용자 결정 = "현실적 분산·리베로 1위 유지" →
// 가드: ① 개인 디그왕(단일 선수 최다)이 리베로 ② 디거 다양성(≥10명) ③ 리베로 독식 아님(<50%). 박스=엔진 진실.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import type { BoxSink } from '../engine/rally';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '300', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const posOf = new Map<string, string>();
for (const p of [...A, ...B]) posOf.set(p.id, p.position);
// 리베로 식별(buildLineup이 지정) — 표시는 후위 MB 슬롯이지만 박스 귀속 id는 리베로 본인
const luA = buildLineup(A), luB = buildLineup(B);
const liberoIds = new Set([luA.libero?.id, luB.libero?.id].filter(Boolean) as string[]);

const byPos: Record<string, number> = {};
let totDig = 0, liberoDig = 0;
const perPlayer = new Map<string, number>();
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

for (let s = 1; s <= N; s++) {
  const box: BoxSink = new Map();
  simulateMatch(s, A, B, { ...base, box });
  for (const [id, l] of box) {
    if (l.digSucc <= 0) continue;
    const pos = liberoIds.has(id) ? 'L' : (posOf.get(id) ?? '?');
    byPos[pos] = (byPos[pos] ?? 0) + l.digSucc;
    totDig += l.digSucc;
    if (liberoIds.has(id)) liberoDig += l.digSucc;
    perPlayer.set(id, (perPlayer.get(id) ?? 0) + l.digSucc);
  }
}

log(`시드 ${N} · 총 digSucc ${totDig}건`);
log(`포지션별 분포: ${Object.entries(byPos).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / totDig * 100).toFixed(1)}%`).join(' · ')}`);
log(`리베로 집중도: ${(liberoDig / totDig * 100).toFixed(1)}%`);
// 팀당 디거 다양성 — 한 팀에서 몇 명이 디그를 나눠 갖나(현실 분산 후 ≥10명 기대, 구 best-dig는 5명)
const distinct = perPlayer.size;
log(`디그 기록 보유 선수 수: ${distinct}명(양팀 합)`);

// ── 가드(사용자 결정 "리베로 1위 유지·현실 분산") ──
const ranked = [...perPlayer.entries()].sort((a, b) => b[1] - a[1]);
const topId = ranked[0][0];
const topIsLibero = liberoIds.has(topId);
const topShare = ranked[0][1] / totDig * 100;
const liberoConc = liberoDig / totDig * 100;
log(`개인 디그왕: ${topIsLibero ? '리베로' : posOf.get(topId)} (${topShare.toFixed(1)}%, 단일 선수 최다)`);
const g1 = topIsLibero;                 // 개인 1위가 리베로
const g2 = distinct >= 10;              // 분산(구 5명 → 현실)
const g3 = liberoConc < 50;             // 독식 아님(현실 분산 — 구 87.7% 폐기)
log(`가드 ① 개인 디그왕=리베로: ${g1 ? 'PASS' : 'FAIL'}  ② 디거≥10명: ${g2 ? 'PASS' : 'FAIL'}(${distinct})  ③ 리베로<50%: ${g3 ? 'PASS' : 'FAIL'}(${liberoConc.toFixed(1)}%)`);
log(g1 && g2 && g3 ? '✅ 디그 귀속 현실 분산 — 리베로 1위 유지' : '❌ FAIL');
if (!(g1 && g2 && g3)) process.exit(1);
