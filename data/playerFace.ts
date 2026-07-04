// 선수 얼굴 아바타 — 선수 id를 시드로 결정론 '피처'(피부·헤어스타일·헤어색·눈·입·배경)를 뽑는다.
// 실제 그리기는 components/PlayerAvatar.tsx(react-native-svg, 온브랜드 배구선수 — 여자부 톤·유니폼).
// 저장 없음(id→피처 재계산). 100시즌+ 세대교체로 이름이 바뀌어도 id 고정 → 얼굴 안정.
// ※ 채택 경위(2026-07-04, 유대감 1순위): 회색 아이콘 → (multiavatar 장난톤/성별섞임 반려) → 온브랜드 레이어 아바타(B).

// 팔레트 (여자 V리그 톤). 인덱스는 id 해시로 결정.
export const SKIN = ['#F4CDA6', '#EBB88E', '#DCA074', '#C08658', '#9C6A44'];
export const HAIR = ['#241C18', '#3E2C1E', '#5A4230', '#7A5236', '#A24A3A', '#33384A', '#6B4E7A'];
export const BG = ['#D9E6F4', '#E7DCF4', '#F4DCE7', '#DCF2E6', '#F4ECD9', '#DDEEF0'];
export const HAIR_STYLES = 5; // 0 롱스트레이트 · 1 포니테일 · 2 단발 · 3 번(올림) · 4 숏뱅
export const EYE_STYLES = 3;
export const MOUTH_STYLES = 3;

export interface FaceFeatures {
  skin: string; hair: string; bg: string;
  style: number; eyes: number; mouth: number;
}

// djb2 계열 시드 해시(id+salt) — salt로 독립 인덱스를 여러 개 뽑는다.
export function faceHash(id: string, salt: string): number {
  return hash(id, salt);
}
function hash(id: string, salt: string): number {
  let h = 5381;
  const s = id + '|' + salt;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

const cache = new Map<string, FaceFeatures>();

/** 선수 id → 결정론 얼굴 피처. */
export function faceFeatures(id: string): FaceFeatures {
  const hit = cache.get(id);
  if (hit) return hit;
  const pick = (salt: string, n: number) => hash(id, salt) % n;
  const f: FaceFeatures = {
    skin: SKIN[pick('skin', SKIN.length)],
    hair: HAIR[pick('hair', HAIR.length)],
    bg: BG[pick('bg', BG.length)],
    style: pick('style', HAIR_STYLES),
    eyes: pick('eyes', EYE_STYLES),
    mouth: pick('mouth', MOUTH_STYLES),
  };
  cache.set(id, f);
  return f;
}
