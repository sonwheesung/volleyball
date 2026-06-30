// INDEPENDENT — 동명이인 방지(dedup) 가드 (FOREIGN_SYSTEM §8, 2026-06-30).
// 버그: 표시 이름이 작은 고정 배열에서 선수마다 독립 추첨돼 한 화면/리그에 동명이인이 흔히 떴다
//   (실기기 관찰: 파울라×2·말리완×2·자오펀×2). 픽스: 풀 확장 + 생성 직후 결정론 dedup(seed.ts dedupeNames).
// 검증: ①초기 리그·트라이아웃 풀·드래프트 클래스 부류별 표시 중복 0  ②A/B 자가검증(dedup 안 하면 중복>0 떠야 — 허위 오라클 차단)
//   ③결정론(같은 입력 두 번 → 같은 이름).
//   npx tsx tools/_dv_name_dedupe.ts
import { generateLeague, dedupeNames } from '../data/seed';
import { generateForeignPool, generateAsianPool } from '../data/tryout';
import { generateDraftClass } from '../data/draftClass';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let ok = true;

const dupCount = (names: string[]) => names.length - new Set(names).size;

// ── (1) 초기 리그 — 부류별(외인/아시아/국내) 표시 중복 0 ──
{
  let allClean = true;
  for (const seed of [1, 7, 42, 100, 2026]) {
    const lg = generateLeague(seed);
    const foreign = lg.players.filter((p) => p.isForeign && !p.isAsianQuota).map((p) => p.name);
    const asian = lg.players.filter((p) => p.isAsianQuota).map((p) => p.name);
    const korean = lg.players.filter((p) => !p.isForeign).map((p) => p.name);
    const d = dupCount(foreign) + dupCount(asian) + dupCount(korean);
    if (d > 0) { allClean = false; log(`  [seed ${seed}] ❌ 중복 ${d}(외인${dupCount(foreign)}·아시아${dupCount(asian)}·국내${dupCount(korean)})`); }
  }
  log(`[초기 리그] 5시드 부류별 동명이인 0: ${allClean ? '✅' : '❌'}`);
  ok = ok && allClean;
}

// ── (2) 트라이아웃 풀 + taken 회피 ──
{
  let clean = true;
  for (const s of [1, 5, 9]) {
    const f = generateForeignPool(s, 70).map((p) => p.name);
    const a = generateAsianPool(s, 70).map((p) => p.name);
    if (dupCount(f) > 0 || dupCount(a) > 0) clean = false;
  }
  // taken 회피: 풀 첫 이름을 taken에 넣으면 그 이름이 풀에서 사라져야
  const base = generateForeignPool(5, 70).map((p) => p.name);
  const withTaken = generateForeignPool(5, 70, base.length, [base[0]]).map((p) => p.name);
  const avoided = !withTaken.includes(base[0]) && dupCount(withTaken) === 0;
  log(`[트라이아웃 풀] 외인·아시아 중복 0: ${clean ? '✅' : '❌'} · taken 이름 회피: ${avoided ? '✅' : '❌'}`);
  ok = ok && clean && avoided;
}

// ── (3) 드래프트 클래스 ──
{
  let clean = true;
  for (const s of [2, 6, 11]) {
    const c = generateDraftClass(s, 30).map((p) => p.name);
    if (dupCount(c) > 0) clean = false;
  }
  log(`[드래프트 클래스] 동명이인 0: ${clean ? '✅' : '❌'}`);
  ok = ok && clean;
}

// ── (4) A/B 자가검증 (허위 오라클 차단) — 일부러 충돌시킨 배치 ──
{
  const mk = (n: number, name: string, kind: 'fgn' | 'asn' | 'kor'): Player[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `x${kind}${i}`, name,
      isForeign: kind !== 'kor', isAsianQuota: kind === 'asn',
    } as unknown as Player));

  const rawF = mk(8, '바네사', 'fgn');
  const rawA = mk(8, '미오', 'asn');
  const rawK = mk(8, '김지우', 'kor');
  const beforeDup = dupCount(rawF.map((p) => p.name)) + dupCount(rawA.map((p) => p.name)) + dupCount(rawK.map((p) => p.name));
  dedupeNames(rawF, 'ab:f'); dedupeNames(rawA, 'ab:a'); dedupeNames(rawK, 'ab:k');
  const afterDup = dupCount(rawF.map((p) => p.name)) + dupCount(rawA.map((p) => p.name)) + dupCount(rawK.map((p) => p.name));
  const sensitive = beforeDup > 0 && afterDup === 0;
  log(`[A/B] 충돌 배치 dedup 전 중복 ${beforeDup}>0 → 후 ${afterDup}=0: ${sensitive ? '✅ (오라클 민감)' : '❌ 허위 오라클'}`);
  ok = ok && sensitive;
}

// ── (5) 결정론 — 같은 입력 두 번 → 같은 이름 ──
{
  const a = generateLeague(77).players.map((p) => p.name).join('|');
  const b = generateLeague(77).players.map((p) => p.name).join('|');
  const det = a === b;
  log(`[결정론] generateLeague(77) 두 번 이름 동일: ${det ? '✅' : '❌'}`);
  ok = ok && det;
}

log(ok ? '\n결론: ✅ 동명이인 방지 + 결정론 + 오라클 민감' : '\n결론: ❌ 점검 필요');
process.exit(ok ? 0 : 1);
