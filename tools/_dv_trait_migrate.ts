// v4→v5 구세이브 특성 재부여 마이그레이션 가드 (SAVE_SYSTEM §6 · TRAIT_SYSTEM §1) — 오늘 특성 20종 확장 전에 만든
//   세이브(옛 규칙: 무특성 허용·반응형 없음)의 base 선수 전원 traits가 rollTraits(id) 새 규칙으로 재부여되는지.
//   npx tsx tools/_dv_trait_migrate.ts
// 검증: (a) 전 선수 1~3개·상극 0쌍·반응형 최소 1명 (b) 결정론(동일 입력 2회=동일) (c) 아카이브(HOF/archive/careerTotals
//      /retirements) 바이트 불변 (d) traits 외 선수 필드 불변 (e) version≥5 게이트(일회성 — 재migrate 안 함).
//      A/B 자가검증: 재부여 스킵(=원본 playerBase, 마이그레이션 안 한 뮤턴트)이면 (a) FAIL.
import './_gt_mock';
import { migrateSave } from '../store/saveMigration';
import { ANTAGONISTS } from '../engine/traits';
import type { Trait } from '../types';

let fail = 0;
const check = (name: string, cond: boolean) => { process.stdout.write(`${cond ? '✅' : '❌'} ${name}\n`); if (!cond) fail++; };

// 반응형(reactive) 특성 집합 (TRAIT_SYSTEM §6.3 Phase 2a/2b) — 경기 중 사건→임시 버프. 구세이브엔 존재 불가.
const REACTIVE: ReadonlySet<Trait> = new Set<Trait>(['joker', 'fragile', 'bounce', 'coldStart', 'pinchServer', 'clutchSub', 'aceStreak']);

// ── 구세이브(v4) 목 — 무특성·옛특성 선수 혼재. 아카이브 필드도 채워 (c) 불변 검증 ──
//   옛 규칙 재현: 일부는 traits 누락, 일부 traits:[](빈 배열 — commitPlayerBase 590 truthy 버그로 그대로 남던 케이스),
//   일부는 옛 특성만(반응형 없음). career/나이/스탯 등 다른 필드도 넣어 (d) 불변 검증.
const N = 300;
const playerBase: Record<string, any> = {};
for (let i = 0; i < N; i++) {
  const id = 'p' + i;
  const oldTraits = i % 3 === 0 ? [] : i % 3 === 1 ? undefined : (['clutch', 'iron'] as Trait[]); // 무특성(빈)·누락·옛특성
  playerBase[id] = {
    id, name: '선수' + i, age: 20 + (i % 15), position: 'OH',
    height: 175 + (i % 20), jump: 60, agility: 60, stamina: 70,
    skSpike: 55, skBlock: 50, career: { seasons: i % 8, matches: i * 3, points: i * 40, aces: i },
    ...(oldTraits === undefined ? {} : { traits: oldTraits }),
  };
}
// 아카이브·기록 필드(playerBase와 별개 영속 필드 — 마이그레이션이 절대 손대면 안 됨)
const v4save = {
  selectedTeamId: 't0', season: 6, currentDay: 40,
  playerBase,
  hallOfFame: [{ id: 'p1', name: '선수1', season: 3, award: 'MVP' }, { id: 'p9', name: '선수9', season: 5, award: '신인상' }],
  archive: [{ season: 3, championId: 't2' }, { season: 4, championId: 't0' }, { season: 5, championId: 't1' }],
  careerTotals: { points: 12345, aces: 678, setsWon: 90, setsLost: 42, matchWins: 30, matchLosses: 18 },
  retirements: [{ id: 'p3', name: '선수3', season: 4 }],
};

// 아카이브 원본 지문(재부여가 이 필드들을 훼손하지 않는지 — 바이트 대조)
const archiveFP = JSON.stringify({ hallOfFame: v4save.hallOfFame, archive: v4save.archive, careerTotals: v4save.careerTotals, retirements: v4save.retirements });

// ── B) 실제 마이그레이션(v4 → migrateSave, version=4 < 5) ──
const migrated = migrateSave(JSON.parse(JSON.stringify(v4save)), 4);
const mpb = migrated.playerBase as Record<string, any>;

