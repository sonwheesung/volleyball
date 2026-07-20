// 세이브 마이그레이션·정규화 — 출시 후 구조 변경/손상 세이브를 안전하게 로드한다. docs/SAVE_SYSTEM.md.
// 핵심: 컨테이너 모양(array/record/scalar)을 강제해 복원 경로의 [...arr]·Object.keys·destructure 크래시를 닫는다.
// version+migrate로 향후 breaking 구조 변경(필드 이름변경·재편)도 단계 변환으로 흡수.

import { deriveHeadAxes } from '../engine/staff'; // 감독 3축 마이그레이션(v4) — id 시드 파생(랜덤 없음·결정론). engine/staff는 leaf(rng+types)라 순환 없음.

// v3(2026-07-08): 포스트시즌 달력 편입(SEASON_SYSTEM §5). 구세이브가 이미 포스트시즌을 소비(archive[season].championId 존재)
//   했는데 currentDay가 정규 범위(≤164)에 멈춰 있으면, 새 일정 화면이 이를 "플옵 미진행"으로 오인해 재관전을 강요한다.
//   → A안: 그런 세이브는 currentDay를 포스트시즌 종료일(POSTSEASON_LAST_DAY=183)로 승격해 오프시즌 체인으로 직행(재관전 금지).
// v4(2026-07-20, STAFF §9.6-A): 감독 능력 단일 `charisma` → 3축(matchOps·dvPhilosophy·leadership).
//   coachPool.coaches의 각 감독: charisma→matchOps 값 이관(엔진 등가) + 신규 2축은 감독 id 시드 파생으로 충전(마이그레이션에서 랜덤 금지 — 결정론).
export const SAVE_VERSION = 4;
const POSTSEASON_LAST_DAY = 183; // engine/calendar.POSTSEASON_LAST_DAY 손복제 회피용 로컬(saveMigration은 leaf 유지 — engine import 시 순환 위험). _dv_postseason이 일치 가드.

// 영속 69필드 기본값(수는 참고용 — 정본은 이 키 집합 자체) — freshSave(store/useGameStore.ts) + 설정 5필드와 1:1. 정규화 기준 단일 소스.
// (drift 가드: _dv_migrate가 이 키 집합 == partialize 키 집합을 단언한다.)
export const SAVE_DEFAULTS: Record<string, unknown> = {
  // 설정(새 게임에도 유지)
  onboarded: false, supporter: false, sfxEnabled: true, bgmVolume: 0.8, seenTips: {},
  // 기본 진행
  selectedTeamId: null, season: 0, currentDay: 0, results: {}, watchProgress: {},
  // 계약·방출·거래
  contractOverrides: {}, released: [], inSeasonTx: [], faPool: [],
  resignDecisions: {}, faOffers: {}, // faOffers(FA_SYSTEM §2.8) — 구 faSignings[]+faAggressive 대체(migrate가 변환)
  protectedIds: [], moneyOnlyIds: [], draftPicks: [], draftSelections: [],
  // 선수·로스터
  playerBase: null, rosters: null,
  // 역대 기록
  archive: [], careerLog: { faSigns: 0, coachHires: 0, staffHires: 0, interviews: 0 },
  careerTotals: { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 },
  hallOfFame: [], expelledLog: [], transfers: [], retirements: [], seasonDraftLog: [], seasonForeignLog: [], milestones: [], readNews: [],
  // 감독·스태프·훈련
  coachPool: null, staffHead: {}, staffHeadTimeline: {}, staffAssistants: {}, staffScouts: {}, trainingFocus: null, focusLog: [],
  // 구단주·재정
  interviews: [], benchDirectives: [], interventions: {}, coachModeLog: [], talkCooldown: {}, benchCooldown: {},
  fanScore: 50, releaseAnger: 0, cash: 50000, lastFinance: null,
  // 외국인·아시아쿼터
  tryoutWish: [], foreignAltPool: [], foreignSubUsed: false, keepForeign: null,
  asianWish: [], asianAltPool: [], asianSubUsed: false, keepAsian: null,
  // 인간관계(RELATIONSHIP_SYSTEM) — 함께한 세월 우정(pairKey→0~0.3)
  bonds: {},
  // 다이아 이코노미(MONETIZATION §11) — 소비성 재화(표시 캐시)·세이브nonce·전지훈련 기록·아웃박스·업적수령·광고상태
  diamonds: 0, saveId: '', campLog: [], campTrainedThisOffseason: [], campDoneSeason: -1, pendingCamp: null, claimedAch: [],
  lastGrowthDay: -1, // 성장 리포트 모달(TRAINING §성장리포트) — 마지막으로 성장 diff를 보여준 날(-1=미초기화)
  adState: { dayIdx: 0, count: 0, lastAdAt: 0 },
  // 시뮬 결과 캐시(REALTIME_SIM Phase1) — 계산된 시즌 결과(재로드 시 재계산 제거). 폐기 가능(특수 분기). null=재계산
  simCache: null,
};

