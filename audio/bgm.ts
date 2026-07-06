// 배경음악(BGM) — UI 레이어 전용. 엔진(/engine)은 오디오를 모른다(순수성·결정론 유지).
// 설계 정본: docs/SOUND_SYSTEM.md §2. 10곡을 고정 순서로 순환(랜덤 아님 — 결정론).
// 단일 플레이어 1개 + player.replace(source) 전환(더블버퍼 금지 — 독립 리뷰 결정).
import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';
import { AppState, type AppStateStatus } from 'react-native';

type Player = ReturnType<typeof createAudioPlayer>;

// static require — 번들 타임 평가(파일이 실제로 있어야 함). 등록만: 실제 플레이어는 1개.
const TRACKS: number[] = [
  require('../assets/bgm/bgm_01.m4a'),
  require('../assets/bgm/bgm_02.m4a'),
  require('../assets/bgm/bgm_03.m4a'),
  require('../assets/bgm/bgm_04.m4a'),
  require('../assets/bgm/bgm_05.m4a'),
  require('../assets/bgm/bgm_06.m4a'),
  require('../assets/bgm/bgm_07.m4a'),
  require('../assets/bgm/bgm_08.m4a'),
  require('../assets/bgm/bgm_09.m4a'),
  require('../assets/bgm/bgm_10.m4a'),
];

// TRACKS 길이(가드 _dv_bgm가 참조 — assets 파일 수와 대조)
export const BGM_TRACK_COUNT = TRACKS.length;

// ── 오디오 모드 단일화(SOUND_SYSTEM §2.7) ──
// setAudioModeAsync 호출은 여기 한 곳뿐. audio/sfx.ts는 이 함수를 재사용(두 파일 중복 금지, 상호참조).
let audioModeSet = false;
/** 폰 무음 스위치 존중(playsInSilentMode:false) + 다른 앱 오디오와 공존(mixWithOthers). 멱등. */
export function ensureAudioMode(): void {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  } catch { /* 오디오 불가 환경 — 무시(게임은 정상) */ }
}

// ── 상태 모델(SOUND_SYSTEM §2.4) — 명령형 pause/resume 금지, 플래그 + applyState 단일화 ──
let player: Player | null = null;
let idx = 0;              // 현재 트랙 인덱스(0..9)
let started = false;      // startBgm 됐는가(루트 1회)
let suppressed = false;   // 경기 화면인가(관전 중 = 정지)
let backgrounded = false; // 앱이 백그라운드인가(AppState)
let volume = 0.8;         // 0..1
let advancing = false;    // didJustFinish 중복 전진 차단(in-flight)
let ended = false;        // 백그라운드 중 곡 종료 감지(자가치유용)
let rampTimer: ReturnType<typeof setInterval> | null = null;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/** 유일한 재생/정지 진입점. desired를 계산해 play/pause. */
function applyState(): void {
  if (!player) return;
  const desired = started && !suppressed && !backgrounded && volume > 0;
  try {
    if (desired) {
      if (!player.playing) player.play();
    } else {
      if (player.playing) player.pause();
    }
  } catch { /* 오디오 불가 — 무시 */ }
}

/** 다음 곡으로 전진(모듈러 순환). 소스만 바꾸고 재생 여부는 applyState가 결정(백그라운드면 정지 유지). */
function advanceTrack(): void {
  if (!player || advancing) return;
  advancing = true;
  ended = false;
  idx = (idx + 1) % TRACKS.length;
  try {
    player.replace(TRACKS[idx]);
    player.volume = volume;
  } catch { /* 무시 */ }
  applyState();
  advancing = false;
}

function onStatus(status: AudioStatus): void {
  if (status.didJustFinish) {
    if (backgrounded) { ended = true; return; } // 복귀 시 자가치유가 전진
    advanceTrack();
  }
}

function onAppState(next: AppStateStatus): void {
  if (next === 'active') {
    backgrounded = false;
    if (ended) advanceTrack(); // 백그라운드 중 끝나 있었으면 다음 곡으로(자가치유)
    else applyState();
  } else {
    backgrounded = true;
    applyState();
  }
}

// Fast Refresh 가드(SOUND_SYSTEM) — __DEV__ 모듈 재평가 시 이전 플레이어/구독 정리(이중재생 방지).
type Reg = { player: Player | null; statusSub: { remove(): void } | null; appSub: { remove(): void } | null };
const G = globalThis as unknown as { __bgmReg?: Reg };

let statusSub: { remove(): void } | null = null;
let appSub: { remove(): void } | null = null;

/** 부트 1회 — 오디오 모드 + 단일 플레이어 생성 + 리스너 부착. 멱등. */
export function initBgm(): void {
  if (player) return;
  ensureAudioMode();
  // Fast Refresh: 이전 인스턴스 정리
  if (__DEV__ && G.__bgmReg) {
    try { G.__bgmReg.statusSub?.remove(); } catch { /* noop */ }
    try { G.__bgmReg.appSub?.remove(); } catch { /* noop */ }
    try { G.__bgmReg.player?.remove(); } catch { /* noop */ }
  }
  try {
    idx = 0;
    const p = createAudioPlayer(TRACKS[idx]);
    p.loop = false; // 필수: true면 didJustFinish 미발화 → 다음 곡 못 감
    p.volume = volume;
    statusSub = p.addListener('playbackStatusUpdate', onStatus);
    appSub = AppState.addEventListener('change', onAppState);
    player = p;
    if (__DEV__) G.__bgmReg = { player: p, statusSub, appSub };
  } catch { /* 오디오 불가 — 무음으로 계속(게임 정상) */ }
}

/** 재생 시작(멱등 — 이미 시작이면 no-op). 시작 시 1.5초 페이드인. */
export function startBgm(): void {
  if (started) return;
  started = true;
  applyState();
  fadeIn();
}

/** 경기 화면 진입/이탈(true=정지). */
export function setBgmSuppressed(v: boolean): void {
  suppressed = v;
  applyState();
}

/** 0..1 클램프 후 즉시 반영. v==0이면 pause(위치 보존), >0 복귀 시 재생. */
export function setBgmVolume(v: number): void {
  const nv = clamp01(v);
  if (nv === volume) { applyState(); return; } // 동일값 — 램프/현 볼륨 미변경(부트 시 볼륨동기화가 페이드인을 죽이지 않게)
  volume = nv;
  if (rampTimer) { clearInterval(rampTimer); rampTimer = null; } // 실제 변경이면 램프보다 수동조정 우선
  if (player) { try { player.volume = volume; } catch { /* noop */ } }
  applyState();
}

/** 시작 시 1.5초 볼륨 램프(0→목표). 저비용 setInterval. */
function fadeIn(): void {
  if (!player || volume <= 0) return;
  const target = volume;
  const steps = 15;
  let i = 0;
  try { player.volume = 0; } catch { /* noop */ }
  if (rampTimer) clearInterval(rampTimer);
  rampTimer = setInterval(() => {
    i += 1;
    if (!player || i >= steps) {
      if (player) { try { player.volume = target; } catch { /* noop */ } }
      if (rampTimer) { clearInterval(rampTimer); rampTimer = null; }
      return;
    }
    try { player.volume = target * (i / steps); } catch { /* noop */ }
  }, 100);
}
