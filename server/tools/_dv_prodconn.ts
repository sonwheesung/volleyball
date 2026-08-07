// 운영 DB 연결 2종 점검 (SERVER_OPS §3.5.1 6단계) — `npx tsx tools/_dv_prodconn.ts`
//
// 왜: 비밀번호 회전 때 `DATABASE_URL`(6543 런타임)만 고치고 `MIGRATE_DATABASE_URL`(5432)을 빼먹으면
//   **서비스는 멀쩡한데 다음 스키마 변경에서만 `28P01`로 막힌다.** 런타임이 6543만 쓰기 때문에
//   증상이 몇 주 뒤에야 나타나고, 그때는 원인이 회전이었다는 걸 연결짓기 어렵다.
//   2026-08-07 회전에서 실제로 그 상태였다(SERVER_OPS §3.5.2 함정 ②).
//
// 회전 직후 이 가드를 돌리는 게 §3.5.1의 검증 단계다. 온디맨드(배터리 체인 밖 — 운영 DB 왕복).
// 읽기 전용: `select 1`·카운트만. 운영 데이터를 만들지도 지우지도 않는다.
import postgres from 'postgres';
import { readEnv, withSecret, dbRefOf } from './_envsafe.mjs';

const ENV_FILE = '.env.local'; // 운영 크리덴셜 정본(로컬)

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m);
};

/** 기대 포트: 런타임은 트랜잭션 풀러(6543), 마이그레이션은 세션(5432) — BACKEND §13.7 */
const SPEC: Array<{ key: string; port: string; role: string }> = [
  { key: 'DATABASE_URL', port: '6543', role: '런타임(트랜잭션 풀러, prepare:false 필수)' },
  { key: 'MIGRATE_DATABASE_URL', port: '5432', role: '마이그레이션(세션 풀러)' },
];

async function main() {
  console.log('── 운영 DB 연결 점검 ──');
  const env = readEnv(ENV_FILE);
  if (env.size === 0) {
    console.log(`  – SKIP: ${ENV_FILE} 없음(운영 크리덴셜 부재 환경)`);
    console.log('\n결과: SKIP');
    return;
  }

  let ref = '';
  for (const { key, port, role } of SPEC) {
    const url = env.get(key);
    console.log(`\n[${key}] ${role}`);
    if (!url) { ok(false, `${ENV_FILE}에 ${key} 없음`); continue; }

    const actual = (() => { try { return new URL(url).port || '(기본)'; } catch { return '(파싱불가)'; } })();
    ok(actual === port, `포트 ${actual} (기대 ${port})`);
    if (!ref) ref = dbRefOf(url);
    else ok(dbRefOf(url) === ref, `같은 DB 호스트를 가리킴 (${dbRefOf(url)})`);

    // 실접속 — 회전 누락(28P01)을 여기서 잡는다.
    const r = await withSecret(url, async (u: string) => {
      const sql = postgres(u, { max: 1, prepare: false, connect_timeout: 20 });
      const q = await sql`select current_database() as db, (select count(*)::int from users) as n`;
      await sql.end();
      return q[0] as { db: string; n: number };
    });
    ok(r.ok, r.ok
      ? `접속 OK (db=${r.value.db}, users=${r.value.n})`
      : `접속 실패 — ${r.reason}${r.reason === '28P01' ? ' = 비밀번호 불일치. 회전 시 이 줄을 빼먹었는지 확인(SERVER_OPS §3.5.2 함정 ②)' : ''}`);
  }

  console.log('\n※ 배포 반영은 별개다 — Vercel env는 **배포 시점 주입**이라 재배포 전엔 옛 값이 쓰인다.');
  console.log('   운영 /api/health 의 commit 이 방금 배포한 커밋인지, dbRef 가 ' + (ref || '?') + ' 인지 함께 확인할 것.');

  console.log(fail ? `\n결과: FAIL ${fail}건` : '\n결과: PASS');
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('가드 실행 실패:', e?.code ?? e?.name ?? 'error'); // 원문에 연결문자열이 섞일 수 있어 코드만
  process.exit(1);
});
