// 상비 가드 — #76 드래프트 출신 영속(draftOrigin) 불변식.
//   (a) 지명 선수 draftOrigin = sequence round/overallPick/teamId + 지명 시즌 정확 일치(독립 오라클 대조)
//   (b) set-once 멱등 — 이미 draftOrigin 있으면 재실행에도 값 불변
//   (c) 라운드 정확성 — 명시 emit된 round = 실제 팀 등장 회차(휴리스틱 오라벨 없음), 패스 낀 케이스로 검증
//   (d) A/B 자가검증 — round를 +1 틀린 mutant 입력에선 오라클 대조가 FAIL 재현(오라클 이빨)
//   (e) 유찰/미지명·제네시스 선수는 draftOrigin 없음(undefined)
// draftOrigin은 패시브 표시 전용(엔진 무간섭) — 지명 시점(store endSeason) set-once. 이 가드는 그 매핑을 순수 재현해 검증.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { generateDraftClass } from '../data/draftClass';
import { lotteryRound1, buildDraftOrder, resolveDraft, type DraftSeqEntry } from '../engine/draft';
import type { CoachStyle, Player, Position } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

// 지명 시점 store 로직(useGameStore endSeason)의 순수 재현 — set-once, 이미 있으면 미덮어씀.
type Origin = { season: number; round: number; overallPick: number; teamId: string };
function applyDraftOrigin(snapshot: Record<string, Player>, sequence: DraftSeqEntry[], season: number): void {
  for (const pk of sequence) {
    const pl = snapshot[pk.playerId];
    if (pl && !pl.draftOrigin) {
      snapshot[pk.playerId] = { ...pl, draftOrigin: { season, round: pk.round, overallPick: pk.overallPick, teamId: pk.teamId } };
    }
  }
}

// 시나리오 빌더 — 제네시스 로스터(비-드래프트-클래스 id) + 드래프트 클래스. targetOf로 late 패스 유도.
const STYLES: CoachStyle[] = ['attack', 'defense', 'balanced'];
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
function buildScenario(season: number, rosterTarget: number) {
  const rng = createRng(7300 + season);
  const teamIds = Array.from({ length: 7 }, (_, i) => `T${i}`);
  const snapshot: Record<string, Player> = {};
  const rosters: Record<string, string[]> = {};
  for (const t of teamIds) {
    const ids: string[] = [];
    const rlen = rng.int(8, 10); // target(rosterTarget) 아래 → 초반 라운드 지명 + 후반 라운드 패스 혼재 유도
    for (let j = 0; j < rlen; j++) {
      const pos = POS[rng.int(0, 4)];
      const pl = { ...makeProspect(rng, `G_${t}_${j}`, pos), age: rng.int(19, 34) }; // 제네시스 id = 드래프트 클래스 포맷(d\d+_\d+) 비매치
      snapshot[pl.id] = pl; ids.push(pl.id);
    }
    rosters[t] = ids;
  }
  const cls = generateDraftClass(season, 40);
  const order = buildDraftOrder(lotteryRound1(teamIds, rng), 4);
  const styleOf = (t: string): CoachStyle => STYLES[t.charCodeAt(1) % 3];
  const targetOf = () => rosterTarget;
  // 순수 AI(myTeam='__none__') — 위시/휴먼 경로 없이 단조 지명(픽 = 라운드 1..k 연속 프리픽스)
  const res = resolveDraft(order, cls, rosters, (id) => snapshot[id], '__none__', [], styleOf, () => 1, [], targetOf);
  // store endSeason과 동일: 지명 선수를 snapshot에 병합(cls→snapshot) 후 set-once 매핑
  for (const p of res.picked) snapshot[p.id] = p;
  return { snapshot, rosters, cls, order, res };
}

// 독립 오라클 — 픽이 라운드 연속 프리픽스(단조)라는 불변식 하에 i번째 팀 픽 = 라운드 i, 전체 순번 = 시퀀스 글로벌 인덱스+1.
function oracleCheck(sequence: DraftSeqEntry[], snapshot: Record<string, Player>, season: number): number {
  let mismatch = 0;
  const byTeam: Record<string, number> = {};
  sequence.forEach((pk, gi) => {
    byTeam[pk.teamId] = (byTeam[pk.teamId] ?? 0) + 1;
    const expRound = byTeam[pk.teamId];
    const expOverall = gi + 1;
    const o = snapshot[pk.playerId]?.draftOrigin;
    if (!o) { mismatch++; return; }
    if (o.round !== expRound || o.overallPick !== expOverall || o.teamId !== pk.teamId || o.season !== season) mismatch++;
    // 엔진 emit된 pk.round가 실제 등장 회차(오라클)와 일치 — 휴리스틱 오라벨 없음
    if (pk.round !== expRound || pk.overallPick !== expOverall) mismatch++;
  });
  return mismatch;
}

