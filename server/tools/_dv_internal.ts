// _dv_internal — 내부(운영자) 계정 지표 제외 가드 (BACKEND_SYSTEM §13.30 G)
//
// 무엇을 봉인하나
//   ① 순수 산수 — `lib/adminStats.aggregateUsers`가 내부 계정을 **정확히 그만큼** 빼는가.
//      "대충 줄어든다"가 아니라 **제외분 = 내부 계정이 기여했을 값**임을 실유저 전용 입력과 대조해 증명한다.
//   ② includeInternal 원복 — 포함 모드에서는 제외 전과 **완전히 동일**해야 한다(필터가 다른 걸 건드리지 않았다는 증거).
//   ③ 배선 — 라우트가 순수 모듈을 **실제로 경유**하는가. 함수만 봉인하고 배선을 안 봉인하면
//      "순수 함수는 맞는데 라우트가 자기 루프를 돌고 있다"를 못 잡는다(TEST_METHODOLOGY §4 사각).
//      `_dv_arch [ach-eval]`와 같은 결의 소스 수준 검사.
//   ④ 원장 필터 헬퍼 — `isExcludedUser`가 includeInternal에서 항상 false(=아무도 안 거름)인가.
//
// A/B 자가검증(허위 오라클 금지): `--mutant` 로 돌리면 **필터를 무력화한 사본**으로 같은 검사를 수행한다.
//   그때 ①이 FAIL로 뒤집히지 않으면 이 가드는 아무것도 안 보고 있는 것이다(스스로를 고발).
//
// 실행: npx tsx server/tools/_dv_internal.ts   /   ...  --mutant   (DB 불필요 — 순수)
import { readFileSync } from 'fs';
import { join } from 'path';
import { aggregateUsers, retentionPct, isExcludedUser, type UserRow } from '../lib/adminStats';

const MUTANT = process.argv.includes('--mutant');
let fails = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); fails++; }
};

// ── 고정 시각(결정론) ──
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0); // 2026-08-08 12:00 UTC
const DAY_START = Date.UTC(2026, 7, 8, 0, 0, 0);
const dayKeys: string[] = [];
for (let i = 13; i >= 0; i--) dayKeys.push(new Date(DAY_START - i * 86400000).toISOString().slice(0, 10));

const d = (daysAgo: number, hourUtc = 10) => new Date(DAY_START - daysAgo * 86400000 + hourUtc * 3600000);

/** 실유저 4명 — 가입·최근접속을 서로 다르게 흩어 모든 버킷(신규·DAU·MAU·WAU·비활성·리텐션)이 0이 아니게 만든다. */
const REAL: UserRow[] = [
  { createdAt: d(0), lastSeenAt: d(0), internal: false },   // 오늘 가입·오늘 접속
  { createdAt: d(5), lastSeenAt: d(0), internal: false },   // 5일 전 가입·오늘 접속(D1·D3 생존)
  { createdAt: d(10), lastSeenAt: d(8), internal: false },  // WAU 밖·MAU 안
  { createdAt: d(40), lastSeenAt: d(35), internal: false }, // 비활성(14일+)·MAU 밖
];
/** 내부 계정 2명 — 실유저와 **같은 날짜대**에 두어 "날짜로 우연히 갈리는" 가짜 통과를 막는다. */
const INTERNAL: UserRow[] = [
  { createdAt: d(0), lastSeenAt: d(0), internal: true },
  { createdAt: d(5), lastSeenAt: d(0), internal: true },
];
const MIXED = [...REAL, ...INTERNAL];

const opts = (includeInternal: boolean) => ({ now: NOW, dayStartMs: DAY_START, dayKeys, includeInternal });

/** 변이(mutant): 내부 플래그를 지워 필터가 걸릴 게 없게 만든다 = "제외 로직 무력화"와 동치. */
const feed = (rows: UserRow[]): UserRow[] => (MUTANT ? rows.map((r) => ({ ...r, internal: false })) : rows);

console.log(`\n=== _dv_internal (§13.30) ${MUTANT ? '[MUTANT — ①이 FAIL로 뒤집혀야 정상]' : ''} ===`);

// ── ① 순수 산수: 혼합 입력을 제외하면 실유저 전용 입력과 **완전히 같아야** 한다 ──
console.log('\n[①] 내부 제외 = 실유저 전용과 동일');
const excluded = aggregateUsers(feed(MIXED), opts(false));
const realOnly = aggregateUsers(REAL, opts(false));
ok(excluded.totalUsers === realOnly.totalUsers, `총가입 ${excluded.totalUsers} = 실유저전용 ${realOnly.totalUsers}`);
ok(excluded.dauToday === realOnly.dauToday, `DAU ${excluded.dauToday} = ${realOnly.dauToday}`);
ok(excluded.wau === realOnly.wau && excluded.mau === realOnly.mau, `WAU/MAU ${excluded.wau}/${excluded.mau} = ${realOnly.wau}/${realOnly.mau}`);
ok(excluded.active30m === realOnly.active30m, `active30m ${excluded.active30m} = ${realOnly.active30m}`);
ok(excluded.inactive === realOnly.inactive, `비활성 ${excluded.inactive} = ${realOnly.inactive}`);
ok(JSON.stringify(excluded.newUsers) === JSON.stringify(realOnly.newUsers), '신규가입 14일 시계열 동일');
ok(JSON.stringify(excluded.dau) === JSON.stringify(realOnly.dau), 'DAU 14일 시계열 동일');
ok(JSON.stringify(excluded.hourly) === JSON.stringify(realOnly.hourly), '시간대 분포 동일');
ok([1, 3, 7, 14, 30].every((k) => retentionPct(excluded, k) === retentionPct(realOnly, k)), '리텐션 D1~D30 동일');
ok(excluded.internalExcluded === 2, `internalExcluded=2 (실제 ${excluded.internalExcluded}) — 고지용 카운트`);

