// 포지션별 대표 기록 한 줄(리스트/요약 표면 전용). 상세 화면은 전 기록을 그대로 쓴다.
// 순수 표시 함수 — 세이브·엔진 무관. ProdLine/SeasonLine 공통 필드만 읽는다(둘 다 만족).
import type { Position } from '../types';

// ProdLine·SeasonLine 공통 부분집합 — 둘 다 이 모양을 만족한다.
// gamesPlayed(정수 GP, ProdLine)가 있으면 그걸, 없으면 matches(SeasonLine은 이미 정수 GP)를 경기수로 표시(UI-46 정정).
type RecordLike = { matches: number; gamesPlayed?: number; points: number; blocks: number; assists: number; digs: number };

/** 경기 수 표시 — 피로 교체(부분 출전 합산)로 소수가 될 수 있어 포맷 필수(UI-46).
 *  정수면 그대로, 소수면 1자리(부동소수점 잔여 "35.799…" 방지). */
export const fmtMatches = (m: number): string => (Number.isInteger(m) ? String(m) : m.toFixed(1));

/** 포지션 대표 기록: OH/OP=득점 · MB=블로킹 · S=세트(어시스트) · L=디그.
 *  예) OH `36경기 · 624점` · MB `36경기 · 블로킹 91` · S `36경기 · 세트 812` · L `36경기 · 디그 488`. */
export function repRecordLine(pos: Position, l: RecordLike): string {
  const g = `${fmtMatches(l.gamesPlayed ?? l.matches)}경기`;
  // 대표 스탯이 0이면(부분출전·신인) 노출하지 않고 득점으로 폴백, 득점도 0이면 경기수만 — "블로킹 0" 박제 방지(테스터 2026-07-29).
  const rep = pos === 'MB' ? (l.blocks > 0 ? `블로킹 ${l.blocks}` : '')
    : pos === 'S' ? (l.assists > 0 ? `세트 ${l.assists}` : '')
    : pos === 'L' ? (l.digs > 0 ? `디그 ${l.digs}` : '')
    : (l.points > 0 ? `${l.points}점` : '');
  const stat = rep || (l.points > 0 ? `${l.points}점` : '');
  return stat ? `${g} · ${stat}` : g;
}
