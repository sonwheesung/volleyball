// 시즌 종료 행동 텔레메트리 — 집계(순수 read-only) · BACKEND_SYSTEM §13.27.
//
// endSeason **롤오버 직전** 상태에서 "구단주 운영 행동"을 비식별 카운트로 파생한다(선수 이름·개인정보 0 — 순수 정수/불리언).
// **순수·read-only**: 넘겨받은 상태를 읽기만 한다 — rng 미소비·상태 변경 0·엔진(simMatch/dynamics) 무호출.
//   결정론 격리(§1·§8): 텔레메트리는 시드/리플레이/경기결과와 무관한 통계 메타. 세이브 백업(§13.26)과 같은 계층.
//
// 성능/비차단: 경기 재구성(simMatch subEvents)을 **하지 않는다** — 개입 로그(interventions)만 훑는 O(개입수) 집계라 값싸다.
//   ※ 엔진 **자동 교체**(SubKind block/def/injury/rest)는 v1 제외 — (a) 구단주 행동이 아니라 엔진/감독 자동이고,
//     (b) subEvents 재구성이 롤오버 후엔 다음 시즌 로스터라 부정확 → 정확하려면 롤오버 전 동기 재구성(=비차단 위반).
//     "확실히 못 구하는 지표는 넣지 않는다"(추정/억지매핑 금지). payload가 jsonb라 후속 확장 자유.
import type { MatchIntervention } from '../engine/simMatch';
import type { CoachModeChange } from './dynamics';
import type { TrainingFocus } from '../types';

/** computeSeasonTelemetry 입력 — GameState의 read-only 부분집합(롤오버 전 값). 상태를 그대로 넘긴다. */
export interface TelemetrySource {
  selectedTeamId: string | null;
  interventions: Record<string, MatchIntervention[]>; // fixtureId→개입[] (내 팀 경기만 존재)
  coachModeLog: CoachModeChange[];                     // "경기 지휘" 설정 체인지로그
  benchDirectives: { playerId: string }[];            // 이번 시즌 벤치/선발 직접 지시(롤오버 시 리셋 → 시즌 단위)
  inSeasonTx: { teamId: string; kind: string }[];     // 시즌 중 이동(방출/영입)
  trainingFocus: TrainingFocus | null;                // 현재 훈련 방향
  campTrainedThisOffseason: string[];                 // 이번 오프시즌 전지훈련 인원
}

/** 호출부(endSeason)만 아는 스칼라 — 롤오버 후 archive/expelledLog에 들어가는 값이라 계산해 주입. */
export interface TelemetryMeta {
  season: number;             // 종료된 시즌
  finalRank: number | null;   // 내 팀 정규 최종 순위(1-based) · 없으면 null
  champion: boolean;          // 우승 여부
  expels: number;             // 이번 시즌 내 팀 불명예 제명 수(롤오버 시 expelledLog로 편입 — 호출부 계산)
}

export interface SeasonTelemetryPayload {
  v: 1;
  season: number;
  finalRank: number | null;
  champion: boolean;
  subs: { total: number; manual: number; pinch: number }; // 내 팀 경기 사용자 교체(개입 로그) — 엔진 자동분 제외(주석)
  timeouts: number;        // 구단주 개입 타임아웃 수
  interventions: number;   // 총 개입 엔트리 수(교체+타임아웃)
  lineupChanges: number;   // 선발/벤치 직접 지시 수(benchDirectives)
  coachMode: boolean;      // "경기 지휘"(수동) 유효 설정 on/off
  releases: number;        // 이번 시즌 내 팀 방출 수
  expels: number;          // 이번 시즌 내 팀 불명예 제명 수
  trainingFocus: string | null; // 훈련 방향 코드("primary|secondary" 훈련id) · null=감독 기본
  campCount: number;       // 전지훈련 사용 인원
}

/** TrainingFocus → 안정 코드 문자열("4,6|1,10,12"). null=null. 비식별 코드(선수·개인정보 0). */
function encodeFocus(f: TrainingFocus | null): string | null {
  if (!f) return null;
  return `${f.primary.join(',')}|${f.secondary.join(',')}`;
}

/** 롤오버 전 상태(src) + 호출부 스칼라(meta) → v1 payload. 순수 함수(read-only·rng 미소비·상태 무변경). */
export function computeSeasonTelemetry(src: TelemetrySource, meta: TelemetryMeta): SeasonTelemetryPayload {
  let manual = 0;
  let pinch = 0;
  let timeouts = 0;
  let interventions = 0;
  // 개입 로그 집계 — 내 팀 경기(fixtureId)별 개입 배열을 훑는다. 사용자 실제 조작만 기록되므로 곧 "구단주 행동".
  for (const list of Object.values(src.interventions)) {
    for (const iv of list) {
      interventions++;
      if (iv.kind === 'timeout') timeouts++;
      else if (iv.kind === 'sub') {
        if (iv.subKind === 'pinch') pinch++;
        else manual++; // subKind 미지정/'manual' = 세트 끝까지 교체
      }
    }
  }
  const my = src.selectedTeamId ?? '';
  const releases = src.inSeasonTx.filter((t) => t.kind === 'release' && t.teamId === my).length;
  // 유효 지휘모드 = 가장 늦은 날의 설정(store endSeason의 coachModeEff 파생과 동형).
  const coachMode = src.coachModeLog.reduce(
    (acc, c) => (c.day >= acc.day ? c : acc),
    { day: -1, manual: false },
  ).manual;
  return {
    v: 1,
    season: meta.season,
    finalRank: meta.finalRank,
    champion: meta.champion,
    subs: { total: manual + pinch, manual, pinch },
    timeouts,
    interventions,
    lineupChanges: src.benchDirectives.length,
    coachMode,
    releases,
    expels: meta.expels,
    trainingFocus: encodeFocus(src.trainingFocus),
    campCount: src.campTrainedThisOffseason.length,
  };
}
