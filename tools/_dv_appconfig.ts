// STANDING GUARD — 정적 앱/디바이스 설정 드리프트 감시 (2026-07-16, 보안·디바이스 감사 후속; 2026-07-17 OTA 채널 확장).
//   OWASP MAS/RN 표준 대비 확정된 수정 + OTA 전달 정합이 시간이 지나며 되돌려지거나(prebuild 재생성·머지 등) 조용히
//   깨지지 않도록 정적으로 단언한다. 검사 대상:
//     ⓐ app.json  expo.android.allowBackup === false            (구글 자동백업 차단 — 평문 세션/세이브 유출·부활 방지)
//     ⓑ AndroidManifest.xml 에 android:allowBackup="false"      (prebuild 네이티브도 동기화, "true" 잔존 금지)
//     ⓒ app.json  permissions·blockedPermissions 중복 0         + RECORD_AUDIO 가 blockedPermissions 에 존재
//        (마이크 권한 노출 금지 — 게임 심사·신뢰. 중복은 prebuild 머지 사고 흔적)
//     ⓓ babel.config.js 에 transform-remove-console(production) (릴리즈 콘솔 로그 정보노출 제거, error·warn 유지)
//     ⓔ app/_layout.tsx 에 maxFontSizeMultiplier 설정 존재      (시스템 폰트 확대 전역 상한 — 레이아웃 보전, 문자열 검사 수준)
//     ⓕ app.json  expo.updates.requestHeaders["expo-channel-name"] 존재 + eas.json production.channel 과 일치
//        (2026-07-17 발견: 로컬 그래들 AAB 는 eas.json build.channel 이 미적용 — 바이너리가 채널 헤더를 안 보내면
//         `eas update --channel production` 게시가 성공해도 기기가 채널을 안 보내 라우팅 불가. "게시 성공≠전달". vc13·14 이틀 잠복.)
//     ⓖ AndroidManifest.xml(존재 시) UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY 메타데이터의 expo-channel-name 이 app.json 과 일치
//        (매니페스트에 채널 헤더가 박혀야 기기가 채널을 EAS 서버로 전송 → 채널→브랜치 매핑이 동작)
//     ⓗ runtimeVersion 3원 정합: app.json runtimeVersion === strings.xml expo_runtime_version(존재 시)
//        + AndroidManifest(존재 시) EXPO_RUNTIME_VERSION 이 @string/expo_runtime_version 참조(하드코딩 금지)
//   android/ 하위(manifest·strings)는 prebuild 재생성 가능 — 파일이 없으면 관련 검사는 skip(app.json·eas.json 만 상시).
//   A/B(허위 오라클 방지): --selftest 는 메모리상 변조 입력(allowBackup true·중복 권한·플러그인 제거·채널 부재/불일치·런타임 불일치 등)을
//     심어 각 검사가 그 결함을 검출하는지 + 정상 입력이 오탐 안 나는지 증명한다. 실디스크는 건드리지 않는다.
//   Usage: npx tsx tools/_dv_appconfig.ts            ; echo $?
//          npx tsx tools/_dv_appconfig.ts --selftest ; echo $?
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';

interface Inputs {
  appJson: string;          // app.json 원문
  manifest: string | null;  // AndroidManifest.xml 원문 (android/ 재생성 가능 — 없으면 관련 검사 skip)
  strings: string | null;   // android res/values/strings.xml 원문 (위와 동일)
  eas: string;              // eas.json 원문
  babel: string;            // babel.config.js 원문
  layout: string;           // app/_layout.tsx 원문
}

/** 매니페스트 meta-data 의 android:value 추출(속성값 안 &quot; 는 &quot; 이므로 [^"]* 로 안전). */
function manifestMetaValue(manifest: string, keySuffix: string): string | null {
  const re = new RegExp(keySuffix + '"[^>]*android:value="([^"]*)"');
  const m = manifest.match(re);
  return m ? m[1] : null;
}

