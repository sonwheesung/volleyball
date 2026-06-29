// 리그 히스토리 컨텍스트 (FINANCE 2.0 Stage3) — 모기업 기조(sponsorStance) 도출용 archive 주입.
// awardSalary(setAwardScores/awardScoreOf) 패턴을 그대로 미러: 스토어가 archive 변화 시 setSeasonHistory 주입,
//   simLeague도 setSeasonHistory(simArchive). resolveFAMarket 이 teamStanceOf 로 전역 일관 읽기(preview=result).
// sponsorStanceOf 는 순수 유지(Stage2a 가드 .length===3 보존) — 여기서 archive를 공급한다.
//   ※ 왜 컨텍스트인가: teamPrestige/buildPlayoffs(season)은 *현재* 누적 standings만 읽어 과거 우승팀(가뭄 트리거의
//     다년 이력)에 데이터 계층 접근이 없다. 과거 우승은 archive(store)/simArchive(sim)에만 있으므로 주입한다.
import type { SeasonArchive } from '../types';
import { sponsorStanceOf, type SponsorStance } from '../engine/sponsorStance';
import { computeStandings } from './standings';
import { buildPlayoffs } from './playoffs';

let historyArchive: SeasonArchive[] = [];
let stanceEnabled = true; // parity A/B 토글(simLeague STANCE_OFF). 기본 on.

export function setSeasonHistory(archive: SeasonArchive[]): void { historyArchive = archive; }
/** parity A/B용 — off면 teamStanceOf 가 항상 normal(stance 효과 0 베이스라인). */
export function setStanceEnabled(on: boolean): void { stanceEnabled = on; }

/** teamId의 (막 끝난 시즌 season 기준) 모기업 기조. stanceEnabled=false면 항상 normal. */
export function teamStanceOf(teamId: string, season: number): SponsorStance {
  if (!stanceEnabled) return 'normal';
  return sponsorStanceOf(teamId, season, historyArchive);
}

// 막 끝난 시즌 S의 순위/우승을 **라이브 셀렉터로** 산출해 archive에 덧댄다(S가 아직 archive에 없는 프리뷰 시점과,
//   S가 담긴 endSeason 시점 모두 동일 — computeStandings(MAX)는 두 시점 다 막 끝난 시즌이라 결과 동일 = preview=result).
function mergedUpcoming(season: number): SeasonArchive[] {
  const live: SeasonArchive = {
    season,
    championId: buildPlayoffs(season).championId ?? '',
    standings: computeStandings(Number.MAX_SAFE_INTEGER).map((r) => r.teamId),
  };
  return [...historyArchive.filter((a) => a.season !== season), live];
}

/** 다가오는 오프시즌의 한 팀 기조(preview=result) — 내 팀 현금 보너스 게이트(projectSettledCash·endSeason). */
export function upcomingStanceOf(teamId: string, season: number): SponsorStance {
  if (!stanceEnabled) return 'normal';
  return sponsorStanceOf(teamId, season, mergedUpcoming(season));
}

/** 전 구단 기조 배치(merged archive 1회 빌드 — buildPlayoffs/computeStandings 1회). resolveFAMarket AI 입찰용.
 *  teamStanceOf(archive-only)와 달리 라이브 병합이라 **프리뷰=결과**(막 끝난 시즌이 archive에 아직 없어도 동일 stance). */
export function upcomingStances(teamIds: string[], season: number): Record<string, SponsorStance> {
  const out: Record<string, SponsorStance> = {};
  if (!stanceEnabled) { for (const t of teamIds) out[t] = 'normal'; return out; }
  const merged = mergedUpcoming(season);
  for (const t of teamIds) out[t] = sponsorStanceOf(t, season, merged);
  return out;
}
