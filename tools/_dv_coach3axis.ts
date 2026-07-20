// _dv_coach3axis — 감독 능력 3축 개편(스태프 3.0 Phase A, STAFF_SYSTEM §9.6-A) 가드.
//   (a) 기존 감독 matchOps == 구 charisma(값 이관 무손실 — HEAD 골든 대조)
//   (b) 신규 2축(육성 철학·리더십) 범위 0~100 + id 시드 결정론(두 번 생성 동일)
//   (c) 파생 유형 라벨 분포 — 세 유형(승부형/육성형/조직관리형) 모두 등장
//   (d) 세이브 마이그레이션 v3→v4 왕복 — 구 세이브(charisma) 로드 시 크래시 0·값 보존·멱등
//   실행: npx tsx tools/_dv_coach3axis.ts        (정상 = PASS)
//         npx tsx tools/_dv_coach3axis.ts --ab   (A/B 자가검증 — 각 체크에 결함 주입 → 검출 증명)
import { LEAGUE, resetLeagueBase, getTeamCoach, availableCoaches } from '../data/league';
import { deriveHeadAxes, headArchetypeOf, headType3, HEAD_TYPE3_KO, type HeadType3 } from '../engine/staff';
import { migrateSave, SAVE_VERSION } from '../store/saveMigration';

const log = (m: string) => process.stdout.write(m + '\n');
const AB = process.argv.includes('--ab');

// ── 골든: HEAD(개편 전) 시드 감독 charisma 값(scratchpad/head_out.json에서 캡처, 2026-07-20).
//    개편 후 각 감독 matchOps가 이 값과 정확히 같아야 = 값 이관 무손실(엔진 등가). rng 소비가 밀리면 여기서 깨진다.
const GOLDEN_CHARISMA: Record<string, number> = {
  t0c: 59, t1c: 78, t2c: 59, t3c: 75, t4c: 93, t5c: 74, t6c: 78,
  fc0: 85, fc1: 69, fc2: 62, fc3: 48, fc4: 88, fc5: 56,
};

interface Coach3 { id: string; matchOps: number; dvPhilosophy: number; leadership: number }

/** 현재(개편 후) 시드 감독들의 3축을 수집. mutate=true면 matchOps를 오염(A/B — (a) 검출 증명용). */
function collectSeedCoaches(mutate = false): Coach3[] {
  resetLeagueBase();
  const out: Coach3[] = [];
  const push = (c: { id: string; matchOps: number; dvPhilosophy: number; leadership: number }) =>
    out.push({ id: c.id, matchOps: mutate ? c.matchOps + 1 : c.matchOps, dvPhilosophy: c.dvPhilosophy, leadership: c.leadership });
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) push(c); }
  for (const c of availableCoaches()) push(c);
  return out;
}

// (a) matchOps == 구 charisma
function checkA(mutate = false): { pass: boolean; msg: string } {
  const coaches = collectSeedCoaches(mutate);
  const bad: string[] = [];
  for (const c of coaches) {
    const g = GOLDEN_CHARISMA[c.id];
    if (g === undefined) continue; // 골든에 없는(런타임 생성) 감독은 스킵
    if (c.matchOps !== g) bad.push(`${c.id}: matchOps=${c.matchOps} ≠ charisma골든 ${g}`);
  }
  const checked = coaches.filter((c) => GOLDEN_CHARISMA[c.id] !== undefined).length;
  return { pass: bad.length === 0 && checked === Object.keys(GOLDEN_CHARISMA).length,
    msg: bad.length ? `matchOps≠골든: ${bad.join(' / ')}` : `시드 감독 ${checked}명 matchOps == 구 charisma(전건 일치)` };
}

// (b) 신규 2축 범위 0~100 + id 결정론
function checkB(mutateRange = false): { pass: boolean; msg: string } {
  const bad: string[] = [];
  let detMismatch = 0;
  const ids = [...LEAGUE.teams.map((t) => t.id + 'c'), ...Array.from({ length: 200 }, (_, i) => `sweep_head_${i}`)];
  for (const id of ids) {
    const a1 = deriveHeadAxes(id);
    const a2 = deriveHeadAxes(id);
    let dv = a1.dvPhilosophy, ld = a1.leadership;
    if (mutateRange && id === ids[0]) { dv = 140; } // A/B: 범위 위반 주입
    if (dv < 0 || dv > 100 || ld < 0 || ld > 100) bad.push(`${id}: 범위밖 dv=${dv} ld=${ld}`);
    if (a1.dvPhilosophy !== a2.dvPhilosophy || a1.leadership !== a2.leadership) detMismatch++;
  }
  return { pass: bad.length === 0 && detMismatch === 0,
    msg: bad.length ? `범위 위반: ${bad.slice(0, 3).join(' / ')}` : `${ids.length}개 id 2축 범위 0~100·결정론(재생성 불일치 ${detMismatch})` };
}

// (c) 파생 유형 라벨 분포 — 세 유형 모두 등장
function checkC(force?: HeadType3): { pass: boolean; msg: string } {
  const hist: Record<HeadType3, number> = { competitive: 0, developmental: 0, organizational: 0 };
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const id = `dist_head_${i}`;
    const axes = deriveHeadAxes(id);
    // matchOps는 생성식이 별도 주입 — 대표 분포(45~95 균등)로 대입해 파생 라벨 산출(생성 현실 반영).
    const matchOps = 45 + (i % 51);
    const c = { matchOps, ...axes };
    const t = force ?? headType3(c); // A/B: force=한 유형만 나오게 강제 → 분포 실패
    hist[t]++;
  }
  const present = (Object.keys(hist) as HeadType3[]).filter((k) => hist[k] > 0);
  return { pass: present.length === 3,
    msg: `유형 분포(N=${N}): 승부형 ${hist.competitive} · 육성형 ${hist.developmental} · 조직관리형 ${hist.organizational} → ${present.length}/3종 등장` };
}

