// 마일스톤 셀렉터 (MILESTONE_SYSTEM). 시즌 경계에서 통산 임계 돌파를 Milestone[] 으로.
// store.endSeason 이 롤오버 전 호출(프리뷰=결과). 개인 통산 + 레전드 추월 + 구단 기록 경신.

import type { CareerStats, HofEntry, Milestone } from '../types';
import { accrueCareer } from '../engine/production';
import { personalMilestones, passedValues } from '../engine/milestones';
import { getPlayer, getTeam, currentRosters, reconstructForeignName } from './league';
import { leagueProduction } from './production';

const STAT_KO: Record<string, string> = {
  points: '통산 득점', blocks: '통산 블로킹', digs: '통산 디그',
  aces: '통산 서브에이스', matches: '통산 출전', seasons: '시즌',
};
const UNIT: Record<string, string> = { points: '점', blocks: '개', digs: '개', aces: '개', matches: '경기' };
// 헤드라인급 임계(이상이면 big)
const HEADLINE: Record<string, number> = {
  points: 10000, blocks: 2000, digs: 7000, aces: 1000, matches: 800, seasons: 20,
};
const CLUB_STATS: (keyof CareerStats)[] = ['points', 'blocks', 'digs'];
// 구단 기록은 "프랜차이즈급" 누적부터 — 단일시즌 리더의 inaugural 남발 방지
const CLUB_FLOOR: Record<string, number> = { points: 2000, blocks: 700, digs: 2000 };

const short = (tid: string) => (getTeam(tid)?.name ?? tid).split(' ').slice(-1)[0];
const cv = (c: CareerStats | HofEntry, k: string) => (c as unknown as Record<string, number>)[k] ?? 0;

/**
 * season(0-based)에 발생한 마일스톤 전부. hof = 현재 명예의전당(레전드 추월 판정).
 * before = 시즌 시작 base.career, after = 이번 시즌 생산 누적(seasons+1).
 */
export function detectSeasonMilestones(season: number, hof: HofEntry[]): Milestone[] {
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  const rs = currentRosters();
  const out: Milestone[] = [];

  // 활성 선수 before/after 통산
  const before = new Map<string, CareerStats>();
  const after = new Map<string, CareerStats>();
  const teamOf = new Map<string, string>();
  for (const tid of Object.keys(rs)) {
    for (const id of rs[tid]) {
      const base = getPlayer(id);
      if (!base) continue;
      const a = { ...accrueCareer(base, prod.get(id)).career, seasons: base.career.seasons + 1 };
      before.set(id, base.career);
      after.set(id, a);
      teamOf.set(id, tid);
    }
  }

  const legends = hof.filter((h) => h.legend);

  for (const [id, aft] of after) {
    const bef = before.get(id)!;
    const tid = teamOf.get(id) ?? '';
    const name = getPlayer(id)?.name ?? reconstructForeignName(id) ?? id;
    const push = (kind: Milestone['kind'], text: string, big: boolean, routine = false) =>
      out.push({ season, playerId: id, name, teamId: tid, kind, text, big, routine });

    // 1) 개인 통산 임계 돌파
    for (const m of personalMilestones(bef, aft)) {
      if (m.stat === 'seasons') {
        // 장수(현역/롱런)는 저신호(베테랑마다 반복) → routine 표시: 연표엔 남기되 뉴스 피드선 생략(NEWS §4.6). 20시즌+는 big(헤드라인 유지)
        push('career', `${name}, ${m.threshold}시즌 현역 — 롱런`, m.threshold >= HEADLINE.seasons, true);
      } else {
        const big = m.threshold >= (HEADLINE[m.stat] ?? Infinity);
        push('career', `${name}, ${STAT_KO[m.stat]} ${m.threshold.toLocaleString()}${UNIT[m.stat] ?? ''} 돌파`, big);
      }
    }

    // 2) 리그 — 명예의전당 레전드(영구결번급) 통산 추월
    for (const stat of CLUB_STATS) {
      // 동점 레전드(같은 stat 동일값)가 marks에 중복 → passedValues가 같은 값을 2회 반환 →
      // legends.find 이 매번 첫 레전드를 골라 동일 push 정확중복. 값 dedup으로 봉인(삽입순서 보존=결정론).
      const marks = [...new Set(legends.map((h) => cv(h, stat)).filter((v) => v > 0))];
      for (const v of passedValues(cv(bef, stat), cv(aft, stat), marks)) {
        const legend = legends.find((h) => cv(h, stat) === v);
        if (legend) push('league', `${name}, 명예의전당 ${legend.name}의 ${STAT_KO[stat]} 기록 추월`, true);
      }
    }

    // 3) 구단 — 구단 통산 기록 경신(이전 구단 1위를 넘어선 순간)
    for (const stat of CLUB_STATS) {
      let clubMaxOther = 0;
      for (const otherId of rs[tid] ?? []) {
        if (otherId === id) continue;
        clubMaxOther = Math.max(clubMaxOther, cv(after.get(otherId) ?? before.get(otherId) ?? bef, stat));
      }
      for (const h of hof) if (h.teamId === tid) clubMaxOther = Math.max(clubMaxOther, cv(h, stat));
      const b = cv(bef, stat), a = cv(aft, stat), floor = CLUB_FLOOR[stat];
      // 프랜차이즈급(floor 이상) 리더가 되는 순간: floor 돌파(b<floor) 또는 기존 1위 추월(b<=clubMaxOther)
      if (a >= floor && a > clubMaxOther && (b < floor || b <= clubMaxOther)) {
        push('club', `${name}, ${short(tid)} 구단 ${STAT_KO[stat]} 1위 등극`, true);
      }
    }
  }

  // 헤드라인 먼저
  return out.sort((x, y) => Number(y.big) - Number(x.big));
}
