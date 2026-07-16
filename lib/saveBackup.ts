// 시즌 종료 서버 백업 (SAVE_SYSTEM §10) — 클라우드 안전망.
//   자동 업로드: endSeason 완주 직후 fire-and-forget(조용한 실패 — 게임 진행 무영향·무알림).
//   재시도    : 부팅(로그인 후) 1회 — "현재 season > 마지막 백업 시즌"이면. 오프라인이면 통과.
//   복원      : 설정에서 목록→선택→기존 가져오기 파이프라인(§9.3 saveTransfer) 그대로.
//
// 불변식(§9와 동일): payload 스키마·SAVE_VERSION·migrate·sanitizeSave·partialize 무접촉.
//   업로드 원천 = captureReplaySave() → buildExportPayload+serializeExport(재사용 — 새 포맷 금지).
//   "마지막 백업 시즌"은 세이브 payload가 아니라 **AsyncStorage 별도 키**(계정별)에 비영속으로 — 스키마 69필드 불변.
// 서버 통신은 lib/server.ts 패턴 미러(Bearer·타임아웃·throw 없음). 라이브 왕복은 서버측 가드(_dv_backup_live)가 커버.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildExportPayload, serializeExport } from './saveTransfer';
import { captureReplaySave } from '../store/useGameStore';
import { useAuthStore } from '../store/useAuthStore';
import { logError } from './log';

const REQ_TIMEOUT_MS = 15000; // 백업 페이로드는 수백KB — 대화형 8s보다 상향(진단 스냅샷 업로드와 같은 결)
const LAST_KEY_PREFIX = 'baeknyeon-backup-last'; // AsyncStorage 별도 키(세이브 스키마 밖 — §10 불변식)

// ── ① 순수: 재시도 판정 (부팅 후 1회) ──────────────────────────────────────
/** 현재 세이브가 마지막 성공 백업보다 앞서면(=시즌 종료 백업 유실) 재시도 필요. 오프라인이면 항상 false(통과). */
export function shouldRetryBackup(lastBackupSeason: number | null, currentSeason: number, online: boolean): boolean {
  if (!online) return false; // 오프라인 → 재시도 안 함(다음 온라인 부팅에서)
  return currentSeason > (lastBackupSeason ?? -1); // 이력 없음(null)=−1 취급 → 진행 중이면 최초 1회 업로드
}

// ── ② 순수: 업로드 바디 빌더 (saveTransfer 재사용 — 새 포맷 금지) ───────────
export interface BackupBody { season: number; payload: string }
/** capture({state,version}) → 서버 바디. payload는 §9.1 봉투 문자열 그대로(파일 export와 바이트 동일). */
export function buildBackupBody(capture: { state: Record<string, unknown>; version: number }, season: number): BackupBody {
  return { season, payload: serializeExport(buildExportPayload(capture)) };
}

// ── 서버 클라 (lib/server.ts 패턴 미러) ────────────────────────────────────
export interface BackupMeta { id: string; season: number; createdAt: string; sizeBytes: number; saveVersion: number }
type Fail = { ok: false; reason: 'offline' | 'unauthorized' | 'error' };
export type BackupResult<T> = ({ ok: true } & T) | Fail;

// base·token은 호출 시점 조회(env·세션은 런타임 확정 — 지연 읽기라 테스트 시임 아님).
function serverBase(): string { return (process.env.EXPO_PUBLIC_SERVER_URL ?? '').replace(/\/$/, ''); }
function bearer(): string | null { return useAuthStore.getState().session?.token || null; }
/** 서버 백업이 지금 가능한가(주소 설정 + 로그인 세션 있음). */
export function isBackupConfigured(): boolean { return !!serverBase() && !!bearer(); }

