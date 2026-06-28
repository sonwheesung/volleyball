// 시뮬 결과 캐시 영속 (REALTIME_SIM_SYSTEM Phase1) — 계산된 시즌 결과(순위·생산)를 세이브에 저장하고
// 재로드 시 복원해 **재계산(로딩)을 제거**한다. 결정론(Phase0 수정)이라 같은 키면 행이 동일 → 저장값 재사용 안전.
// 재생 엔진은 폴백으로 유지(G2): 상태가 바뀌면 키 불일치 → 자동 재계산. 캐시는 폐기 가능(구세이브 없으면 그냥 재계산).
import { baseVersion, setBaseVersion } from './league';
import { currentTxVersion, setTxVersion, getDynCacheRaw, setDynCacheRaw, type Dyn, type InjurySpan, type Tx, type ScandalSpan } from './dynamics';
import { getStandingsCacheRaw, setStandingsCacheRaw, type ResultRow } from './standings';
import { getProductionCacheRaw, setProductionCacheRaw, type ProdRow } from './production';
import type { ProdLine } from '../engine/production';
import { ENGINE_VERSION } from '../engine/match';

// dyn(부상/거래)은 Map 2개(played·teamDays)를 품어 JSON 직렬화가 안 되므로, 영속용 표현은 Map→엔트리 배열로 평탄화한다.
interface SerializedDyn {
  injuries: InjurySpan[]; txLog: Tx[]; scandals: ScandalSpan[];
  played: [string, number[]][]; teamDays: [string, number[]][];
}

// ProdRow도 Set(homeIds·starters) + Map(lines)을 품어 JSON으로 죽는다(Phase1 미직렬화 잠복 버그, 2026-06-28 수정):
// 저장하면 {}로 복원돼 `for..of mp.lines`가 "iterator method is not callable"로 터졌다(대시보드 buildNewsFeed). 평탄화한다.
interface SerializedProdRow {
  dayIndex: number; homeTeamId: string; awayTeamId: string;
  homeIds: string[]; lines: [string, ProdLine][]; starters: string[];
}

export interface SimCache {
  baseVersion: number;
  txVersion: number;
  engineVersion: number; // 경기 엔진 버전(G3) — 다르면 재로드 시 폐기(엔진 재튜닝 후 옛 결과 박제 방지)
  standings?: ResultRow[]; // 워밍된 것만(독립) — 화면마다 순위/생산이 따로 워밍되므로
  production?: SerializedProdRow[];
  dyn?: SerializedDyn;      // 부상/거래 — 재로드 시 availableTeamPlayers/teamInjuriesOn 콜드 재생 제거(2026-06-28)
}

const serializeDyn = (d: Dyn): SerializedDyn => ({
  injuries: d.injuries, txLog: d.txLog, scandals: d.scandals,
  played: [...d.played.entries()], teamDays: [...d.teamDays.entries()],
});
const deserializeDyn = (s: SerializedDyn): Dyn => ({
  injuries: s.injuries, txLog: s.txLog, scandals: s.scandals,
  played: new Map(s.played), teamDays: new Map(s.teamDays),
});

const serializeProd = (rows: ProdRow[]): SerializedProdRow[] => rows.map((r) => ({
  dayIndex: r.dayIndex, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId,
  homeIds: [...r.homeIds], lines: [...r.lines.entries()], starters: [...r.starters],
}));
// 신 포맷(lines가 배열)만 복원. 구 손상 포맷(lines가 {})은 새 포맷이 아니므로 false → production 복원 건너뜀(재계산).
const isSerializedProd = (rows: unknown): rows is SerializedProdRow[] =>
  Array.isArray(rows) && (rows.length === 0 || Array.isArray((rows[0] as { lines?: unknown })?.lines));
const deserializeProd = (rows: SerializedProdRow[]): ProdRow[] => rows.map((r) => ({
  dayIndex: r.dayIndex, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId,
  homeIds: new Set(r.homeIds), lines: new Map(r.lines), starters: new Set(r.starters),
}));

/** 저장 시점 캐시 캡처 — 순위·생산 **각각 현재 키로 워밍됐을 때만** 포함(stale 저장 금지). 둘 다 없으면 undefined. */
export function captureSimCache(): SimCache | undefined {
  const key = `${baseVersion()}:${currentTxVersion()}`;
  const s = getStandingsCacheRaw();
  const p = getProductionCacheRaw();
  const d = getDynCacheRaw();
  const standings = s && s.key === key ? s.rows : undefined;
  const production = p && p.key === key ? serializeProd(p.rows) : undefined;
  const dyn = d && d.key === key ? serializeDyn(d.dyn) : undefined;
  if (!standings && !production && !dyn) return undefined;
  return { baseVersion: baseVersion(), txVersion: currentTxVersion(), engineVersion: ENGINE_VERSION, standings, production, dyn };
}

/** 재로드 복원 — rehydrate **맨 끝**(모든 commit이 카운터를 bump한 뒤)에 호출해야 키가 맞는다. 있는 것만 복원. */
export function restoreSimCache(c: SimCache | undefined): void {
  if (!c || typeof c.baseVersion !== 'number' || typeof c.txVersion !== 'number') return;
  // G3: 엔진 버전 불일치(앱 업데이트로 재튜닝)면 캐시 폐기 → 새 엔진으로 재계산(보드 재생과 일관). 구세이브(버전 없음)도 폐기.
  if (c.engineVersion !== ENGINE_VERSION) return;
  setBaseVersion(c.baseVersion);
  setTxVersion(c.txVersion);
  const key = `${c.baseVersion}:${c.txVersion}`;
  if (Array.isArray(c.standings)) setStandingsCacheRaw({ key, rows: c.standings });
  // production은 신 직렬화 포맷(lines=배열)일 때만 복원 — 구 손상 세이브(lines={})는 건너뛰어 재계산(크래시 차단).
  if (isSerializedProd(c.production)) setProductionCacheRaw({ key, rows: deserializeProd(c.production) });
  // dyn 복원 — played/teamDays 둘 다 배열이어야 유효(부분/손상 세이브는 폴백 재계산). 구세이브(dyn 없음)도 폴백.
  if (c.dyn && Array.isArray(c.dyn.played) && Array.isArray(c.dyn.teamDays)) {
    setDynCacheRaw({ key, dyn: deserializeDyn(c.dyn) });
  }
}
