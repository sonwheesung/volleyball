// STANDING GUARD — 정적 앱/디바이스 설정 드리프트 감시 (2026-07-16, 보안·디바이스 감사 후속).
//   OWASP MAS/RN 표준 대비 확정된 4종 수정이 시간이 지나며 되돌려지거나(prebuild 재생성·머지 등) 조용히
//   깨지지 않도록 정적으로 단언한다. 검사 대상:
//     ⓐ app.json  expo.android.allowBackup === false            (구글 자동백업 차단 — 평문 세션/세이브 유출·부활 방지)
//     ⓑ AndroidManifest.xml 에 android:allowBackup="false"      (prebuild 네이티브도 동기화, "true" 잔존 금지)
//     ⓒ app.json  permissions·blockedPermissions 중복 0         + RECORD_AUDIO 가 blockedPermissions 에 존재
//        (마이크 권한 노출 금지 — 게임 심사·신뢰. 중복은 prebuild 머지 사고 흔적)
//     ⓓ babel.config.js 에 transform-remove-console(production) (릴리즈 콘솔 로그 정보노출 제거, error·warn 유지)
//     ⓔ app/_layout.tsx 에 maxFontSizeMultiplier 설정 존재      (시스템 폰트 확대 전역 상한 — 레이아웃 보전, 문자열 검사 수준)
//   A/B(허위 오라클 방지): --selftest 는 메모리상 변조 입력(allowBackup true 버전·중복 권한·플러그인 제거 등)을
//     심어 각 검사가 그 결함을 검출하는지 + 정상 입력이 오탐 안 나는지 증명한다. 실디스크는 건드리지 않는다.
//   Usage: npx tsx tools/_dv_appconfig.ts            ; echo $?
//          npx tsx tools/_dv_appconfig.ts --selftest ; echo $?
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';

interface Inputs {
  appJson: string;   // app.json 원문
  manifest: string;  // AndroidManifest.xml 원문
  babel: string;     // babel.config.js 원문
  layout: string;    // app/_layout.tsx 원문
}

/** 핵심 분석기(순수) — 4개 파일 내용 → 위반 문자열 목록. selftest 가 그대로 재사용. */
function analyze(inp: Inputs): string[] {
  const v: string[] = [];

  // ── app.json 파싱 ──
  let android: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(inp.appJson) as { expo?: { android?: Record<string, unknown> } };
    android = parsed.expo?.android ?? null;
    if (!android) v.push('[appjson-parse] app.json 에 expo.android 블록이 없음');
  } catch (e) {
    v.push(`[appjson-parse] app.json JSON 파싱 실패: ${(e as Error).message}`);
  }

  if (android) {
    // ⓐ allowBackup === false (엄격 — 미설정·true 모두 FAIL)
    if (android.allowBackup !== false) {
      v.push(`[allowBackup-json] app.json expo.android.allowBackup 이 false 가 아님 (실제: ${JSON.stringify(android.allowBackup)}) — 구글 자동백업 차단 필요`);
    }
    // ⓒ 권한 중복 0 + RECORD_AUDIO blocked 존재
    const perms = Array.isArray(android.permissions) ? (android.permissions as unknown[]).map(String) : null;
    const blocked = Array.isArray(android.blockedPermissions) ? (android.blockedPermissions as unknown[]).map(String) : null;
    if (perms === null) v.push('[perm-shape] app.json expo.android.permissions 가 배열이 아님');
    else {
      const dup = perms.filter((p, i) => perms.indexOf(p) !== i);
      if (dup.length) v.push(`[perm-dup] app.json permissions 에 중복: ${[...new Set(dup)].join(', ')}`);
    }
    if (blocked === null) v.push('[perm-shape] app.json expo.android.blockedPermissions 가 배열이 아님');
    else {
      const dupB = blocked.filter((p, i) => blocked.indexOf(p) !== i);
      if (dupB.length) v.push(`[perm-dup] app.json blockedPermissions 에 중복: ${[...new Set(dupB)].join(', ')}`);
      if (!blocked.includes(RECORD_AUDIO)) v.push(`[perm-blocked-record] app.json blockedPermissions 에 ${RECORD_AUDIO} 가 없음 — 마이크 권한 노출 금지`);
    }
  }

  // ⓑ AndroidManifest — allowBackup="false" 존재 · "true" 잔존 금지
  if (/android:allowBackup\s*=\s*"true"/.test(inp.manifest)) {
    v.push('[allowBackup-manifest] AndroidManifest.xml 에 android:allowBackup="true" 잔존 — "false" 로 동기화 필요');
  } else if (!/android:allowBackup\s*=\s*"false"/.test(inp.manifest)) {
    v.push('[allowBackup-manifest] AndroidManifest.xml 에 android:allowBackup="false" 가 없음');
  }

  // ⓓ babel — transform-remove-console 가 env.production 하위에 존재(문자열 근접 검사)
  //   production 블록 안에 플러그인이 있어야(dev/test 무영향). 'production' 이후에 플러그인명이 나오는지 확인.
  const prodIdx = inp.babel.search(/\bproduction\b/);
  const pluginIdx = inp.babel.indexOf('transform-remove-console');
  if (pluginIdx < 0) {
    v.push('[babel-remove-console] babel.config.js 에 transform-remove-console 플러그인이 없음 — 릴리즈 콘솔 로그 제거 필요');
  } else if (prodIdx < 0 || pluginIdx < prodIdx) {
    v.push('[babel-remove-console] transform-remove-console 가 env.production 하위가 아님 — dev/test 번들까지 로그 제거 위험');
  }

  // ⓔ _layout — maxFontSizeMultiplier 설정 존재(문자열 검사 수준)
  if (!inp.layout.includes('maxFontSizeMultiplier')) {
    v.push('[font-multiplier] app/_layout.tsx 에 maxFontSizeMultiplier 설정이 없음 — 시스템 폰트 확대 전역 상한 필요');
  }

  return v;
}

