// 시뮬 결과 캐시 영속 (REALTIME_SIM_SYSTEM Phase1) — 계산된 시즌 결과(순위·생산)를 세이브에 저장하고
// 재로드 시 복원해 **재계산(로딩)을 제거**한다. 결정론(Phase0 수정)이라 같은 키면 행이 동일 → 저장값 재사용 안전.
// 재생 엔진은 폴백으로 유지(G2): 상태가 바뀌면 키 불일치 → 자동 재계산. 캐시는 폐기 가능(구세이브 없으면 그냥 재계산).
import { baseVersion, setBaseVersion } from './league';
import { currentTxVersion, setTxVersion } from './dynamics';
import { getStandingsCacheRaw, setStandingsCacheRaw, type ResultRow } from './standings';
import { getProductionCacheRaw, setProductionCacheRaw, type ProdRow } from './production';
import { ENGINE_VERSION } from '../engine/match';

export interface SimCache {
  baseVersion: number;
  txVersion: number;
  engineVersion: number; // 경기 엔진 버전(G3) — 다르면 재로드 시 폐기(엔진 재튜닝 후 옛 결과 박제 방지)
  standings?: ResultRow[]; // 워밍된 것만(독립) — 화면마다 순위/생산이 따로 워밍되므로
  production?: ProdRow[];
}

/** 저장 시점 캐시 캡처 — 순위·생산 **각각 현재 키로 워밍됐을 때만** 포함(stale 저장 금지). 둘 다 없으면 undefined. */
export function captureSimCache(): SimCache | undefined {
  const key = `${baseVersion()}:${currentTxVersion()}`;
  const s = getStandingsCacheRaw();
  const p = getProductionCacheRaw();
  const standings = s && s.key === key ? s.rows : undefined;
  const production = p && p.key === key ? p.rows : undefined;
  if (!standings && !production) return undefined;
  return { baseVersion: baseVersion(), txVersion: currentTxVersion(), engineVersion: ENGINE_VERSION, standings, production };
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
  if (Array.isArray(c.production)) setProductionCacheRaw({ key, rows: c.production });
}
