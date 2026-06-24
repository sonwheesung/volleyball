// 구단 정체성 recentRanks 정합성 — 각 시즌(열)이 그 시즌 존재 팀들의 순위 1..N 유일 순열인가.
// 신생팀(expansion)은 시즌 수가 짧아 일부 시즌엔 부재 → 그 시즌은 존재 팀 수만큼의 순열이어야.
// 사용: npx tsx tools/checkClubRanks.ts
import { CLUB_IDENTITIES } from '../data/clubIdentity';
import { TEAM_NAMES } from '../data/names';

const log = (m: string) => process.stdout.write(m + '\n');
const N = TEAM_NAMES.length;
// 팀 i → 정체성(순환). recentRanks는 정체성에 붙어 있다.
const ids = Array.from({ length: N }, (_, i) => CLUB_IDENTITIES[i % CLUB_IDENTITIES.length]);
const maxLen = Math.max(...ids.map((d) => d.recentRanks.length));

let bad = 0;
for (let s = 0; s < maxLen; s++) {
  const present = ids.filter((d) => s < d.recentRanks.length);
  const ranks = present.map((d) => d.recentRanks[s]);
  const want = present.length; // 그 시즌 존재 팀 수 → 1..want 순열이어야
  const sorted = [...ranks].sort((a, b) => a - b);
  const expect = Array.from({ length: want }, (_, k) => k + 1);
  const ok = sorted.length === want && sorted.every((v, k) => v === expect[k]);
  // 중복/결손 진단
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const dups = [...counts.entries()].filter(([, c]) => c > 1).map(([r, c]) => `순위${r}×${c}`);
  const missing = expect.filter((e) => !ranks.includes(e));
  log(`시즌 -${s} (팀 ${want}): [${ranks.join(',')}] → ${ok ? '✅ 유효 순열' : `❌ ${dups.length ? '중복 ' + dups.join('·') : ''}${missing.length ? ' 결손 ' + missing.join(',') : ''}`}`);
  if (!ok) bad++;
}
log('');
log(bad === 0 ? '✅ 전 시즌 순위 = 유효 순열(중복/결손 0)' : `❌ ${bad}개 시즌 순위 불량 — recentRanks가 아키타입별 비조율 작성됨`);

// ── 형제 불변식(같은 클래스: 아키타입별 독립 작성 + 교차 팀 제약) ──
// strengthBias 합 = 0(주석 주장: 리그 평균 전력 보존·대칭). N==아키타입수면 1:1.
const biasSum = ids.reduce((s, d) => s + d.strengthBias, 0);
const biasOk = Math.abs(biasSum) < 1e-9;
log(`strengthBias 합 = ${biasSum.toFixed(2)} → ${biasOk ? '✅ 0(평균 전력 보존)' : '❌ 비대칭(리그 평균 전력 깨짐)'}`);

const allOk = bad === 0 && biasOk;
log(allOk ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(allOk ? 0 : 1);
