// STANDING GUARD — 아키텍처 계층 경계(레이어 의존 방향) 상설 감시 (2026-07-07).
//   CLAUDE.md §8: UI(app) → 셀렉터(data) → 엔진(engine). 역방향 금지. 엔진은 React/Expo/zustand 무의존(순수 TS·시드).
//   이 가드는 app/ components/ data/ engine/ store/ lib/ types/ audio/ 의 모든 .ts/.tsx(테스트·d.ts·tools 제외)를
//   파싱해 아래 금지 간선이 0인지 정적 단언한다:
//     · engine → {data,store,app,components,lib,audio,db}   (엔진은 하위 계층만·아래로 안 봄)
//     · data   → {app,components,store}                     (셀렉터는 UI·스토어 모름)
//     · lib    → {app,components}
//     · store  → {app,components}
//     · types  → 런타임 계층 값 import(타입 전용은 허용 — 타입은 런타임 무의존)
//   추가 규칙:
//     · engine bare import 금지 — 상대(./·../types)만. react|expo|zustand|react-native 등 = FAIL(node: 빌트인만 예외).
//     · Math.random 금지(결정론 계층 app/data/engine/lib) — ALLOWLIST(lib/iap·lib/walletKeys·store/useAuthStore)만 예외.
//     · leagueDisplayDay 는 app/contracts.tsx 만 import 허용(다른 app 파일이 쓰면 FAIL).
//         ※ 다른 에이전트가 contracts.tsx 를 leagueDisplayDay 에서 떼는 중 — 마이그레이션 끝나면 이 예외 삭제 가능.
//     · png/이미지 require 는 자산(레이어 간선 아님) — data/faceSheets.ts 포함 무시.
//   A/B(허위 오라클 방지): --selftest 는 가짜 파일 트리(디스크 미변경)에 의도적 위반을 심어 탐지되는지, 정상 파일이
//     오탐 안 나는지 검증한다. 실디스크에 프로브 파일을 쓰지 않는다(엔진 오염 방지).
//   Usage: npx tsx tools/_dv_arch.ts            ; echo $?
//          npx tsx tools/_dv_arch.ts --selftest ; echo $?
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = join(__dirname, '..');
const LAYERS = ['app', 'components', 'data', 'engine', 'store', 'lib', 'types', 'audio', 'db'] as const;
type Layer = (typeof LAYERS)[number];
const isLayer = (s: string): s is Layer => (LAYERS as readonly string[]).includes(s);
const SCAN_DIRS: Layer[] = ['app', 'components', 'data', 'engine', 'store', 'lib', 'types', 'audio'];
const RUNTIME_LAYERS: Layer[] = ['app', 'components', 'data', 'engine', 'store', 'lib', 'audio', 'db'];

// 금지 간선: source layer → [forbidden target layers]
const FORBIDDEN: Partial<Record<Layer, Layer[]>> = {
  engine: ['data', 'store', 'app', 'components', 'lib', 'audio', 'db'],
  data: ['app', 'components', 'store'],
  lib: ['app', 'components'],
  store: ['app', 'components'],
};

const BAN_RANDOM: Layer[] = ['app', 'data', 'engine', 'lib']; // 결정론 계층
const RANDOM_ALLOW = new Set(['store/useAuthStore.ts', 'lib/iap.ts', 'lib/walletKeys.ts']);
const ASSET_RE = /\.(png|jpe?g|webp|gif|svg)$/i;

interface Src { rel: string; text: string }
interface Imp { spec: string; typeOnly: boolean }

const firstSeg = (rel: string): string => rel.split('/')[0];

