// Sentry 환경 게이트 순수 가드 (§13.21, 2026-07-24 알림 폭주 사건) — **DB·네트워크·실 Sentry 전송 없음**.
// 실행: server 디렉터리에서 `npx tsx tools/_dv_sentry_gate.ts`
//
// 왜: Next는 dev에서도 `.env.local`(운영 크리덴셜)을 로드한다 → 로컬 dev/가드가 만든 500이 **운영 Sentry 프로젝트**로
//   전송돼 알림이 폭주했다. 코드 게이트(`lib/sentryGate.ts`)를 넣었으므로, 그 게이트가 사문화되지 않게 상설 가드로 봉인.
//
// 검증 항목:
//  (a) sentryEnabled() 진리표 — DSN 유무 × VERCEL_ENV(없음/production/preview/development) × 탈출구.
//  (b) register()가 로컬(DSN 있음·VERCEL_ENV 없음)에서 **init하지 않음**(Sentry 클라이언트 미생성).
//  (c) onRequestError()가 로컬에서 no-op — **스텁 트랜스포트 클라이언트**를 바인딩해 "전송 시도 0건"을 실측.
//      배포 env로 바꾸면 같은 호출이 1건 전송 → 가드가 전송을 실제로 관측함(민감도 증명, 네트워크는 스텁이라 안 나감).
//  (d) reportError()(lib/observability)도 **같은 판단**을 따름 — 로컬 0건 / 배포 1건.
//
// ⚠ 실 Sentry로는 아무것도 보내지 않는다: DSN은 존재하지 않는 호스트의 더미이고, 전송은 메모리 스텁 트랜스포트가 받는다.
//
// ⚠ 변이 자가검증(mutant self-check): 게이트를 걷어내면 아래가 FAIL 나야 한다.
//   예) sentryEnabled가 `return !!env.SENTRY_DSN`(구 로직)이면 (a) 로컬/‘development’ 케이스 + (b)(c)(d) 로컬 케이스 실패;
//       onRequestError만 구 로직(`if (!process.env.SENTRY_DSN) return`)으로 되돌리면 (c) 로컬 no-op 실패(절반만 막힘 재현).
import * as Sentry from '@sentry/node';
import { sentryEnabled } from '../lib/sentryGate';
import { register, onRequestError } from '../instrumentation';
import { reportError } from '../lib/observability';

// 존재하지 않는 호스트(.invalid TLD, RFC 2606) — 만에 하나 스텁을 우회해도 실 Sentry엔 도달 불가.
const DUMMY_DSN = 'https://0000000000000000000000000000abcd@o0.ingest.invalid/1';

let pass = 0;
let total = 0;
const ok = (cond: boolean, msg: string): void => {
  total++;
  if (cond) { pass++; console.log('  ✓', msg); }
  else console.error('  ✗ FAIL:', msg);
};

type Env = Record<string, string | undefined>;

