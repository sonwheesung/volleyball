// 스포트라이트 튜토리얼 커버리지 가드 (ONBOARDING_SYSTEM §3) — 팁 ↔ 코드 앵커/오버레이 정합.
// 왜: 팁 anchor 오타·삭제된 SpotlightTarget·오버레이 누락은 **조용히 하이라이트 실패**(에러 없이 안 뜸).
//     정적 대조로 잡는다. A/B 자가검증(가짜 팁 주입 시 반드시 FAIL)으로 오라클 민감도 증명.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { TIPS } from '../data/tutorialSteps';
import type { Tip } from '../data/tutorialSteps';

// 동적으로 만드는 anchor(정적 id="" 아님) — 여기 명시. select-team i===0 카드.
const DYNAMIC_ANCHORS = new Set<string>(['team-card-0']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const blob = walk('app').map((f) => readFileSync(f, 'utf8')).join('\n');
const codeAnchors = new Set<string>([...blob.matchAll(/SpotlightTarget id="([^"]+)"/g)].map((m) => m[1]));
DYNAMIC_ANCHORS.forEach((a) => codeAnchors.add(a));
const overlayScreens = new Set<string>([...blob.matchAll(/SpotlightOverlay screen="([^"]+)"/g)].map((m) => m[1]));

/** 순수 검사 — 팁 배열 하나에 대해 위반 목록을 낸다(A/B 자가검증 위해 함수화). */
function check(tips: Tip[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const t of tips) {
    if (ids.has(t.id)) errs.push(`중복 팁 id: ${t.id}`);
    ids.add(t.id);
    if (t.anchor && !codeAnchors.has(t.anchor)) errs.push(`앵커 없음(하이라이트 실패): ${t.id} → "${t.anchor}"`);
    if (!overlayScreens.has(t.screen)) errs.push(`오버레이 없는 화면(팁 안 뜸): ${t.id} → screen "${t.screen}"`);
  }
  // 화면별 order 중복
  const byScreen = new Map<string, number[]>();
  for (const t of tips) { const a = byScreen.get(t.screen) ?? []; a.push(t.order); byScreen.set(t.screen, a); }
  for (const [scr, orders] of byScreen) {
    if (new Set(orders).size !== orders.length) errs.push(`order 중복(${scr}): [${orders.join(',')}]`);
  }
  return errs;
}

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log(`── 코드 스캔: 앵커 ${codeAnchors.size}종 · 오버레이 화면 ${overlayScreens.size}종 · 팁 ${TIPS.length}개 ──`);

console.log('── 실측: 모든 팁이 실제 앵커·오버레이에 매칭 ──');
const real = check(TIPS);
real.forEach((e) => console.error('  ✗', e));
ok(real.length === 0, `위반 0 (발견 ${real.length})`);

// 고아 앵커(코드에 있으나 팁 없음) — 낭비/오배치 경고(치명 아님, 정보성)
const tipAnchors = new Set(TIPS.map((t) => t.anchor).filter(Boolean));
const orphans = [...codeAnchors].filter((a) => !tipAnchors.has(a));
ok(orphans.length === 0, `고아 앵커 0 (발견 ${orphans.length}${orphans.length ? ': ' + orphans.join(',') : ''})`);

console.log('── A/B 자가검증(오라클 민감도) ──');
const bogusAnchor = check([...TIPS, { id: '__bogus__', screen: 'tab-office', order: 99, anchor: 'nope-xyz', title: 'x', body: 'y' }]);
ok(bogusAnchor.length > 0, '가짜 anchor 주입 → FAIL 감지(앵커 대조 살아있음)');
const bogusScreen = check([...TIPS, { id: '__bogus2__', screen: 'nonexistent-screen', order: 100, title: 'x', body: 'y' }]);
ok(bogusScreen.length > 0, '오버레이 없는 화면 주입 → FAIL 감지(화면 대조 살아있음)');
const dupId = check([...TIPS, { ...TIPS[0], order: 101 }]);
ok(dupId.length > 0, '중복 id 주입 → FAIL 감지');

console.log(fail === 0 ? '\n✅ 스포트라이트 커버리지 정합 — 전 팁 매칭·고아 0·오라클 민감' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
