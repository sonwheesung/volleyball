// 얼굴 시트 프리워밍 인덱서 검증 (AVATAR_SYSTEM · UI_RULES UI-45)
//   npx tsx tools/_dv_facewarm.ts
// 검증 2축:
//  ① 리팩터 결정론 보존 — faceSheetSlot(신 단일 산식)이 구 faceCell 인라인 공식과 **완전 동일**(id→시트/칸 불변).
//     src·PNG는 Metro 전용이라 Node에서 못 붙이지만, 배정 산식(faceSheetSlot)은 node-safe라 여기서 대조 가능.
//  ② 워밍 수집 완전성·최소성 — uniqueFaceSheetIndices(ids)가 그 선수들이 **실제 쓸 시트 전부(누락 0)이자 그것뿐**(초과 0).
//     누락=플레이스홀더 잔존 / 초과=불필요 시트 디코드(발열·메모리). 부트 일괄 프리로드가 아님을 보장.
// A/B 자가검증: 변이 수집기(누락·전체34)가 검사에 걸리는지로 검사 민감도 증명(허위 오라클 금지).
import { faceHash } from '../data/playerFace';
import { FACE_SHEET_META, FACE_TOTAL, faceSheetSlot, uniqueFaceSheetIndices } from '../data/faceSheetMeta';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

// ── 독립 오라클: 구 faceCell 인라인 공식을 별도 리터럴(34시트×9, cols/rows 3)로 재구현(리팩터와 무관한 코드 경로) ──
const O_META = Array.from({ length: 34 }, () => ({ cols: 3, rows: 3, count: 9 }));
const O_TOTAL = O_META.reduce((n, s) => n + s.count, 0);
function oracleSlot(id: string): { index: number; col: number; row: number } | null {
  if (O_TOTAL === 0) return null;
  let k = faceHash(id, 'face') % O_TOTAL;
  for (let i = 0; i < O_META.length; i++) {
    if (k < O_META[i].count) return { index: i, col: k % O_META[i].cols, row: Math.floor(k / O_META[i].cols) };
    k -= O_META[i].count;
  }
  return null;
}

// 대량 합성 id(해시 산식 전 구간 자극) + 소수 '풀' id
const N = 20000;
const ids = Array.from({ length: N }, (_, i) => `t${i % 12}-p${i}-${(i * 2654435761) >>> 0}`);

// ── 축 ① 리팩터 결정론 보존: faceSheetSlot === oracle (index·col·row 전부) ──
let slotMismatch = 0;
const usedIdx = new Set<number>();
for (const id of ids) {
  const a = faceSheetSlot(id); const b = oracleSlot(id);
  if (JSON.stringify(a && { index: a.index, col: a.col, row: a.row }) !== JSON.stringify(b)) slotMismatch++;
  if (a) usedIdx.add(a.index);
}
ok(slotMismatch === 0, `faceSheetSlot === 구 인라인 공식 (${N} id, 불일치 ${slotMismatch})`);
ok(FACE_TOTAL === O_TOTAL && FACE_TOTAL === 306, `FACE_TOTAL=306(34시트×9), 메타 length=${FACE_SHEET_META.length}`);
// 20000 id면 34시트 전부 등장(칸 배정 골고루) — 특정 시트 편중 없음의 약한 확인
ok(usedIdx.size === 34, `20000 id가 34시트 전부에 배정됨(사용 시트 ${usedIdx.size}/34)`);

// A/B: 슬롯 대조 민감도 — 드리프트한 리팩터(count 8 오타 흉내)는 오라클과 어긋나야 검사가 유효
function driftedSlot(id: string): { index: number; col: number; row: number } | null {
  const M = Array.from({ length: 34 }, () => ({ cols: 3, rows: 3, count: 8 })); // 결함 주입: 9→8
  const T = M.reduce((n, s) => n + s.count, 0);
  let k = faceHash(id, 'face') % T;
  for (let i = 0; i < M.length; i++) { if (k < M[i].count) return { index: i, col: k % M[i].cols, row: Math.floor(k / M[i].cols) }; k -= M[i].count; }
  return null;
}
const driftDetected = ids.some((id) => JSON.stringify(driftedSlot(id)) !== JSON.stringify(oracleSlot(id)));
ok(driftDetected, 'A/B: 드리프트(count 9→8) 슬롯이 오라클과 달라짐 → 슬롯 대조가 결함을 잡음');

// ── 축 ② 워밍 수집 완전성·최소성 ──
// 화면 규모 풀(예: 트라이아웃 후보 ~14명) — 34시트보다 훨씬 적게 쓰므로 최소성(초과 0)이 의미를 가진다
const pool = Array.from({ length: 14 }, (_, i) => `asn-s${i}-${(i * 40503) >>> 0}`);
const truthPool = [...new Set(pool.map((id) => oracleSlot(id)?.index).filter((x): x is number => x != null))].sort((a, b) => a - b);
const warmPool = uniqueFaceSheetIndices(pool);
ok(JSON.stringify(warmPool) === JSON.stringify(truthPool), `워밍 수집 = 풀이 실제 쓸 시트 정확히(완전+최소): [${warmPool}]`);
ok(warmPool.length <= 34 && warmPool.length < FACE_SHEET_META.length + 1, `풀 워밍은 부분집합(${warmPool.length}시트, 전체 34 미만 가능)`);
// 전체 id로도 완전성(누락 0) 확인
const truthAll = [...usedIdx].sort((a, b) => a - b);
const warmAll = uniqueFaceSheetIndices(ids);
ok(JSON.stringify(warmAll) === JSON.stringify(truthAll), `워밍 수집(대량) = 사용 시트 전부(누락 0)`);

// A/B: 수집 검사 민감도 — 변이 수집기가 완전성/최소성 검사에 걸려야 함
const dropOne = warmPool.slice(1); // 누락(under-warm): 한 시트 뺌
ok(JSON.stringify(dropOne) !== JSON.stringify(truthPool), 'A/B: 누락 수집기(1시트 빠짐) ≠ 정답 → 완전성 검사가 under-warm을 잡음');
const allSheets = Array.from({ length: 34 }, (_, i) => i); // 초과(over-warm): 부트 일괄 프리로드
ok(JSON.stringify(allSheets) !== JSON.stringify(truthPool) && allSheets.length > truthPool.length,
  'A/B: 전체34 수집기(부트 프리로드) ⊋ 정답 → 최소성 검사가 over-warm을 잡음');

console.log(fail === 0 ? '\n✅ 얼굴 시트 워밍 인덱서 검증 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
