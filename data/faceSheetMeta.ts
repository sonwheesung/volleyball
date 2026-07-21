// 얼굴 시트 격자·수용 메타 + 순수 인덱서 (AVATAR_SYSTEM). **Node-safe**(require('*.png') 없음) —
// data/faceSheets.ts(Metro 전용, src require)와 분리해 faceCell·프리워밍·가드가 이 순수 산식을 **단일 소스**로 공유한다.
// 시트 추가 = 아래 length만 늘리고(격자 동일 3×3=9) faceSheets.ts의 src 배열도 같은 순서로 push(길이 일치 검사됨).
import { faceHash } from './playerFace';

export interface FaceSheetMeta { cols: number; rows: number; count: number }

// 현 풀: 34시트 × 3×3(9명) = 306명(AVATAR_SYSTEM 2026-07-19 마감, 목표 300 달성). 격자·수용의 단일 소스.
export const FACE_SHEET_META: FaceSheetMeta[] = Array.from({ length: 34 }, () => ({ cols: 3, rows: 3, count: 9 }));
export const FACE_TOTAL = FACE_SHEET_META.reduce((n, s) => n + s.count, 0);

export interface FaceSlot { index: number; cols: number; rows: number; col: number; row: number }

/** 선수 id → 시트 슬롯(시트 인덱스 + 칸 좌표). 시트 초과 id는 null(절차적 폴백). faceCell·워밍 공용 단일 산식. */
export function faceSheetSlot(id: string): FaceSlot | null {
  if (FACE_TOTAL === 0) return null;
  let k = faceHash(id, 'face') % FACE_TOTAL;
  for (let i = 0; i < FACE_SHEET_META.length; i++) {
    const s = FACE_SHEET_META[i];
    if (k < s.count) return { index: i, cols: s.cols, rows: s.rows, col: k % s.cols, row: Math.floor(k / s.cols) };
    k -= s.count;
  }
  return null;
}

/** 표시 대상 id들이 실제로 렌더할 시트 인덱스 집합(중복 제거·정렬) — 프리워밍이 데울 시트 목록의 진실.
 *  전체 시트가 아니라 **이 화면에 뜨는 선수들의 시트만**(발열 #122·메모리 — 부트 일괄 프리로드 금지). */
export function uniqueFaceSheetIndices(ids: Iterable<string>): number[] {
  const seen = new Set<number>();
  for (const id of ids) { const s = faceSheetSlot(id); if (s) seen.add(s.index); }
  return [...seen].sort((a, b) => a - b);
}
