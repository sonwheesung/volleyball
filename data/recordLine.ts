// 포지션별 대표 기록 한 줄(리스트/요약 표면 전용). 상세 화면은 전 기록을 그대로 쓴다.
// 순수 표시 함수 — 세이브·엔진 무관. ProdLine/SeasonLine 공통 필드만 읽는다(둘 다 만족).
import type { Position } from '../types';

// ProdLine·SeasonLine 공통 부분집합 — 둘 다 이 모양을 만족한다.
type RecordLike = { matches: number; points: number; blocks: number; assists: number; digs: number };

/** 경기 수 표시 — 피로 교체(부분 출전 합산)로 소수가 될 수 있어 포맷 필수(UI-46).
 *  정수면 그대로, 소수면 1자리(부동소수점 잔여 "35.799…" 방지). */
export const fmtMatches = (m: number): string => (Number.isInteger(m) ? String(m) : m.toFixed(1));

/** 포지션 대표 기록: OH/OP=득점 · MB=블로킹 · S=세트(어시스트) · L=디그.
 *  예) OH `36경기 · 624점` · MB `36경기 · 블로킹 91` · S `36경기 · 세트 812` · L `36경기 · 디그 488`. */
export function repRecordLine(pos: Position, l: RecordLike): string {
  const g = `${fmtMatches(l.matches)}경기`;
  switch (pos) {
    case 'MB': return `${g} · 블로킹 ${l.blocks}`;
    case 'S':  return `${g} · 세트 ${l.assists}`;
    case 'L':  return `${g} · 디그 ${l.digs}`;
    default:   return `${g} · ${l.points}점`; // OH · OP
  }
}
