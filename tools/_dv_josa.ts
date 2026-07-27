// 가드 — 동적 값 뒤 하드코딩 조사 파손 방지(josa 헬퍼 적용 6+2 사이트).
//   npx tsx tools/_dv_josa.ts
// (A) hasBatchim 경계((글자-0xAC00)%28) 독립 오라클 대조.
// (B) 각 수정 사이트의 조사 종류를 받침/무받침 양쪽 입력에서 문법 검증 + 옛 하드코딩 A/B(FAIL 재현).
// (C) 소스 스캔 회귀 트립와이어: 고친 파일이 헬퍼 호출을 유지하고 옛 하드코딩 리터럴이 없는지.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasBatchim, iGa, eunNeun, eulReul, waGwa, josa } from '../lib/josa';

const ROOT = join(__dirname, '..');
const fails: string[] = [];
const fail = (m: string) => fails.push(m);

// ── 독립 오라클: 손검증 받침 진리표(engine 무관, lib/josa 로직 미참조) ──
//   받침 유무는 사람이 눈으로 확정한 값. 헬퍼가 이 표와 어긋나면 헬퍼 결함.
const GT: [string, boolean][] = [
  ['코메츠', false], ['타이드', false], ['블레이즈', false], ['페퍼스', false],
  ['윙스', false], ['스파이커스', false], ['페어리스', false],           // 7개 팀명 전부 무받침
  ['에이스', false], ['디그', false], ['어시스트', false],                // 무받침 지표
  ['득점', true], ['블로킹', true], ['성공률', true], ['리시브 효율', true], // 받침 지표
  ['한채원', true], ['우리 팀', true], ['챔피언결정전', true],             // 받침 이름/라운드
  ['사자', false], ['철수', false], ['영희', false],
  ['10억', true], ['3500만', true],                                       // formatMoney 출력(억ㄱ/만ㄴ = 받침)
];
const gtBatchim = (w: string): boolean => {
  const e = GT.find((x) => x[0] === w);
  if (!e) throw new Error(`GT 누락: ${w}`);
  return e[1];
};

// (A) 경계 케이스 — 종성 index 0(무받침)·8(ㄹ)·기타 받침·숫자·영문
const boundary: [string, boolean | null][] = [
  ['가', false], ['각', true], ['갈', true], ['강', true], ['츠', false], ['스', false],
  ['0', true], ['1', true], ['2', false], ['3', true], ['5', false], ['6', true],
  ['a', false], ['b', true], ['e', false], ['t', true], ['', null], ['%', null],
];
for (const [w, want] of boundary) {
  const got = hasBatchim(w);
  if (got !== want) fail(`(A)hasBatchim("${w}")=${got} 기대 ${want}`);
}
// 진리표 대조
for (const [w, b] of GT) if (hasBatchim(w) !== b) fail(`(A)hasBatchim("${w}")=${hasBatchim(w)} GT ${b}`);

// ── (B) 사이트별 조사 종류 — 받침/무받침 양쪽에서 문법 정답 + 옛 하드코딩 A/B ──
// 오라클: 정답 조사 = 진리표 배치 기반(헬퍼 미참조)
const wantJosa = (w: string, wB: string, wo: string, euro = false) => {
  const b = gtBatchim(w);
  if (euro && b) { /* ㄹ받침 '로' 예외는 팀명에 없음 */ }
  return b ? wB : wo;
};
type Site = { name: string; kind: (w: string) => string; wB: string; wo: string; oldLiteral: string; samples: string[] };
const sites: Site[] = [
  { name: 'contracts 위약금 iGa', kind: iGa, wB: '이', wo: '가', oldLiteral: '가', samples: ['10억', '3500만'] },
  { name: 'fa winnerName iGa', kind: iGa, wB: '이', wo: '가', oldLiteral: '가', samples: ['우리 팀', '코메츠'] },
  { name: 'draft-live name iGa', kind: iGa, wB: '이', wo: '가', oldLiteral: '가', samples: ['한채원', '사자'] },
  { name: 'draftPreview name eunNeun', kind: eunNeun, wB: '은', wo: '는', oldLiteral: '는', samples: ['한채원', '철수'] },
  { name: 'news roundKo eunNeun', kind: eunNeun, wB: '은', wo: '는', oldLiteral: '는', samples: ['챔피언결정전', '영희'] },
  { name: 'prospectReport label eunNeun', kind: eunNeun, wB: '은', wo: '는', oldLiteral: '은', samples: ['득점', '에이스'] },
  { name: 'fa nm waGwa', kind: waGwa, wB: '과', wo: '와', oldLiteral: '과', samples: ['한채원', '코메츠'] },
];
for (const s of sites) {
  let opposite = false;
  for (const w of s.samples) {
    const want = wantJosa(w, s.wB, s.wo);
    const got = s.kind(w);            // 헬퍼는 `단어+조사` 전체를 반환
    if (got !== w + want) fail(`(B)${s.name}: "${got}"≠"${w + want}"`);
    // A/B: 옛 하드코딩 리터럴이 이 입력에서 비문이면 검출
    if (s.oldLiteral !== want) opposite = true;
  }
  if (!opposite) fail(`(B)${s.name}: A/B 민감도 없음(옛 리터럴 "${s.oldLiteral}"이 두 표본 모두에서 우연히 정답 — 표본이 한쪽 받침만)`);
}