// (d) 세이브 마이그레이션 v3→v4 왕복
function checkD(breakIt = false): { pass: boolean; msg: string } {
  // 구세이브(v3) — 감독 객체가 charisma만 가짐(matchOps/신규 2축 없음).
  const v3Coaches = [
    { id: 't0c', name: 'A', age: 50, charisma: 77, style: 'balanced', archetype: 'x', trainingFocus: { primary: [4, 6], secondary: [1, 10, 12] }, salary: 8000, teamId: 't0' },
    { id: 'head_coach_p9', name: 'B', age: 48, charisma: 61, style: 'attack', archetype: '선수 출신', trainingFocus: { primary: [4, 6], secondary: [1, 10, 12] }, salary: 8000, teamId: null },
  ];
  const v3Save: Record<string, unknown> = { selectedTeamId: 't0', season: 3, coachPool: { coaches: v3Coaches, assistants: [] } };
  let migrated: Record<string, unknown>;
  try {
    migrated = migrateSave(v3Save, 3);
  } catch (e) {
    return { pass: false, msg: `마이그레이션 크래시: ${(e as Error).message}` };
  }
  const pool = migrated.coachPool as { coaches: Array<Record<string, unknown>> };
  const bad: string[] = [];
  for (const c of pool.coaches) {
    const src = v3Coaches.find((x) => x.id === c.id)!;
    if (breakIt) (c as { matchOps: number }).matchOps = 999; // A/B: 값 오염 주입
    if (c.matchOps !== src.charisma) bad.push(`${c.id}: matchOps=${c.matchOps} ≠ charisma ${src.charisma}`);
    if ('charisma' in c) bad.push(`${c.id}: 구 charisma 필드 잔존`);
    const dv = c.dvPhilosophy as number, ld = c.leadership as number;
    if (typeof dv !== 'number' || dv < 0 || dv > 100) bad.push(`${c.id}: dvPhilosophy 범위밖 ${dv}`);
    if (typeof ld !== 'number' || ld < 0 || ld > 100) bad.push(`${c.id}: leadership 범위밖 ${ld}`);
    // 신규 2축은 id 시드 파생과 일치해야(마이그레이션=랜덤 없음)
    const expect = deriveHeadAxes(c.id as string);
    if (dv !== expect.dvPhilosophy || ld !== expect.leadership) bad.push(`${c.id}: 2축이 id시드 파생과 불일치`);
  }
  // 멱등 — v4 결과를 다시 migrate해도 동일(matchOps 보존)
  const again = migrateSave(migrated, SAVE_VERSION);
  const p2 = again.coachPool as { coaches: Array<Record<string, unknown>> };
  for (const c of p2.coaches) {
    const src = v3Coaches.find((x) => x.id === c.id)!;
    if (c.matchOps !== src.charisma) bad.push(`${c.id}: 멱등 위반 matchOps=${c.matchOps}`);
  }
  return { pass: bad.length === 0, msg: bad.length ? bad.join(' / ') : `v3→v4 왕복 크래시 0·matchOps 값 보존·2축 id파생 충전·멱등(SAVE_VERSION=${SAVE_VERSION})` };
}

log('=== _dv_coach3axis — 감독 3축 개편(Phase A) 가드 ===');
const checks: Array<[string, { pass: boolean; msg: string }]> = [
  ['(a) matchOps==구charisma', checkA()],
  ['(b) 2축 범위·결정론', checkB()],
  ['(c) 유형 분포 3종', checkC()],
  ['(d) 세이브 v3→v4 왕복', checkD()],
];
let allPass = true;
for (const [name, r] of checks) { if (!r.pass) allPass = false; log(`${r.pass ? 'PASS' : 'FAIL'} ${name} — ${r.msg}`); }

if (AB) {
  log('\n--- A/B 민감도 자가검증(결함 주입 → 반드시 FAIL로 검출) ---');
  const ab: Array<[string, boolean]> = [
    ['(a) matchOps 오염(+1)', checkA(true).pass],
    ['(b) 2축 범위 위반 주입', checkB(true).pass],
    ['(c) 한 유형만 강제', checkC('competitive').pass],
    ['(d) 마이그레이션 값 오염', checkD(true).pass],
  ];
  let sensOk = true;
  for (const [name, passUnderMutation] of ab) {
    const detected = !passUnderMutation; // 결함 주입 시 FAIL(=검출)이어야 함
    if (!detected) sensOk = false;
    log(`${detected ? 'SENS-OK' : 'SENS-FAIL'} ${name} — 주입 후 ${passUnderMutation ? 'PASS(둔감!)' : 'FAIL(검출됨)'}`);
  }
  log(sensOk ? 'A/B 민감도: 4/4 결함 전부 검출(허위 오라클 아님)' : 'A/B 민감도: 일부 결함 미검출 — 가드 무효');
  if (!sensOk) allPass = false;
}

log(allPass ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(allPass ? 0 : 1);
