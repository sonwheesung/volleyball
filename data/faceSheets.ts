// 실제 얼굴 스프라이트 시트(크로마키 초록 제거된 투명 PNG) — id 해시로 칸 배정 → 같은 선수=같은 얼굴.
// ※ 이 파일은 require('*.png')를 포함해 **Metro 전용**(Node/tsx에서 import 금지 — 가드는 playerFace만 임포트).
// 시트 추가 = 아래 배열에 push + count. 시트 초과 id는 절차적 아바타(faceFeatures)로 폴백 — 무한 세대교체 안전.
import { faceHash } from './playerFace';

interface FaceSheet { src: number; cols: number; rows: number; count: number }
// 화풍: 고품질 반실사(2026-07-05 사용자 재선택). ~~반실사 애니풍 시트 1~14(350명)~~ 전량 폐기하고 이 톤으로 재시작.
export const FACE_SHEETS: FaceSheet[] = [
  { src: require('../assets/players/faces1.png'), cols: 5, rows: 5, count: 25 },
];
const TOTAL_FACES = FACE_SHEETS.reduce((n, s) => n + s.count, 0);

export interface FaceCell { src: number; cols: number; rows: number; col: number; row: number }
/** 선수 id → 시트 칸(없으면 null=절차적 폴백). */
export function faceCell(id: string): FaceCell | null {
  if (TOTAL_FACES === 0) return null;
  let k = faceHash(id, 'face') % TOTAL_FACES;
  for (const s of FACE_SHEETS) {
    if (k < s.count) return { src: s.src, cols: s.cols, rows: s.rows, col: k % s.cols, row: Math.floor(k / s.cols) };
    k -= s.count;
  }
  return null;
}