// 양성대조(오라클이 살아있음): 실유저 전용 입력 자체가 **비어 있지 않다**. 전부 0이면 위 등호는 공허하게 참이다.
console.log('\n[①-대조] 오라클 비공허성');
ok(realOnly.totalUsers === 4 && realOnly.dauToday === 2 && realOnly.inactive === 1,
  `실유저 기준값 총4·DAU2·비활성1 (실제 ${realOnly.totalUsers}·${realOnly.dauToday}·${realOnly.inactive})`);
ok(retentionPct(realOnly, 1) !== null, 'D1 리텐션이 null 아님(분모 존재)');

// ── ② includeInternal 원복 ──
console.log('\n[②] includeInternal=1이면 포함(원복)');
const included = aggregateUsers(MIXED, opts(true));
ok(included.totalUsers === 6, `총가입 6 (실제 ${included.totalUsers})`);
ok(included.dauToday === 4, `DAU 4 (실제 ${included.dauToday})`);
ok(included.internalExcluded === 0, `포함 모드의 internalExcluded=0 (실제 ${included.internalExcluded})`);

// ── ③ 배선: 집계 라우트가 **전부** 스코프를 경유하는가 ──
//   Phase 1에서 stats만 적용하고 업적·BM·시계열을 빠뜨렸다가 사용자가 화면에서 발견했다.
//   그래서 "새 집계 라우트가 스코프를 안 쓰면 FAIL"을 소스 수준에서 못 박는다.
console.log('\n[③] 집계 라우트 배선(소스 검사)');
const AGG_ROUTES = ['stats', 'achievements', 'series', 'bm'];
for (const name of AGG_ROUTES) {
  const src = readFileSync(join(process.cwd(), `app/api/admin/${name}/route.ts`), 'utf8');
  ok(/from '.*lib\/internalScope'/.test(src), `${name}: lib/internalScope를 import`);
  ok(/internalScope\(req\)/.test(src), `${name}: internalScope(req)로 스코프 생성`);
  ok(/internalMeta\(/.test(src), `${name}: 응답에 internalMeta 고지 포함`);
  // 스코프를 만들어놓고 **쓰지 않는** 구멍 차단 — 제외 조건이든 필터든 최소 한 번은 써야 한다.
  ok(/isExcluded\(scope|users\.internal, false|eq\(users\.internal/.test(src) || /notInArray\(walletLedger\.userId/.test(src),
    `${name}: 스코프를 실제 집계에 적용(제외 조건 또는 isExcluded 사용)`);
}
const statsSrc = readFileSync(join(process.cwd(), 'app/api/admin/stats/route.ts'), 'utf8');
ok(/from '.*lib\/adminStats'/.test(statsSrc), 'stats: 순수 집계 모듈 lib/adminStats를 import');
ok(/aggregateUsers\(/.test(statsSrc), 'stats: aggregateUsers 호출(자체 루프로 되돌아가지 않음)');
// 회귀 방지: 예전 인라인 루프의 흔적(`totalUsers++`)이 라우트에 되살아나면 배선이 우회된 것.
ok(!/totalUsers\+\+/.test(statsSrc), 'stats: 인라인 유저 카운트 루프가 없음');
// 스코프 진실이 두 곳으로 갈라지는 것 차단 — 라우트가 자기 손으로 internal id 쿼리를 만들면 안 된다.
for (const name of AGG_ROUTES) {
  const src = readFileSync(join(process.cwd(), `app/api/admin/${name}/route.ts`), 'utf8');
  ok(!/new Set\(\s*\w*[Ii]nternalRows/.test(src), `${name}: 자체 internalIds Set을 만들지 않음(스코프 단일 출처)`);
}
const usersSrc = readFileSync(join(process.cwd(), 'app/api/admin/users/route.ts'), 'utf8');
ok(/export async function PATCH/.test(usersSrc), 'users 라우트에 내부 표시 PATCH 존재');
ok(/users\.internal/.test(usersSrc), 'users 라우트가 internal 컬럼을 다룸');
// 개별 레코드 목록은 **제외하지 않는 게 설계**(운영자가 내부 계정 행을 봐야 한다, §13.30 적용 경계).
ok(!/internalScope\(req\)/.test(usersSrc), 'users 목록은 내부 계정을 숨기지 않음(설계 — 표시만 한다)');

// ── ④ 원장 필터 헬퍼 ──
console.log('\n[④] isExcludedUser 계약(순수 모듈)');
const ids = new Set(['u-int']);
ok(isExcludedUser('u-int', ids, false) === true, '내부 id는 제외(기본 모드)');
ok(isExcludedUser('u-real', ids, false) === false, '실유저 id는 통과');
ok(isExcludedUser('u-int', ids, true) === false, 'includeInternal이면 아무도 안 거름');

console.log(`\n=== ${fails === 0 ? 'PASS' : `FAIL ${fails}건`} ===`);
if (MUTANT) {
  // 변이 모드의 성공 조건은 **실패**다. 여기서 통과해 버리면 가드가 장님이라는 뜻.
  console.log(fails > 0
    ? '✅ A/B 민감도 확인 — 필터 무력화가 ①에서 검출됨(가드가 실제로 보고 있음)'
    : '❌ A/B 실패 — 필터를 무력화했는데도 통과했다. 이 가드는 무의미하다.');
  process.exit(fails > 0 ? 0 : 1);
}
process.exit(fails === 0 ? 0 : 1);