/** 상대 specifier 를 소스 rel 기준으로 posix 정규화(디스크 무관·순수 문자열). */
function resolveRel(fromRel: string, spec: string): string {
  const stack = fromRel.split('/').slice(0, -1); // 파일이 든 디렉터리
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

function stripComments(s: string): string {
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');        // 블록 주석
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');     // 라인 주석(:// URL 보호)
  return s;
}

/** import/export-from/require/dynamic-import specifier 추출(타입 전용 여부 포함). */
function extractImports(text: string): Imp[] {
  const out: Imp[] = [];
  let m: RegExpExecArray | null;
  const fromRe = /\b(import|export)\s+(type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  while ((m = fromRe.exec(text))) out.push({ spec: m[3], typeOnly: !!m[2] });
  const sideRe = /\bimport\s+['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(text))) out.push({ spec: m[1], typeOnly: false });
  const reqRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reqRe.exec(text))) out.push({ spec: m[1], typeOnly: false });
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(text))) out.push({ spec: m[1], typeOnly: false });
  return out;
}

/** 핵심 분석기(순수) — 파일 목록 → 위반 문자열 목록. selftest 가 그대로 재사용. */
function analyze(files: Src[]): string[] {
  const violations: string[] = [];
  for (const f of files) {
    const layer = firstSeg(f.rel);
    if (!isLayer(layer)) continue;
    const text = stripComments(f.text);
    const imps = extractImports(text);

    for (const imp of imps) {
      const { spec, typeOnly } = imp;
      const asset = ASSET_RE.test(spec);
      const relative = spec.startsWith('.');
      const alias = spec.startsWith('@/');
      const bare = !relative && !alias;

      // 엔진 순수성: 상대(./·../types)만. bare(외부 패키지) = FAIL(node: 예외).
      if (layer === 'engine' && bare && !asset && !spec.startsWith('node:')) {
        violations.push(`[engine-bare] ${f.rel} → '${spec}' (엔진은 React/Expo/외부패키지 무의존 — 상대 import만)`);
      }

      if (asset) continue; // 자산 require/import 는 레이어 간선 아님

      let target: string | null = null;
      if (relative) target = firstSeg(resolveRel(f.rel, spec));
      else if (alias) target = firstSeg(spec.slice(2));
      if (!target || !isLayer(target)) continue; // 외부/자산/미해결 → 간선 아님

      if (layer === 'types') {
        // types → anything-runtime: 타입 전용이면 OK(런타임 무의존), 값 import 는 FAIL.
        if (!typeOnly && RUNTIME_LAYERS.includes(target)) {
          violations.push(`[types-runtime] ${f.rel} → ${target} '${spec}' (types 는 런타임 값 import 금지 — import type 만)`);
        }
        continue;
      }
      const forb = FORBIDDEN[layer];
      if (forb && forb.includes(target)) {
        violations.push(`[layer] ${f.rel} → ${target} '${spec}' (${layer}→${target} 금지 간선)`);
      }
    }

    // Math.random 금지(결정론 계층)
    if (BAN_RANDOM.includes(layer) && !RANDOM_ALLOW.has(f.rel) && /Math\.random\s*\(/.test(text)) {
      violations.push(`[random] ${f.rel} (결정론 계층 ${layer} 에서 Math.random 사용 — 시드 RNG 사용)`);
    }

    // leagueDisplayDay 는 app/contracts.tsx 만
    if (layer === 'app' && f.rel !== 'app/contracts.tsx'
      && /\bimport\b[\s\S]*?\bleagueDisplayDay\b[\s\S]*?\bfrom\b/.test(text)) {
      violations.push(`[leagueDisplayDay] ${f.rel} (app 에서 leagueDisplayDay import 는 contracts.tsx 만 허용)`);
    }
  }
  return violations;
}

// ── 실디스크 파일 수집 ──
function walk(dir: string, acc: string[]): void {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, acc); continue; }
    if (!/\.(ts|tsx)$/.test(e)) continue;
    if (/\.test\.ts$/.test(e) || /\.d\.ts$/.test(e)) continue;
    acc.push(p);
  }
}

