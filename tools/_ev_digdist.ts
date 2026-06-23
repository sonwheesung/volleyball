// 디그 귀속 분포 진단 — 박스 digSucc가 포지션별로 어떻게 갈리나(엔진은 dg0=defenders(df).best-dig에 전부 귀속).
// 리베로에 과집중되는지(=보드 nearestDig와 어긋날 소지) 먼저 본다. 박스=엔진 진실.
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
// 팀당 디거 다양성 — 한 팀에서 몇 명이 디그를 나눠 갖나(로테이션마다 best-dig가 바뀌므로 >1 기대)
const distinct = perPlayer.size;
log(`디그 기록 보유 선수 수: ${distinct}명(양팀 합)`);
