// _dv_kst — 운영 지표 시간대 KST 계약 가드 (BACKEND_SYSTEM §13.15)
//
// 왜 필요한가: 시간대 오류는 **화면이 멀쩡해 보인다.** 막대는 그려지고 숫자도 나오는데 9시간 밀려서,
//   운영자가 유저의 이용 시간대를 정반대로 읽는다(2026-08-08 사용자 발견 — 저녁 19시 접속이 10시 칸에 찍혔다).
//   같은 뿌리로 "오늘" 경계가 UTC 자정 = **KST 오전 9시**여서, 밤 11시 가입이 다음 날 신규로 넘어갔다.
//
//   ① `kstHour` — UTC 시가 아니라 KST 시(경계 케이스 포함)
//   ② `kstYmd`  — KST 달력일. **UTC 자정~09:00 구간에서 UTC 날짜와 갈린다**(여기가 실제 버그 지대)
//   ③ `kstDayStart` — "오늘 00:00 KST"의 UTC 순간 = 전날 15:00Z
//   ④ 배선 — stats/adminStats/series 가 KST 헬퍼를 경유(UTC 원형이 되살아나면 FAIL)
//   ⑤ statsDaily 라이터도 KST(읽기만 KST면 매출 일자가 어긋난다 — 읽기·쓰기 대칭)
//
// A/B: `--mutant` 는 KST 오프셋을 0으로 본 기대값으로 검사 → ①②③이 FAIL 로 뒤집혀야 한다.
//
// 실행: npx tsx server/tools/_dv_kst.ts   /   ... --mutant   (DB 불필요 — 순수)
import { readFileSync } from 'fs';
import { join } from 'path';
import { kstYmd, kstMd, kstHour, kstDayStart, kstDayStartOf } from '../lib/dates';

const MUTANT = process.argv.includes('--mutant');
const OFF = MUTANT ? 0 : 9; // 변이: KST 오프셋이 0이라고 가정한 기대값(=UTC 그대로)
let fails = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); fails++; }
};
const at = (iso: string) => new Date(iso);
const expHour = (utcH: number) => (utcH + OFF) % 24;

console.log(`\n=== _dv_kst (§13.15 지표 시간대) ${MUTANT ? '[MUTANT — ①②③이 FAIL로 뒤집혀야 정상]' : ''} ===`);

console.log('\n[①] kstHour — KST 시');
ok(kstHour(at('2026-08-08T10:17:00Z')) === expHour(10), `10:17Z → ${expHour(10)}시 (실측 ${kstHour(at('2026-08-08T10:17:00Z'))}) — 실유저 저녁 접속`);
ok(kstHour(at('2026-08-08T12:00:00Z')) === expHour(12), `12:00Z → ${expHour(12)}시 (실측 ${kstHour(at('2026-08-08T12:00:00Z'))}) — 밤 9시`);
ok(kstHour(at('2026-08-08T15:00:00Z')) === expHour(15), `15:00Z → ${expHour(15)}시 (실측 ${kstHour(at('2026-08-08T15:00:00Z'))}) — **자정 넘김**(24 랩어라운드)`);
ok(kstHour(at('2026-08-08T23:30:00Z')) === expHour(23), `23:30Z → ${expHour(23)}시 (실측 ${kstHour(at('2026-08-08T23:30:00Z'))}) — 오전 8시반`);

console.log('\n[②] kstYmd — KST 달력일 (UTC 00:00~09:00 구간이 진짜 버그 지대)');
ok(kstYmd(at('2026-08-08T15:00:00Z')) === (MUTANT ? '2026-08-08' : '2026-08-09'),
  `15:00Z → ${MUTANT ? '08-08' : '08-09'} (실측 ${kstYmd(at('2026-08-08T15:00:00Z'))}) — KST 자정 직후는 **다음 날**`);
