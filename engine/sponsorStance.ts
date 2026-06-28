// 모기업 기조 (sponsorStance) — FINANCE 2.0. 매 오프시즌 전 구단이 {긴축·평년·공격} 중 하나.
// 시드 + 관측 성적신호(직전 순위·우승·가뭄)만으로 도출 → cash 무관 = 내 팀/AI 대칭, 무저장 결정론(archive 읽기).
// 선수 심리 mood/morale과 별개(용어 분리). 효과: AI 입찰 공격성(캡 안) + 내 팀 advisory + 예고 뉴스(별 모듈).
import { createRng, strSeed } from './rng';
import type { SeasonArchive } from '../types';

export type SponsorStance = 'thrifty' | 'normal' | 'aggressive';

// 트리거 확률(빈도 목표 aggressive 팀당 ~12~15시즌 1회 — _dv_sponsorstance로 실측·튜닝).
const P_CONTENDER = 0.16;   // 상위권 한끗부족 팀이 "이번엔 가자"
const P_DROUGHT = 0.12;     // 장기 무관 팀이 "큰 거 한 방"(약팀 반등 — 동등 비중)
const P_NEWSPONSOR = 0.03;  // 누구나 저확률 새 스폰서 서사
const P_THRIFTY = 0.07;     // 누구나 저확률 모기업 긴축(성적 무관 — 데스스파이럴 회피)
const DROUGHT_SEASONS = 8;  // 장기 무관 기준

/** 막 끝난 시즌(season) 기준, teamId의 다음 오프시즌 모기업 기조. archive는 standings·championId 포함 필요. */
export function sponsorStanceOf(teamId: string, season: number, archive: SeasonArchive[]): SponsorStance {
  const a = archive.find((x) => x.season === season);
  const ranks = a?.standings;
  if (!ranks || ranks.length === 0) return 'normal'; // 데이터 없음(시즌0 등) — 평년
  const rank = ranks.indexOf(teamId) + 1;            // 1=1위, 0(=−1+1)이면 미발견
  if (rank <= 0) return 'normal';
  const teamCount = ranks.length;
  const champ = a!.championId === teamId;

  // 가뭄: 마지막 우승 이후 경과 시즌(우승 이력 없으면 season+1로 큰 값)
  let drought = season + 1;
  for (let s = season; s >= 0; s--) {
    const e = archive.find((x) => x.season === s);
    if (e && e.championId === teamId) { drought = season - s; break; }
  }

  // 별도 RNG 시드(공유 스트림 미소비 — 기존 FA 회귀 baseline 보존)
  const r = createRng(strSeed(`stance:${teamId}:${season}`)).next();

  const topContender = !champ && rank <= Math.max(2, Math.ceil(teamCount * 0.3)); // 상위권인데 우승 못 함
  const longDrought = drought >= DROUGHT_SEASONS;

  // aggressive (겹치지 않는 r 구간에 배치 — 결정론·빈도 제어)
  if (topContender && r < P_CONTENDER) return 'aggressive';
  if (longDrought && r >= P_CONTENDER && r < P_CONTENDER + P_DROUGHT) return 'aggressive';
  if (r >= P_CONTENDER + P_DROUGHT && r < P_CONTENDER + P_DROUGHT + P_NEWSPONSOR) return 'aggressive';
  // thrifty (상단 구간 — 성적 무관)
  if (r >= 1 - P_THRIFTY) return 'thrifty';
  return 'normal';
}
