// 커버 안무 v2 검증(BOARD_RULES 룰 62) — 세터 토스 시 "공격 옵션은 커버로 안 빠진다"를 실측.
//   npx tsx tools/_dv_cover.ts [경기수=40]
// 오라클: open/tempo(세터가 고를 수 있는 국면)면 전위 히터(옵션)가 커버에 0명이어야 한다(위장).
//         백어택이면 전위가 네트 앞 커버로 들어온다(대조 — 같은 도구가 전위 커버를 볼 수 있음 = 비공허 A/B).
//         어느 국면이든 이번 공격수(atkIdx)는 커버 아님(자기 공격).
// 추정 금지: 코드가 아니라 실제 ballPath 재생 결과(coverSink)로 판정.
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type Atk } from '../components/courtPath';
import { reconstructRallies } from '../components/courtDirector';

const W = 360, H = 500, SERVE_OUT = 22;
const nMatches = Math.max(1, Number(process.argv[2]) || 40);
const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

type Rec = { atk: Atk; atkIdx: number; front: number[]; cover: number[] };
const recs: Rec[] = [];

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length];
  const aId = teams[(m + 1 + (m % (teams.length - 1))) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0);
  const aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId), touches: true });
  const rallies = reconstructRallies(sim);
  let prevLast: { x: number; y: number } | undefined;
  for (const r of rallies) {
    const sink: Rec[] = [];
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast, undefined, sink);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    recs.push(...sink);
  }
}

// 집계
const group = (f: (r: Rec) => boolean) => recs.filter(f);
const frontInCover = (r: Rec) => r.cover.filter((c) => r.front.includes(c)).length;
const atkInCover = (r: Rec) => r.cover.includes(r.atkIdx);

const disguise = group((r) => r.atk === 'open' || r.atk === 'tempo'); // 위장 국면
const back = group((r) => r.atk === 'back');
const quick = group((r) => r.atk === 'quick');

const disguiseFrontLeak = disguise.filter((r) => frontInCover(r) > 0).length; // 위반: 옵션(전위)이 커버에
const backFrontCover = back.filter((r) => frontInCover(r) > 0).length;         // 대조: 백어택은 전위 커버 참여
const anyAtkInCover = recs.filter(atkInCover).length;                          // 위반: 공격수가 커버

const pct = (n: number, d: number) => d ? (100 * n / d).toFixed(1) : '—';
log('\n═══ 커버 안무 v2 검증 (룰 62) ═══');
log(`표본: ${recs.length} 커버 국면 (${nMatches}경기) — open/tempo ${disguise.length} · back ${back.length} · quick ${quick.length}`);
log('');
log(`① [위장] open/tempo 전위 옵션이 커버에 낀 국면: ${disguiseFrontLeak} (${pct(disguiseFrontLeak, disguise.length)}%) — 기대 0`);
log(`② [대조/비공허] 백어택서 전위가 네트앞 커버로: ${backFrontCover} (${pct(backFrontCover, back.length)}%) — 같은 도구가 전위 커버를 봄(측정 유효)`);
log(`③ [불변] 이번 공격수(atkIdx)가 자기 커버에 낀 국면: ${anyAtkInCover} — 기대 0`);
log(`   (참고) 위장 국면 평균 커버 인원: ${(disguise.reduce((s, r) => s + r.cover.length, 0) / (disguise.length || 1)).toFixed(2)} · 백어택 ${(back.reduce((s, r) => s + r.cover.length, 0) / (back.length || 1)).toFixed(2)}`);

const pass = disguiseFrontLeak === 0 && anyAtkInCover === 0 && backFrontCover > 0;
log('');
log(pass ? '✅ PASS — 옵션 커버 누출 0 · 공격수 커버 0 · 백어택 전위커버 대조 유효' : '❌ FAIL — 위 지표 확인');
process.exit(pass ? 0 : 1);
