// 변이 테스트(mutation testing) — TEST_METHODOLOGY §1.G. 소스에 작은 버그(mutant)를 일부러 심고
// `npm test`를 돌려 잡는지(KILLED=실패) 본다. SURVIVED=테스트 공백. 살해율로 스위트 완전성 정량화.
//   Usage: npx tsx tools/_mut.ts
//
// ⚠️ 안전(변이된 코드가 절대 커밋되면 안 됨 — [[mutation-testing-no-commit]], sadojeon 패턴 채택 2026-06-21):
//   1) 대상 파일이 깨끗(HEAD 동일 + 미스테이지)할 때만 실행 — 복원 기준 보장 + 미커밋 작업 보호.
//   2) 실행 중 `.mutation.lock` 생성 → pre-commit 훅(.git/hooks/pre-commit)이 락 있으면 커밋 차단.
//   3) 변이마다 finally 원본 복원 + 바이트 일치 검증(불일치 시 git checkout).
//   4) SIGINT/SIGTERM/uncaught 에서도 전 대상 복원 + 락 제거.
//   5) 종료 시 git checkout 백스톱.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

interface Mutant { file: string; find: string; repl: string; label: string }
const MUTANTS: Mutant[] = [
  // ── 1차 배치 ──
  { file: 'engine/cap.ts', find: 'payroll + salary <= (opts?.cap ?? LEAGUE_CAP)', repl: 'payroll + salary > (opts?.cap ?? LEAGUE_CAP)', label: 'cap.canAfford 비교 반전' },
  { file: 'engine/aging.ts', find: 'if (age <= 27) return 0;', repl: 'if (age <= 99) return 0;', label: 'aging.decayRate 노쇠 제거' },
  { file: 'engine/aging.ts', find: 'return { ...p, age: p.age + 1 };', repl: 'return { ...p, age: p.age };', label: 'aging.ageOneSeason 나이고정' },
  { file: 'engine/rotation.ts', find: 'return (rotation + 1) % 6;', repl: 'return (rotation + 2) % 6;', label: 'rotation.rotate 2칸' },
  { file: 'engine/match.ts', find: 'Math.abs(home - away) >= 2;', repl: 'Math.abs(home - away) >= 1;', label: 'match 듀스 2→1점차' },
  { file: 'data/standings.ts', find: 'y.points - x.points', repl: 'x.points - y.points', label: 'standings 정렬 역순' },
  { file: 'engine/salary.ts', find: 'Math.max(0.5, 0.84 - (age - 31) * 0.06)', repl: 'Math.max(0.5, 0.84 + (age - 31) * 0.06)', label: 'salary 노장 곡선 부호반전' },
  { file: 'engine/production.ts', find: 'if (roll < 0.58)', repl: 'if (roll < 0.30)', label: 'production 킬 비율 급감' },
  // ── 2차 배치(확장) ──
  { file: 'engine/compensation.ts', find: 'export const PROTECT_COUNT = 6;', repl: 'export const PROTECT_COUNT = 5;', label: 'compensation 보호명단 6→5' },
  { file: 'engine/foreign.ts', find: 'overall(p) >= domesticAvg + 15', repl: 'overall(p) >= domesticAvg + 0', label: 'foreign 재계약 문턱 +15→+0' },
  { file: 'engine/form.ts', find: 'export const FORM_MAX_PENALTY = 0.07;', repl: 'export const FORM_MAX_PENALTY = 0.20;', label: 'form 최대패널티 7%→20%' },
  { file: 'engine/form.ts', find: 'if (windowSize <= 0) return 1;', repl: 'if (windowSize <= 0) return 0.5;', label: 'form 빈 윈도우 1→0.5' },
  { file: 'engine/injury.ts', find: 'export const CONCURRENT_CAP = 3;', repl: 'export const CONCURRENT_CAP = 99;', label: 'injury 동시부상 상한 3→99' },
  // 'injury 확률 상한 0.06→0.99': EQUIVALENT 변이(도달 불가) — 최대 raw ≈ 0.009×2(age)×1.6(stam)×1.7(glass)
  //   ≈ 0.049 < 0.06 이라 클램프가 절대 안 걸린다. 관측 가능한 동작 변화 0 → 변이 대상에서 제외(2026-06-21).
  { file: 'engine/finance.ts', find: 'if (cashBefore < 150000) return 1;', repl: 'if (cashBefore < 0) return 1;', label: 'finance 구제금융 문턱 제거' },
  { file: 'engine/milestones.ts', find: 'before < t && after >= t', repl: 'before < t && after > t', label: 'milestones 임계 경계(>= → >)' },
];

