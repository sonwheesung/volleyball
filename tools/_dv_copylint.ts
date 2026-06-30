// COPY LINT — 유저 노출 문구 정합 가드(2026-06-30, 에뮬 발견 회귀 분석 산물).
//   배경: 에뮬 테스트에서 여자부에 남성형 표현("결승의 사나이"·"그의")·배구 오용어("라켓")가 나왔는데
//   자동 테스트엔 **문구(copy) 정합을 검사하는 렌즈가 없었다**(TEST_METHODOLOGY §4 copy 사각). 이 가드가 그 갭을 닫는다.
//   판정: data/engine/app/components 소스에서 금지어 0건이어야 PASS.
//   - 명사형(사나이·라켓 등)은 부분문자열(오탐 없음 — 정상어의 일부가 아님).
//   - 대명사(그의·그가)는 **경계 인식**(앞이 공백/따옴표/시작) — 안 그러면 "리그의"·"리그가"가 오탐(한글 부분문자열 함정).
//   A/B(허위 오라클 방지): 합성 더러운 문장은 잡고, 합성 깨끗한 문장(리그가·그 선수의)은 안 잡아야 = 매처가 진짜 동작.
//   Usage: npx tsx tools/_dv_copylint.ts
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const log = (m: string) => process.stdout.write(m + '\n');

// 명사형 금지어(부분문자열 안전 — 정상 단어의 조각이 아님)
const NOUN_DENY: { term: string; why: string }[] = [
  { term: '사나이', why: '남성형(여자부)' },
  { term: '사내대장부', why: '남성형' },
  { term: '라켓', why: '배구에 없는 도구(타 종목)' },
  { term: '홈런', why: '야구 용어' },
  { term: '골키퍼', why: '축구 용어' },
];
// 남성 3인칭 대명사 — 경계(줄시작/공백/따옴표/괄호) 뒤일 때만(리그의·리그가 오탐 회피). 여자부=그녀 또는 무대명사.
const PRONOUN_RE = /(?:^|[\s"'(《「【>·\-—])(그가|그의)(?=[\s.,!?)"'」】》:]|$)/;

const ROOTS = ['data', 'engine', 'app', 'components'];
const SKIP_FILE = (f: string) => f.endsWith('.test.ts') || f.endsWith('.test.tsx');

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !SKIP_FILE(p)) out.push(p);
  }
}

function scanLine(line: string): string[] {
  const hits: string[] = [];
  for (const d of NOUN_DENY) if (line.includes(d.term)) hits.push(`${d.term}(${d.why})`);
  const m = PRONOUN_RE.exec(line);
  if (m) hits.push(`${m[1]}(남성 대명사)`);
  return hits;
}

// ── 실제 소스 스캔 ──
const files: string[] = [];
for (const r of ROOTS) { try { walk(r, files); } catch { /* 루트 없으면 패스 */ } }
const findings: string[] = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    for (const h of scanLine(ln)) findings.push(`  ${f}:${i + 1}  [${h}]  ${ln.trim().slice(0, 80)}`);
  });
}

// ── A/B 자가검증(매처 민감도) ──
const dirty = '결승의 사나이가 라켓을 들고, 그가 외쳤다';
const clean = '리그가 주목한 그 선수의 활약 — 리그의 역사가 된다';
const dirtyHits = scanLine(dirty);           // ≥3(사나이·라켓·그가) 잡혀야
const cleanHits = scanLine(clean);           // 0(리그가·리그의·그 선수의 오탐 없어야)

log(`[_dv_copylint] 스캔 파일 ${files.length}개`);
if (findings.length) { log('실제 금지어 발견:'); findings.forEach((x) => log(x)); }
else log('  실제 소스 금지어 = 0건');
log(`  A/B 더러운 문장 적발 = ${dirtyHits.length}건 ${JSON.stringify(dirtyHits)} (기대 ≥3)`);
log(`  A/B 깨끗한 문장 오탐 = ${cleanHits.length}건 ${JSON.stringify(cleanHits)} (기대 0)`);

const pass = findings.length === 0 && dirtyHits.length >= 3 && cleanHits.length === 0;
log(pass ? 'COPYLINT_GUARD PASS' : 'COPYLINT_GUARD FAIL');
process.exit(pass ? 0 : 2);
