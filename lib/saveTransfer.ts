// 세이브 내보내기/가져오기 — 순수 빌더/파서 (SAVE_SYSTEM §9). React 무의존 → 헤드리스 가드로 왕복 검증.
//   내보내기 원천은 captureReplaySave()의 {state, version}(persist 저장본과 바이트 동일).
//   가져오기 검증·정규화는 §3의 migrateSave/sanitizeSave를 재사용한다 — 새 로직 없음, 파일 입출력의 봉투 래퍼일 뿐.
// UI(app/settings.tsx)는 이 모듈 + expo-file-system/sharing/document-picker로 파일 I/O·다이얼로그만 맡는다.
import { SAVE_VERSION, migrateSave, sanitizeSave, consumePendingClaimSeed } from '../store/saveMigration';

/** 봉투 식별 태그 — 아무 JSON을 세이브로 오인해 덮어쓰는 사고 차단(가져오기 1차 게이트). */
export const EXPORT_APP = 'baeknyeon';
export const EXPORT_KIND = 'save-export';

export interface ExportPayload {
  app: typeof EXPORT_APP;
  kind: typeof EXPORT_KIND;
  version: number;
  state: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** captureReplaySave() 산출({state, version})을 파일 봉투로 감싼다(§9.1). state는 partialize 산출 통째(손 선별 금지). */
export function buildExportPayload(capture: { state: Record<string, unknown>; version: number }): ExportPayload {
  return { app: EXPORT_APP, kind: EXPORT_KIND, version: capture.version, state: capture.state };
}

/** 파일명 `baeknyeon-save-s<season+1>-d<currentDay>.json`(season 0-based → 표시 +1). 손상 필드는 안전 기본. */
export function exportFileName(state: Record<string, unknown>): string {
  const season = typeof state.season === 'number' && Number.isFinite(state.season) ? state.season : 0;
  const day = typeof state.currentDay === 'number' && Number.isFinite(state.currentDay) ? state.currentDay : 0;
  return `baeknyeon-save-s${season + 1}-d${day}.json`;
}

/** 봉투를 pretty JSON 문자열로(파일 기록·공유 폴백 공용). */
export function serializeExport(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export type ParseResult =
  | { ok: true; state: Record<string, unknown>; version: number }
  | { ok: false; reason: string };

/**
 * 파일 텍스트 → 봉투 검증(§9.3-2). 실패는 항상 사유와 함께 반환(호출부가 현재 세이브 무접촉으로 거부).
 * - JSON 파싱 실패 / app·kind 불일치 / state 비객체(배열·누락) → 거부.
 * - version > SAVE_VERSION → 미래 스키마 거부(구버전 세이브에 신필드 손실 위험 차단).
 */
export function parseImportPayload(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: '파일을 읽을 수 없어요. 배구명가에서 내보낸 세이브 파일이 맞는지 확인해 주세요.' };
  }
  if (!isObj(parsed)) return { ok: false, reason: '세이브 파일 형식이 아니에요.' };
  if (parsed.app !== EXPORT_APP) return { ok: false, reason: '배구명가 세이브 파일이 아니에요.' };
  if (parsed.kind !== EXPORT_KIND) return { ok: false, reason: '세이브 내보내기 파일이 아니에요.' };
  if (!isObj(parsed.state)) return { ok: false, reason: '세이브 내용이 손상됐어요(구단 데이터를 찾을 수 없어요).' };
  const version = typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 0;
  if (version > SAVE_VERSION) {
    return { ok: false, reason: '이 세이브는 더 최신 버전의 앱에서 만들어졌어요. 앱을 최신으로 업데이트한 뒤 가져올 수 있어요.' };
  }
  return { ok: true, state: parsed.state, version };
}

export type DryRunResult =
  | { ok: true; sanitized: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * 드라이런 게이트(§9.3-3) — 스토리지 **쓰기 전** 순수 검증. 실패면 현재 세이브를 절대 건드리지 않는다.
 *   ① sanitizeSave(migrateSave(...))가 유효 스키마를 산출하는가(§3 그대로).
 *   ② 최소 유효성:
 *      - selectedTeamId가 유효 문자열(진행 중 구단 진입점).
 *      - playerBase가 비-null이면 모든 엔트리가 객체(엔트리 null/비객체는 commitPlayerBase의 p.traits에서 throw →
 *        §3.3 안전망이 fresh 리셋 → 현재 세이브 전손. _dv_migrate_e2e ③ 크래시 벡터). 이걸 쓰기 전에 걸러 낸다.
 */
export function dryRunImport(state: Record<string, unknown>, version: number): DryRunResult {
  let sanitized: Record<string, unknown>;
  try {
    sanitized = sanitizeSave(migrateSave(state, version));
  } catch {
    // migrate/sanitize는 순수 코어스(throw 없음)라 정상 경로엔 안 옴 — 방어적.
    consumePendingClaimSeed();
    return { ok: false, reason: '세이브를 복원하는 중 문제가 발생했어요. 파일이 손상됐을 수 있어요.' };
  }
  // migrateSave의 소급 시드 플래그(§11.3)를 드라이런에서 소비해 부작용을 정리 — 실제 적용 시 rehydrate가 다시 정확히 설정.
  consumePendingClaimSeed();

  const team = sanitized.selectedTeamId;
  if (typeof team !== 'string' || team === '') {
    return { ok: false, reason: '이 파일에는 진행 중인 구단이 없어요. 구단을 선택하고 저장된 세이브만 가져올 수 있어요.' };
  }
  const pb = sanitized.playerBase;
  if (pb !== null) {
    if (!isObj(pb)) return { ok: false, reason: '세이브의 선수 데이터가 손상됐어요.' };
    for (const v of Object.values(pb)) {
      if (!isObj(v) || typeof (v as Record<string, unknown>).id !== 'string') {
        return { ok: false, reason: '세이브의 선수 데이터가 손상됐어요.' };
      }
    }
  }
  return { ok: true, sanitized };
}
