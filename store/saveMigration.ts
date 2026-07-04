// 세이브 마이그레이션·정규화 — 출시 후 구조 변경/손상 세이브를 안전하게 로드한다. docs/SAVE_SYSTEM.md.
// 핵심: 컨테이너 모양(array/record/scalar)을 강제해 복원 경로의 [...arr]·Object.keys·destructure 크래시를 닫는다.
// version+migrate로 향후 breaking 구조 변경(필드 이름변경·재편)도 단계 변환으로 흡수.

export const SAVE_VERSION = 1;

// 영속 59필드 기본값 — freshSave(store/useGameStore.ts) + 설정 4필드와 1:1. 정규화 기준 단일 소스.
// (drift 가드: _dv_migrate가 이 키 집합 == partialize 키 집합을 단언한다.)
export const SAVE_DEFAULTS: Record<string, unknown> = {
  // 설정(새 게임에도 유지)
  onboarded: false, supporter: false, sfxEnabled: true, seenTips: {},
  // 기본 진행
  selectedTeamId: null, season: 0, currentDay: 0, results: {}, watchProgress: {},
  // 계약·방출·거래
  contractOverrides: {}, released: [], inSeasonTx: [], faPool: [],
  resignDecisions: {}, faSignings: [], faAggressive: false,
  protectedIds: [], moneyOnlyIds: [], draftPicks: [],
  // 선수·로스터
  playerBase: null, rosters: null,
  // 역대 기록
  archive: [], careerLog: { faSigns: 0, coachHires: 0, staffHires: 0, interviews: 0 },
  careerTotals: { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 },
  hallOfFame: [], expelledLog: [], transfers: [], retirements: [], milestones: [], readNews: [],
  // 감독·스태프·훈련
  coachPool: null, staffHead: {}, staffAssistants: {}, staffScouts: {}, trainingFocus: null,
  // 구단주·재정
  interviews: [], benchDirectives: [], talkCooldown: {}, benchCooldown: {},
  fanScore: 50, releaseAnger: 0, cash: 50000, lastFinance: null,
  // 외국인·아시아쿼터
  tryoutWish: [], foreignAltPool: [], foreignSubUsed: false, keepForeign: null,
  asianWish: [], asianAltPool: [], asianSubUsed: false, keepAsian: null,
  // 인간관계(RELATIONSHIP_SYSTEM) — 함께한 세월 우정(pairKey→0~0.3)
  bonds: {},
  // 다이아 이코노미(MONETIZATION §11) — 소비성 재화(표시 캐시)·세이브nonce·전지훈련 기록·아웃박스·업적수령·광고상태
  diamonds: 0, saveId: '', campLog: [], campTrainedThisOffseason: [], campDoneSeason: -1, pendingCamp: null, claimedAch: [],
  adState: { dayIdx: 0, count: 0, lastAdAt: 0 },
  // 시뮬 결과 캐시(REALTIME_SIM Phase1) — 계산된 시즌 결과(재로드 시 재계산 제거). 폐기 가능(특수 분기). null=재계산
  simCache: null,
};

type Kind = 'bool' | 'nbool' | 'num' | 'nstr' | 'rec' | 'nrec' | 'arr';