type Kind = 'bool' | 'nbool' | 'num' | 'nstr' | 'rec' | 'nrec' | 'arr';

// 필드별 자료구조(SAVE_SYSTEM §1). 특수(중첩) 필드는 여기 없고 sanitizeSave switch default가 처리.
const KIND: Record<string, Kind> = {
  onboarded: 'bool', supporter: 'bool', sfxEnabled: 'bool', bgmVolume: 'num', seenTips: 'rec',
  selectedTeamId: 'nstr', season: 'num', currentDay: 'num', results: 'rec', watchProgress: 'rec',
  contractOverrides: 'rec', released: 'arr', inSeasonTx: 'arr', faPool: 'arr',
  resignDecisions: 'rec', // faOffers는 특수(중첩) — default 분기가 처리
  protectedIds: 'arr', moneyOnlyIds: 'arr', draftPicks: 'arr', draftSelections: 'arr',
  playerBase: 'nrec', rosters: 'nrec',
  archive: 'arr', hallOfFame: 'arr', expelledLog: 'arr', transfers: 'arr', retirements: 'arr',
  seasonDraftLog: 'arr', seasonForeignLog: 'arr',
  milestones: 'arr', readNews: 'arr',
  staffHead: 'rec', staffAssistants: 'rec', staffScouts: 'rec',
  interviews: 'arr', benchDirectives: 'arr', interventions: 'rec', talkCooldown: 'rec', benchCooldown: 'rec',
  fanScore: 'num', releaseAnger: 'num', cash: 'num',
  tryoutWish: 'arr', foreignAltPool: 'arr', foreignSubUsed: 'bool', keepForeign: 'nbool',
  asianWish: 'arr', asianAltPool: 'arr', asianSubUsed: 'bool', keepAsian: 'nbool',
  bonds: 'rec',
  diamonds: 'num', saveId: 'nstr', campLog: 'arr', campTrainedThisOffseason: 'arr', campDoneSeason: 'num', claimedAch: 'arr', lastGrowthDay: 'num',
  // 특수(default 분기): careerLog, careerTotals, coachPool, trainingFocus, focusLog, coachModeLog, staffHeadTimeline, lastFinance, adState, pendingCamp, faOffers
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

/** 감독 3축 정규화(STAFF §9.6-A, save v4) — 구세이브(charisma)·신세이브(matchOps) 모두 안전·멱등.
 *  charisma→matchOps 값 이관(엔진 등가) + 신규 2축(dvPhilosophy·leadership) 누락 시 감독 id 시드 파생으로 충전(랜덤 없음).
 *  감독이 아닌 값/부분손상도 크래시 없이 통과(other 필드는 원형 보존). */
function normalizeCoach(c: unknown): unknown {
  if (!isObj(c)) return c;
  const id = typeof c.id === 'string' ? c.id : '';
  const matchOps = num(c.matchOps, num(c.charisma, 50)); // 신세이브=matchOps 우선, 구세이브=charisma 이관, 둘 다 없으면 중립 50
  const axes = deriveHeadAxes(id);
  const dvPhilosophy = num(c.dvPhilosophy, axes.dvPhilosophy);
  const leadership = num(c.leadership, axes.leadership);
  const out: Record<string, unknown> = { ...c, matchOps, dvPhilosophy, leadership };
  delete out.charisma; // 구 필드 제거(모양 변경 — v4)
  return out;
}

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
      return {
        coaches: Array.isArray(v.coaches) ? v.coaches.map(normalizeCoach) : [],
        assistants: Array.isArray(v.assistants) ? v.assistants : [],
      };
    case 'trainingFocus':
      // malformed → null: 리그가 감독 기본 trainingFocus로 재유도(안전)
      if (v === null) return null;
      return isObj(v) && Array.isArray(v.primary) && Array.isArray(v.secondary) ? v : null;
    case 'focusLog': {
      // 훈련 방침 타임라인(A4) — [{fromDay:number, focus: null | {primary,secondary}}]. 손상 세그먼트는 제거(안전).
      if (!Array.isArray(v)) return [];
      const okFocus = (f: unknown) => f === null || (isObj(f) && Array.isArray((f as Record<string, unknown>).primary) && Array.isArray((f as Record<string, unknown>).secondary));
      return v.filter((seg) => isObj(seg) && typeof seg.fromDay === 'number' && Number.isFinite(seg.fromDay) && okFocus(seg.focus));
    }
    case 'coachModeLog': {
      // "경기 지휘" 설정 체인지로그(MATCH_INTERVENTION §4.1) — [{day:number, manual:boolean}]. 손상 세그먼트 제거(focusLog 동형 방어).
      //   day 유한수·manual 불리언만 통과 → manualSideFor의 forward-only 루프가 안전하게 소비(NaN 비교/비불리언 유입 차단).
      if (!Array.isArray(v)) return [];
      return v.filter((c) => isObj(c) && typeof c.day === 'number' && Number.isFinite(c.day) && typeof c.manual === 'boolean');
    }
    case 'lastFinance':
      return v === null || isObj(v) ? v : null;
    case 'adState':
      return numRec(v, ['dayIdx', 'count', 'lastAdAt']);
    case 'pendingCamp':
      // 전지훈련 아웃박스(§13.12) — null 또는 {key,playerId,course,season} 모양. 어긋나면 null(안전 — 미정산 취소)
      return v === null || (isObj(v) && typeof v.key === 'string' && typeof v.playerId === 'string' && typeof v.course === 'string' && typeof v.season === 'number') ? v : null;
    case 'faOffers': {
      // FA 오퍼 다레버(FA_SYSTEM §2.8) — Record<id, {salary:number|'auto', years:1..5, starterGuarantee, promises, aggressive?}>.
      //   손상 엔트리는 제거, 필드는 기본값으로 코어스(salary→'auto', years→2, 나머지 off). migrate가 구 faSignings→여기로 변환.
      if (!isObj(v)) return {};
      const out: Record<string, unknown> = {};
      for (const [id, o] of Object.entries(v)) {
        if (!isObj(o)) continue;
        const salary = o.salary === 'auto' || (typeof o.salary === 'number' && Number.isFinite(o.salary)) ? o.salary : 'auto';
        const years = typeof o.years === 'number' && o.years >= 1 && o.years <= 5 ? Math.round(o.years) : 2;
        const starterGuarantee = o.starterGuarantee === true;
        const promises = isObj(o.promises)
          ? { ...(o.promises.captain ? { captain: true } : {}), ...(o.promises.number ? { number: true } : {}) }
          : {};
        // 카운터 tolerance(FA_SYSTEM §2.8.6) — {salaryUp:number}만, 유효 양수일 때만 보존(미설정/손상=드롭 → 0드리프트).
        const ct = isObj(o.counterTolerance) && typeof o.counterTolerance.salaryUp === 'number'
          && Number.isFinite(o.counterTolerance.salaryUp) && o.counterTolerance.salaryUp > 0
          ? { counterTolerance: { salaryUp: Math.round(o.counterTolerance.salaryUp) } } : {};
        out[id] = { salary, years, starterGuarantee, promises, ...(o.aggressive === true ? { aggressive: true } : {}), ...ct };
      }
      return out;
    }
    case 'staffHeadTimeline': {
      // 감독 부임 타임라인(축3) — Record<teamId, {fromDay:number, coachId:string|null}[]>. 손상 세그먼트/비배열 값은 제거(안전).
      if (!isObj(v)) return {};
      const out: Record<string, unknown> = {};
      for (const [tid, segs] of Object.entries(v)) {
        if (!Array.isArray(segs)) continue;
        const clean = segs.filter((s) => isObj(s) && typeof s.fromDay === 'number' && Number.isFinite(s.fromDay) && (s.coachId === null || typeof s.coachId === 'string'));
        if (clean.length) out[tid] = clean;
      }
      return out;
    }
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
 * v<2(2026-07-08, A4): 훈련 방침 타임라인 focusLog 도입. 구세이브는 단일 `trainingFocus`(day0부터 소급 적용)라
 *   → `[{fromDay:0, focus:구값}]`로 시드해 **리플레이가 바이트 동일**하게(day0부터 상수 = 옛 동작). trainingFocus 없으면 [].
 * 향후 breaking 변경 시 단계 추가:
 *   if (version < 3) s = v2_to_v3(s);
 */
let _pendingClaimSeed = false;
/** 다이아 기능 이전 세이브였는지(소급 폭탄 방지 시드 필요, §11.3) — rehydrate가 1회 소비. 출력 키 오염 없음. */
export const consumePendingClaimSeed = (): boolean => { const v = _pendingClaimSeed; _pendingClaimSeed = false; return v; };

export function migrateSave(persisted: unknown, _version: number): Record<string, unknown> {
  // 다이아 기능 이전 세이브(진행 중)는 claimedAch 키가 없다 → 현 달성분을 claimed로 시드(rehydrate에서).
  if (isObj(persisted) && persisted.claimedAch === undefined && !!persisted.selectedTeamId) _pendingClaimSeed = true;
  const out = sanitizeSave(persisted);
  // FA 오퍼 모델 마이그레이션(FA_SYSTEM §2.8 Phase1) — 구 faSignings[]+faAggressive → faOffers 기본 오퍼.
  //   salary:'auto'(해석 시점 asking×(aggressive?1.2:1)) — 구 aggressive=on이면 aggressive 마커를 박아 ×1.2를 정확히 재현(결과 바이트 동일).
  //   조건: 구 필드가 있고 faOffers가 아직 없을 때만(신규 세이브 보호). sanitizeSave가 out.faOffers를 {}로 둔 걸 덮어쓴다.
  if (isObj(persisted) && (persisted.faSignings !== undefined || persisted.faAggressive !== undefined) && !isObj((persisted as Record<string, unknown>).faOffers)) {
    const signings = Array.isArray(persisted.faSignings) ? persisted.faSignings : [];
    const aggr = persisted.faAggressive === true;
    const off: Record<string, unknown> = {};
    for (const id of signings) {
      if (typeof id !== 'string') continue;
      off[id] = { salary: 'auto', years: 2, starterGuarantee: false, promises: {}, ...(aggr ? { aggressive: true } : {}) };
    }
    out.faOffers = off;
  }
  // A4 마이그레이션 — focusLog 없던 구세이브: 단일 trainingFocus를 [{fromDay:0}]로 시드(day0부터 상수 = 옛 리플레이와 바이트 동일).
  //   신규 세이브는 focusLog를 항상 함께 저장하므로 비어있으면 = 구세이브(또는 방침 미설정). trainingFocus 있을 때만 시드.
  if ((out.focusLog as unknown[]).length === 0 && out.trainingFocus) {
    out.focusLog = [{ fromDay: 0, focus: out.trainingFocus }];
  }
  // v3 마이그레이션(A안, 포스트시즌 달력 편입) — 이미 우승 확정된 시즌(archive[season].championId 존재)인데
  //   currentDay가 정규 범위(≤183 미만)에 있으면 포스트시즌 종료일로 승격 → 오프시즌 직행(재관전 강요 금지).
  //   진화 조회는 min(day, SEASON_DAYS) 클램프라 currentDay 승격이 스탯·순위·생산에 무영향(동결 규칙).
  {
    const season = out.season as number;
    const archive = out.archive as Array<{ season?: number; championId?: string }>;
    const done = Array.isArray(archive) && archive.some((a) => a && a.season === season && !!a.championId);
    if (done && (out.currentDay as number) < POSTSEASON_LAST_DAY) out.currentDay = POSTSEASON_LAST_DAY;
  }
  return out;
}