function collectReal(): Src[] {
  const paths: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), paths);
  return paths.map((p) => ({ rel: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
}

// ── A/B 자가검증(가짜 트리) ──
function selftest(): number {
  const CONTROL: Src[] = [
    { rel: 'engine/_ctrl.ts', text: `import type { Player } from '../types';\nimport { createRng } from './rng';\nexport const x = 1;` },
    { rel: 'data/_ctrl.ts', text: `import { simulateMatch } from '../engine/match';\nexport const y = 2;` },
    { rel: 'types/_ctrl.ts', text: `import type { Side } from './index';\nexport type Z = Side;` },
    { rel: 'app/_ctrl.tsx', text: `import { LEAGUE } from '../data/league';\nimport bg from '../assets/x.png';` },
  ];
  const MUTANTS: { file: Src; tag: string }[] = [
    { file: { rel: 'engine/_probe.ts', text: `import { LEAGUE } from '../data/league';` }, tag: '[layer] engine/_probe.ts → data' },
    { file: { rel: 'engine/_probe2.ts', text: `import React from 'react';` }, tag: '[engine-bare] engine/_probe2.ts' },
    { file: { rel: 'data/_probe.ts', text: `export const r = () => Math.random();` }, tag: '[random] data/_probe.ts' },
    { file: { rel: 'types/_probe.ts', text: `import { overall } from '../engine/overall';` }, tag: '[types-runtime] types/_probe.ts' },
    { file: { rel: 'app/_probe.tsx', text: `import { leagueDisplayDay } from '../data/league';` }, tag: '[leagueDisplayDay] app/_probe.tsx' },
    { file: { rel: 'store/_probe.ts', text: `import Screen from '../components/Screen';` }, tag: '[layer] store/_probe.ts → components' },
  ];
  const log = (m: string) => process.stdout.write(m + '\n');
  log('═══ _dv_arch --selftest (A/B 탐지 민감도) ═══');

  // (A) 정상 트리 → 위반 0 이어야(오탐 없음)
  const ctrlV = analyze(CONTROL);
  let fail = 0;
  if (ctrlV.length !== 0) { log(`  ❌ 정상 대조군에서 오탐 ${ctrlV.length}건:`); ctrlV.forEach((v) => log('     ' + v)); fail++; }
  else log('  ✓ 정상 대조군(허용 간선·타입 import·자산 require) 위반 0 — 오탐 없음');

  // (B) 각 뮤턴트 단독 → 해당 위반이 탐지되어야(민감도)
  for (const { file, tag } of MUTANTS) {
    const v = analyze([...CONTROL, file]);
    const caught = v.some((s) => s.startsWith(tag.split(' ')[0]) && s.includes(file.rel));
    if (caught) log(`  ✓ 뮤턴트 탐지: ${tag}`);
    else { log(`  ❌ 뮤턴트 미탐지: ${tag} — 결과: ${JSON.stringify(v.filter((s) => s.includes(file.rel)))}`); fail++; }
  }
  log(`\n${fail ? `❌ ARCH_SELFTEST FAIL (${fail})` : '✅ ARCH_SELFTEST PASS — 정상 오탐0 · 뮤턴트 6종 전부 탐지(A/B 민감도 증명)'}`);
  return fail ? 1 : 0;
}

// ── main ──
function main(): number {
  if (process.argv.includes('--selftest')) return selftest();
  const files = collectReal();
  const violations = analyze(files);
  const log = (m: string) => process.stdout.write(m + '\n');
  log('═══ 아키텍처 계층 경계 가드 (_dv_arch) ═══');
  log(`스캔 ${files.length} 파일 (${SCAN_DIRS.join('·')}, 테스트·d.ts·tools 제외)`);
  log(`금지 간선: engine→{data,store,app,components,lib,audio,db} · data→{app,components,store} · lib/store→{app,components} · types→런타임값`);
  log(`추가: engine bare import 금지 · Math.random 금지(${BAN_RANDOM.join('/')}, allowlist ${[...RANDOM_ALLOW].join('·')}) · leagueDisplayDay=contracts.tsx만`);
  if (violations.length) { log(`\n위반 ${violations.length}건:`); violations.forEach((v) => log('  ❌ ' + v)); }
  log(`\n${violations.length ? `❌ ARCH_GUARD FAIL (${violations.length})` : `✅ ARCH_GUARD PASS — 금지 간선 0 · 엔진 순수 · 결정론 계층 Math.random 0 · 경계 위반 없음`}`);
  return violations.length ? 1 : 0;
}

process.exit(main());
