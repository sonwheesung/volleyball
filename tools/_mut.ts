// 변이 테스트(mutation testing) — TEST_METHODOLOGY §1.G. 소스에 작은 버그(mutant)를 일부러 심고
// `npm test`를 돌려 잡는지(KILLED=실패) 본다. SURVIVED=테스트 공백. 살해율로 스위트 완전성 정량화.
// ⚠️ 안전([[mutation-testing-no-commit]]): 매 변이 try/finally 즉시 원본 복원 + 종료 후 git 클린 검증 전까지 커밋 금지.
//   Usage: npx tsx tools/_mut.ts
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

interface Mutant { file: string; find: string; repl: string; label: string; expect: string }
const MUTANTS: Mutant[] = [
  { file: 'engine/cap.ts', find: 'payroll + salary <= (opts?.cap ?? LEAGUE_CAP)', repl: 'payroll + salary > (opts?.cap ?? LEAGUE_CAP)', label: 'cap.canAfford 비교 반전', expect: 'cap.test' },
  { file: 'engine/aging.ts', find: 'if (age <= 27) return 0;', repl: 'if (age <= 99) return 0;', label: 'aging.decayRate 노쇠 제거', expect: 'aging.test' },
  { file: 'engine/aging.ts', find: 'return { ...p, age: p.age + 1 };', repl: 'return { ...p, age: p.age };', label: 'aging.ageOneSeason 나이고정', expect: 'aging.test' },
  { file: 'engine/rotation.ts', find: 'return (rotation + 1) % 6;', repl: 'return (rotation + 2) % 6;', label: 'rotation.rotate 2칸 회전', expect: '(직접 테스트 없음?)' },
  { file: 'engine/match.ts', find: 'Math.abs(home - away) >= 2;', repl: 'Math.abs(home - away) >= 1;', label: 'match 듀스 2점차→1점차', expect: 'match.test' },
  { file: 'data/standings.ts', find: 'y.points - x.points', repl: 'x.points - y.points', label: 'standings 정렬 역순', expect: 'standings.test' },
  { file: 'engine/salary.ts', find: 'Math.max(0.5, 0.84 - (age - 31) * 0.06)', repl: 'Math.max(0.5, 0.84 + (age - 31) * 0.06)', label: 'salary 노장 곡선 부호반전', expect: 'salary.test' },
  { file: 'engine/production.ts', find: 'if (roll < 0.58)', repl: 'if (roll < 0.30)', label: 'production 킬 비율 급감', expect: 'production.test' },
];

const log = (m: string) => process.stdout.write(m + '\n');
// npm test 통과(=all green)면 true. mutant 적용 후 true면 SURVIVED(나쁨), false면 KILLED(좋음).
const testsPass = (): boolean => {
  try { execSync('npm test', { stdio: 'pipe' }); return true; } catch { return false; }
};

let killed = 0; const survived: string[] = []; const skipped: string[] = [];
log('=== MUTATION TESTING (8 mutants) ===\n');
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8');
  const n = orig.split(m.find).length - 1;
  if (n !== 1) { skipped.push(`${m.label} (substring ${n}회 — 유일하지 않음)`); log(`SKIP    ${m.label}`); continue; }
  try {
    writeFileSync(m.file, orig.replace(m.find, m.repl));
    const passed = testsPass();
    if (passed) { survived.push(`${m.label} [${m.expect}]`); log(`SURVIVED ${m.label}  ← 테스트 공백!`); }
    else { killed++; log(`KILLED   ${m.label}`); }
  } finally {
    writeFileSync(m.file, orig); // ★ 항상 원본 복원
    const restored = readFileSync(m.file, 'utf8') === orig;
    if (!restored) log(`!!! 복원 실패 ${m.file} — git checkout 필요 !!!`);
  }
}

const total = killed + survived.length;
log(`\n=== 결과 ===`);
log(`살해율 ${killed}/${total}${total ? ` (${Math.round((killed / total) * 100)}%)` : ''} · SKIP ${skipped.length}`);
if (survived.length) { log(`\nSURVIVED (테스트 공백 — 케이스 추가로 닫을 것):`); survived.forEach((s) => log('  · ' + s)); }
if (skipped.length) { log(`\nSKIP:`); skipped.forEach((s) => log('  · ' + s)); }
log(`\n⚠️ 변이 종료. 커밋 전 반드시 \`git status\`로 working tree 클린 확인.`);
