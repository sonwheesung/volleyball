// 가드 — 상황 인지 중계(BOARD_RULES 60): situationFeed가 세트/매치포인트·듀스를 정확히 검출하는가.
//   npx tsx tools/_ev_situation.ts [경기수=200]
// (A) 합성 경계 A/B: 24-23=세트포인트·23-22=null·매치포인트·듀스·연속 — 임계 정확.
// (B) 실경기: 매 점 situationFeed vs 독립 재유도(오라클) 100% 일치 + 검출 수 sanity.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch, targetPoints } from '../engine/match';
import { reconstructRallies } from '../components/courtDirector';
import { situationLine, situationFeed } from '../components/courtCommentary';
import { buildLineup } from '../engine/lineup';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '200', 10);
const fails: string[] = [];

// ── (A) 합성 경계 A/B ──
const has = (s: string | null, sub: string) => !!s && s.includes(sub);
const pre = (setNo: number, h: number, a: number, hs = 0, as = 0) => situationLine({ phase: 'pre', setNo, home: h, away: a, homeSetsWon: hs, awaySetsWon: as });
const post = (setNo: number, h: number, a: number, streakSide?: any, streak?: number) => situationLine({ phase: 'post', setNo, home: h, away: a, homeSetsWon: 0, awaySetsWon: 0, streakSide, streak });
if (!has(pre(1, 24, 23), '세트포인트')) fails.push('24-23(set1) 세트포인트 미검출');
if (pre(1, 23, 22) !== null) fails.push('23-22(set1) 세트포인트 오검출(경계)');
if (!has(pre(5, 14, 13, 2, 1), '매치포인트')) fails.push('14-13(set5·2세트보유) 매치포인트 미검출');
if (has(pre(5, 14, 13, 0, 1), '매치포인트')) fails.push('세트 0개인데 매치포인트(오검출)');
if (pre(1, 24, 24) !== null) fails.push('24-24 pre는 null이어야(듀스는 post 담당)');
if (!has(post(1, 24, 24), '듀스')) fails.push('24-24 듀스 미검출');
if (post(1, 25, 23) !== null) fails.push('25-23 post 듀스 오검출');
if (!has(post(1, 20, 12, 'home', 5), '연속')) fails.push('5연속 미검출');
if (post(1, 20, 12, 'home', 3) !== null) fails.push('3연속인데 연속 검출(경계 — 4+만)');

// ── (B) 실경기: 독립 오라클과 100% 일치 ──
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;
let setPts = 0, matchPts = 0, deuces = 0, mismatch = 0, points = 0;
for (let s = 1; s <= N; s++) {
  const sim = simulateMatch(s, A, B, base);
  const rallies = reconstructRallies(sim);
  for (let i = 0; i < rallies.length; i++) {
    points++;
    const r = rallies[i]; const setNo = r.setNo; const target = targetPoints(setNo);
    // 독립 오라클: before 점수·세트스코어
    const prev = i > 0 && rallies[i - 1].setNo === setNo ? rallies[i - 1] : null;
    const hb = prev?.home ?? 0, ab = prev?.away ?? 0;
    let hs = 0, as = 0;
    for (let ss = 1; ss < setNo; ss++) { let last: any = null; for (let k = 0; k < rallies.length; k++) if (rallies[k].setNo === ss) last = rallies[k]; if (last) { if (last.home > last.away) hs++; else as++; } }
    const hi = Math.max(hb, ab), lo = Math.min(hb, ab); const leader = hb > ab ? 'home' : ab > hb ? 'away' : null;
    const expectSetPt = !!leader && hi >= target - 1 && lo < target - 1;
    const expectMatchPt = expectSetPt && (leader === 'home' ? hs : as) >= 2;
    const expectDeuce = r.home >= target - 1 && r.away >= target - 1 && r.home === r.away;
    const f = situationFeed(rallies, i, '홈', '원정');
    // pre 검증
    const gotMatch = has(f.pre, '매치포인트'), gotSet = has(f.pre, '세트포인트');
    if (expectMatchPt !== gotMatch) { mismatch++; if (fails.length < 6) fails.push(`매치포인트 불일치 set${setNo} ${hb}-${ab} sets${hs}-${as}`); }
    if ((expectSetPt && !expectMatchPt) !== gotSet) { mismatch++; if (fails.length < 6) fails.push(`세트포인트 불일치 set${setNo} ${hb}-${ab}`); }
    // post 듀스 검증
    const gotDeuce = has(f.post, '듀스');
    if (expectDeuce !== gotDeuce) { mismatch++; if (fails.length < 6) fails.push(`듀스 불일치 set${setNo} ${r.home}-${r.away}`); }
    if (expectMatchPt) matchPts++; else if (expectSetPt) setPts++;
    if (expectDeuce) deuces++;
  }
}

log(`=== 상황 인지 중계 검증 (${N}경기 · ${points}점) ===`);
log(`  검출: 세트포인트 ${setPts} · 매치포인트 ${matchPts} · 듀스 ${deuces} · situationFeed↔독립오라클 불일치 ${mismatch}`);
log(`  합성 경계 A/B: ${fails.filter((f) => !f.includes('불일치')).length === 0 ? 'OK' : 'FAIL'}`);
const pass = fails.length === 0 && mismatch === 0 && setPts > 0 && deuces > 0;
log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 6).join(' / ') : ''}`);
if (!pass) process.exit(1);
