// stg ↔ prod 격리 가드 (RUNBOOK §3.5.7) — `npx tsx tools/_dv_stgisolation.ts`
//
// 왜: 2026-08-07 stg 구축 시, Vercel Preview가 **운영 env를 상속해 stg 서버가 운영 DB에 붙어 있었다.**
//   응답도 화면도 정상이라 눈으로는 못 잡는다. 격리는 한 번 확인하고 끝나는 게 아니라 **조용히 깨지는** 종류라
//   (env 추가 시 스코프를 Production and Preview로 두면 그 순간 재발) 상비 가드로 박아둔다.
//
// 검사 대상은 **로컬 env 파일 2개**(.env.local=prod / .env.staging=stg)와 stg DB 실접속이다.
//   Vercel 대시보드 상태는 이 가드가 못 본다 — 그건 /api/health의 `dbRef`로 확인한다(아래 안내 출력).
//
// 원칙: 시크릿 원문은 어떤 경로로도 출력하지 않는다. 비교는 전부 지문(fp)으로 한다(_envsafe).
import fs from 'fs';
import postgres from 'postgres';
import { readEnv, withSecret, fp, dbRefOf } from './_envsafe.mjs';

const PROD_ENV = '.env.local';
const STG_ENV = '.env.staging';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m);
};
const skip = (m: string) => console.log('  – SKIP:', m);
const warn = (m: string) => console.log('  ⚠ WARN:', m);

// **기한부 수용(2026-08-07)**: 운영 DB 비밀번호와 stg DB 비밀번호가 같은 값이다. 사용자가 위험을 인지하고
//   "현 값 유지 + 월 1회 정기 회전"으로 수용했다(SERVER_OPS §3.5 함정 ③).
//   영구 FAIL로 두면 가드가 무시되므로(경보 피로) **기한까지는 WARN, 넘기면 FAIL**로 자동 격상한다.
//   다음 회전 때 prod·stg를 서로 다른 무작위 값으로 끊으면 이 상수는 지운다.
const PW_SHARED_ACCEPTED_UNTIL = '2026-09-07';

// 사람이 읽히는 더미가 진짜 시크릿으로 통과한 사고(2026-08-07 `stg-admin-token-REPLACE-min-16-random`)를 막는다.
// "TODO로 시작하는가"만 보면 뚫린다 — 포함 여부 + 길이 + 패턴으로 판정.
const PLACEHOLDER = /TODO|REPLACE|CHANGE|EXAMPLE|YOUR|XXX|여기|채우|입력/i;
const looksPlaceholder = (v: string | undefined) =>
  !v || PLACEHOLDER.test(v) || v.length < 24 || /-(secret|token|key)-/i.test(v);