// ── 실디스크 파일 수집 ──
function collectReal(): Inputs {
  return {
    appJson: readFileSync(join(ROOT, 'app.json'), 'utf8'),
    manifest: readFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8'),
    babel: readFileSync(join(ROOT, 'babel.config.js'), 'utf8'),
    layout: readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8'),
  };
}

// ── A/B 자가검증(메모리상 변조 입력) ──
function selftest(): number {
  const log = (m: string) => process.stdout.write(m + '\n');
  log('═══ _dv_appconfig --selftest (A/B 탐지 민감도) ═══');

  // (A) 정상 대조군 — 4종이 전부 올바른 입력 → 위반 0
  const CONTROL: Inputs = {
    appJson: JSON.stringify({
      expo: {
        android: {
          allowBackup: false,
          permissions: ['android.permission.MODIFY_AUDIO_SETTINGS', RECORD_AUDIO],
          blockedPermissions: [RECORD_AUDIO],
        },
      },
    }),
    manifest: '<application android:allowBackup="false" android:theme="@style/AppTheme"></application>',
    babel: "module.exports = { presets: ['babel-preset-expo'], env: { production: { plugins: [['transform-remove-console', { exclude: ['error','warn'] }]] } } };",
    layout: 'TextDefaults.defaultProps.maxFontSizeMultiplier = 1.3;',
  };
  let fail = 0;
  const ctrlV = analyze(CONTROL);
  if (ctrlV.length !== 0) { log(`  ❌ 정상 대조군에서 오탐 ${ctrlV.length}건:`); ctrlV.forEach((s) => log('     ' + s)); fail++; }
  else log('  ✓ 정상 대조군(allowBackup false·중복0·blocked record·plugin·multiplier) 위반 0 — 오탐 없음');

  // (B) 각 뮤턴트 단독 → 해당 검사가 위반을 검출해야(민감도)
  const clone = (): Inputs => JSON.parse(JSON.stringify({ ...CONTROL })) as Inputs;
  const MUTANTS: { tag: string; mut: (i: Inputs) => void }[] = [
    { tag: '[allowBackup-json]', mut: (i) => { i.appJson = i.appJson.replace('"allowBackup":false', '"allowBackup":true'); } },
    { tag: '[allowBackup-json]', mut: (i) => { i.appJson = i.appJson.replace('"allowBackup":false,', ''); } }, // 미설정도 FAIL
    { tag: '[allowBackup-manifest]', mut: (i) => { i.manifest = i.manifest.replace('allowBackup="false"', 'allowBackup="true"'); } },
    { tag: '[perm-dup]', mut: (i) => { i.appJson = i.appJson.replace(`["android.permission.MODIFY_AUDIO_SETTINGS","${RECORD_AUDIO}"]`, `["android.permission.MODIFY_AUDIO_SETTINGS","${RECORD_AUDIO}","${RECORD_AUDIO}"]`); } },
    { tag: '[perm-blocked-record]', mut: (i) => { i.appJson = i.appJson.replace(`"blockedPermissions":["${RECORD_AUDIO}"]`, '"blockedPermissions":[]'); } },
    { tag: '[babel-remove-console]', mut: (i) => { i.babel = i.babel.replace(/transform-remove-console/g, 'noop-plugin'); } }, // 플러그인 부재 → FAIL
    { tag: '[babel-remove-console]', mut: (i) => { i.babel = "module.exports = { presets: ['babel-preset-expo'], plugins: [['transform-remove-console']] };"; } }, // production 밖 → FAIL
    { tag: '[font-multiplier]', mut: (i) => { i.layout = 'TextDefaults.defaultProps.style = {};'; } },
  ];
  for (const { tag, mut } of MUTANTS) {
    const m = clone();
    mut(m);
    const res = analyze(m);
    const caught = res.some((s) => s.startsWith(tag));
    if (caught) log(`  ✓ 뮤턴트 탐지: ${tag} — ${res.find((s) => s.startsWith(tag))!.slice(0, 70)}…`);
    else { log(`  ❌ 뮤턴트 미탐지: ${tag} — 결과: ${JSON.stringify(res)}`); fail++; }
  }
  log(`\n${fail ? `❌ APPCONFIG_SELFTEST FAIL (${fail})` : `✅ APPCONFIG_SELFTEST PASS — 정상 오탐0 · 뮤턴트 ${MUTANTS.length}종 전부 탐지(A/B 민감도 증명)`}`);
  return fail ? 1 : 0;
}

// ── main ──
function main(): number {
  if (process.argv.includes('--selftest')) return selftest();
  const log = (m: string) => process.stdout.write(m + '\n');
  log('═══ 앱/디바이스 설정 드리프트 가드 (_dv_appconfig) ═══');
  log('검사: ⓐallowBackup(json)=false · ⓑallowBackup(manifest)=false · ⓒ권한 중복0+RECORD_AUDIO blocked · ⓓbabel transform-remove-console(prod) · ⓔmaxFontSizeMultiplier');
  const violations = analyze(collectReal());
  if (violations.length) { log(`\n위반 ${violations.length}건:`); violations.forEach((s) => log('  ❌ ' + s)); }
  log(`\n${violations.length ? `❌ APPCONFIG_GUARD FAIL (${violations.length})` : '✅ APPCONFIG_GUARD PASS — allowBackup 차단(json·manifest) · 권한 중복0·마이크 blocked · 릴리즈 로그제거 · 폰트확대 상한'}`);
  return violations.length ? 1 : 0;
}

process.exit(main());
