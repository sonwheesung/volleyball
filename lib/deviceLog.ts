// 기기 진단 로그 롤링 버퍼 (BACKEND_SYSTEM §7·§13.6, #44 기기 절반) — **유지보수용** 로그이지 게임 기록이 아니다.
// 시즌 태그로 쌓고 **최근 KEEP_SEASONS 시즌만 유지**(예: 15시즌이면 5시즌 이하 prune). 문의 제출 시 진단 스냅샷에
// 첨부(대부분 문의가 히스토리 오류라 최근 이력이 핵심). AsyncStorage로 재시작에도 유지, 쓰기는 디바운스(A6 교훈).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from './log';

export interface DiagLogEntry {
  t: number; // epoch ms
  season: number;
  cat: string; // 카테고리(예: 'save', 'sim', 'wallet', 'error')
  msg: string;
  data?: unknown;
}

export const KEEP_SEASONS = 10; // 최근 N시즌 유지
const MAX_ENTRIES = 4000; // 하드 상한(폭주 방지 — 시즌 prune과 별개 안전망)
const STORAGE_KEY = 'diagLog.v1';
const FLUSH_DEBOUNCE_MS = 1500;

// ── 순수 헬퍼(AsyncStorage 무관 — tsx로 검증 가능) ──
/** 최근 keep 시즌 밖(< maxSeason-keep+1) 엔트리 제거 + 하드 상한(오래된 것부터). */
export function pruneBySeasons(entries: DiagLogEntry[], keep = KEEP_SEASONS, max = MAX_ENTRIES): DiagLogEntry[] {
  if (entries.length === 0) return entries;
  const maxSeason = entries.reduce((m, e) => Math.max(m, e.season), 0);
  const floor = maxSeason - keep + 1; // 이 시즌 이상만 유지
  let out = entries.filter((e) => e.season >= floor);
  if (out.length > max) out = out.slice(out.length - max); // 오래된 것부터 버림
  return out;
}

/** 스냅샷용 — [currentSeason-keep+1 .. currentSeason] 범위 엔트리(시간순). */
export function entriesInRange(entries: DiagLogEntry[], currentSeason: number, keep = KEEP_SEASONS): DiagLogEntry[] {
  const floor = currentSeason - keep + 1;
  return entries.filter((e) => e.season >= floor && e.season <= currentSeason).sort((a, b) => a.t - b.t);
}

// ── 스테이트풀 버퍼 ──
let buf: DiagLogEntry[] = [];
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) buf = JSON.parse(raw) as DiagLogEntry[];
  } catch (e) {
    logError('deviceLog.load', e);
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(buf)).catch((e) => logError('deviceLog.flush', e));
  }, FLUSH_DEBOUNCE_MS);
}

/** 진단 로그 1건 추가(현재 시즌 태그). throw 안 함. */
export function diag(season: number, cat: string, msg: string, data?: unknown): void {
  void ensureLoaded().then(() => {
    buf.push({ t: nowMs(), season, cat, msg, data });
    buf = pruneBySeasons(buf);
    scheduleFlush();
  });
}

/** 스냅샷에 첨부할 최근 KEEP_SEASONS 로그. */
export async function getSnapshotLogs(currentSeason: number): Promise<DiagLogEntry[]> {
  await ensureLoaded();
  return entriesInRange(buf, currentSeason);
}

export async function clearDiag(): Promise<void> {
  buf = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    logError('deviceLog.clear', e);
  }
}

function nowMs(): number {
  return Date.now();
}