const SEASON = 5;

// ── (a)+(c) 자연 런: 지명 선수 draftOrigin이 오라클과 정확 일치 + 라운드 정확성(패스 포함) ──
console.log('── (a)+(c) 자연 런 오라클 대조 (패스 포함) ──');
const sc = buildScenario(SEASON, 12); // target 12 → 라운드 후반 패스 유도
applyDraftOrigin(sc.snapshot, sc.res.sequence, SEASON);
// 패스 존재 확인 — 팀 등장(order 회차) > 실제 픽 수 이면 패스 발생
const appearances: Record<string, number> = {};
for (const t of sc.order) appearances[t] = (appearances[t] ?? 0) + 1;
const picksByTeam: Record<string, number> = {};
for (const pk of sc.res.sequence) picksByTeam[pk.teamId] = (picksByTeam[pk.teamId] ?? 0) + 1;
const passes = Object.keys(appearances).reduce((s, t) => s + Math.max(0, appearances[t] - (picksByTeam[t] ?? 0)), 0);
console.log(`  전체 지명 ${sc.res.sequence.length} · 팀 등장 합 ${sc.order.length} · 패스(등장−픽) ${passes}`);
ok(passes > 0, `패스가 낀 케이스로 검증 — 패스 ${passes}건 발생(라운드 정확성 유효)`);
const m0 = oracleCheck(sc.res.sequence, sc.snapshot, SEASON);
ok(m0 === 0, `지명 선수 전원 draftOrigin = 오라클(round·overallPick·teamId·season) 일치 — 불일치 ${m0}`);
// 라운드가 실제로 여러 값(1..k)이 나오는지(단일값이면 검증 무의미)
const roundsSeen = new Set(sc.res.sequence.map((pk) => pk.round));
ok(roundsSeen.size >= 2, `라운드 다양성 확보(1..k, ${[...roundsSeen].sort().join(',')})`);