ok(kstYmd(at('2026-08-08T14:59:59Z')) === '2026-08-08', `14:59:59Z → 08-08 (경계 직전, 실측 ${kstYmd(at('2026-08-08T14:59:59Z'))})`);
ok(kstYmd(at('2026-08-08T02:00:00Z')) === '2026-08-08', `02:00Z → 08-08 (KST 오전 11시)`);
ok(kstMd(at('2026-08-08T15:00:00Z')) === (MUTANT ? '08-08' : '08-09'), 'kstMd 도 같은 규약');

console.log('\n[③] kstDayStart — 오늘 00:00 KST 의 UTC 순간 = 전날 15:00Z');
const ds = kstDayStart(at('2026-08-08T12:00:00Z'));
ok(ds.toISOString() === (MUTANT ? '2026-08-08T00:00:00.000Z' : '2026-08-07T15:00:00.000Z'),
  `기준 08-08T12:00Z → dayStart ${MUTANT ? '08-08T00:00Z' : '08-07T15:00Z'} (실측 ${ds.toISOString()})`);
ok(kstDayStartOf('2026-08-08').toISOString() === (MUTANT ? '2026-08-08T00:00:00.000Z' : '2026-08-07T15:00:00.000Z'),
  'kstDayStartOf 도 동일');
// 불변식: dayStart 는 항상 그 시각보다 과거이고 24시간 이내다(어떤 오프셋이든 성립 — 산수 자체의 온전성 대조)
const now = at('2026-08-08T02:00:00Z'); const d2 = kstDayStart(now).getTime();
ok(d2 <= now.getTime() && now.getTime() - d2 < 86400000, '불변식: 0 ≤ (now − dayStart) < 24h');

console.log('\n[④] 배선 — 라우트가 KST 헬퍼를 경유');
const stats = readFileSync(join(__dirname, '..', 'app/api/admin/stats/route.ts'), 'utf8');
ok(/from '.*lib\/dates'/.test(stats), 'stats: lib/dates import');
ok(/kstDayStart\(\)/.test(stats), 'stats: dayStart 가 KST');
ok(!/dayStart\.setUTCHours\(0, 0, 0, 0\)/.test(stats), 'stats: 구 UTC 자정 경계가 되살아나지 않음');
const agg = readFileSync(join(__dirname, '..', 'lib/adminStats.ts'), 'utf8');
ok(/kstHour\(r\.lastSeenAt\)/.test(agg), 'adminStats: hourly 가 KST 시');
ok(!/getUTCHours\(\)/.test(agg), 'adminStats: getUTCHours 잔존 없음');
const ser = readFileSync(join(__dirname, '..', 'app/api/admin/series/route.ts'), 'utf8');
ok(/const utc = \(kstWall: number\) => kstWall - KST_MS/.test(ser), 'series: 버킷 경계를 KST 벽시계에서 계산 후 UTC 순간으로 환산');

console.log('\n[⑤] statsDaily 라이터도 KST(읽기·쓰기 대칭)');
const rc = readFileSync(join(__dirname, '..', 'lib/revenuecat.ts'), 'utf8');
ok(/const day = kstYmd\(\)/.test(rc), 'revenuecat: 매출 일자 = KST 달력일');
const ret = readFileSync(join(__dirname, '..', 'lib/retention.ts'), 'utf8');
ok(/AT TIME ZONE 'Asia\/Seoul'/.test(ret), 'retention 롤업 SQL: Asia/Seoul');
ok(!/AT TIME ZONE 'UTC'\)::date/.test(ret), 'retention: 구 UTC 일자 산출 잔존 없음');

console.log(`\n=== ${fails === 0 ? 'PASS' : `FAIL ${fails}건`} ===`);
if (MUTANT) {
  console.log(fails > 0
    ? '✅ A/B 민감도 확인 — 오프셋 0 가정에서 ①②③이 FAIL(=9시간 밀림을 이 가드가 실제로 잰다)'
    : '❌ A/B 실패 — 오프셋을 0으로 봐도 통과했다. 이 가드는 시간대를 안 보고 있다.');
  process.exit(fails > 0 ? 0 : 1);
}
process.exit(fails === 0 ? 0 : 1);
