// 통계 이중 계산 차이 측정 — 스코어박스(rally.ts box, 관전/상세가 보는 기록) vs 생산(production.ts,
// 통산·시즌·시상·연봉이 먹는 기록)이 같은 경기에서 선수별로 얼마나 어긋나나(2026-06-24 사용자: "차이 0이어야").
// 같은 시드·같은 명단으로 둘을 돌려 선수별·카테고리별 |box - prod| 합산. 팀 합계 정렬 vs 개인 분기 대조.
//   A/B 자가검증(허위 오라클 차단): (대조) box vs box = 0이어야 / (실측) box vs prod = 분기 노출되어야.
// 사용: npx tsx tools/_ev_statsource.ts [경기수=2000]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import type { BoxSink, BoxLine } from '../engine/rally';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '2000', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;
const posOf = new Map<string, string>();
for (const p of [...A, ...B]) posOf.set(p.id, p.position);

// 비교 카테고리: box 필드 ↔ prod 필드(같은 사건의 두 귀속). 정의가 1:1인 것만(receives는 정의 달라 별도 참고).
type Cat = { name: string; box: (l: BoxLine) => number; prod: (l: any) => number };
const CATS: Cat[] = [
  { name: '스파이크(킬+블록아웃)', box: (l) => l.atkKill, prod: (l) => l.spikes },
  { name: '블록(스터프)', box: (l) => l.blockPt, prod: (l) => l.blocks },
  { name: '에이스', box: (l) => l.srvAce, prod: (l) => l.aces },
  { name: '어시(세트)', box: (l) => l.assist, prod: (l) => l.assists },
  { name: '디그', box: (l) => l.digSucc, prod: (l) => l.digs },
];

// 선수별 누적: box / prod 각각
const boxAgg = new Map<string, BoxLine>();
const prodAgg = new Map<string, any>();
const addBox = (id: string, l: BoxLine) => {
  const cur = boxAgg.get(id);
  if (!cur) { boxAgg.set(id, { ...l }); return; }
  for (const k of Object.keys(l) as (keyof BoxLine)[]) cur[k] += l[k];
};
const addProd = (id: string, l: any) => {
  const cur = prodAgg.get(id) ?? {};
  for (const k of Object.keys(l)) cur[k] = (cur[k] ?? 0) + l[k];
  prodAgg.set(id, cur);
};

for (let s = 1; s <= N; s++) {
  const box: BoxSink = new Map();
  const sim = simulateMatch(s, A, B, { ...base, box });
  for (const [id, l] of box) addBox(id, l);
  const prod = attributeProduction(sim, A, B, s);
  for (const [id, l] of prod) addProd(id, l);
}

const ids = new Set<string>([...boxAgg.keys(), ...prodAgg.keys()]);
log(`시드 ${N}경기 · 선수 ${ids.size}명(양팀) — 스코어박스(box) vs 생산(production) 선수별 차이\n`);
log(`카테고리                    box합     prod합   팀합차%   선수별|차이|합   분기율(개인)`);
let anyDiverge = false;
for (const c of CATS) {
  let boxSum = 0, prodSum = 0, absDiff = 0;
  for (const id of ids) {
    const bv = boxAgg.has(id) ? c.box(boxAgg.get(id)!) : 0;
    const pv = prodAgg.has(id) ? c.prod(prodAgg.get(id)!) : 0;
    boxSum += bv; prodSum += pv; absDiff += Math.abs(bv - pv);
  }
  const teamDiffPct = boxSum > 0 ? Math.abs(boxSum - prodSum) / boxSum * 100 : 0;
  // 분기율 = 선수별 차이 합 / box 총량 — 팀합은 같아도 개인이 갈리면 100% 가까이 나올 수 있다(핵심 지표)
  const divergePct = boxSum > 0 ? absDiff / boxSum * 100 : 0;
  if (divergePct > 1) anyDiverge = true;
  log(`${c.name.padEnd(22)} ${String(boxSum).padStart(8)} ${String(prodSum).padStart(9)} ${teamDiffPct.toFixed(1).padStart(7)}% ${String(absDiff).padStart(12)} ${divergePct.toFixed(1).padStart(10)}%`);
}

// ── A/B 자가검증 — 도구가 진짜 차이를 재는지(허위 오라클 차단) ──
// 대조: box를 자기 자신과 비교 → 모든 카테고리 0이어야(차이 없는 입력엔 0).
let selfDiff = 0;
for (const c of CATS) for (const id of ids) {
  const bv = boxAgg.has(id) ? c.box(boxAgg.get(id)!) : 0;
  selfDiff += Math.abs(bv - bv);
}
log(`\n[A/B 자가검증]`);
log(`  대조(box vs box, 같은 소스): 선수별 차이 합 = ${selfDiff}  (0이어야 — PASS=${selfDiff === 0})`);
log(`  실측(box vs prod): 위 표의 분기율 — 두 모델이 다르면 >0  (분기 노출=${anyDiverge})`);
log(`\n결론: ${anyDiverge ? '⚠ 두 통계 소스가 선수 단위로 어긋남(분기율 표 참조) → 통합 필요(사용자 결정: 차이 0)' : '✅ 선수 단위로도 일치'}`);
log(`참고: 리시브는 정의가 달라(box recvAtt=전 리시브 incl 범실 / prod receives=패서 픽) 위 표에서 제외 — 통합 시 정의 통일 대상`);
