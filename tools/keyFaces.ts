// 얼굴 시트 크로마키(초록 배경) 제거 — 아바타 파이프라인 전처리(오프라인, 앱과 무관).
//   npx tsx tools/keyFaces.ts <입력.png> <출력.png>
// ※ sharp는 전처리 전용(런타임 아님) — 없으면: npm install --no-save sharp
// 파라미터 고정 = 모든 배치가 정확히 같은 투명도/디스필로 처리(화풍 흔들림 방지, AVATAR_SYSTEM).
// 파라미터 유래: faces1(2026-07-05) 순수그린 배경(RGB~33,250,15)에서 검증한 값.
//   - green: 배경만 제거(g가 크고 r·b가 확실히 작을 때) → 틸 유니폼(g-b 작음)·검은머리·피부 보존.
//   - white: 순백 반사/여백 제거.
//   - despill: 머리·피부 가장자리의 초록 스필을 눌러 후광 제거.
import sharp from 'sharp';

// 튜닝 대상이 아니라 "재현" 대상 — 바꾸면 기존 faces*.png와 톤이 어긋난다. 변경 시 전량 재처리.
export const KEY = { gMin: 110, dGR: 45, dGB: 45, whiteMin: 235, spillD: 14, spillAdd: 10 };

export async function keyFaces(inPath: string, outPath: string): Promise<number> {
  const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const green = g > KEY.gMin && g - r > KEY.dGR && g - b > KEY.dGB;
    const white = r > KEY.whiteMin && g > KEY.whiteMin && b > KEY.whiteMin;
    if (green || white) { data[i + 3] = 0; cleared++; }
    else if (g > r && g > b && g - Math.max(r, b) > KEY.spillD) {
      const mx = Math.max(r, b); data[i + 1] = Math.min(g, mx + KEY.spillAdd); // 초록 스필 억제
    }
  }
  await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(outPath);
  return cleared / (W * H);
}

if (require.main === module) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error('usage: npx tsx tools/keyFaces.ts <in.png> <out.png>'); process.exit(1); }
  keyFaces(inPath, outPath).then((pct) => { console.log(`✓ ${outPath} (배경제거 ${(pct * 100).toFixed(1)}%)`); })
    .catch((e) => { console.error('FAIL', e.message); process.exit(1); });
}