async function main(): Promise<number> {
  // ───────────────────────── (a) 순수 진리표 ─────────────────────────
  console.log('── (a) sentryEnabled() 진리표(순수 함수, process.env 무관) ──');
  const E = (o: Env): Env => o;
  ok(sentryEnabled(E({ SENTRY_DSN: DUMMY_DSN })) === false,
    'DSN 있음 + VERCEL_ENV 없음(로컬) → 비활성  ← 이번 사건의 본체');
  ok(sentryEnabled(E({ SENTRY_DSN: DUMMY_DSN, VERCEL_ENV: 'production' })) === true,
    'DSN 있음 + VERCEL_ENV=production → 활성');
  ok(sentryEnabled(E({ SENTRY_DSN: DUMMY_DSN, VERCEL_ENV: 'preview' })) === true,
    'DSN 있음 + VERCEL_ENV=preview → 활성');
  ok(sentryEnabled(E({ SENTRY_DSN: DUMMY_DSN, VERCEL_ENV: 'development' })) === false,
    "DSN 있음 + VERCEL_ENV=development(`vercel dev` 로컬) → 비활성(화이트리스트)");
  ok(sentryEnabled(E({})) === false, 'DSN 없음 + 로컬 → 비활성');
  ok(sentryEnabled(E({ VERCEL_ENV: 'production' })) === false, 'DSN 없음 + production → 비활성(부팅 안전 계약)');
  ok(sentryEnabled(E({ SENTRY_DSN: '', VERCEL_ENV: 'production' })) === false,
    "DSN 빈 문자열('' 오버라이드) → 비활성 — .env.development.local 무력화 관행이 배포에서도 통함");
  ok(sentryEnabled(E({ SENTRY_DSN: DUMMY_DSN, SENTRY_FORCE_LOCAL: '1' })) === true,
    'DSN 있음 + SENTRY_FORCE_LOCAL=1 + 로컬 → 활성(탈출구 동작)');
  ok(sentryEnabled(E({ SENTRY_FORCE_LOCAL: '1' })) === false,
    'DSN 없음 + FORCE_LOCAL=1 → 비활성(탈출구가 DSN 부재를 못 이김)');
  ok(sentryEnabled(E({ SENTRY_DSN: DUMMY_DSN, SENTRY_FORCE_LOCAL: '0' })) === false,
    "FORCE_LOCAL='0' → 비활성(정확히 '1'만 인정)");

  // process.env 스냅샷(이 아래부터 실제 env를 조작한다 — 끝에서 복원)
  const env = process.env as Env;
  const SNAP = {
    DSN: env.SENTRY_DSN, VERCEL_ENV: env.VERCEL_ENV, FORCE: env.SENTRY_FORCE_LOCAL,
    RUNTIME: env.NEXT_RUNTIME, TRACES: env.SENTRY_TRACES_SAMPLE_RATE,
  };
  const setEnv = (o: Env): void => {
    for (const k of ['SENTRY_DSN', 'VERCEL_ENV', 'SENTRY_FORCE_LOCAL', 'NEXT_RUNTIME', 'SENTRY_TRACES_SAMPLE_RATE']) {
      if (o[k] === undefined) delete env[k]; else env[k] = o[k];
    }
  };

  // ───────────────────────── (b) register() = 로컬에선 init 안 함 ─────────────────────────
  console.log('── (b) register() 로컬 게이트(실제 init 여부) ──');
  ok(!Sentry.getClient(), '사전 조건: 이 프로세스에 Sentry 클라이언트 없음');
  setEnv({ SENTRY_DSN: DUMMY_DSN, NEXT_RUNTIME: 'nodejs', SENTRY_TRACES_SAMPLE_RATE: '0' }); // 로컬(VERCEL_ENV 없음)
  await register();
  ok(!Sentry.getClient(), 'DSN 있어도 로컬이면 Sentry.init 안 함(클라이언트 미생성)');
  setEnv({ SENTRY_DSN: DUMMY_DSN, VERCEL_ENV: 'development', NEXT_RUNTIME: 'nodejs', SENTRY_TRACES_SAMPLE_RATE: '0' });
  await register();
  ok(!Sentry.getClient(), "VERCEL_ENV='development'(vercel dev)도 init 안 함");

  // ───────────────────────── (c)(d) 전송 경로 = 스텁 트랜스포트로 실측 ─────────────────────────
  // 실 Sentry 전송 금지 조건을 지키려고 **우리가 만든 클라이언트**를 바인딩한다(전송은 메모리 배열로).
  // 이렇게 하면 "클라이언트는 살아 있는데 게이트가 막는가"를 관측할 수 있다 — 게이트가 없으면 sent가 늘어난다.
  console.log('── (c)(d) 캡처 경로 실측(스텁 트랜스포트 — 네트워크·실 Sentry 전송 0) ──');
  const sent: unknown[] = [];
  const client = new Sentry.NodeClient({
    dsn: DUMMY_DSN,
    integrations: [],
    stackParser: Sentry.defaultStackParser,
    tracesSampleRate: 0,
    transport: () => ({
      send: async (envelope: unknown) => { sent.push(envelope); return {}; },
      flush: async () => true,
    }),
  });
  Sentry.setCurrentClient(client);
  client.init();
  ok(!!Sentry.getClient(), '사전 조건: 스텁 클라이언트가 바인딩됨(전송 관측 가능 상태)');

  // 관측 도구 자체 검증(허위 오라클 방지): 게이트를 안 타는 직접 캡처는 sent가 늘어나야 한다.
  Sentry.captureException(new Error('sentry-gate-guard: 트랜스포트 스텁 sanity'));
  await Sentry.flush(2000);
  ok(sent.length >= 1, '오라클 sanity: 게이트 밖 직접 captureException은 스텁에 잡힘(측정 도구가 살아 있음)');

  // (c) onRequestError — 로컬 0건
  setEnv({ SENTRY_DSN: DUMMY_DSN, NEXT_RUNTIME: 'nodejs', SENTRY_TRACES_SAMPLE_RATE: '0' });
  let n0 = sent.length;
  await onRequestError(new Error('sentry-gate-guard: 로컬 onRequestError(전송되면 안 됨)'));
  ok(sent.length === n0, 'onRequestError: 로컬(DSN 있음·VERCEL_ENV 없음) → 전송 0건(no-op)');

  // (d) reportError — 로컬 0건
  n0 = sent.length;
  reportError(new Error('sentry-gate-guard: 로컬 reportError(전송되면 안 됨)'), 'guard');
  await Sentry.flush(2000);
  ok(sent.length === n0, 'reportError: 로컬 → 전송 0건(instrumentation과 동일 판단)');

  // (c') 민감도 — 같은 호출이 배포 env에선 전송된다(가드가 "항상 0건"을 보는 게 아님을 증명)
  setEnv({ SENTRY_DSN: DUMMY_DSN, VERCEL_ENV: 'production', NEXT_RUNTIME: 'nodejs', SENTRY_TRACES_SAMPLE_RATE: '0' });
  n0 = sent.length;
  await onRequestError(new Error('sentry-gate-guard: 배포 onRequestError(전송돼야 함)'));
  ok(sent.length > n0, '민감도: VERCEL_ENV=production이면 onRequestError가 전송(게이트 통과 확인)');
  n0 = sent.length;
  reportError(new Error('sentry-gate-guard: 배포 reportError(전송돼야 함)'), 'guard');
  await Sentry.flush(2000);
  ok(sent.length > n0, '민감도: VERCEL_ENV=production이면 reportError가 전송');

  // (e) 탈출구 — 로컬 + FORCE_LOCAL=1이면 전송된다(디버깅 경로가 살아 있음)
  setEnv({ SENTRY_DSN: DUMMY_DSN, SENTRY_FORCE_LOCAL: '1', NEXT_RUNTIME: 'nodejs', SENTRY_TRACES_SAMPLE_RATE: '0' });
  n0 = sent.length;
  await onRequestError(new Error('sentry-gate-guard: 탈출구 onRequestError'));
  ok(sent.length > n0, '탈출구: 로컬 + SENTRY_FORCE_LOCAL=1이면 전송(연동 검증 도구 경로 보존)');

  // 정리 — 스텁 클라이언트 종료 + env 복원(가드가 프로세스에 잔여 상태를 남기지 않게)
  await client.close(0);
  setEnv({
    SENTRY_DSN: SNAP.DSN, VERCEL_ENV: SNAP.VERCEL_ENV, SENTRY_FORCE_LOCAL: SNAP.FORCE,
    NEXT_RUNTIME: SNAP.RUNTIME, SENTRY_TRACES_SAMPLE_RATE: SNAP.TRACES,
  });

  console.log(pass === total ? `\nSENTRY GATE PASS (${pass}/${total})` : `\nSENTRY GATE FAIL (${pass}/${total})`);
  return pass === total ? 0 : 1;
}

main().then((code) => process.exit(code));
