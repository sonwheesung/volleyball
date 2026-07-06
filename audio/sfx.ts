// 경기 보드 효과음(휘슬·스파이크·서브) — UI 레이어 전용. 엔진(/engine)은 오디오를 모른다(순수성 유지).
// 음원: 합성 효과음(assets/audio/*.wav, 44.1kHz·16bit·모노 — 2026-06-28 numpy 합성으로 무음 플레이스홀더 교체).
//   더 좋은 음원으로 바꾸려면 같은 파일명으로 덮으면 끝(코드 무변경). 다른 확장자면 아래 SOURCES require만 변경.
import { createAudioPlayer } from 'expo-audio';
import { ensureAudioMode } from './bgm'; // 오디오 모드는 BGM 매니저가 단일 소유(SOUND_SYSTEM §2.7) — 여기선 재사용

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
    // 폰 무음 스위치 존중(관전형) + 다른 앱 오디오와 공존 — 설정은 BGM 매니저와 공유(중복 금지, audio/bgm.ts)
    ensureAudioMode();
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