// ── (b) set-once 멱등 — 이미 draftOrigin 있는 선수는 재실행에도 불변 ──
console.log('── (b) set-once 멱등 ──');
{
  const sc2 = buildScenario(SEASON, 12);
  // 첫 실행 = SEASON
  applyDraftOrigin(sc2.snapshot, sc2.res.sequence, SEASON);
  const firstPickId = sc2.res.sequence[0].playerId;
  const before = { ...sc2.snapshot[firstPickId].draftOrigin! };
  // 재실행 — 다른 시즌·다른 round로 덮어쓰려 시도(mutant sequence). set-once면 무시돼야 함.
  const tamper: DraftSeqEntry[] = sc2.res.sequence.map((pk) => ({ ...pk, round: pk.round + 9, overallPick: pk.overallPick + 99 }));
  applyDraftOrigin(sc2.snapshot, tamper, SEASON + 100);
  const after = sc2.snapshot[firstPickId].draftOrigin!;
  ok(after.season === before.season && after.round === before.round && after.overallPick === before.overallPick && after.teamId === before.teamId,
    `재실행(다른 시즌·round+9)에도 기존 draftOrigin 불변 — before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  // 전수: 아무 선수도 두 번째 실행 값으로 바뀌지 않음
  let overwritten = 0;
  for (const pk of sc2.res.sequence) { const o = sc2.snapshot[pk.playerId].draftOrigin!; if (o.season !== SEASON) overwritten++; }
  ok(overwritten === 0, `전수 멱등 — 두 번째 실행에 덮어쓰인 선수 0 (실제 ${overwritten})`);
}

// ── (d) A/B 자가검증 — round +1 mutant 입력에선 오라클 대조가 FAIL 재현 ──
console.log('── (d) A/B 오라클 이빨(mutant round+1) ──');
{
  const sc3 = buildScenario(SEASON, 12);
  // mutant: 한 픽의 round만 +1 틀리게. 나머지는 실제값.
  const idx = Math.min(3, sc3.res.sequence.length - 1);
  const mutant: DraftSeqEntry[] = sc3.res.sequence.map((pk, i) => (i === idx ? { ...pk, round: pk.round + 1 } : { ...pk }));
  applyDraftOrigin(sc3.snapshot, mutant, SEASON);
  const mMut = oracleCheck(mutant, sc3.snapshot, SEASON);
  ok(mMut > 0, `round+1 mutant → 오라클 대조 FAIL 재현(불일치 ${mMut} > 0) — 오라클 이빨 확인`);
  // 대조군: 같은 시나리오 실제값이면 0(오라클이 정상 입력을 거짓양성 내지 않음)
  const sc3b = buildScenario(SEASON, 12);
  applyDraftOrigin(sc3b.snapshot, sc3b.res.sequence, SEASON);
  ok(oracleCheck(sc3b.res.sequence, sc3b.snapshot, SEASON) === 0, '대조군(실제값) → 오라클 통과(거짓양성 없음)');
}

// ── (c') §1025 휴리스틱 취약성 노출 — pass-then-pick(비단조)에서 옛 "팀 재등장=새 라운드" 휴리스틱은 오라벨, 명시 emit이 근본해소 ──
console.log('── (c′) §1025 휴리스틱 vs 명시 emit ──');
{
  // 크래프트: order=[A,B,A,B,A,B](3라운드 2팀). A가 라운드2 패스, 라운드1·3 지명(현 AI는 단조라 미발생 — 휴리스틱 취약성만 노출).
  //   슬롯→픽: A(등장1)·B(등장1)·[A 등장2 패스]·B(등장2)·A(등장3)·B(등장3). 실제 라운드 = 등장 회차.
  const craftedTrue = [1, 1, 2, 3, 3]; // A1,B1,B2,A3,B3 의 실제 라운드(등장 회차) — 엔진이 emit할 값
  const craftedTeams = ['A', 'B', 'B', 'A', 'B'];
  // 옛 휴리스틱 재현(app/draft-live.tsx:107~109 / 구 store):
  const oldHeuristic = (teams: string[]): number[] => {
    let round = 1; const seen = new Set<string>();
    return teams.map((t) => { if (seen.has(t)) { round++; seen.clear(); } seen.add(t); return round; });
  };
  const heur = oldHeuristic(craftedTeams); // 기대: [1,1,2,2,3] — A3를 라운드2로 오라벨
  const divergeIdx = heur.findIndex((r, i) => r !== craftedTrue[i]);
  ok(divergeIdx >= 0, `옛 휴리스틱이 pass-then-pick에서 발산(idx ${divergeIdx}: heur=${heur[divergeIdx]} ≠ 실제=${craftedTrue[divergeIdx]}) — 휴리스틱 오라벨 실재`);
  ok(heur[3] === 2 && craftedTrue[3] === 3, `A의 라운드3 지명을 휴리스틱은 라운드2로 오라벨(2 vs 3) — 명시 emit(등장 회차)이 정답`);
}

// ── (e) 유찰/미지명·제네시스 선수는 draftOrigin 없음 ──
console.log('── (e) 미지명·제네시스 draftOrigin 없음 ──');
{
  const sc4 = buildScenario(SEASON, 12);
  applyDraftOrigin(sc4.snapshot, sc4.res.sequence, SEASON);
  const pickedIds = new Set(sc4.res.sequence.map((pk) => pk.playerId));
  // 유찰(클래스에 있으나 미지명) — draftOrigin 없어야
  const undraftedCls = sc4.cls.filter((p) => !pickedIds.has(p.id));
  const undraftedWithOrigin = undraftedCls.filter((p) => sc4.snapshot[p.id]?.draftOrigin).length;
  ok(undraftedCls.length > 0, `유찰(미지명) 선수 존재 ${undraftedCls.length}명`);
  ok(undraftedWithOrigin === 0, `유찰 선수 draftOrigin 없음 — 위반 ${undraftedWithOrigin}`);
  // 제네시스(로스터 원년) — 비-드래프트-클래스 id, draftOrigin 없어야
  const genesisIds = Object.keys(sc4.snapshot).filter((id) => id.startsWith('G_'));
  const genesisWithOrigin = genesisIds.filter((id) => sc4.snapshot[id].draftOrigin).length;
  ok(genesisWithOrigin === 0, `제네시스 선수 draftOrigin 없음 — 위반 ${genesisWithOrigin}`);
  // 화면 폴백 정규식 경계 — 클래스 id는 매치, 제네시스 id는 비매치(app/player/[id].tsx 폴백과 동일)
  const RE = /^d(\d+)_\d+$/;
  ok(sc4.cls.every((p) => RE.test(p.id)), '드래프트 클래스 id는 폴백 정규식(d\\d+_\\d+) 매치');
  ok(genesisIds.every((id) => !RE.test(id)), '제네시스 id는 폴백 정규식 비매치(약한 폴백도 안 뜸)');
  // 폴백이 인코딩하는 시즌 = 클래스 생성 시즌(=draftOrigin.season과 동일 seasonYear로 표시되도록)
  const capture = Number(RE.exec(sc4.cls[0].id)![1]);
  ok(capture === SEASON, `폴백 id 캡처 시즌(${capture}) = 클래스 생성 시즌(${SEASON}) — primary/폴백 표시 연도 정합`);
}

console.log(fail === 0 ? '\n✅ PASS _dv_draftorigin' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
