// _dv_opsrefresh — 운영 콘솔 새로고침 계약 가드 (BACKEND_SYSTEM §13.15)
//
// 왜 필요한가: 이 버튼의 고장은 **조용하다.** 눌러도 아무 일이 안 일어나는데 화면은 멀쩡해 보여서,
//   운영자가 **낡은 숫자를 최신으로 착각**하게 만든다(2026-08-08 사용자 발견: "버튼은 아무 동작이 없다").
//   실제 원인은 두 겹이었다 —
//     ⓐ `load()`가 공통 6종만 갱신하고 **탭별 데이터(업적·오프시즌·BM·광고·시계열)는 그대로**였다.
//        탭들은 각자 `useEffect(..., [api, ...])`로 부르는데, `api` 참조가 안 바뀌니 재실행되지 않았다.
//     ⓑ `load()`를 await 안 하고 즉시 '새로고침됨' 토스트 → **데이터가 오기도 전에 "끝났다"는 거짓 신호**.
//   둘 다 소스 수준에서만 드러나는 배선 결함이라 구조 가드로 봉인한다(런타임 테스트로는 잡기 어렵다).
//
//   ① `api`가 `nonce`에 의존 — 이게 탭 전체 재조회의 유일한 지렛대
//   ② 새로고침이 `nonce`를 올린다
//   ③ `load()`를 **await 한 뒤** 토스트(거짓 완료 신호 금지)
//   ④ 최초 로드 useEffect에 **1회 가드** — 없으면 nonce 변경마다 공통 6종이 이중 호출된다
//   ⑤ 버튼이 진행 상태를 **보여준다**(disabled + 라벨 전환) — 시각 피드백 0이 최초 신고 사유였다
//   ⑥ 연타 차단
//   ⑦ 탭들이 `[api]` 의존을 유지 — 이걸 떼면 ①이 무력화된다(지렛대 상실)
//
// A/B: `--mutant` 는 소스에서 nonce 의존을 지운 사본으로 검사 → ①이 FAIL 로 뒤집혀야 한다.
//
// 실행: npx tsx server/tools/_dv_opsrefresh.ts   /   ... --mutant   (DB 불필요 — 순수 소스 검사)
import { readFileSync } from 'fs';
import { join } from 'path';

const MUTANT = process.argv.includes('--mutant');
let fails = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); fails++; }
};

const PAGE = join(__dirname, '..', 'app', 'ops-9f3a2c', 'page.tsx');
let src = readFileSync(PAGE, 'utf8');
// 변이: api의 nonce 의존을 제거 = "탭이 재조회되지 않는" 원래 버그 재현.
if (MUTANT) src = src.replace('apiCall(p, token, init), [token, nonce]);', 'apiCall(p, token, init), [token]);');

console.log(`\n=== _dv_opsrefresh (§13.15 새로고침 계약) ${MUTANT ? '[MUTANT — ①이 FAIL로 뒤집혀야 정상]' : ''} ===`);

console.log('\n[①] api가 nonce에 의존(탭 전체 재조회 지렛대)');
ok(/apiCall\(p, token, init\), \[token, nonce\]\)/.test(src), 'useCallback 의존성에 nonce 포함');

console.log('\n[②~⑥] 새로고침 동작');
const refreshFn = src.match(/const doRefresh = useCallback\(async \(\) => \{[\s\S]*?\}, \[load\]\);/)?.[0] ?? '';
ok(refreshFn.length > 0, 'doRefresh 존재');
ok(/setNonce\(\(n\) => n \+ 1\)/.test(refreshFn), '② nonce를 올린다(탭 재조회 트리거)');
ok(/await load\(\)[\s\S]*flash\(/.test(refreshFn), '③ load()를 await한 **뒤** 토스트(거짓 완료 신호 금지)');
ok(/refreshingRef\.current\) return/.test(refreshFn), '⑥ 연타 차단');
ok(/bootedRef\.current\) return; bootedRef\.current = true/.test(src), '④ 최초 로드 1회 가드(nonce 변경 시 이중 호출 방지)');
const btn = src.match(/<button className="oc-btn ghost sm refreshbtn"[\s\S]*?<\/button>/)?.[0] ?? '';
ok(btn.length > 0, '⑤ 새로고침 버튼에 refreshbtn 클래스(폭 고정)');
ok(/onClick=\{doRefresh\}/.test(btn), '⑤ 버튼이 doRefresh를 호출(인라인 load() 직접 호출 아님)');
ok(/disabled=\{refreshing\}/.test(btn), '⑤ 진행 중 비활성');
ok(/불러오는 중/.test(btn), '⑤ 진행 중 라벨 전환(시각 피드백)');
ok(/min-width:118px/.test(src), '⑤ 폭 고정 — 라벨이 바뀌어도 헤더가 안 밀린다');
// 회귀 방지: 예전의 "await 없이 즉시 토스트" 형태가 되살아나면 FAIL.
ok(!/onClick=\{\(\) => \{ load\(\); flash\(/.test(src), '구 형태(load(); flash())가 되살아나지 않음');

console.log('\n[⑦] 탭들이 [api] 의존을 유지(①의 지렛대가 실제로 작동)');
const apiDeps = (src.match(/\}, \[api[,\]]/g) ?? []).length;
ok(apiDeps >= 15, `useEffect가 api를 의존성에 둔 곳 ${apiDeps}개(≥15 기대 — 여기가 줄면 새로고침이 그만큼 안 닿는다)`);

console.log(`\n=== ${fails === 0 ? 'PASS' : `FAIL ${fails}건`} ===`);
if (MUTANT) {
  console.log(fails > 0
    ? '✅ A/B 민감도 확인 — nonce 의존 제거가 ①에서 검출됨(탭이 재조회되지 않는 원래 버그를 이 가드가 잡는다)'
    : '❌ A/B 실패 — 변이를 넣었는데 통과했다. 이 가드는 무의미하다.');
  process.exit(fails > 0 ? 0 : 1);
}
process.exit(fails === 0 ? 0 : 1);
