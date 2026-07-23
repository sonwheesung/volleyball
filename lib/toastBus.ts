// 전역 토스트 버스(순수 pub/sub) — 컴포넌트 밖(store 액션·포그라운드 배선)에서 비차단 토스트를 띄우는 유일 경로.
// UI 무의존(React 없음) → store(상태계층)가 안전하게 import(레이어 방향 store→lib 유지). 표시는 components/Toast의
//   GlobalToastHost가 이 버스를 구독해 담당(UI→lib). 출석 패스 자동 수령 토스트(ATTENDANCE_PASS_SYSTEM §2.3·UI.2)용.
type ToastListener = (text: string) => void;
const listeners = new Set<ToastListener>();

// 콜드부트 레이스 버퍼: 호스트가 마운트되기 **직전**에 방출된 토스트(예: 부팅 시 자동 수령 claim이 GlobalToastHost의
//   useEffect 구독보다 먼저 emit)를 잠깐 보관했다가, 첫 구독자가 붙으면 흘려보낸다. 없으면 부팅 직후 수령 토스트가
//   소리 없이 사라진다(관전형 = 보는 경험 손실). 짧은 TTL·소량 상한이라 지연/누수 없음.
const PENDING_TTL_MS = 8000;
const PENDING_MAX = 5;
let pending: string[] = [];
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/** 토스트 리스너 등록 — GlobalToastHost가 마운트 시 호출. 구독 순간 대기 중이던(콜드부트) 토스트를 즉시 흘린다. 해제 함수 반환. */
export function subscribeToast(l: ToastListener): () => void {
  listeners.add(l);
  if (pending.length) {
    const flush = pending; pending = [];
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = undefined; }
    for (const t of flush) { try { l(t); } catch { /* 격리 */ } }
  }
  return () => { listeners.delete(l); };
}

/** 전역 비차단 토스트 발행 — 구독 호스트가 있으면 즉시 표시. 없으면 짧게 버퍼링(콜드부트 레이스) 후 첫 구독자에게 흘림. throw 없음. */
export function emitGlobalToast(text: string): void {
  if (listeners.size === 0) {
    pending.push(text);
    if (pending.length > PENDING_MAX) pending.shift();
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pending = []; pendingTimer = undefined; }, PENDING_TTL_MS);
    return;
  }
  for (const l of listeners) { try { l(text); } catch { /* 리스너 오류 격리 */ } }
}
