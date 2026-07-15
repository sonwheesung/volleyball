// 검증 도구(F1 — 경기 개입 서브교체 사전차단) — "현재 서버 슬롯" 도출의 로테이션 재생이 엔진과 100% 일치함을 박제.
//
// 보드 UI(app/match/[id].tsx `pinchBlock`)는 서브 교체(핀치)가 뺄 대상으로 삼는 **현재 서버 슬롯**을
// `reconstructRallies(components/courtDirector)`로 로테이션을 재생해 `serverIndex(rot)`로 얻는다. 그 슬롯 선수가
// 세터/부상교체슬롯/활성교체슬롯/복귀선발이면 엔진 subIn이 반드시 거부하므로(match.ts) 메뉴에서 사전차단한다.
// → 이 재생이 틀리면 엉뚱한 선수를 서버로 지목해 오차단/미차단이 난다. 추정 금지(CLAUDE §11): 시뮬로 증명.
//
// 이 도구는 `reconstructRallies`의 per-rally (serving·homeRot·awayRot)가 엔진 `simulateMatch(opts.trace)`가 랠리
// 루프 최상단에 찍는 `[h:a] 서브권 X (로테이션 Hn/An)` 줄(주입 지점 상태 그 자체)과 **모든 랠리에서** 일치함을 대조한다.
// + A/B 자가검증: 의도적 오프바이원 변이(로컬 사본, 회전 +1 보고)는 반드시 FAIL — 허위 오라클(무민감 통과) 방지.
import { simulateMatch } from '../engine/match';
import { reconstructRallies } from '../components/courtDirector';
import { serverIndex } from '../engine/rotation';
import type { SimResult } from '../engine/simMatch';
import type { Side } from '../types';
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';

resetLeagueBase();
const teams = LEAGUE.teams;

// 엔진 트레이스 로테이션 줄: "[h:a] 서브권 홈|원정 (로테이션 H{n}/A{n})" — 랠리당 1줄, 랠리 순서.
const ROT_RE = /^\[(\d+):(\d+)\] 서브권 (홈|원정) \(로테이션 H(\d+)\/A(\d+)\)$/;

interface TLine { h: number; a: number; serving: Side; H: number; A: number }
function parseTrace(trace: string[]): TLine[] {
  const out: TLine[] = [];
  for (const l of trace) {
    const m = ROT_RE.exec(l);
    if (m) out.push({ h: +m[1], a: +m[2], serving: m[3] === '홈' ? 'home' : 'away', H: +m[4], A: +m[5] });
  }
  return out;
}

interface RState { serving: Side; H: number; A: number }
// 실제 UI가 쓰는 재생(reconstructRallies)에서 랠리 진입 상태(before-rally)를 뽑는다.
function shippedReplay(sim: SimResult): RState[] {
  return reconstructRallies(sim).map((r) => ({ serving: r.serving, H: r.homeRot, A: r.awayRot }));
}
// 변이 사본 — 회전 결과를 한 칸 어긋나게 보고(오프바이원). 반드시 트레이스와 불일치해야(민감도 증명).
function mutantReplay(sim: SimResult): RState[] {
  return reconstructRallies(sim).map((r) => ({ serving: r.serving, H: (r.homeRot + 1) % 6, A: (r.awayRot + 1) % 6 }));
}

function compare(states: RState[], lines: TLine[]): { total: number; mismatch: number; first: string | null } {
  let total = 0, mismatch = 0; let first: string | null = null;
  const n = Math.min(states.length, lines.length);
  if (states.length !== lines.length && !first) first = `length mismatch: replay=${states.length} trace=${lines.length}`;
  for (let i = 0; i < n; i++) {
    total++;
    const s = states[i], t = lines[i];
    if (s.serving !== t.serving || s.H !== t.H || s.A !== t.A) {
      mismatch++;
      if (!first) first = `i=${i} replay(serv=${s.serving} H${s.H}/A${s.A}) vs trace(serv=${t.serving} H${t.H}/A${t.A}) [${t.h}:${t.a}]`;
    }
  }
  return { total, mismatch: mismatch + Math.abs(states.length - lines.length), first };
}

const N = 400; // ≥300경기
let matches = 0, rallies = 0, badMatches = 0;
let mutantCaught = 0; // 변이가 잡힌 경기 수(민감도)
let firstBad: string | null = null;
// 추가: reconstructRallies로 도출한 서버 슬롯(serverIndex)이 항상 0..5 범위인지도 확인(경계 sanity)
let slotBad = 0;

for (let i = 0; i < N; i++) {
  const seed = (i * 2654435761) >>> 0;
  const H = getEvolvedTeamPlayers(teams[i % teams.length].id, 0);
  const A = getEvolvedTeamPlayers(teams[(i + 1) % teams.length].id, 0);
  const opts = { home: coachInfoOf(teams[i % teams.length].id), away: coachInfoOf(teams[(i + 1) % teams.length].id) };
  const trace: string[] = [];
  const sim = simulateMatch(seed, H, A, { ...opts, trace });
  if (sim.points.length < 10) continue;
  matches++;

  const lines = parseTrace(trace);
  const shipped = shippedReplay(sim);
  const r = compare(shipped, lines);
  rallies += r.total;
  if (r.mismatch > 0) { badMatches++; if (!firstBad) firstBad = `SHIPPED seed=${seed}: ${r.first}`; }

  // 서버 슬롯 경계 sanity — 각 랠리의 서브 팀 슬롯이 유효 인덱스인지
  for (const st of shipped) {
    const slot = serverIndex(st.serving === 'home' ? st.H : st.A);
    if (slot < 0 || slot > 5 || !Number.isInteger(slot)) slotBad++;
  }

  // A/B 민감도 — 같은 경기에서 변이 재생은 반드시 불일치
  const m = compare(mutantReplay(sim), lines);
  if (m.mismatch > 0) mutantCaught++;
}

console.log(`matches=${matches} rallies=${rallies} badMatches=${badMatches} mutantCaught=${mutantCaught}/${matches} slotBad=${slotBad}`);
if (matches < 300) { console.log(`FAIL — 유효 경기 ${matches} < 300`); process.exit(1); }
if (badMatches > 0) { console.log(`FAIL — 재생≠엔진트레이스: ${firstBad}`); process.exit(1); }
if (slotBad > 0) { console.log(`FAIL — 서버 슬롯 인덱스 범위 이탈 ${slotBad}건`); process.exit(1); }
if (mutantCaught !== matches) { console.log(`FAIL — 민감도: 변이 재생이 안 잡힌 경기 ${matches - mutantCaught}건(허위 오라클)`); process.exit(1); }
console.log(`PASS — ${matches}경기 ${rallies}랠리 전건 재생=엔진 일치(100%), 서버슬롯 경계 OK, 변이 민감도 ${mutantCaught}/${matches} 전건 검출`);