// (a) 전 선수 1~3개 · 상극 0쌍 · 반응형 최소 1명
const gradeTraits = (pb: Record<string, any>) => {
  let allInRange = true, antagPairs = 0, reactiveCount = 0, everyoneHas = true;
  for (const id of Object.keys(pb)) {
    const ts: Trait[] = pb[id].traits ?? [];
    if (ts.length < 1 || ts.length > 3) allInRange = false;
    if (ts.length === 0) everyoneHas = false;
    const set = new Set(ts);
    for (const t of ts) {
      if (REACTIVE.has(t)) reactiveCount++;
      for (const a of ANTAGONISTS[t] ?? []) if (set.has(a)) antagPairs++;
    }
  }
  return { allInRange, everyoneHas, antagPairs, reactiveCount };
};
const g = gradeTraits(mpb);
process.stdout.write('\n[B) 실제 마이그레이션 — 재부여 결과]\n');
check(`(a) 전 선수 1~3개 특성 보유(무특성 0)`, g.allInRange && g.everyoneHas);
check(`(a) 상극 동시부여 0쌍 (실측 ${g.antagPairs})`, g.antagPairs === 0);
check(`(a) 반응형 특성 최소 1명 등장 (실측 ${g.reactiveCount}개 슬롯)`, g.reactiveCount >= 1);

// (c) 아카이브 바이트 불변
process.stdout.write('\n[c) 아카이브 보존 — 하드 요건]\n');
const archiveAfter = JSON.stringify({ hallOfFame: migrated.hallOfFame, archive: migrated.archive, careerTotals: migrated.careerTotals, retirements: migrated.retirements });
check('(c) HOF/archive/careerTotals/retirements 바이트 불변', archiveAfter === archiveFP);

// (d) traits 외 선수 필드 불변
process.stdout.write('\n[d) traits 외 선수 필드 불변]\n');
let fieldsIntact = true, mismatchId = '';
for (const id of Object.keys(playerBase)) {
  const before = { ...playerBase[id] }; delete before.traits;
  const after = { ...mpb[id] }; delete after.traits;
  if (JSON.stringify(before) !== JSON.stringify(after)) { fieldsIntact = false; mismatchId = id; break; }
}
check(`(d) career/나이/스탯 등 traits 외 전부 불변${mismatchId ? ' (불일치 ' + mismatchId + ')' : ''}`, fieldsIntact);

// (b) 결정론 — 동일 입력 2회 = 동일 결과
process.stdout.write('\n[b) 결정론]\n');
const migrated2 = migrateSave(JSON.parse(JSON.stringify(v4save)), 4);
const traitsFP = (m: any) => JSON.stringify(Object.keys(m.playerBase).map((id: string) => [id, (m.playerBase[id].traits ?? [])]));
check('(b) 동일 입력 2회 → 동일 traits 재부여', traitsFP(migrated) === traitsFP(migrated2));

// (e) version≥5 게이트 — 일회성(v5 저장 후 재migrate하면 재부여 안 함, traits 원형 유지)
process.stdout.write('\n[e) version 게이트 — 일회성]\n');
const alreadyV5 = { selectedTeamId: 't0', playerBase: { z0: { id: 'z0', name: 'Z', traits: ['clutch'] } } };
const notReRolled = migrateSave(JSON.parse(JSON.stringify(alreadyV5)), 5).playerBase as Record<string, any>;
check('(e) version=5 입력 → traits 재부여 안 함(원형 유지)', JSON.stringify(notReRolled.z0.traits) === JSON.stringify(['clutch']));

// ── A) 뮤턴트: 재부여 스킵(=원본 playerBase, 마이그레이션 안 함) → (a) FAIL 이어야 가드가 민감 ──
process.stdout.write('\n[A) A/B 자가검증 — 재부여 스킵 뮤턴트]\n');
const gRaw = gradeTraits(playerBase); // 원본(옛 규칙)
const rawFailsA = !(gRaw.allInRange && gRaw.everyoneHas) || gRaw.reactiveCount !== 0; // 무특성 존재 or 반응형 없음
check(`A) 재부여 스킵(원본) → (a) 조건 FAIL 실증 [무특성 존재=${!gRaw.everyoneHas}·반응형 ${gRaw.reactiveCount}개]`, rawFailsA);
check('B) 재부여 후 → (a) 조건 PASS (위 [B] 블록)', g.allInRange && g.everyoneHas && g.antagPairs === 0 && g.reactiveCount >= 1);

process.stdout.write(fail === 0 ? '\n✅ ALL PASS\n' : `\n❌ ${fail} FAIL\n`);
process.exit(fail === 0 ? 0 : 1);
