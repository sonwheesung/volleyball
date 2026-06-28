// 선수 얼굴 포트레이트 풀 — 선수 id 해시로 결정론 배정(같은 선수 = 항상 같은 얼굴, 저장 불필요).
// 이름은 이미지에 박지 않는다(이름은 화면 텍스트가 표시) — 100시즌+ 세대교체로 이름이 계속 바뀌므로
// 얼굴 이미지는 이름과 무관한 풀에서 돌려 쓴다(2026-06-28, 선수 정보 화면 시안).
//
// 사용법: assets/players/ 에 정사각 포트레이트(앞/측면 얼굴)를 넣고 아래 FACES에 require를 추가하면
// 자동으로 풀에 들어간다. 풀이 비어 있으면 화면은 기본 인물 아이콘으로 폴백한다(빈 상태 안전).

const FACES: number[] = [
  // require('../assets/players/f01.png'),
  // require('../assets/players/f02.png'),
  // ... 원하는 만큼 추가
];

// 작은 결정론 해시(djb2 계열) — id 문자열 → 풀 인덱스
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

/** 선수 id에 배정된 얼굴(없으면 null → 아이콘 폴백) */
export function faceFor(id: string): number | null {
  return FACES.length ? FACES[hashId(id) % FACES.length] : null;
}

export const FACE_POOL_SIZE = FACES.length;
