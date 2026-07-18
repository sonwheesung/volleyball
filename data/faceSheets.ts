// 실제 얼굴 스프라이트 시트(크로마키 초록 제거된 투명 PNG) — id 해시로 칸 배정 → 같은 선수=같은 얼굴.
// ※ 이 파일은 require('*.png')를 포함해 **Metro 전용**(Node/tsx에서 import 금지 — 가드는 playerFace만 임포트).
// 시트 추가 = 아래 배열에 push + count. 시트 초과 id는 절차적 아바타(faceFeatures)로 폴백 — 무한 세대교체 안전.
import { faceHash } from './playerFace';

interface FaceSheet { src: number; cols: number; rows: number; count: number }
// 화풍 재정비(2026-07-05 사용자): 기존 시트 전량 제거 후 새 **클린 반실사 3×3** 시트로 재구축.
// 시트 없으면 faceCell=null → PlayerAvatar가 절차적 아바타로 폴백(회색 아이콘 아님).
// faces1: GPT 생성 3×3(9명), 크로마키 초록 제거된 투명 PNG. 화풍 = 한국 웹툰 반실사·틸 민소매.
export const FACE_SHEETS: FaceSheet[] = [
  { src: require('../assets/players/faces1.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces2.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces3.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces4.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces5.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces6.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces7.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces8.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces9.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces10.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces11.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces12.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces13.png'), cols: 3, rows: 3, count: 9 },
  { src: require('../assets/players/faces14.png'), cols: 3, rows: 3, count: 9 },
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
