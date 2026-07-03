// 드래프트 클래스 프리뷰 (FA_SYSTEM §3.3 스카우팅 2.0 4단계) — 순수·결정론 뉴스.
//
// 관전형 몰입: 드래프트 전 "이번 클래스"를 가시 신호로 요약(포지션 풍년/기근·최대어·의견 갈림·깊이).
// 두 하드룰(리포트와 동일): ① 숨은 포텐 미참조(잠재력 언급은 revealedPotential만) ② 날조 금지(값→표현 매핑).
// 결과 빗나감 허용 — "최대어라더니 폭망"·"무명이 대박" = 진짜 드라마.
import type { Player, Position } from '../types';
import { deriveRatings } from '../engine/ratings';
import { amateurScore } from './amateurRecord';
import { revealedPotential } from './prospectScout';

const POS_KO: Record<Position, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };
const STRONG = 0.6; // 성적상 상위(가시 amateurScore) 임계

export interface DraftPreview { headline: string; notes: string[] }

/**
 * 드래프트 클래스 요약(가시 신호만). reveal=내 팀 스카우팅 공개도(의견 갈림 판정에 공개 포텐 사용).
 */
export function draftClassPreview(cls: Player[], reveal: number): DraftPreview {
  if (cls.length === 0) return { headline: '드래프트 클래스 정보 없음', notes: [] };
  const scored = cls.map((p) => ({ p, s: amateurScore(p) })); // 가시 성적 인상(포텐 무관)
  const strong = scored.filter((x) => x.s >= STRONG);

  // 포지션 풍년/기근 — 상위 성적 유망주 분포.
  const byPos: Record<string, number> = {};
  for (const x of strong) byPos[x.p.position] = (byPos[x.p.position] ?? 0) + 1;
  const posEntries = (Object.keys(POS_KO) as Position[]).map((pos) => ({ pos, n: byPos[pos] ?? 0 }));
  const rich = posEntries.filter((e) => e.n >= 3).sort((a, b) => b.n - a.n);
  const lean = posEntries.filter((e) => e.n === 0);

  const notes: string[] = [];

  // 최대어 — 성적 1위(가시). 틀릴 수 있음(노이즈·은닉 포텐) = 드라마.
  const top = [...scored].sort((a, b) => b.s - a.s)[0];
  if (top) notes.push(`최대어로 꼽히는 건 ${POS_KO[top.p.position]} ${top.p.name}. 아마추어 무대 성적이 단연 눈에 띈다.`);

  // 포지션 풍년.
  if (rich.length) notes.push(`올해는 ${rich.slice(0, 2).map((e) => POS_KO[e.pos]).join('·')} 자원이 풍년이다. 이 포지션이 급하면 좋은 기회.`);
  // 포지션 기근.
  if (lean.length) notes.push(`반면 ${lean.slice(0, 2).map((e) => POS_KO[e.pos]).join('·')} 쪽은 마땅한 상위 자원이 보이지 않는다.`);

  // 의견 갈림 — 성적은 좋은데 공개된 포텐(핵심 rating)은 현재보다 낮게 읽히는 선수(가시 divergence만).
  if (reveal >= 0.2) {
    const split = strong.find((x) => {
      const rev = revealedPotential(x.p, reveal);
      if (!rev.length) return false;
      const cur = deriveRatings(x.p);
      return rev.every((r) => r.value <= cur[r.key] + 3); // 공개된 천장이 현재와 큰 차이 없음 = 성장 여지 물음표
    });
    if (split) notes.push(`${POS_KO[split.p.position]} ${split.p.name}는 성적은 좋지만 성장 여지를 두고 스카우트 평가가 엇갈린다.`);
  }

  // 클래스 깊이.
  const depth = strong.length;
  const headline = depth >= 8 ? '알찬 드래프트 클래스가 예고됐다'
    : depth >= 4 ? '무난한 드래프트 클래스다'
    : '전반적으로 얇은 드래프트 클래스다';

  return { headline, notes };
}
