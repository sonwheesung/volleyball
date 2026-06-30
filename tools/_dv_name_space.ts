// INDEPENDENT — 절차적 이름 생성 공간 가드 (FOREIGN_SYSTEM §8 A', 2026-06-30).
// 사용자 지적: 고정 완성-이름 리스트는 유한→100시즌+ 고갈/반복. 픽스: 음절 조합 절차 생성(genKoreanName/genForeignName/
//   genAsianIdentity). 검증: ①대량 생성 시 고유 이름 수가 옛 리스트(수십)를 압도(절차성 입증) ②결정론 ③국적 전수 ④육안 샘플.
//   npx tsx tools/_dv_name_space.ts
import { genKoreanName, genForeignName, genAsianIdentity, ASIAN_NATS } from '../data/names';

const log = (m: string) => process.stdout.write(m + '\n');
let ok = true;
const N = 20000;

// ── 국내 ──
{
  const set = new Set<string>();
  for (let i = 0; i < N; i++) set.add(genKoreanName(`k${i}`));
  const pass = set.size > 5000;
  log(`[국내] ${N}개 생성 → 고유 ${set.size} (>5000: ${pass ? '✅' : '❌'})`);
  log(`  샘플: ${Array.from({ length: 24 }, (_, i) => genKoreanName(`s${i}`)).join(' ')}`);
  ok = ok && pass;
}
// ── 외국인 ──
{
  const set = new Set<string>();
  for (let i = 0; i < N; i++) set.add(genForeignName(`f${i}`));
  const pass = set.size > 1000;
  log(`[외국인] ${N}개 생성 → 고유 ${set.size} (>1000: ${pass ? '✅' : '❌'})`);
  log(`  샘플: ${Array.from({ length: 24 }, (_, i) => genForeignName(`s${i}`)).join(' ')}`);
  ok = ok && pass;
}
// ── 아시아쿼터 (국적 전수 + 고유) ──
{
  const set = new Set<string>();
  const nats = new Set<string>();
  for (let i = 0; i < N; i++) { const a = genAsianIdentity(`a${i}`); set.add(a.name); nats.add(a.nat); }
  const allNats = ASIAN_NATS.every((n) => nats.has(n));
  const pass = set.size > 150 && allNats;
  log(`[아시아] ${N}개 생성 → 고유 ${set.size} (>150: ${set.size > 150 ? '✅' : '❌'}) · 국적 전수(${nats.size}/${ASIAN_NATS.length}): ${allNats ? '✅' : '❌'}`);
  log(`  샘플: ${Array.from({ length: 16 }, (_, i) => { const a = genAsianIdentity(`s${i}`); return `${a.name}(${a.nat})`; }).join(' ')}`);
  ok = ok && pass;
}
// ── 결정론 ──
{
  const det = genKoreanName('z') === genKoreanName('z')
    && genForeignName('z') === genForeignName('z')
    && genAsianIdentity('z').name === genAsianIdentity('z').name;
  log(`[결정론] 같은 id 두 번 동일: ${det ? '✅' : '❌'}`);
  ok = ok && det;
}

log(ok ? '\n결론: ✅ 절차적 생성(공간 수천~수만)·고갈 없음·결정론·국적 전수' : '\n결론: ❌ 점검 필요');
process.exit(ok ? 0 : 1);
