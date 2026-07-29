// OTA 자동 적용(부팅 전용) 순수 헬퍼 검증 (AUTH_SYSTEM §4) — 킬스위치 진리표 + withTimeout 실증 + 상수 sanity.
//   실제 expo-updates 호출(check/fetch/reload)은 node/Expo Go(isEnabled=false)에서 무동작 → 여기선 결정 로직만.
//   실제 부팅 자동적용은 preview/실빌드 E2E에서만 검증 가능(트리비얼 OTA 쏘고 1회 자동적용 확인).
// 사용: npx tsx tools/_dv_ota.ts
import { otaAutoApplyEnabled, withTimeout, OTA_CHECK_TIMEOUT_MS, OTA_FETCH_TIMEOUT_MS } from '../lib/otaGate';

const fails: string[] = [];
const ck = (c: boolean, m: string) => { if (!c) fails.push(m); };
const delay = <T>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));

async function main(): Promise<void> {
  // ── A. otaAutoApplyEnabled 진리표 (기본 on, false일 때만 차단) ──
  ck(otaAutoApplyEnabled(undefined) === true, 'A: undefined(조회중) → true 여야');
  ck(otaAutoApplyEnabled(null) === true, 'A: null(오프라인) → true 여야');
  ck(otaAutoApplyEnabled({}) === true, 'A: {}(필드 없음) → true 여야');
  ck(otaAutoApplyEnabled({ otaAutoApply: true }) === true, 'A: {otaAutoApply:true} → true 여야');
  ck(otaAutoApplyEnabled({ otaAutoApply: false }) === false, 'A: {otaAutoApply:false} → false(킬스위치) 여야');

  // A/B 민감도: `!== false`를 `=== true`로 변이하면 undefined/null/{} 케이스가 false로 뒤집힌다.
  //   오라클(위 진리표)이 그 변이를 실제로 잡는지 인라인 재현으로 증명(변이는 프로덕션 코드에 안 남김).
  const mutated = (boot: { otaAutoApply?: boolean } | null | undefined) => boot?.otaAutoApply === true;
  ck(mutated(undefined) === false && otaAutoApplyEnabled(undefined) === true,
    'A/B: `=== true` 변이가 undefined를 false로 뒤집음 — 오라클이 검출해야(감도 증명)');

  // ── B. withTimeout: 빠른 resolve는 값 통과 / 느린 것은 지정 ms 후 reject ──
  const fast = await withTimeout(delay('ok', 5), 200);
  ck(fast === 'ok', `B: 빠른 resolve 값 통과 (got ${String(fast)})`);

  let timedOut = false;
  const t0 = Date.now();
  try { await withTimeout(delay('late', 400), 60); } catch { timedOut = true; }
  const elapsed = Date.now() - t0;
  ck(timedOut, 'B: 느린 Promise가 타임아웃으로 reject 되어야');
  ck(elapsed < 300, `B: 타임아웃(60ms)이 느린 값(400ms) 전에 발화 (elapsed ${elapsed}ms)`);

  // A/B 민감도(타임아웃 실증): 지정 ms를 넉넉히 주면 같은 느린 Promise가 통과 → 타임아웃이 진짜 경합함을 증명
  let passedWhenAmple = false;
  try { const v = await withTimeout(delay('late', 60), 500); passedWhenAmple = v === 'late'; } catch { /* noop */ }
  ck(passedWhenAmple, 'B/AB: 타임아웃 여유(500ms)면 느린 값 통과 — 타임아웃이 값 자체를 막지 않음');

  // ── 상수 sanity ──
  ck(OTA_CHECK_TIMEOUT_MS > 0 && OTA_FETCH_TIMEOUT_MS > 0, '상수: 둘 다 양수여야');
  ck(OTA_CHECK_TIMEOUT_MS < OTA_FETCH_TIMEOUT_MS, `상수: CHECK(${OTA_CHECK_TIMEOUT_MS}) < FETCH(${OTA_FETCH_TIMEOUT_MS}) 여야(다운로드가 조회보다 오래)`);

  console.log(fails.length ? '❌ FAIL\n  ' + fails.join('\n  ') : '✅ otaGate 순수 헬퍼 PASS (킬스위치 진리표·withTimeout 타임아웃 실증·상수 sanity + A/B 감도)');
  process.exit(fails.length ? 1 : 0);
}

void main();
