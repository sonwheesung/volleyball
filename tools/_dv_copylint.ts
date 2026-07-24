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

// 명사형 금지어. 기본은 부분문자열(정상 단어의 조각이 아닌 것). `re` 있으면 경계 인식(정상어 오탐 회피).
//   '라켓'은 '브라켓(bracket)'의 조각이라 부분문자열이면 오탐 → 앞이 '브'가 아닐 때만(negative lookbehind).
const NOUN_DENY: { term: string; why: string; re?: RegExp }[] = [
  { term: '사나이', why: '남성형(여자부)' },
  { term: '사내대장부', why: '남성형' },
  { term: '라켓', why: '배구에 없는 도구(타 종목)', re: /(?<!브)라켓/ },
  { term: '홈런', why: '야구 용어' },
  { term: '골키퍼', why: '축구 용어' },
  { term: '준플레이오프', why: '포스트시즌 명칭 통일(SEASON §5.1.1 — 오기, 2위vs3위 시리즈명은 "플레이오프")' },
];
// 남성 3인칭 대명사 — 경계(줄시작/공백/따옴표/괄호) 뒤일 때만(리그의·리그가 오탐 회피). 여자부=그녀 또는 무대명사.
const PRONOUN_RE = /(?:^|[\s"'(《「【>·\-—])(그가|그의)(?=[\s.,!?)"'」】》:]|$)/;

// ── 내부 용어 금지어(2026-07-24, BUG-05) — **문자열 리터럴 안에서만** 금지. 엔진 식별자·주석·설계 문서 용어는 유지가 정본
//   (CLAUDE §6 라벨 정정: 체젠→"체력재생", 노쇠→"하락세/기량 하락"). 주석에 그대로 쓰는 건 정상이라 리터럴만 본다.
//   재발 사례: engine/staff.ts SPECIALTY_DESC/TYPE_KO/TYPE_DESC가 '노쇠억제형'·'노쇠 지연'을 그대로 화면에 렌더(스태프 화면).
const LITERAL_DENY: { term: string; why: string }[] = [
  { term: '노쇠', why: '사용자 노출 라벨 정정 — "하락세/기량 하락"(CLAUDE §6)' },
  { term: '체젠', why: '사용자 노출 라벨 정정 — "체력재생"(CLAUDE §6)' },
];
/** 줄에서 주석을 걷어내고 남은 **문자열 리터럴**들만 추출 — 주석 속 설계 용어를 오탐하지 않기 위해. */
function literalsOf(line: string): string[] {
  let s = line;
  const lineComment = s.indexOf('//');
  const blockStart = s.indexOf('/*');
  const cut = [lineComment, blockStart].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (cut !== undefined) s = s.slice(0, cut);
  if (/^\s*\*/.test(line)) return [];      // JSDoc 본문 줄
  return [...s.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

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
  for (const d of NOUN_DENY) if (d.re ? d.re.test(line) : line.includes(d.term)) hits.push(`${d.term}(${d.why})`);
  const m = PRONOUN_RE.exec(line);
  if (m) hits.push(`${m[1]}(남성 대명사)`);
  for (const lit of literalsOf(line)) {
    for (const d of LITERAL_DENY) if (lit.includes(d.term)) hits.push(`${d.term}(${d.why})`);
  }
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
const clean = '리그가 주목한 그 선수의 활약 — 리그의 역사가 된다. 포스트시즌 브라켓 대진 확정';
const dirtyHits = scanLine(dirty);           // ≥3(사나이·라켓·그가) 잡혀야
const cleanHits = scanLine(clean);           // 0(리그가·리그의·그 선수의 오탐 없어야)
// 내부 용어 A/B — 리터럴이면 잡고(구 staff.ts 문구 재현), 주석/JSDoc이면 안 잡아야(설계 용어는 유지가 정본)
const dirtyLit = scanLine(`  antiaging: '노쇠 크게 지연(전성기 연장)', stamina: '체젠 회복↑',`);
const cleanLit = scanLine('// 하락은 신체 스탯에만 — 점프·민첩·체력·체젠(노쇠 곡선)');
const cleanLit2 = scanLine(' * 나이 들며 하락하는 신체 스탯 — 노쇠 XP 적립(체젠 포함)');

log(`[_dv_copylint] 스캔 파일 ${files.length}개`);
if (findings.length) { log('실제 금지어 발견:'); findings.forEach((x) => log(x)); }
else log('  실제 소스 금지어 = 0건');
log(`  A/B 더러운 문장 적발 = ${dirtyHits.length}건 ${JSON.stringify(dirtyHits)} (기대 ≥3)`);
log(`  A/B 깨끗한 문장 오탐 = ${cleanHits.length}건 ${JSON.stringify(cleanHits)} (기대 0)`);
log(`  A/B 내부용어 리터럴 적발 = ${dirtyLit.length}건 ${JSON.stringify(dirtyLit)} (기대 ≥2 — 노쇠·체젠)`);
log(`  A/B 내부용어 주석 오탐 = ${cleanLit.length + cleanLit2.length}건 (기대 0 — 주석·JSDoc의 설계 용어는 유지)`);

const pass = findings.length === 0 && dirtyHits.length >= 3 && cleanHits.length === 0
  && dirtyLit.length >= 2 && cleanLit.length === 0 && cleanLit2.length === 0;
log(pass ? 'COPYLINT_GUARD PASS' : 'COPYLINT_GUARD FAIL');
process.exit(pass ? 0 : 2);