/** 핵심 분석기(순수) — 파일 내용 → 위반 문자열 목록. selftest 가 그대로 재사용. */
function analyze(inp: Inputs): string[] {
  const v: string[] = [];

  // ── app.json 파싱 ──
  let android: Record<string, unknown> | null = null;
  let appChannel: string | undefined;        // updates.requestHeaders['expo-channel-name']
  let appRuntimeVersion: string | undefined; // expo.runtimeVersion
  try {
    const parsed = JSON.parse(inp.appJson) as {
      expo?: {
        android?: Record<string, unknown>;
        runtimeVersion?: unknown;
        updates?: { requestHeaders?: Record<string, unknown> };
      };
    };
    const expo = parsed.expo;
    android = expo?.android ?? null;
    if (!android) v.push('[appjson-parse] app.json 에 expo.android 블록이 없음');
    if (typeof expo?.runtimeVersion === 'string') appRuntimeVersion = expo.runtimeVersion;
    const rh = expo?.updates?.requestHeaders;
    if (rh && typeof rh['expo-channel-name'] === 'string') appChannel = rh['expo-channel-name'] as string;
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

  // ⓑ AndroidManifest — allowBackup="false" 존재 · "true" 잔존 금지 (manifest 존재 시)
  if (inp.manifest !== null) {
    if (/android:allowBackup\s*=\s*"true"/.test(inp.manifest)) {
      v.push('[allowBackup-manifest] AndroidManifest.xml 에 android:allowBackup="true" 잔존 — "false" 로 동기화 필요');
    } else if (!/android:allowBackup\s*=\s*"false"/.test(inp.manifest)) {
      v.push('[allowBackup-manifest] AndroidManifest.xml 에 android:allowBackup="false" 가 없음');
    }
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

  // ── OTA 채널/런타임 정합 (2026-07-17 발견 — "게시 성공≠전달") ──
  // eas.json production.channel
  let easChannel: string | undefined;
  try {
    const easParsed = JSON.parse(inp.eas) as { build?: { production?: { channel?: unknown } } };
    const c = easParsed?.build?.production?.channel;
    if (typeof c === 'string') easChannel = c;
    else v.push('[eas-channel-shape] eas.json build.production.channel 이 문자열이 아님/없음');
  } catch (e) {
    v.push(`[eas-parse] eas.json JSON 파싱 실패: ${(e as Error).message}`);
  }

  // ⓕ app.json 채널 헤더 존재 + eas 와 일치
  if (appChannel === undefined) {
    v.push('[channel-appjson] app.json expo.updates.requestHeaders["expo-channel-name"] 가 없음 — 바이너리가 채널 헤더를 안 보내 EAS 업데이트 라우팅 불가(OTA 전달 사각, vc13·14 잠복 원인)');
  } else if (easChannel !== undefined && appChannel !== easChannel) {
    v.push(`[channel-mismatch] app.json 채널 헤더("${appChannel}") ≠ eas.json production.channel("${easChannel}")`);
  }

  // ⓖ 매니페스트 채널 메타데이터 정합 (manifest 존재 시)
  if (inp.manifest !== null) {
    const raw = manifestMetaValue(inp.manifest, 'UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY');
    if (raw === null) {
      v.push('[channel-manifest-missing] AndroidManifest.xml 에 UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY 메타데이터가 없음 — 로컬 그래들 빌드는 eas.json channel 미적용, 매니페스트에 채널 헤더가 박혀야 기기가 채널을 전송');
    } else {
      let manifestChannel: string | undefined;
      try {
        const obj = JSON.parse(raw.replace(/&quot;/g, '"')) as Record<string, unknown>;
        if (typeof obj['expo-channel-name'] === 'string') manifestChannel = obj['expo-channel-name'] as string;
      } catch { /* handled below */ }
      if (manifestChannel === undefined) {
        v.push(`[channel-manifest-shape] AndroidManifest UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY 값에 expo-channel-name 이 없음/파싱불가: ${raw}`);
      } else if (appChannel !== undefined && manifestChannel !== appChannel) {
        v.push(`[channel-manifest-mismatch] AndroidManifest 채널("${manifestChannel}") ≠ app.json 채널("${appChannel}")`);
      }
    }
  }

  // ⓗ runtimeVersion 3원 정합
  if (appRuntimeVersion === undefined) {
    v.push('[runtime-appjson] app.json expo.runtimeVersion 이 문자열이 아님/없음');
  }
  if (inp.strings !== null) {
    const sm = inp.strings.match(/<string name="expo_runtime_version"[^>]*>([^<]*)<\/string>/);
    const stringsRV = sm ? sm[1].trim() : undefined;
    if (stringsRV === undefined) {
      v.push('[runtime-strings-missing] strings.xml 에 expo_runtime_version 문자열 리소스가 없음');
    } else if (appRuntimeVersion !== undefined && stringsRV !== appRuntimeVersion) {
      v.push(`[runtime-mismatch] strings.xml expo_runtime_version("${stringsRV}") ≠ app.json runtimeVersion("${appRuntimeVersion}")`);
    }
  }
  if (inp.manifest !== null) {
    const rvRef = manifestMetaValue(inp.manifest, 'EXPO_RUNTIME_VERSION');
    if (rvRef !== null && rvRef !== '@string/expo_runtime_version') {
      v.push(`[runtime-manifest-ref] AndroidManifest EXPO_RUNTIME_VERSION 이 @string/expo_runtime_version 참조가 아님(하드코딩 드리프트): ${rvRef}`);
    }
  }

  return v;
}

// ── 실디스크 파일 수집 ──
function collectReal(): Inputs {
  const readOpt = (rel: string): string | null => {
    try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
  };
  return {
    appJson: readFileSync(join(ROOT, 'app.json'), 'utf8'),
    manifest: readOpt('android/app/src/main/AndroidManifest.xml'),
    strings: readOpt('android/app/src/main/res/values/strings.xml'),
    eas: readFileSync(join(ROOT, 'eas.json'), 'utf8'),
    babel: readFileSync(join(ROOT, 'babel.config.js'), 'utf8'),
    layout: readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8'),
  };
}

// ── A/B 자가검증(메모리상 변조 입력) ──
function selftest(): number {
  const log = (m: string) => process.stdout.write(m + '\n');
  log('═══ _dv_appconfig --selftest (A/B 탐지 민감도) ═══');

  // (A) 정상 대조군 — 전부 올바른 입력 → 위반 0
  const CONTROL: Inputs = {
    appJson: JSON.stringify({
      expo: {
        android: {
          allowBackup: false,
          permissions: ['android.permission.MODIFY_AUDIO_SETTINGS', RECORD_AUDIO],
          blockedPermissions: [RECORD_AUDIO],
        },
        runtimeVersion: '1.1.0',
        updates: { url: 'https://u.expo.dev/x', requestHeaders: { 'expo-channel-name': 'production' } },
      },
    }),
    manifest:
      '<application android:allowBackup="false" android:theme="@style/AppTheme">' +
      '<meta-data android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"/>' +
      '<meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;production&quot;}"/>' +
      '</application>',
    strings: '<resources><string name="expo_runtime_version">1.1.0</string></resources>',
    eas: JSON.stringify({ build: { production: { channel: 'production' } } }),
    babel: "module.exports = { presets: ['babel-preset-expo'], env: { production: { plugins: [['transform-remove-console', { exclude: ['error','warn'] }]] } } };",
    layout: 'TextDefaults.defaultProps.maxFontSizeMultiplier = 1.3;',
  };
  let fail = 0;
  const ctrlV = analyze(CONTROL);
  if (ctrlV.length !== 0) { log(`  ❌ 정상 대조군에서 오탐 ${ctrlV.length}건:`); ctrlV.forEach((s) => log('     ' + s)); fail++; }
  else log('  ✓ 정상 대조군(allowBackup·중복0·blocked·plugin·multiplier·채널정합·런타임정합) 위반 0 — 오탐 없음');

  // (B) 각 뮤턴트 단독 → 해당 검사가 위반을 검출해야(민감도)
  const clone = (): Inputs => JSON.parse(JSON.stringify({ ...CONTROL })) as Inputs;
  const MUTANTS: { tag: string; mut: (i: Inputs) => void }[] = [
    { tag: '[allowBackup-json]', mut: (i) => { i.appJson = i.appJson.replace('"allowBackup":false', '"allowBackup":true'); } },
    { tag: '[allowBackup-json]', mut: (i) => { i.appJson = i.appJson.replace('"allowBackup":false,', ''); } }, // 미설정도 FAIL
    { tag: '[allowBackup-manifest]', mut: (i) => { i.manifest = i.manifest!.replace('allowBackup="false"', 'allowBackup="true"'); } },
    { tag: '[perm-dup]', mut: (i) => { i.appJson = i.appJson.replace(`["android.permission.MODIFY_AUDIO_SETTINGS","${RECORD_AUDIO}"]`, `["android.permission.MODIFY_AUDIO_SETTINGS","${RECORD_AUDIO}","${RECORD_AUDIO}"]`); } },
    { tag: '[perm-blocked-record]', mut: (i) => { i.appJson = i.appJson.replace(`"blockedPermissions":["${RECORD_AUDIO}"]`, '"blockedPermissions":[]'); } },
    { tag: '[babel-remove-console]', mut: (i) => { i.babel = i.babel.replace(/transform-remove-console/g, 'noop-plugin'); } }, // 플러그인 부재 → FAIL
    { tag: '[babel-remove-console]', mut: (i) => { i.babel = "module.exports = { presets: ['babel-preset-expo'], plugins: [['transform-remove-console']] };"; } }, // production 밖 → FAIL
    { tag: '[font-multiplier]', mut: (i) => { i.layout = 'TextDefaults.defaultProps.style = {};'; } },
    // OTA 채널/런타임 (2026-07-17)
    { tag: '[channel-appjson]', mut: (i) => { i.appJson = i.appJson.replace('"requestHeaders":{"expo-channel-name":"production"}', '"requestHeaders":{}'); } }, // 채널 헤더 부재 → FAIL
    { tag: '[channel-mismatch]', mut: (i) => { i.eas = i.eas.replace('"channel":"production"', '"channel":"preview"'); } }, // app=production, eas=preview → FAIL
    { tag: '[channel-manifest-missing]', mut: (i) => { i.manifest = i.manifest!.replace(/<meta-data android:name="expo\.modules\.updates\.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"[^>]*\/>/, ''); } }, // 매니페스트 채널 부재 → FAIL
    { tag: '[channel-manifest-mismatch]', mut: (i) => { i.manifest = i.manifest!.replace('&quot;production&quot;}', '&quot;preview&quot;}'); } }, // 매니페스트=preview, app=production → FAIL
    { tag: '[runtime-mismatch]', mut: (i) => { i.strings = i.strings!.replace('>1.1.0<', '>2.0.0<'); } }, // strings RV ≠ app RV → FAIL
    { tag: '[runtime-manifest-ref]', mut: (i) => { i.manifest = i.manifest!.replace('android:value="@string/expo_runtime_version"', 'android:value="1.1.0"'); } }, // 하드코딩 참조 → FAIL
  ];
  for (const { tag, mut } of MUTANTS) {
    const m = clone();
    mut(m);
    const res = analyze(m);
    const caught = res.some((s) => s.startsWith(tag));
    if (caught) log(`  ✓ 뮤턴트 탐지: ${tag} — ${res.find((s) => s.startsWith(tag))!.slice(0, 78)}…`);
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
  log('검사: ⓐallowBackup(json) · ⓑallowBackup(manifest) · ⓒ권한중복0+RECORD_AUDIO blocked · ⓓbabel remove-console(prod) · ⓔmaxFontSizeMultiplier · ⓕ채널헤더(json↔eas) · ⓖ채널메타(manifest↔json) · ⓗruntimeVersion 3원');
  const violations = analyze(collectReal());
  if (violations.length) { log(`\n위반 ${violations.length}건:`); violations.forEach((s) => log('  ❌ ' + s)); }
  log(`\n${violations.length ? `❌ APPCONFIG_GUARD FAIL (${violations.length})` : '✅ APPCONFIG_GUARD PASS — allowBackup(json·manifest) · 권한중복0·마이크blocked · 릴리즈 로그제거 · 폰트확대상한 · OTA 채널정합(json·eas·manifest) · runtimeVersion 3원정합'}`);
  return violations.length ? 1 : 0;
}

process.exit(main());