const LOCK = '.mutation.lock';
const log = (m: string) => process.stdout.write(m + '\n');
const touched = new Set<string>();
const gitClean = (f: string): boolean => {
  try { execSync(`git diff --quiet -- ${f}`, { stdio: 'pipe' }); execSync(`git diff --cached --quiet -- ${f}`, { stdio: 'pipe' }); return true; } catch { return false; }
};
const gitRestore = () => { try { if (touched.size) execSync(`git checkout -- ${[...touched].join(' ')}`, { stdio: 'pipe' }); } catch {} };
const cleanup = () => { gitRestore(); try { unlinkSync(LOCK); } catch {} };
// npm test 통과(all green)면 true → SURVIVED(나쁨). 실패면 false → KILLED(좋음).
const testsPass = (): boolean => { try { execSync('npm test', { stdio: 'pipe' }); return true; } catch { return false; } };

// ── 안전 가드(실행 전) ──
try { execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' }); } catch { log('✋ git 저장소 아님 — 중단.'); process.exit(2); }
if (existsSync(LOCK)) { log('✋ .mutation.lock 존재 — 이미 변이 중이거나 비정상 종료. git status 확인 후 락 삭제.'); process.exit(2); }
const FILES = [...new Set(MUTANTS.map((m) => m.file))];
for (const f of FILES) if (!gitClean(f)) { log(`✋ ${f} 에 미커밋 변경 — 변이는 깨끗한 트리에서만. 먼저 커밋/스태시.`); process.exit(2); }

process.on('SIGINT', () => { log('\n⚠️ 중단 — 복원 중'); cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
process.on('uncaughtException', (e: any) => { log('\n⚠️ 예외 — 복원 중 ' + e?.message); cleanup(); process.exit(1); });

writeFileSync(LOCK, `mutation in progress pid ${process.pid}\n`);
log(`=== MUTATION TESTING (${MUTANTS.length} mutants) ===`);
log('🔒 .mutation.lock 생성 — 변이 중 커밋 차단(pre-commit 훅). 종료 시 복원·락 제거.\n');

let killed = 0; const survived: string[] = []; const skipped: string[] = [];
try {
  for (const m of MUTANTS) {
    const orig = readFileSync(m.file, 'utf8');
    const n = orig.split(m.find).length - 1;
    if (n !== 1) { skipped.push(`${m.label} (substring ${n}회)`); log(`SKIP     ${m.label}`); continue; }
    touched.add(m.file);
    try {
      writeFileSync(m.file, orig.replace(m.find, m.repl));
      const passed = testsPass();
      if (passed) { survived.push(m.label); log(`SURVIVED ${m.label}  ← 테스트 공백!`); }
      else { killed++; log(`KILLED   ${m.label}`); }
    } finally {
      writeFileSync(m.file, orig);
      if (readFileSync(m.file, 'utf8') !== orig) { log(`  ✋ 복원 불일치 ${m.file} — git checkout`); gitRestore(); }
    }
  }
} finally { cleanup(); }

const total = killed + survived.length;
log(`\n=== 결과 ===`);
log(`살해율 ${killed}/${total}${total ? ` (${Math.round((killed / total) * 100)}%)` : ''} · SKIP ${skipped.length}`);
if (survived.length) { log(`\nSURVIVED (테스트 공백 — 케이스 추가로 닫을 것):`); survived.forEach((s) => log('  · ' + s)); }
if (skipped.length) { log(`\nSKIP:`); skipped.forEach((s) => log('  · ' + s)); }
log(`\n🔓 복원·락 제거 완료. 커밋 전 \`git status\`로 클린 재확인.`);
process.exit(survived.length ? 1 : 0);
