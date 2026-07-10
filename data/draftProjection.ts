// 예상 지명 순위(프로젝션) = 리그 컨센서스 (UI_RULES DL-5 / ⑥ UX 개선) — 순수·결정론·reveal-gated·무저장.
//
// 유망주마다 "예상 몇 순위/라운드"를 준다. **팀별 need를 시뮬하지 않는 리그 컨센서스**(전 팀 평균 시선) —
//   그래서 실제 지명(resolveDraft sequence: 로터리 + 팀별 need + 패스)과 **어긋난다** = 진짜 드라마(DL-5 괴리).
// 안개: reveal↑ → 좁은 범위("예상 1~3순위"), reveal↓ → 넓은 범위/모호("순위 불명"). 밴드 폭은 reveal에 단조 감소.
// 산출: 클래스를 공개 컨센서스 가치(aiProspectValue, reveal-gated·숨은 포텐 미참조)로 정렬 → 순번을 라운드 밴드로.
import type { Player } from '../types';
import { aiProspectValue } from './draftAI';
import { DRAFT_ROUNDS } from '../engine/draft';

// KOVO 7팀 4라운드 = 라운드당 ~7픽(총 ~19~21 실지명, 슬롯 28). DL-2 로스터 여유 표시와 같은 근거.
const PER_ROUND = 7;

/** 클래스 공개 컨센서스 순위(id→0-based rank) — 가치 내림차순. reveal-gated(숨은 포텐 미참조). */
export function consensusOrder(cls: Player[], reveal: number): Map<string, number> {
  const sorted = [...cls].sort((a, b) => {
    const d = aiProspectValue(b, reveal) - aiProspectValue(a, reveal);
    return d !== 0 ? d : (a.id < b.id ? -1 : 1); // 동점 tie-break=id(결정론)
  });
  return new Map(sorted.map((p, i) => [p.id, i] as const));
}

/** reveal→밴드 반폭(안개). reveal↑ = 좁아짐(단조 감소). 999=순위 불명(범위 폭발). */
export function bandHalfWidth(reveal: number): number {
  if (reveal >= 0.92) return 1;
  if (reveal >= 0.7) return 2;
  if (reveal >= 0.5) return 4;
  if (reveal >= 0.3) return 7;
  return 999;
}

const roundOf = (rank: number): number => Math.floor(rank / PER_ROUND) + 1; // 0-based rank → 1-based round

export interface ProjectionBand { text: string; lo: number; hi: number; width: number }

/** rank(0-based 컨센서스 순위) + reveal → 예상 지명 밴드(텍스트 + [lo,hi] rank 범위). */
export function projectionBand(rank: number, classSize: number, reveal: number): ProjectionBand {
  const hw = bandHalfWidth(reveal);
  if (hw >= 999) return { text: '순위 불명', lo: 0, hi: classSize - 1, width: classSize };
  const lo = Math.max(0, rank - hw);
  const hi = Math.min(classSize - 1, rank + hw);
  const width = hi - lo + 1;
  const totalSlots = PER_ROUND * DRAFT_ROUNDS; // 28
  let text: string;
  if (lo >= totalSlots) {
    text = '지명권 밖 예상';
  } else {
    const rLo = roundOf(lo), rHi = roundOf(Math.min(hi, totalSlots - 1));
    if (rLo === rHi) {
      // 1라운드 상단(hi<3)은 특히 "예상 1~3순위"로 좁게
      text = rLo === 1 && hi < 3 ? '예상 1~3순위' : `예상 ${rLo}라운드`;
    } else {
      text = `예상 ${rLo}~${rHi}라운드`;
    }
  }
  return { text, lo, hi, width };
}

/** 편의: 유망주 하나의 예상 지명 밴드 텍스트(클래스 컨센서스 재계산). 목록에선 consensusOrder를 1회만 쓰는 게 효율적. */
export function projectedPickBand(p: Player, cls: Player[], reveal: number): string {
  const rank = consensusOrder(cls, reveal).get(p.id) ?? cls.length - 1;
  return projectionBand(rank, cls.length, reveal).text;
}

/** 예상↔실제 괴리 배지(DL-5) — 실제 전체 픽 순번(actualIndex, 0-based)이 예상 밴드보다 이르/늦으면. */
export function pickTimingBadge(actualIndex: number, band: ProjectionBand): '이른' | '늦은' | null {
  if (band.width >= 999) return null; // 순위 불명이면 괴리 판정 안 함
  if (actualIndex < band.lo) return '이른';
  if (actualIndex > band.hi) return '늦은';
  return null;
}
