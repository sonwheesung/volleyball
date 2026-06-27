// INDEPENDENT — 외인/아시아 트라이아웃 풀 생성 종료 가드 (EDGE_CASES — edge-swarm 클러스터 A, 2026-06-27).
// 버그: data/tryout.ts 풀 생성의 `while(overall(p) < domesticAvg[+2]) p=lift(p,3)`가 무캡인데 lift는 키·체력을
//   안 올려 overall 천장(~89~93)이 존재 → domesticAvg가 천장 근처(≥~87, 장기 인플레/손상·도핑 세이브)면 영구루프=앱 프리즈.
// 픽스: best-effort 반복 캡(60). 검증: ①고 domesticAvg에서 *종료*(옛 무캡은 영원히 안 끝남 = A/B 이빨) ②정상은 바닥 충족·캡 미발동.
//   npx tsx tools/_dv_tryout_pool.ts
import { generateForeignPool, generateAsianPool } from '../data/tryout';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
let ok = true;

// ── (1) 정상 domesticAvg=64: 바닥 완전 충족(캡 미발동) ──
const fN = generateForeignPool(1, 64);
const aN = generateAsianPool(1, 64);
const fFloor = fN.every((p) => overall(p) >= 64 + 2);
const aFloor = aN.every((p) => overall(p) >= 64);
log(`[정상 dom=64] 외인 ${fN.length}명 전원≥66: ${fFloor ? '✅' : '❌'} · 아시아 ${aN.length}명 전원≥64: ${aFloor ? '✅' : '❌'}`);
ok = ok && fFloor && aFloor && fN.length > 0 && aN.length > 0;

// ── (2) 고 domesticAvg=95 (천장 초과): *종료*가 핵심. 이 줄에 도달했다 = 무한루프 아님(옛 무캡은 여기서 영원히 hang) ──
const fH = generateForeignPool(2, 95);
const aH = generateAsianPool(2, 95);
const terminated = fH.length > 0 && aH.length > 0;
log(`[고 dom=95] 종료됨(외인 ${fH.length}·아시아 ${aH.length}): ${terminated ? '✅ (옛 무캡은 영구루프로 여기 도달 불가 = A/B 이빨)' : '❌'}`);
// 천장 초과라 바닥은 best-effort(미달 정상) — 그래도 count는 채워야(풀 크기 보존)
const fSize = fH.length === fN.length, aSize = aH.length === aN.length;
log(`[고 dom=95] 풀 크기 보존(외인 ${fSize}·아시아 ${aSize}): ${fSize && aSize ? '✅' : '❌'}`);
ok = ok && terminated && fSize && aSize;

// ── (3) 극단 domesticAvg=200 (절대 도달 불가): 그래도 종료 ──
const fX = generateForeignPool(3, 200);
log(`[극단 dom=200] 종료됨(${fX.length}명): ${fX.length > 0 ? '✅' : '❌'}`);
ok = ok && fX.length > 0;

log(ok ? '\n결론: ✅ 풀 생성 종료 보장 + 정상 바닥 불변(무한루프 차단)' : '\n결론: ❌ 점검 필요');
process.exit(ok ? 0 : 1);