/** 공통 호출 — throw 없이 typed 결과. 서버 미설정/네트워크/타임아웃 = offline로 흡수(조용). */
async function req<T>(path: string, init?: RequestInit): Promise<BackupResult<T>> {
  const base = serverBase();
  const token = bearer();
  if (!base || !token) return { ok: false, reason: 'offline' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    const res = await fetch(base + path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    clearTimeout(timer);
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    let body: unknown = {};
    try { body = await res.json(); } catch { /* 빈/비JSON 허용 */ }
    const b = (body ?? {}) as Record<string, unknown>;
    if (!res.ok || b.ok === false) return { ok: false, reason: 'error' };
    return { ok: true, ...(b as T) };
  } catch (e) {
    logError('saveBackup:' + path, e);
    return { ok: false, reason: 'offline' };
  }
}

/** 시즌 백업 업로드(POST). 서버는 계정당 최근 5개 유지(keptCount). */
export function uploadBackup(body: BackupBody): Promise<BackupResult<{ id: string; keptCount: number }>> {
  return req('/api/save-backup', { method: 'POST', body: JSON.stringify(body) });
}
/** 서버 백업 목록(최신순). */
export function listBackups(): Promise<BackupResult<{ backups: BackupMeta[] }>> {
  return req('/api/save-backup');
}
/** 단일 백업 payload 다운로드(복원용). */
export function fetchBackup(id: string): Promise<BackupResult<{ payload: string }>> {
  return req('/api/save-backup/' + encodeURIComponent(id));
}

// ── 마지막 성공 백업 시즌 (계정별 별도 키 — 세이브 payload 밖) ──────────────
function lastKey(userId: string): string { return `${LAST_KEY_PREFIX}:${userId}`; }
/** 마지막 성공 백업 시즌 읽기(없음=null). 손상값 방어(유한수만). */
export async function readLastBackupSeason(userId: string): Promise<number | null> {
  try {
    const v = await AsyncStorage.getItem(lastKey(userId));
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
async function writeLastBackupSeason(userId: string, season: number): Promise<void> {
  try { await AsyncStorage.setItem(lastKey(userId), String(season)); } catch { /* 조용 */ }
}

// ── 오케스트레이션: 시즌 종료 자동 업로드 (fire-and-forget) ─────────────────
/** endSeason 커밋 직후 호출. 절대 throw 안 함·store 무접촉(결정론·바이트 불변). 실패는 조용(무알림). */
export async function triggerSeasonBackup(): Promise<void> {
  try {
    const userId = useAuthStore.getState().session?.userId;
    if (!userId) return; // 로그인 세션 없음(익명/로컬) → 조용히 통과
    const cap = captureReplaySave();
    if (!cap || !cap.state.selectedTeamId) return; // 진행 중 구단 없으면 백업 안 함
    const season = typeof cap.state.season === 'number' && Number.isFinite(cap.state.season) ? cap.state.season : 0;
    const r = await uploadBackup(buildBackupBody(cap, season));
    if (r.ok) await writeLastBackupSeason(userId, season);
  } catch (e) {
    logError('saveBackup:trigger', e); // 조용 — 게임 진행 무영향
  }
}

// ── 부팅(로그인 후) 1회 재시도 ──────────────────────────────────────────────
let bootRetryDone = false; // 세션당 1회(모듈 플래그, 비영속) — "1회 재시도"
/** 슬롯 로드 완료 시점(onRehydrateStorage) 호출. 현재 세이브가 마지막 백업보다 앞서면 1회 업로드. */
export async function retryBackupOnBoot(): Promise<void> {
  if (bootRetryDone) return;
  bootRetryDone = true;
  try {
    const userId = useAuthStore.getState().session?.userId;
    if (!userId) return;
    const cap = captureReplaySave();
    if (!cap || !cap.state.selectedTeamId) return;
    const season = typeof cap.state.season === 'number' && Number.isFinite(cap.state.season) ? cap.state.season : 0;
    const last = await readLastBackupSeason(userId);
    if (!shouldRetryBackup(last, season, isBackupConfigured())) return;
    await triggerSeasonBackup();
  } catch (e) {
    logError('saveBackup:bootRetry', e);
  }
}