async function main() {
  console.log('── stg 격리 가드 ──');

  if (!fs.existsSync(STG_ENV)) {
    skip(`${STG_ENV} 없음 — stg 미구성 환경(CI 등)에서는 검사 생략`);
    console.log('\n결과: SKIP (stg env 부재)');
    return;
  }
  const prod = readEnv(PROD_ENV);
  const stg = readEnv(STG_ENV);

  // ── A. DB가 서로 다른가 (격리의 본체) ──
  console.log('\n[A] DB 분리');
  const pDb = prod.get('DATABASE_URL');
  const sDb = stg.get('DATABASE_URL');
  if (!pDb) {
    skip(`${PROD_ENV}에 DATABASE_URL 없음 — prod 대조 불가`);
  } else {
    ok(dbRefOf(pDb) !== dbRefOf(sDb), `DATABASE_URL 호스트가 다름 (prod ${dbRefOf(pDb)} ≠ stg ${dbRefOf(sDb)})`);
  }
  const mig = stg.get('MIGRATE_DATABASE_URL');
  if (mig && pDb) ok(dbRefOf(mig) !== dbRefOf(pDb), 'stg MIGRATE_DATABASE_URL도 운영 호스트가 아님');

  // ── B. 시크릿이 서로 다른가 ──
  // JWT를 공유하면 stg에서 발급한 토큰이 **운영에서도 유효**해진다. ADMIN을 공유하면 stg 관리자 = 운영 관리자.
  console.log('\n[B] 시크릿 분리');
  for (const k of ['SESSION_JWT_SECRET', 'ADMIN_TOKEN', 'CRON_SECRET', 'TELEMETRY_SALT']) {
    const p = prod.get(k), s = stg.get(k);
    if (!s) { skip(`${k}: stg에 없음(Vercel에만 있을 수 있음 — 대시보드 확인 필요)`); continue; }
    if (!p) { skip(`${k}: prod 로컬에 없음 — 대조 불가`); continue; }
    ok(fp(p) !== fp(s), `${k} 값이 다름 (prod ${fp(p)} ≠ stg ${fp(s)})`);
  }
  // ⚠ A(호스트)만 보면 **DB 비밀번호가 prod↔stg 동일해도 전부 통과**한다(2026-08-07 실사례 —
  //   회전한 운영 비밀번호가 stg 것과 같아져 "stg 크리덴셜 하나로 운영 DB가 열리는" 상태가 됐다).
  //   호스트가 달라도 비밀번호가 같으면 유출 시 피해가 양쪽으로 번지므로 별도 검사한다.
  const pwOf = (u?: string) => { try { return new URL(u!).password; } catch { return ''; } };
  const pPw = pwOf(pDb), sPw = pwOf(sDb);
  if (!pPw || !sPw) {
    skip('DB 비밀번호: 한쪽 파싱 불가 — 대조 생략');
  } else if (fp(pPw) !== fp(sPw)) {
    ok(true, `DB 비밀번호가 다름 (prod ${fp(pPw)} ≠ stg ${fp(sPw)})`);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const msg = `DB 비밀번호가 prod↔stg 동일 (${fp(pPw)}) — stg 크리덴셜 하나로 운영 DB가 열린다`;
    if (today <= PW_SHARED_ACCEPTED_UNTIL) {
      warn(`${msg}. 기한부 수용 중(~${PW_SHARED_ACCEPTED_UNTIL}, SERVER_OPS §3.5) — 다음 회전 때 분리할 것`);
    } else {
      ok(false, `${msg}. **수용 기한 ${PW_SHARED_ACCEPTED_UNTIL} 경과** — 회전으로 분리하라(SERVER_OPS §3.5.1)`);
    }
  }

  // ── C. 자리표시자가 남아 있지 않은가 ──
  console.log('\n[C] 자리표시자 잔존');
  for (const k of ['SESSION_JWT_SECRET', 'ADMIN_TOKEN', 'CRON_SECRET']) {
    const v = stg.get(k);
    if (v === undefined) { skip(`${k}: stg env에 없음`); continue; }
    ok(!looksPlaceholder(v), `${k}가 실제 랜덤값 (더미 문구·24자 미만 아님)`);
  }

  // ── D. 운영과 같은 연결 방식인가 (stg = 운영 미러) ──
  // 6543(트랜잭션 풀러)에서만 나는 문제를 stg가 잡으려면 포트까지 같아야 한다(BACKEND §13.7).
  console.log('\n[D] 연결 방식 동형');
  const portOf = (u?: string) => { try { return new URL(u!).port || '(기본)'; } catch { return '(파싱불가)'; } };
  if (pDb) ok(portOf(sDb) === portOf(pDb), `런타임 포트가 운영과 동일 (prod ${portOf(pDb)} / stg ${portOf(sDb)})`);
  else skip('prod DATABASE_URL 부재 — 포트 대조 불가');

  // ── E. stg DB가 실제로 살아 있고 스키마가 서 있는가 ──
  // ⚠ A가 깨졌으면 sDb는 **운영 DB**다. 격리 가드가 운영에 접속하는 건 어불성설이라 그땐 붙지 않는다
  //   (2026-08-07 A/B 변이 실행 중 발견 — 읽기 전용이라 무해했지만 원칙 위반).
  console.log('\n[E] stg DB 실접속');
  const isolationBroken = !!pDb && dbRefOf(pDb) === dbRefOf(sDb);
  if (isolationBroken) {
    skip('A 실패(= stg가 운영 DB를 가리킴) — 운영에 접속하지 않기 위해 프로브 생략');
    console.log(fail ? `\n결과: FAIL ${fail}건` : '\n결과: PASS');
    process.exit(fail ? 1 : 0);
  }
  const r = await withSecret(sDb, async (u: string) => {
    const sql = postgres(u, { max: 2, prepare: false, connect_timeout: 15 });
    const t = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
    const p = await sql`select proj_code from proj_info order by proj_code`;
    await sql.end();
    return { tables: t[0].n as number, projs: p.map((x: any) => x.proj_code as string) };
  });
  if (!r.ok) {
    ok(false, `stg DB 접속 실패 (${r.reason}) — 비밀번호 회전 후 .env.staging 갱신을 잊지 않았는지 확인`);
  } else {
    ok(r.value.tables >= 18, `public 테이블 ${r.value.tables}개 (운영과 동일하게 18개 이상)`);
    // proj_info 시드가 없으면 모든 라우트가 FK 위반으로 500난다(§3.5 함정 ①).
    ok(r.value.projs.includes('volleyball'), `proj_info 시드 존재: ${r.value.projs.join(', ')}`);
  }

  console.log('\n※ 이 가드는 로컬 env만 본다. **Vercel Preview가 실제로 stg DB를 보는지**는 배포된 서버로 확인:');
  console.log('   https://volleyball-git-staging-sonws.vercel.app/api/health → dbRef 가 ' + dbRefOf(sDb) + ' 여야 한다');
  console.log('   (운영 값 ' + (pDb ? dbRefOf(pDb) : '?') + ' 가 나오면 Preview가 운영 env를 상속한 것 — RUNBOOK §3.5 함정 ③)');

  console.log(fail ? `\n결과: FAIL ${fail}건` : '\n결과: PASS');
  if (fail) process.exit(1);
}

main().catch((e) => {
  // 예외 메시지에 연결문자열이 실릴 수 있으므로 코드/이름만 남긴다.
  console.error('가드 실행 실패:', e?.code ?? e?.name ?? 'error');
  process.exit(1);
});
