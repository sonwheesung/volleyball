// 웹 콘솔(브라우저 esbuild 번들) ↔ CLI(tsx) 동일 엔진 동일 입력 결과 일치 검증.
import { resetLeagueBase, LEAGUE, getTeam, coachInfoOf, getPlayer } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { currentSeasonAwards } from '../data/awards';
const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), Bsq = availableTeamPlayers(t1, 0);
const opts = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

const sim = simulateMatch(1, A, Bsq, opts);
log(`[경기] 스코어 ${sim.homeSets} : ${sim.awaySets}`);
log(`[경기] 세트 ${sim.setScores.map((s) => `${s.home}:${s.away}`).join(' | ')}`);
const lines = attributeProduction(sim, A, Bsq, 1);
const top = A.map((p) => ({ p, l: lines.get(p.id) })).filter((x) => x.l && x.l.matches > 0).sort((x, y) => y.l!.points - x.l!.points)[0];
log(`[경기] A 1행 ${top.p.position},${top.p.name},${top.l!.points},${top.l!.spikes},${top.l!.blocks},${top.l!.digs},${top.l!.aces},${top.l!.assists},${top.l!.receives}`);

const KILL = new Set(['kill', 'blockout', 'tip', 'cap']); const ERR = new Set(['serveErr', 'recvErr', 'fault', 'miscErr', 'atkErr']);
let kill = 0, stuff = 0, ace = 0, err = 0, total = 0;
for (let i = 0; i < 200; i++) { const s = simulateMatch(i + 1, A, Bsq, opts); for (const pt of s.points) { const h = pt.how; if (!h) continue; total++; if (KILL.has(h)) kill++; else if (h === 'stuff') stuff++; else if (h === 'ace') ace++; else if (ERR.has(h)) err++; } }
log(`[분포] 킬 ${(kill / total * 100).toFixed(1)}% ${kill} / 블록 ${(stuff / total * 100).toFixed(1)}% ${stuff} / 에이스 ${(ace / total * 100).toFixed(1)}% ${ace} / 범실 ${(err / total * 100).toFixed(1)}% ${err}`);

const st = computeStandings(164); const champ = buildPlayoffs(0).championId; const r = st[0];
log(`[시즌] 1위 ${getTeam(r.teamId)?.name} 36 ${r.wins} ${r.losses} ${r.points} ${r.setDiff >= 0 ? '+' : ''}${r.setDiff} champ=${r.teamId === champ}`);
const aw = currentSeasonAwards(0);
log(`[시즌] MVP ${getPlayer(aw.mvp!.playerId)?.name} ${getTeam(aw.mvp!.teamId)?.name}`);
