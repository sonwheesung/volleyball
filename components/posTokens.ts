// 포지션 디자인 토큰 — 색·라벨·정렬의 **단일 소스**. 배지(PosTag)·코트 마커·박스스코어 테이블이
// 전부 여기서 읽는다. 예전엔 POS_COLOR가 5곳에 복붙돼 어긋났다(BoxScoreTable S색 드리프트 등) →
// 디자인 변경이 한 곳에 모이도록 통합. RN 비의존(타입만) → 어디서 import해도 순환참조 없음.
import type { Position } from '../types';

/** KOVO 라이트 시스템 파스텔 포지션색 — 전 화면 동일 */
export const POS_COLOR: Record<Position, string> = {
  S: '#36BE9A', OH: '#0E9C8C', OP: '#FF6B5A', MB: '#8B7CF0', L: '#C8961F',
};
/** 풀 라벨(한글) — 배지 full·선수 상세 등 */
export const POS_LABEL: Record<Position, string> = {
  S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로',
};
/** 정렬 순서 — 선수단/명단 정렬 공통 */
export const POS_ORDER: Record<Position, number> = { S: 0, OH: 1, OP: 2, MB: 3, L: 4 };

const FALLBACK = '#8A8F98'; // 알 수 없는 포지션(이론상 없음)
export const posColor = (pos: string): string => POS_COLOR[pos as Position] ?? FALLBACK;
export const posLabel = (pos: string): string => POS_LABEL[pos as Position] ?? pos;
