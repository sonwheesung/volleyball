// 아마추어 성적표 (FA_SYSTEM §3.3 — 스카우팅 2.0). 순수 파생: player.id + 현재 윗단 스탯(deriveRatings).
//
// 원칙(확정 스펙):
//  - 성적 = **현재 실력** × 약체 리그 인플레(id 시드) × 노이즈(±15%, id×카테고리 독립). **포텐 무관**(성적 계산에 절대 안 들어감).
//  - 노이즈 seed = id + 카테고리만(스카우터·팀·reveal 무관 → 플레이어·AI 동일 조건, 성적으로 스탯/포텐 역산 불가).
//  - **표시·드래프트 평가 메타.** 세이브 무저장·시드/리플레이 무관·매치엔진/성장/저장 절대 불침투.
//  - 합성 "아마추어 OVR" 숫자는 화면에 표시 금지(역산). amateurScore는 AI 평가/검증용 내부 스칼라(비표시).
import type { Player, Position } from '../types';
import { deriveRatings } from '../engine/ratings';
import { strSeed } from '../engine/rng';

export interface AmateurStat { key: string; label: string; value: number; unit: '%' | '/세트' }
export interface AmateurRecord { leagueLabel: string; stats: AmateurStat[] }

// 카테고리별 독립 노이즈 폭 — 스펙 "aggregate ±15%"에 대응. 성적표는 2~3개 카테고리를 보여줘 평균 시 노이즈가
// √N만큼 상쇄되므로, aggregate corr(성적,현재)이 ~0.5(역산 불가)에 들어오려면 카테고리별은 더 커야 한다(아마추어 소표본
// 편차라 테마상 정당 — "아마추어 성적은 들쭉날쭉"). 값은 _dv_amateur가 실측·게이트(밴드 밖이면 재조정).
const NOISE = 0.25;

/** id×카테고리 결정론 노이즈 배수 (1±NOISE). 스카우터·팀 무관 — seed는 id+key만. */
function noiseMult(id: string, key: string): number {
  const h = (strSeed(`${id}::am::${key}`) % 100000) / 100000; // 0~1
  return 1 + (h * 2 - 1) * NOISE;
}

/** 약체 리그 라벨 — id 시드 향미(인플레는 아래 지표가 프로 규범 위로 이미 반영). */
const LEAGUES = ['대학 1부 리그', '대학 2부 리그', '고교 리그', '실업 아마추어 리그'];
const leagueOf = (id: string): string => LEAGUES[strSeed(`${id}::lg`) % LEAGUES.length];

/** 윗단 rating(0~100) → 지표값 선형 사상(at40=rating40일 때, at65=rating65일 때). 약체라 프로 규범 위로 앵커. */
const lin = (rating: number, at40: number, at65: number): number => at40 + (rating - 40) * ((at65 - at40) / 25);
const r1 = (v: number): number => Math.round(v * 10) / 10; // 소수 1자리

/** 포지션별 카테고리 정의 — 각 지표가 어느 윗단 rating에서 나오는지(현재 실력만). */
type Ratings = ReturnType<typeof deriveRatings>;
type Cat = { key: string; label: string; unit: '%' | '/세트'; calc: (r: Ratings) => number };

const CATS: Record<Position, Cat[]> = {
  OH: [
    { key: 'pts', label: '세트당 득점', unit: '/세트', calc: (r) => Math.max(0, lin(r.spike * 0.7 + r.serve * 0.3, 2.4, 5.2)) },
    { key: 'atk', label: '공격 성공률', unit: '%', calc: (r) => clampPct(lin(r.spike, 55, 68)) },
    { key: 'rcv', label: '리시브 효율', unit: '%', calc: (r) => clampPct(lin(r.receive, 56, 74)) },
  ],
  OP: [
    { key: 'pts', label: '세트당 득점', unit: '/세트', calc: (r) => Math.max(0, lin(r.spike * 0.8 + r.serve * 0.2, 2.8, 5.6)) },
    { key: 'atk', label: '공격 성공률', unit: '%', calc: (r) => clampPct(lin(r.spike, 55, 69)) },
    { key: 'ace', label: '세트당 에이스', unit: '/세트', calc: (r) => Math.max(0, lin(r.serve, 0.25, 0.9)) },
  ],
  MB: [
    { key: 'blk', label: '세트당 블로킹', unit: '/세트', calc: (r) => Math.max(0, lin(r.block, 0.45, 1.2)) },
    { key: 'qk', label: '속공 성공률', unit: '%', calc: (r) => clampPct(lin(r.spike, 58, 72)) },
    { key: 'pts', label: '세트당 득점', unit: '/세트', calc: (r) => Math.max(0, lin(r.spike * 0.6 + r.block * 0.4, 2.0, 4.4)) },
  ],
  S: [
    { key: 'ast', label: '세트당 어시스트', unit: '/세트', calc: (r) => Math.max(0, lin(r.set, 7.5, 12.5)) },
    { key: 'dig', label: '세트당 디그', unit: '/세트', calc: (r) => Math.max(0, lin(r.dig, 1.8, 4.2)) },
    { key: 'ace', label: '세트당 에이스', unit: '/세트', calc: (r) => Math.max(0, lin(r.serve, 0.2, 0.75)) },
  ],
  L: [
    { key: 'rcv', label: '리시브 효율', unit: '%', calc: (r) => clampPct(lin(r.receive, 58, 76)) },
    { key: 'dig', label: '세트당 디그', unit: '/세트', calc: (r) => Math.max(0, lin(r.dig, 2.4, 5.0)) },
  ],
};

function clampPct(v: number): number { return Math.max(30, Math.min(90, v)); }

/** 유망주 아마추어 성적표(순수·결정론). 현재 실력 × 인플레(지표) × 노이즈(id×카테고리). 포텐 무관.
 *  @param noiseless 검증(A/B) 전용 — 노이즈 무력화(역산 밴드 대조군). 실사용은 항상 false. */
export function amateurRecord(p: Player, noiseless = false): AmateurRecord {
  const r = deriveRatings(p);
  const cats = CATS[p.position];
  const stats: AmateurStat[] = cats.map((c) => ({
    key: c.key, label: c.label, unit: c.unit,
    value: r1(c.calc(r) * (noiseless ? 1 : noiseMult(p.id, c.key))),
  }));
  return { leagueLabel: leagueOf(p.id), stats };
}

/** AI 평가·검증용 내부 스칼라(0~1, 비표시) — 성적표의 "전반적 인상". 각 지표를 카테고리 기준폭으로 정규화한 평균.
 *  ※ 화면 표시 금지(합성 OVR = 역산). AI(pickWithReason)가 아마추어 신호로 쓸 때만. */
export function amateurScore(p: Player, noiseless = false): number {
  const rec = amateurRecord(p, noiseless);
  // 카테고리별 대략 min~max(약체 인플레 범위)로 0~1 정규화 후 평균.
  const NORM: Record<string, [number, number]> = {
    pts: [1.5, 6.0], atk: [45, 75], rcv: [50, 82], ace: [0.1, 1.1], blk: [0.3, 1.4], qk: [50, 78], ast: [6, 14], dig: [1.5, 5.5],
  };
  let sum = 0, n = 0;
  for (const s of rec.stats) {
    const [lo, hi] = NORM[s.key] ?? [0, 100];
    sum += Math.max(0, Math.min(1, (s.value - lo) / (hi - lo)));
    n++;
  }
  return n ? sum / n : 0.5;
}
