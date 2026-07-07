// A4 검증(2026-07-08) — 훈련 방침 타임라인 "바꾼 날부터 적용" 쌍대조 + 마이그레이션 바이트 동일. DO NOT COMMIT.
import assert from 'node:assert';
import { evolvePlayer, type FocusResolver } from '../engine/progression';
import { makeProspect, ARCHETYPES } from '../data/seed';
import { createRng } from '../engine/rng';
import { migrateSave } from '../store/saveMigration';
import type { Player, TrainingFocus } from '../types';

const ATK = ARCHETYPES.find((a) => a.name === '공격파')!.focus;   // primary jump/공격
const DEF = ARCHETYPES.find((a) => a.name === '수비파')!.focus;   // primary 리시브/디그
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const eq = (a: Player, b: Player) => JSON.stringify(a) === JSON.stringify(b);

// 성장 여지 있는 유망주 20명(방침 차이가 드러나게)
const rng = createRng(42);
const players: Player[] = [];
for (let i = 0; i < 20; i++) players.push(makeProspect(rng, `a4-${i}`, (['OH', 'OP', 'MB', 'S', 'L'] as const)[i % 5]));

const D = 80;   // 방침 변경일
const TOTAL = 160;
// 타임라인 해석기: 0..D-1 = ATK, D.. = DEF (evolvePlayer는 days 루프에서 focusAt(d)로 그날 방침 사용)
const changeAtD: FocusResolver = (day: number): TrainingFocus => (day < D ? ATK : DEF);
const constATK: FocusResolver = () => ATK;

// ─── (1) 쌍대조: day ≤ D 는 무변경(ATK)과 바이트 동일 / day > D 는 발산 ───
console.log('═══ A4 쌍대조 (바꾼 날부터 · 본 역사 보존) ═══');
{
  let identicalBefore = 0, divergedAfter = 0;
  for (const p of players) {
    // days=D: 루프 d=0..D-1 전부 <D → ATK → 상수 ATK와 동일해야(과거 소급 없음)
    const changedAtD = evolvePlayer(p, changeAtD, D);
    const constAtD = evolvePlayer(p, constATK, D);
    if (eq(changedAtD, constAtD)) identicalBefore++;
    // days=TOTAL: D..TOTAL-1 은 DEF → 상수 ATK와 달라야(변경이 앞으로 실제 발현)
    const changedFull = evolvePlayer(p, changeAtD, TOTAL);
    const constFull = evolvePlayer(p, constATK, TOTAL);
    if (!eq(changedFull, constFull)) divergedAfter++;
  }
  check('A4-1a day≤D 무변경(ATK)과 바이트 동일 (소급 0)', identicalBefore === players.length, `${identicalBefore}/${players.length}`);
  check('A4-1b day>D 발산 (변경이 앞으로 발현)', divergedAfter === players.length, `${divergedAfter}/${players.length}`);
}

// ─── (1역) 반대 방향(DEF→ATK)도 대칭 확인(A/B 민감도) ───
{
  const changeDefToAtk: FocusResolver = (day: number) => (day < D ? DEF : ATK);
  const constDEF: FocusResolver = () => DEF;
  let idB = 0, divA = 0;
  for (const p of players) {
    if (eq(evolvePlayer(p, changeDefToAtk, D), evolvePlayer(p, constDEF, D))) idB++;
    if (!eq(evolvePlayer(p, changeDefToAtk, TOTAL), evolvePlayer(p, constDEF, TOTAL))) divA++;
  }
  check('A4-1c 반대방향(DEF→ATK) day≤D 동일', idB === players.length, `${idB}/${players.length}`);
  check('A4-1d 반대방향 day>D 발산', divA === players.length, `${divA}/${players.length}`);
}

// ─── (2) 마이그레이션 바이트 동일: 구세이브 단일 trainingFocus → focusLog[{fromDay:0}] ───
console.log('═══ A4 마이그레이션 바이트 동일 ═══');
{
  // 구세이브(진행 중): trainingFocus 있음, focusLog 없음
  const oldSave = { selectedTeamId: 't', trainingFocus: ATK, claimedAch: [] };
  const migrated = migrateSave(oldSave, 1);
  const fl = migrated.focusLog as { fromDay: number; focus: TrainingFocus }[];
  check('A4-2a 구세이브 focusLog=[{fromDay:0, focus:구값}]', Array.isArray(fl) && fl.length === 1 && fl[0].fromDay === 0 && JSON.stringify(fl[0].focus) === JSON.stringify(ATK), JSON.stringify(fl));

  // 마이그레이션된 타임라인 해석기 == 구 상수 focus(day0부터) → 진화 바이트 동일
  const sorted = [...fl].sort((a, b) => a.fromDay - b.fromDay);
  const migResolver: FocusResolver = (day) => { let f: TrainingFocus | null = null; for (const s of sorted) { if (s.fromDay <= day) f = s.focus; } return f ?? ATK; };
  let identical = 0;
  for (const p of players) {
    for (const days of [40, 90, 160]) {
      if (eq(evolvePlayer(p, migResolver, days), evolvePlayer(p, ATK, days))) identical++;
    }
  }
  check('A4-2b 마이그레이션 타임라인 진화 == 구 상수(바이트 동일)', identical === players.length * 3, `${identical}/${players.length * 3}`);

  // 방침 없던 구세이브(trainingFocus=null) → focusLog=[]
  const noFocus = migrateSave({ selectedTeamId: 't', trainingFocus: null, claimedAch: [] }, 1);
  check('A4-2c 방침 미설정 구세이브 → focusLog=[]', Array.isArray(noFocus.focusLog) && (noFocus.focusLog as unknown[]).length === 0, JSON.stringify(noFocus.focusLog));

  // 신규 세이브(focusLog 이미 존재) → 시드 스킵(덮어쓰기 안 함)
  const newSave = migrateSave({ selectedTeamId: 't', trainingFocus: DEF, focusLog: [{ fromDay: 90, focus: DEF }], claimedAch: [] }, 2);
  const nfl = newSave.focusLog as { fromDay: number }[];
  check('A4-2d 신규 세이브 focusLog 보존(시드 스킵)', nfl.length === 1 && nfl[0].fromDay === 90, JSON.stringify(nfl));
}

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