// 필드별 자료구조(SAVE_SYSTEM §1). 특수(중첩) 필드는 여기 없고 sanitizeSave switch default가 처리.
const KIND: Record<string, Kind> = {
  onboarded: 'bool', supporter: 'bool', sfxEnabled: 'bool', seenTips: 'rec',
  selectedTeamId: 'nstr', season: 'num', currentDay: 'num', results: 'rec', watchProgress: 'rec',
  contractOverrides: 'rec', released: 'arr', inSeasonTx: 'arr', faPool: 'arr',
  resignDecisions: 'rec', faSignings: 'arr', faAggressive: 'bool',
  protectedIds: 'arr', moneyOnlyIds: 'arr', draftPicks: 'arr',
  playerBase: 'nrec', rosters: 'nrec',
  archive: 'arr', hallOfFame: 'arr', expelledLog: 'arr', transfers: 'arr', retirements: 'arr',
  milestones: 'arr', readNews: 'arr',
  staffHead: 'rec', staffAssistants: 'rec', staffScouts: 'rec',
  interviews: 'arr', benchDirectives: 'arr', talkCooldown: 'rec', benchCooldown: 'rec',
  fanScore: 'num', releaseAnger: 'num', cash: 'num',
  tryoutWish: 'arr', foreignAltPool: 'arr', foreignSubUsed: 'bool', keepForeign: 'nbool',
  asianWish: 'arr', asianAltPool: 'arr', asianSubUsed: 'bool', keepAsian: 'nbool',
  bonds: 'rec',
  diamonds: 'num', saveId: 'nstr', campLog: 'arr', campTrainedThisOffseason: 'arr', campDoneSeason: 'num', claimedAch: 'arr',
  // 특수(default 분기): careerLog, careerTotals, coachPool, trainingFocus, lastFinance, adState, pendingCamp
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numRec = (v: unknown, keys: string[]): Record<string, number> => {
  const o = isObj(v) ? v : {};
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = num(o[k], 0);
  return out;
};

/** 한 필드를 기대 자료구조로 코어스(잘못된 타입 → 기본값). throw 없음. */
function sanitizeField(key: string, v: unknown): unknown {
  const def = SAVE_DEFAULTS[key];
  switch (KIND[key]) {
    case 'bool': return typeof v === 'boolean' ? v : def;
    case 'nbool': return v === null || typeof v === 'boolean' ? v : def;
    case 'num': return num(v, def as number);
    case 'nstr': return v === null || typeof v === 'string' ? v : def;
    case 'rec': return isObj(v) ? v : {};
    case 'nrec': return v === null || isObj(v) ? v : def; // playerBase/rosters: 잘못된 모양 → null(시드 재구성)
    case 'arr': return Array.isArray(v) ? v : [];
    default: break; // 특수 필드
  }
  switch (key) {
    case 'careerLog': return numRec(v, ['faSigns', 'coachHires', 'staffHires', 'interviews']);
    case 'careerTotals': return numRec(v, ['points', 'aces', 'setsWon', 'setsLost', 'matchWins', 'matchLosses']);
    case 'coachPool':
      if (v === null) return null;
      if (!isObj(v)) return null;
      return { coaches: Array.isArray(v.coaches) ? v.coaches : [], assistants: Array.isArray(v.assistants) ? v.assistants : [] };
    case 'trainingFocus':
      // malformed → null: 리그가 감독 기본 trainingFocus로 재유도(안전)
      if (v === null) return null;
      return isObj(v) && Array.isArray(v.primary) && Array.isArray(v.secondary) ? v : null;
    case 'lastFinance':
      return v === null || isObj(v) ? v : null;
    case 'adState':
      return numRec(v, ['dayIdx', 'count', 'lastAdAt']);
    case 'pendingCamp':
      // 전지훈련 아웃박스(§13.12) — null 또는 {key,playerId,course,season} 모양. 어긋나면 null(안전 — 미정산 취소)
      return v === null || (isObj(v) && typeof v.key === 'string' && typeof v.playerId === 'string' && typeof v.course === 'string' && typeof v.season === 'number') ? v : null;
    case 'simCache':
      // 모양 검증(baseVersion·txVersion 숫자 + standings/production/dyn은 있으면 배열/객체). 어긋나면 null(재계산 폴백) — 폐기 가능
      return isObj(v) && typeof v.baseVersion === 'number' && typeof v.txVersion === 'number'
        && (v.standings === undefined || Array.isArray(v.standings))
        && (v.production === undefined || Array.isArray(v.production))
        && (v.dyn === undefined || (isObj(v.dyn) && Array.isArray(v.dyn.played) && Array.isArray(v.dyn.teamDays))) ? v : null;
    default:
      return v ?? def; // 미분류(이론상 없음) — 안전 통과
  }
}

/** 손상/구버전 세이브를 유효 스키마로 정규화. 모든 필드를 SAVE_DEFAULTS 키로 채운다(누락=기본값). */
export function sanitizeSave(raw: unknown): Record<string, unknown> {
  const s = isObj(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SAVE_DEFAULTS)) out[key] = sanitizeField(key, s[key]);
  return out;
}

/**
 * zustand persist migrate 훅. (persisted, version) → 정규화된 유효 상태.
 * version < 1: 현 구조와 동일 → 정규화만. 향후 breaking 변경 시 단계 추가:
 *   let s = persisted;
 *   if (version < 2) s = v1_to_v2(s);   // 옛 모양 → 새 모양
 *   if (version < 3) s = v2_to_v3(s);
 *   return sanitizeSave(s);
 */
let _pendingClaimSeed = false;
/** 다이아 기능 이전 세이브였는지(소급 폭탄 방지 시드 필요, §11.3) — rehydrate가 1회 소비. 출력 키 오염 없음. */
export const consumePendingClaimSeed = (): boolean => { const v = _pendingClaimSeed; _pendingClaimSeed = false; return v; };

export function migrateSave(persisted: unknown, _version: number): Record<string, unknown> {
  // 다이아 기능 이전 세이브(진행 중)는 claimedAch 키가 없다 → 현 달성분을 claimed로 시드(rehydrate에서).
  if (isObj(persisted) && persisted.claimedAch === undefined && !!persisted.selectedTeamId) _pendingClaimSeed = true;
  return sanitizeSave(persisted);
}
