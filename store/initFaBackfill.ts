// 초기 FA 풀 소급 판정(TRANSACTION_SYSTEM §5c 소급 백필) — 순수 판정 헬퍼(RN 무의존).
//   기능(3bb8d3a) 이전에 시작한 시즌0 세이브는 selectTeam()의 faPool 시드를 못 받아 빈 풀([])로 저장돼,
//   OTA로 코드를 받아도 재로드 시 여전히 영입 가능 FA 0이 된다. 재수화 경로에서 이 헬퍼로 대상을 판정해 소급 주입한다.
//
//   드리프트 방지: 프로덕션(store 재수화)과 가드(tools/_dv_initfa.ts)가 **같은 함수**를 import(인라인 복제 금지).
//   useGameStore는 react-native(AsyncStorage)를 전이 import하므로 tsx 가드가 store를 직접 import 못 한다 →
//   순수 로직만 이 모듈로 분리(오직 data/seed→engine만 의존). useGameStore가 재-export해 store 소비자 호환.
import { INITIAL_FA_IDS } from '../data/seed';

/**
 * pre-feature 세이브(시즌0·빈풀·무거래·팀선택) → 초기 FA 풀(INITIAL_FA_IDS 복사) 반환, 아니면 null.
 * 조건 근거: 시즌0·빈풀·거래없음 = "막 시작한 pre-feature 세이브"(selectTeam 직후 상태). 이미 영입 시작
 * (inSeasonTx 존재)·시즌≥1·이미 풀 있음(faPool 비어있지 않음)은 불변(중복/역행 방지). 팀 미선택도 불변.
 */
export function initFaBackfillPool(
  state: { season?: number; faPool?: unknown[]; inSeasonTx?: unknown[]; selectedTeamId?: string | null } | undefined,
): string[] | null {
  const need = (state?.season ?? 0) === 0
    && (state?.faPool?.length ?? 0) === 0
    && (state?.inSeasonTx?.length ?? 0) === 0
    && !!state?.selectedTeamId;
  return need ? [...INITIAL_FA_IDS] : null;
}
