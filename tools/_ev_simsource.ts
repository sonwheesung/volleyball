// 경기 시뮬 명단 소스 상설 가드 (EC-UI-01 재발 방지, TEST_METHODOLOGY §1.F 복수경로 재계산).
// 불변식: app/·data/ 에서 simulateMatch 를 호출하는 모든 곳은 정사 명단 소스 `availableTeamPlayers`
//   (부상·정지·벤치 반영)를 써야 한다 — 원본 `getEvolvedTeamPlayers`를 명단으로 넘기면 관전·기록과 어긋난다.
//   (production/standings의 `ReturnType<typeof getEvolvedTeamPlayers>`는 *타입 주석*이라 호출 `(`이 아님 → 무관.)
//   Usage: npx tsx tools/_ev_simsource.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const log = (m: string) => process.stdout.write(m + '\n');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || e.startsWith('.')) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 한 파일이 불변식을 어기는가 — simulateMatch 호출부면 availableTeamPlayers( 필수 + getEvolvedTeamPlayers( 금지 */
function violationsFor(path: string, src: string): string[] {
  const v: string[] = [];
  if (!src.includes('simulateMatch(')) return v;            // 시뮬 호출부만 검사
  if (src.includes('function simulateMatch')) return v;     // 엔진 정의부 제외
  if (!src.includes('availableTeamPlayers(')) v.push(`${path}: simulateMatch 호출부인데 availableTeamPlayers() 미사용(정사 명단 아님)`);
  if (src.includes('getEvolvedTeamPlayers(')) v.push(`${path}: simulateMatch 호출부에서 getEvolvedTeamPlayers() 호출 — 원본 명단(부상 미반영) 위험`);
  return v;
}

const files = [...walk('app'), ...walk('data')];
const simFiles = files.filter((f) => readFileSync(f, 'utf8').includes('simulateMatch('));
const violations: string[] = [];
for (const f of simFiles) violations.push(...violationsFor(f, readFileSync(f, 'utf8')));

// A/B 자가검증 — 깨진 합성 소스는 잡고, 깨끗한 합성 소스는 통과해야 신뢰
const abBad = violationsFor('synthetic', 'const sim = simulateMatch(s, getEvolvedTeamPlayers(t, d), a, {});').length > 0;
const abGood = violationsFor('synthetic', 'const r = availableTeamPlayers(t, d); const sim = simulateMatch(s, r, a, {});').length === 0;

log('=== 경기 시뮬 명단 소스 가드 (EC-UI-01) ===');
log(`simulateMatch 호출 파일 ${simFiles.length}개: ${simFiles.map((f) => f.replace(/\\/g, '/')).join(', ')}`);
log(`불변식 위반 ${violations.length}건`);
violations.forEach((x) => log('  ❌ ' + x.replace(/\\/g, '/')));
log(`[A/B] 위반 합성 검출=${abBad} · 정상 합성 통과=${abGood} (둘 다 true여야 신뢰)`);

const ok = violations.length === 0 && abBad && abGood;
log(`\nSIMSOURCE OK = ${ok}`);
process.exit(ok ? 0 : 2);
