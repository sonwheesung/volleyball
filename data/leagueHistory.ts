// 리그 히스토리 컨텍스트 (FINANCE 2.0 Stage3) — 모기업 기조(sponsorStance) 도출용 archive 주입.
// awardSalary(setAwardScores/awardScoreOf) 패턴을 그대로 미러: 스토어가 archive 변화 시 setSeasonHistory 주입,
//   simLeague도 setSeasonHistory(simArchive). resolveFAMarket 이 teamStanceOf 로 전역 일관 읽기(preview=result).
// sponsorStanceOf 는 순수 유지(Stage2a 가드 .length===3 보존) — 여기서 archive를 공급한다.
//   ※ 왜 컨텍스트인가: teamPrestige/buildPlayoffs(season)은 *현재* 누적 standings만 읽어 과거 우승팀(가뭄 트리거의
//     다년 이력)에 데이터 계층 접근이 없다. 과거 우승은 archive(store)/simArchive(sim)에만 있으므로 주입한다.
import type { SeasonArchive } from '../types';
import { sponsorStanceOf, type SponsorStance } from '../engine/sponsorStance';

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
