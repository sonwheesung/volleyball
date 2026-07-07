// INDEPENDENT GUARD — 스카우팅 안개 누출 (EC-DR-03, 2026-07-07, 사용자 보고 버그).
//   배경: 드래프트 "내 지명 결과 (미리보기)"가 목록의 reveal 분기 없이 추가돼 스카우터 공개도와 무관하게
//   정확 OVR을 노출(안개 우회). 수정: 공용 헬퍼 fogOvr(data/prospectScout.ts)로 추출 — 목록·미리보기·live가
//   같은 분기(reveal≥0.92면 정확, 아니면 범위)를 강제. "공유 헬퍼 미사용 형제"(§4)의 재발이라 형제 grep을 상설화.
//   판정: (a) 기능 — 100+유망주 × reveal 임계 아래/위에서 fogOvr 출력이 (아래=범위 문자열, 정확치와 불일치)
//   (위=정확치, 범위표기 없음). (b) 형제 정적 — 유망주 OVR을 그리는 파일(draft.tsx·draft-live.tsx)이 전부
//   fogOvr(...) 또는 reveal≥0.92 게이트 뒤 OvrBadge를 쓰는지(맨 overallRaw 렌더가 reveal 게이트 없이 없는지) fs로 대조.
//   A/B(허위 오라클 방지): fogOvr가 임계 아래서도 정확치를 반환하는 변종을 만들면 (a)가 FAIL해야(누출 재현).
//   Usage: npx tsx tools/_dv_fogleak.ts   ; echo $?
import { readFileSync } from 'fs';
import { join } from 'path';
import { fogOvr } from '../data/prospectScout';
import { overallRaw, displayOvr } from '../engine/overall';
import { generateDraftClass } from '../data/draftClass';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const root = join(__dirname, '..');

// ~100+ 유망주(여러 시즌 클래스 합성, 결정론)
const prospects: Player[] = [];
for (let s = 1; s <= 10; s++) prospects.push(...generateDraftClass(s, 12));

// reveal 임계(0.92) 아래/위 표본
const BELOW = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 0.91];
const ABOVE = [0.92, 0.95, 1];

// A/B 변종 — 일부러 안개를 벗긴(항상 정확치) 누출 fog. 민감도 증명용(실코드 아님).
const fogOvrLeaky = (p: Player, _reveal: number): string => `${displayOvr(overallRaw(p))}`;

let fail = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { log('  ❌ ' + msg); fail++; } else log('  ✓ ' + msg); };

// ── (a) 기능: 임계 아래 = 범위(정확치 아님) · 위 = 정확치 ──
let belowChecks = 0, belowLeak = 0, belowNotRange = 0;
let aboveChecks = 0, aboveWrong = 0;
let leakyBelowLeak = 0; // A/B: 누출 변종이 아래서 정확치를 내는가
for (const p of prospects) {
  const exact = `${displayOvr(overallRaw(p))}`;
  for (const r of BELOW) {
    belowChecks++;
    const out = fogOvr(p, r);
    if (out === exact) belowLeak++;            // 정확치 노출 = 누출
    if (!out.includes('~')) belowNotRange++;   // 범위 표기여야(안개)
    // A/B 변종
    if (fogOvrLeaky(p, r) === exact) leakyBelowLeak++;
  }
  for (const r of ABOVE) {
    aboveChecks++;
    const out = fogOvr(p, r);
    if (out !== exact || out.includes('~')) aboveWrong++; // 정밀 공개는 정확치·범위표기 없음
  }
}

// ── (b) 형제 정적: 유망주 OVR 렌더 경로가 reveal 게이트/fogOvr를 쓰는지 ──
//   한계(주석): 정규식 휴리스틱 — overallRaw( 렌더 라인 ±3줄에 `reveal >= REVEAL_PRECISE`(또는 옛 리터럴
//   `reveal >= 0.92`, 공백 무시) 게이트나 같은 라인 fogOvr(가 있어야 통과. import 라인·비유망주(외인 트라이아웃 자체 fog)는 제외.
const norm = (s: string) => s.replace(/\s+/g, '');
function siblingViolations(rel: string): string[] {
  const src = readFileSync(join(root, rel), 'utf8').split('\n');
  const v: string[] = [];
  src.forEach((line, i) => {
    if (!line.includes('overallRaw(')) return;
    if (/^\s*import\b/.test(line)) return;                 // import 라인 제외
    if (line.includes('fogOvr(')) return;                 // 같은 라인 안개 헬퍼 → 안전
    const win = norm(src.slice(Math.max(0, i - 3), i + 4).join('\n'));
    const gated = win.includes('reveal>=REVEAL_PRECISE') || win.includes('reveal>=0.92') || win.includes('fogOvr(');
    if (!gated) v.push(`${rel}:${i + 1}  ${line.trim()}`);
  });
  return v;
}
// 유망주 OVR을 그리는 파일(draft 클래스). draft-live는 fogOvr만 쓰고 overallRaw 미사용(검증 대상이나 위반 0 기대).
const PROSPECT_FILES = ['app/draft.tsx', 'app/draft-live.tsx'];
const violations: string[] = [];
for (const f of PROSPECT_FILES) violations.push(...siblingViolations(f));

// 형제 확인(정보): 외인/아시아 트라이아웃은 유망주가 아니라 별개지만 자체 reveal-gated fog를 씀(누출 아님).
const tryoutUsesFog = ['app/tryout.tsx', 'app/asian-tryout.tsx'].every((f) => {
  const s = readFileSync(join(root, f), 'utf8');
  return /const\s+fogOvr\s*=/.test(s) && s.includes('teamScoutReveal');
});

log('═══ 스카우팅 안개 누출 가드 (EC-DR-03, prospectScout.fogOvr) ═══');
log(`유망주 ${prospects.length}명 × (아래 ${BELOW.length} + 위 ${ABOVE.length}) reveal 표본`);
log(`(a) 임계 아래 검사 ${belowChecks} — 정확치 누출 ${belowLeak} · 범위표기 아님 ${belowNotRange}`);
log(`(a) 임계 위 검사 ${aboveChecks} — 정확치 아님/범위표기 ${aboveWrong}`);
log(`(a-A/B) 누출 변종(항상 정확치) 아래서 정확치 노출 ${leakyBelowLeak}/${belowChecks}`);
log(`(b) 형제 정적 — 유망주 파일 ${PROSPECT_FILES.join('·')} 게이트 없는 overallRaw 렌더 ${violations.length}건`);
if (violations.length) violations.forEach((x) => log('     ⚠ ' + x));

check(belowLeak === 0, '(a) 임계(0.92) 아래: fogOvr가 정확 OVR을 노출하지 않음(누출 0)');
check(belowNotRange === 0, '(a) 임계 아래: 출력이 범위 문자열(안개 표기)');
check(aboveWrong === 0, '(a) 임계 이상: 정확치 노출(범위 아님)');
check(leakyBelowLeak > 0, '(a-A/B): 누출 변종은 아래서 정확치 노출 재현(민감도 — 허위 오라클 아님)');
check(violations.length === 0, '(b) 형제: 유망주 OVR 렌더가 reveal 게이트/fogOvr 뒤에만(우회 0)');
check(tryoutUsesFog, '(b·정보): 외인/아시아 트라이아웃도 reveal-gated 자체 fog 사용(별개 표면, 누출 아님)');

log(`\n${fail ? `❌ FOGLEAK_GUARD FAIL (${fail})` : '✅ FOGLEAK_GUARD PASS — 안개 아래 정확치 0 누출·위 정밀·형제 우회 0·A/B 누출 재현'}`);
process.exit(fail ? 1 : 0);
