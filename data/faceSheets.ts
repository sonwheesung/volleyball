// 실제 얼굴 스프라이트 시트(크로마키 초록 제거된 투명 PNG) — id 해시로 칸 배정 → 같은 선수=같은 얼굴.
// ※ 이 파일은 require('*.png')를 포함해 **Metro 전용**(Node/tsx에서 import 금지 — 가드는 faceSheetMeta/playerFace만 임포트).
// 시트 추가 = 아래 FACE_SRC에 push + faceSheetMeta.FACE_SHEET_META length 증가(둘 길이 일치 검사). 시트 초과 id는 절차적 아바타(faceFeatures)로 폴백.
import { FACE_SHEET_META, FACE_TOTAL, faceSheetSlot, uniqueFaceSheetIndices } from './faceSheetMeta';

// 화풍 재정비(2026-07-05 사용자): 기존 시트 전량 제거 후 새 **클린 반실사 3×3** 시트로 재구축.
// 시트 없으면 faceCell=null → PlayerAvatar가 절차적 아바타로 폴백(회색 아이콘 아님).
// 격자·수용(cols/rows/count)은 faceSheetMeta가 단일 소스 — 여기선 시트 순서대로 src(require)만 공급.
const FACE_SRC: number[] = [
  require('../assets/players/faces1.png'),
  require('../assets/players/faces2.png'),
  require('../assets/players/faces3.png'),
  require('../assets/players/faces4.png'),
  require('../assets/players/faces5.png'),
  require('../assets/players/faces6.png'),
  require('../assets/players/faces7.png'),
  require('../assets/players/faces8.png'),
  require('../assets/players/faces9.png'),
  require('../assets/players/faces10.png'),
  require('../assets/players/faces11.png'),
  require('../assets/players/faces12.png'),
  require('../assets/players/faces13.png'),
  require('../assets/players/faces14.png'),
  require('../assets/players/faces15.png'),
  require('../assets/players/faces16.png'),
  require('../assets/players/faces17.png'),
  require('../assets/players/faces18.png'),
  require('../assets/players/faces19.png'),
  require('../assets/players/faces20.png'),
  require('../assets/players/faces21.png'),
  require('../assets/players/faces22.png'),
  require('../assets/players/faces23.png'),
  require('../assets/players/faces24.png'),
  require('../assets/players/faces25.png'),
  require('../assets/players/faces26.png'),
  require('../assets/players/faces27.png'),
  require('../assets/players/faces28.png'),
  require('../assets/players/faces29.png'),
  require('../assets/players/faces30.png'),
  require('../assets/players/faces31.png'),
  require('../assets/players/faces32.png'),
  require('../assets/players/faces33.png'),
  require('../assets/players/faces34.png'),
];
// src 배열과 메타 길이가 어긋나면(시트 추가 시 한쪽만 갱신) 즉시 실패 — 배정 산식이 조용히 틀어지는 것 방지.
if (FACE_SRC.length !== FACE_SHEET_META.length) {
  throw new Error(`face sheet src(${FACE_SRC.length}) != meta(${FACE_SHEET_META.length}) — faceSheetMeta.FACE_SHEET_META 길이와 FACE_SRC 길이를 맞추세요`);
}

export interface FaceSheet { src: number; cols: number; rows: number; count: number }
export const FACE_SHEETS: FaceSheet[] = FACE_SHEET_META.map((m, i) => ({ src: FACE_SRC[i], ...m }));

export interface FaceCell { src: number; cols: number; rows: number; col: number; row: number }
/** 선수 id → 시트 칸(없으면 null=절차적 폴백). 배정 산식은 faceSheetSlot(단일 소스) — src만 여기서 붙인다. */
export function faceCell(id: string): FaceCell | null {
  if (FACE_TOTAL === 0) return null;
  const slot = faceSheetSlot(id);
  if (!slot) return null;
  const s = FACE_SHEETS[slot.index];
  return { src: s.src, cols: s.cols, rows: s.rows, col: slot.col, row: slot.row };
}

/** 표시 대상 선수들이 쓸 시트만(중복 제거) — 프리워밍(FaceSheetWarmup)용. 전체 시트 부트 프리로드 금지(발열·메모리). */
export function uniqueFaceSheets(ids: Iterable<string>): FaceSheet[] {
  return uniqueFaceSheetIndices(ids).map((i) => FACE_SHEETS[i]);
}
