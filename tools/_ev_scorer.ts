// #1 검증(강화) — 보드 종결 스파이커가 엔진 귀속(byId)과 일치하는가 + 측정기 자가검증.
// 보드 재생(reconstructRallies + ballPath)으로 킬류 득점의 종결 토스 WP 공격수(=그 스파이크를 친 선수,
// 중계도 이 from.idx로 이름 붙음)를 추출해 r.byId와 비교.
//  (A) 실측 일치율  (B) A/B 자가검증: byId를 한 칸 어긋나게(shuffle) 비교 → 무작위로 떨어져야 도구 신뢰
//  (C) 잔여 불일치 분해: byId가 코트6에 없음(교체) vs 코트6에 있는데 표시 못함(전환공격=룰 M 한계)
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies } from '../components/courtDirector';
import { ballPath, type Lineups } from '../components/courtPath';
import { buildLineup } from '../engine/lineup';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const W = 360, H = 500, SO = 22;
const N = parseInt(process.argv[2] || '300', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const L: Lineups = { home: buildLineup(A), away: buildLineup(B) };
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

type Rec = { byId: string; boardId: string | null; byIdInSix: boolean };
const recs: Rec[] = [];

for (let s = 1; s <= N; s++) {
  const sim = simulateMatch(s, A, B, base);
  const rallies = reconstructRallies(sim);
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    if (!r.byId) continue;
    if (r.how !== 'kill' && r.how !== 'blockout' && r.how !== 'tip') continue; // byId=공격수인 킬류만
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, L, W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(r, s, L, W, H, SO, prevLast);
    const tosses = path.filter((w) => w.kind === 'toss' && w.idx >= 0);
    const last = tosses[tosses.length - 1]; // 종결 공격의 세트 = 마지막 토스 WP(중계도 이 idx로 명명)
    const six = (last?.side === 'home' ? L.home : L.away).six;
    const boardId = last ? (six[last.idx]?.id ?? null) : null;
    const inSix = (r.scorer === 'home' ? L.home : L.away).six.some((p) => p.id === r.byId)
      || (r.scorer === 'away' ? L.home : L.away).six.some((p) => p.id === r.byId);
    recs.push({ byId: r.byId, boardId, byIdInSix: inSix });
  }
}

const n = recs.length;
const real = recs.filter((x) => x.boardId === x.byId).length;
// (B) A/B: byId를 한 칸 밀어 비교 — 정렬이 깨지면 무작위(포지션 점유)로 떨어져야 함(도구가 진짜 정렬을 잰다는 증거)
const shuffled = recs.filter((x, k) => x.boardId === recs[(k + 7) % n].byId).length;
// (C) 불일치 분해
const mism = recs.filter((x) => x.boardId !== x.byId);
const mismNotInSix = mism.filter((x) => !x.byIdInSix).length;     // byId가 코트6에 없음(교체 등) — 베이스 라인업 한계
const mismInSix = mism.filter((x) => x.byIdInSix).length;          // 코트6에 있는데 표시 안 됨(전환공격=firstTouch, 룰 M)

log(`킬류 득점 ${n}건 (시드 ${N})`);
log(`(A) 실측 종결자==byId        : ${real}건  ${(real / n * 100).toFixed(1)}%`);
log(`(B) A/B 자가검증 — shuffle 비교: ${shuffled}건  ${(shuffled / n * 100).toFixed(1)}%  (실측보다 훨씬 낮아야 도구 신뢰)`);
log(`(C) 불일치 ${mism.length}건 분해: 코트6에 byId 있는데 표시못함(전환공격·룰M) ${mismInSix} · byId가 코트6에 없음(교체) ${mismNotInSix}`);
const toolOk = (real / n) >= 0.85 && (real / n) - (shuffled / n) >= 0.4;
log(`\n판정: ${toolOk ? '✅ PASS — 정렬 진짜(실측≫shuffle)·일치 85%↑. 잔여는 전환공격(룰 M 한계)' : '❌ CHECK'}`);
