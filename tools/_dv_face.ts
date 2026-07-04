// 선수 아바타 피처 검증 (AVATAR_SYSTEM, 2026-07-04) — faceFeatures가 id 시드 결정론이고 골고루 변형되는지.
//   npx tsx tools/_dv_face.ts
import { faceFeatures, SKIN, HAIR, BG, HAIR_STYLES } from '../data/playerFace';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

const ids = Array.from({ length: 400 }, (_, i) => `t${i % 7}-p${i}`);

// 결정론
ok(ids.every((id) => JSON.stringify(faceFeatures(id)) === JSON.stringify(faceFeatures(id))), '같은 id → 같은 피처(결정론)');

// 변형 분포
const style: Record<number, number> = {}, skin = new Set<string>(), hair = new Set<string>(), bg = new Set<string>();
for (const id of ids) { const f = faceFeatures(id); style[f.style] = (style[f.style] ?? 0) + 1; skin.add(f.skin); hair.add(f.hair); bg.add(f.bg); }
console.log('  style 분포:', style, '| skin', skin.size, '| hair', hair.size, '| bg', bg.size);
ok(Object.keys(style).length === HAIR_STYLES, `헤어스타일 ${HAIR_STYLES}종 전부 등장`);
ok(skin.size === SKIN.length, `피부 ${SKIN.length}종 전부 등장`);
ok(hair.size === HAIR.length, `헤어색 ${HAIR.length}종 전부 등장`);
ok(bg.size === BG.length, `배경 ${BG.length}종 전부 등장`);
// 한 스타일이 60% 넘게 몰리지 않음(편향 가드)
ok(Math.max(...Object.values(style)) / ids.length < 0.4, '특정 스타일 편중 없음(<40%)');

console.log(fail === 0 ? '\n✅ 아바타 피처 검증 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
