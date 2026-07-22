// 시상식 산정 (AWARDS_SYSTEM). 순수 함수 — 리그/스토어 의존 0, 결정론.
// 입력: 시즌 생산(production) + 팀 순위 + 신인/성장 정보. 출력: SeasonAwards.
// 상은 OVR이 아니라 "코트에서 실제로 일어난 생산"에 준다(OVR≠실전력 우회).

import type { AwardWinner, Best7Slot, Player, Position, SeasonAwards } from '../types';
import type { ProdLine } from './production';

/** MVP/신인상/베스트7 종합 임팩트 — 득점 위주, 세터(어시)·리베로(디그)도 경합.
 *  입력은 `{points,assists,digs}` 최소 형상 — ProdLine(올시즌)·SeasonLine(전시즌)을 **같은 자**로 잰다(기량발전상 Δ, AWARDS_SYSTEM §9). */
export function impactScore(l: { points: number; assists: number; digs: number }): number {
  return l.points + 0.25 * l.assists + 0.18 * l.digs;
}

/** 기량발전상 자격 — 올시즌 최소 출전 경기수(AWARDS_SYSTEM §9). 팀 정규 36경기의 ≈28%.
 *  실측(N=31,114 선수-시즌): 실제 수상자 전원 matches≥30이라 정상 결과엔 안 걸리는 안전 바닥 —
 *  핀치서브 프린지(실사례 matches≈0.05) 오수상 봉인용. ⚠ 팀 경기수 균등(36) 가정 — 확장/단축 시즌 도입 시 재검토. */
export const MIN_IMPROVE_MATCHES = 10;

/** 팀 성적 가중 — 1위 ×1.0 … 꼴찌 ×0.5. "성적 없는 MVP 없다" */
function teamWeight(rank: number, teamCount: number): number {
  if (teamCount <= 1) return 1;
  return 1 - 0.5 * (rank / (teamCount - 1));
}

export interface AwardsInput {
  prod: Map<string, ProdLine>;             // 시즌 전체 선수별 생산
  player: (id: string) => Player | undefined;
  teamOf: (id: string) => string | undefined;
  teamRank: Map<string, number>;           // teamId → 0-based 정규시즌 순위
  teamCount: number;
  rookies: Set<string>;                    // 데뷔 시즌 선수
  // 기량발전상(AWARDS_SYSTEM §9) — priorImpact = playerId → 전시즌 seasonLine impactScore.
  //   **맵에 엔트리가 있어야만 후보**(전시즌 라인 존재 필수 — prior=0 폴백 금지, 신규 외국인/데뷔직후 오수상 봉인).
  priorImpact: Map<string, number>;
  mostImprovedReady: boolean;              // 프리뷰 게이트 — 시즌 집계 완료(uptoDay≥REF_DAY) 시에만 true. false면 mostImproved=null.
  championId: string | null;
  legProd: Map<string, ProdLine>[];        // 라운드(leg)별 생산 — 라운드 MVP용
}

const win = (id: string, teamOf: (id: string) => string | undefined, value: number): AwardWinner =>
  ({ playerId: id, teamId: teamOf(id) ?? '', value: Math.round(value) });

/** pool 중 score 최대(동률은 id 사전순) → AwardWinner. 후보 없으면 null */
function pickTop(
  pool: Iterable<string>,
  score: (id: string) => number,
  teamOf: (id: string) => string | undefined,
): AwardWinner | null {
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const id of pool) {
    const v = score(id);
    if (v <= 0) continue;
    if (v > bestVal || (v === bestVal && best !== null && id < best)) { best = id; bestVal = v; }
  }
  return best === null ? null : win(best, teamOf, bestVal);
}

const BEST7_SLOTS: Position[] = ['S', 'OH', 'OH', 'OP', 'MB', 'MB', 'L'];
// 베스트7 포지션별 선정 기준 스탯
const BEST7_KEY: Record<Position, keyof ProdLine> = {
  S: 'assists', OH: 'points', OP: 'points', MB: 'points', L: 'digs',
};

export function computeSeasonAwards(input: AwardsInput): SeasonAwards {
  const { prod, player, teamOf, teamRank, teamCount, rookies, priorImpact, mostImprovedReady, championId, legProd } = input;
  const ids = [...prod.keys()].filter((id) => (prod.get(id)?.matches ?? 0) > 0);
  const stat = (id: string, k: keyof ProdLine): number => (prod.get(id)?.[k] as number) ?? 0;
  const posOf = (id: string): Position | undefined => player(id)?.position;

  // ── 정규리그 MVP: 임팩트 × 팀 성적 가중 ──
  const mvp = pickTop(ids, (id) => {
    const l = prod.get(id)!;
    const r = teamRank.get(teamOf(id) ?? '') ?? teamCount - 1;
    return impactScore(l) * teamWeight(r, teamCount);
  }, teamOf);

  // ── 챔프전 MVP: 우승팀 최고 임팩트 ──
  const finalsMvp = championId
    ? pickTop(ids.filter((id) => teamOf(id) === championId), (id) => impactScore(prod.get(id)!), teamOf)
    : null;

  // ── 신인상 / 기량발전상 ──
  const rookie = pickTop([...rookies].filter((id) => ids.includes(id)), (id) => impactScore(prod.get(id)!), teamOf);
  // 기량발전상(AWARDS_SYSTEM §9): 점수 = 올시즌 생산 임팩트 − 전시즌 생산 임팩트(Δ). 자격 = 비신인 ∧ 전시즌 라인 존재
  //   ∧ 올시즌 matches≥MIN_IMPROVE_MATCHES. Δ>0은 pickTop의 v<=0 배제로 집행. 프리뷰(집계 중)엔 null(mostImprovedReady=false).
  const mostImproved = mostImprovedReady
    ? pickTop(
        ids.filter((id) =>
          !rookies.has(id) &&
          priorImpact.has(id) &&
          (prod.get(id)?.matches ?? 0) >= MIN_IMPROVE_MATCHES),
        (id) => impactScore(prod.get(id)!) - priorImpact.get(id)!,
        teamOf,
      )
    : null;

  // ── 부문 기록왕(순수 1위, 팀 성적 무관) ──
  const title = (k: keyof ProdLine) => pickTop(ids, (id) => stat(id, k), teamOf);
  const titles = {
    scoring: title('points'),
    spike: title('spikes'),
    block: title('blocks'),
    serve: title('aces'),
    dig: title('digs'),
    set: title('assists'),
    receive: title('receives'),
  };

  // ── 베스트7: 포지션별 최고(각 슬롯 중복 없이) ──
  const best7: Best7Slot[] = [];
  const used = new Set<string>();
  for (const pos of BEST7_SLOTS) {
    const key = BEST7_KEY[pos];
    const winner = pickTop(
      ids.filter((id) => posOf(id) === pos && !used.has(id)),
      (id) => stat(id, key),
      teamOf,
    );
    if (winner) used.add(winner.playerId);
    best7.push({ pos, winner });
  }

  // ── 라운드(leg) MVP: 각 구간 최고 임팩트 ──
  const roundMvps = legProd.map((lp) =>
    pickTop([...lp.keys()], (id) => impactScore(lp.get(id)!), teamOf),
  );

  return { mvp, finalsMvp, rookie, mostImproved, titles, best7, roundMvps };
}