// 으로서는 사이트(josa 접미형) — 팀명 무받침 → '로서는', 가상의 받침 → '으로서는'
{
  const got무 = josa('코메츠', '으로서는', '로서는');
  const got유 = josa('한채원', '으로서는', '로서는');
  if (got무 !== '코메츠로서는') fail(`(B)news 으로서는 무받침: "${got무}"≠"코메츠로서는"`);
  if (got유 !== '한채원으로서는') fail(`(B)news 으로서는 받침: "${got유}"≠"한채원으로서는"`);
  // A/B: 옛 하드코딩 '으로서는'은 무받침 팀명에서 비문
  if ('코메츠으로서는' === got무) fail('(B)news 으로서는 A/B 실패');
}

// ── (C) 소스 회귀 트립와이어 ──
const scan: [string, RegExp[], RegExp[]][] = [
  // [파일, 반드시_존재(헬퍼), 존재하면_FAIL(옛 하드코딩)]
  ['app/contracts.tsx', [/iGa\(formatMoney\(fee\)\)/], [/\$\{formatMoney\(fee\)\}가 듭니다/]],
  ['app/fa.tsx', [/iGa\(winnerName\)/, /waGwa\(nm\)/], [/\{winnerName\}가 우세한/, /\$\{nm\}과의 계약/]],
  ['app/draft-live.tsx', [/iGa\(p\.player\.name\)/], [/\{p\.player\.name\}가 \{shortTeamName/]],
  ['data/draftPreview.ts', [/eunNeun\(split\.p\.name\)/], [/\$\{split\.p\.name\}는 성적/]],
  ['data/news.ts', [/eunNeun\(roundKo\)/, /josa\(teamName\(myTeamId\), '으로서는', '로서는'\)/], [/\$\{roundKo\}는 \$\{w\}의 것/, /\$\{teamName\(myTeamId\)\}으로서는/]],
  ['data/prospectReport.ts', [/eunNeun\(worst\.label\.replace/], [/\}은 아직 다듬을/]],
];
for (const [f, must, forbid] of scan) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const re of must) if (!re.test(src)) fail(`(C)${f}: 헬퍼 호출 누락 ${re}`);
  for (const re of forbid) if (re.test(src)) fail(`(C)${f}: 옛 하드코딩 잔존 ${re}`);
}

console.log('=== _dv_josa: 동적값 뒤 조사 파손 방지 ===');
console.log(`  (A)경계+진리표 · (B)사이트 8종 받침/무받침 A/B · (C)소스 트립와이어`);
const abProof = iGa('코메츠') === '코메츠가' && iGa('한채원') === '한채원이'
  && eunNeun('디그') === '디그는' && waGwa('타이드') === '타이드와' && waGwa('한채원') === '한채원과';
console.log(`  A/B 민감도 증명(헬퍼가 받침별 상이 출력): iGa 코메츠→가 · 한채원→이 · waGwa 타이드→와 · 한채원→과 = ${abProof}`);
const pass = fails.length === 0 && abProof;
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? '\n  - ' + fails.join('\n  - ') : ''}`);
if (!pass) process.exit(1);
