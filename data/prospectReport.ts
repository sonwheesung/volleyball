// 스카우트 리포트 (FA_SYSTEM §3.3 스카우팅 2.0 4단계) — 순수·결정론 프로즈.
//
// 두 하드룰(가짜 드라마 금지의 정확한 선):
//   ① 스포일러 금지 — 숨은 포텐을 절대 읽지 않는다. 잠재력 언급은 **스카우터가 공개한 revealedPotential**만 근거.
//   ② 날조 금지 — 데이터에 없는 설정(성격·노력·배경) 생성 금지. 모든 문장은 **가시 신호(아마추어 성적·현재 rating·공개 포텐)**의 값→표현 결정론 매핑.
// 결과가 빗나가는 건 허용·장려("성적 좋았는데 프로에서 폭망", "무명이 대박") = 진짜 드라마·스카우팅 도박(노이즈·은닉 포텐).
import type { Player } from '../types';
import { deriveRatings } from '../engine/ratings';
import { strSeed } from '../engine/rng';
import { amateurImpression } from './amateurRecord';
import { revealedPotential } from './prospectScout';

// 성적 카테고리 key → 강점 표현(가시 성적 기반). label은 성적표와 동일.
const STRENGTH: Record<string, string[]> = {
  pts: ['득점 생산력이 돋보인다', '해결사 기질이 있다'],
  atk: ['공격 성공률이 안정적이다', '결정력이 뛰어나다'],
  rcv: ['리시브가 단단하다', '서브 리시브가 안정적이다'],
  ace: ['서브가 매섭다', '서브 무기가 하나 있다'],
  blk: ['블로킹 타이밍이 좋다', '높이에서 강점을 보인다'],
  qk: ['속공 처리가 매끄럽다', '중앙 속공이 빠르다'],
  ast: ['토스 워크가 정교하다', '경기 운영이 영리하다'],
  dig: ['수비 범위가 넓다', '바닥 볼 처리가 끈질기다'],
};

// 한 줄에 여러 변형 중 id로 결정(날조 아님 — 같은 사실의 표현 다양화만).
const pick = (id: string, salt: string, arr: string[]): string => arr[strSeed(`${id}::rpt::${salt}`) % arr.length];

/**
 * 유망주 스카우트 리포트(2~4문장). 가시 신호만 사용 — 숨은 포텐 절대 미참조.
 * @param reveal 팀 스카우팅 공개도(잠재력 문장의 근거 = revealedPotential(p, reveal)).
 */
export function prospectReport(p: Player, reveal: number): string[] {
  const imp = amateurImpression(p);
  const lines: string[] = [];

  // 1) 전반 인상 — 성적 평균 정규화(가시).
  const avg = imp.reduce((s, x) => s + x.norm, 0) / (imp.length || 1);
  lines.push(
    avg >= 0.75 ? pick(p.id, 'ov', ['아마추어 무대를 압도한 성적표다.', '아마추어 레벨에서는 급이 다른 성적이다.'])
    : avg >= 0.5 ? pick(p.id, 'ov', ['아마추어 무대에서 꾸준한 성적을 냈다.', '기복 없이 무난한 성적을 쌓았다.'])
    : avg >= 0.3 ? pick(p.id, 'ov', ['성적은 그럭저럭한 편이다.', '눈에 띄는 성적은 아니다.'])
    : pick(p.id, 'ov', ['성적만 보면 평범하다.', '아마추어 성적은 아쉬운 편이다.']),
  );

  // 2) 강점 — 가장 좋은 성적 지표.
  const best = [...imp].sort((a, b) => b.norm - a.norm)[0];
  if (best && best.norm >= 0.45 && STRENGTH[best.key]) lines.push(pick(p.id, 'st', STRENGTH[best.key]) + '.');

  // 3) 약점 — 가장 낮은 지표가 확실히 처지면 단서(가시).
  const worst = [...imp].sort((a, b) => a.norm - b.norm)[0];
  if (worst && worst.norm < 0.35 && worst.key !== best?.key) lines.push(`다만 ${worst.label.replace('세트당 ', '')}은 아직 다듬을 여지가 있다.`);

  // 4) 잠재력 — 스카우터가 공개한 부분 포텐만 근거(숨은 포텐 미참조 = 스포일러 금지).
  const rev = revealedPotential(p, reveal);
  if (rev.length === 0) {
    lines.push('스카우터가 부족해 성장 잠재력은 안갯속이다.');
  } else {
    const cur = deriveRatings(p);
    const grow = rev.filter((r) => r.value >= cur[r.key] + 8); // 공개된 천장이 현재보다 뚜렷이 높은 항목
    if (grow.length) lines.push(`스카우트 평: ${grow.map((g) => g.label).join('·')} 쪽 성장 여지가 크다.`);
    else lines.push('스카우트 평: 지금 기량이 곧 천장에 가까워 보인다.');
  }

  return lines;
}
