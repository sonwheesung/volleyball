// 경기 보드 효과음(휘슬·스파이크·서브) — UI 레이어 전용. 엔진(/engine)은 오디오를 모른다(순수성 유지).
// 음원은 무음 플레이스홀더(assets/audio/*.wav) — 실제 음원으로 같은 파일명으로 교체하면 바로 소리난다.
//   (다른 확장자면 아래 SOURCES require 경로만 변경) — 상세: audio/README.md
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

export type SfxKey = 'serve' | 'spike' | 'whistle';
type Player = ReturnType<typeof createAudioPlayer>;

// require는 번들 타임에 평가(파일이 실제로 있어야 함 — 무음 플레이스홀더가 그 역할)
const SOURCES: Record<SfxKey, number> = {
  serve: require('../assets/audio/serve.wav'),
  spike: require('../assets/audio/spike.wav'),
  whistle: require('../assets/audio/whistle.wav'),
};

let enabled = true;
let ready = false;
const players: Partial<Record<SfxKey, Player>> = {};
const lastPlayed: Partial<Record<SfxKey, number>> = {};

/** 설정 토글과 동기화(MatchCourt가 sfxEnabled 변화 시 호출) */
export function setSfxEnabled(v: boolean): void { enabled = v; }

/** 보드 진입 시 1회 — 오디오 모드 + 플레이어 프리로드. 실패해도 게임 진행엔 영향 없음(무음으로 계속). */
export function initSfx(): void {
  if (ready) return;
  ready = true;
  try {
    // 폰 무음 스위치 존중(관전형 — 조용히 보고 싶은 사람을 방해 안 함) + 다른 앱 오디오와 공존
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    for (const k of Object.keys(SOURCES) as SfxKey[]) {
      const p = createAudioPlayer(SOURCES[k]);
      p.volume = k === 'whistle' ? 0.7 : 0.9;
      players[k] = p;
    }
  } catch {
    /* 오디오 불가 환경 — 무음으로 계속(게임은 정상) */
  }
}

/** 짧은 효과음 발사(fire-and-forget). 비활성/미준비/직전 중복(같은 구간 재실행)은 무시. */
export function playSfx(key: SfxKey): void {
  if (!enabled) return;
  const p = players[key];
  if (!p) return;
  const now = Date.now();
  if (now - (lastPlayed[key] ?? 0) < 60) return; // 같은 구간 이펙트 재실행 등 중복 방지
  lastPlayed[key] = now;
  try { p.seekTo(0); p.play(); } catch { /* 무시 — 한 컷 소리 안 나도 무방 */ }
}
