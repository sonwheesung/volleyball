# 사운드 시스템 (SOUND_SYSTEM)

> 게임의 **오디오 레이어 정본**. 효과음(SFX)과 배경음악(BGM)을 함께 관리한다.
> 오디오는 **UI 레이어 전용** — 엔진(`/engine`)은 소리를 모른다(순수성·결정론 유지, CLAUDE 11장).
> "관전형이 1순위 = 보는(그리고 듣는) 경험"이라 연출 투자처지만, **조용히 보고 싶은 사람**(무음 스위치·볼륨 0)을
> 절대 방해하지 않는다.

★ 구현 현황
| 영역 | 상태 | 핵심 파일 |
|---|---|---|
| 효과음(휘슬·스파이크·서브) | ✅ 구현 | `audio/sfx.ts`·`components/MatchCourt.tsx` |
| 배경음악(BGM 10곡 순환) | ✅ 구현(2026-07-07) | `audio/bgm.ts`·`app/_layout.tsx`·`app/match/[id].tsx`·`app/settings.tsx`·`store` |

---

## 1. 효과음 (SFX)

경기 보드 짧은 효과음. 음원 = 합성 효과음(`assets/audio/*.wav`, 44.1kHz·16bit·모노 — 2026-06-28 numpy 합성으로
무음 플레이스홀더 교체). **같은 파일명으로 실제 음원을 덮으면 코드 수정 없이 바로 소리가 난다.**

| 파일 | 언제 | 비고 |
|---|---|---|
| `serve.wav` | 서버가 공을 때리는 순간(서브 임팩트) | 에이스·서브범실 포함(서브 컨택은 같음) |
| `spike.wav` | 스파이크 **강타** 컨택 | **페인트(연타)·소프트샷은 안 남**(`!to.soft`) — 사용자 요청 |
| `whistle.wav` | 랠리가 끝나 점수가 날 때(종결 휘슬) | 랠리당 1회 |

### 동작
- 엔진 무의존(UI 레이어). 보드(`components/MatchCourt.tsx`)가 구간 이벤트에 맞춰 `playSfx()` 호출.
- 설정 화면 **"효과음"** 토글로 끔/켬(기본 켜짐, 스토어 `sfxEnabled` 영속).
- **폰 무음 스위치 존중** — 무음 모드면 토글이 켜져 있어도 소리 안 남(관전형 — 조용히 보고 싶은 사람 배려).
- 음원 교체: 권장 짧게(0.1~0.4s)·mono·44.1kHz. `wav`/`mp3`/`m4a` 모두 가능(expo-audio). 다른 확장자면 `audio/sfx.ts`
  `SOURCES` require 경로만 변경. **CC0/로열티프리** 권장(라이선스 확인 필수). 음량은 `initSfx()` `p.volume`.

---

## 2. 배경음악 (BGM)

앱을 켜고 있는 동안(인트로·로그인 화면 포함) 조용히 흐르는 배경음악. **경기 관전 중에는 자동으로 멈춘다**(경기
보드 자체 연출·SFX에 자리를 내준다). 10곡을 **고정 순서로 순환**(랜덤 아님 — 결정론·예측가능성).

### 2.1 트랙 (10곡, `assets/bgm/bgm_01.m4a`~`bgm_10.m4a`)

원본 WAV(`C:\game\배구\bgm`)을 ffmpeg로 **AAC .m4a 128kbps·44.1kHz·스테레오** 변환. 파일 순서는 **원곡명
알파벳순(결정론)**. 총 자산 ~27.6MB.

| 파일 | 원곡명 |
|---|---|
| `bgm_01.m4a` | Matchday Flow |
| `bgm_02.m4a` | Neon Velocity |
| `bgm_03.m4a` | Rise of the Court |
| `bgm_04.m4a` | The Final Drive |
| `bgm_05.m4a` | Volleyball Club Anthem |
| `bgm_06.m4a` | Volleyball Club Anthem (1) |
| `bgm_07.m4a` | Volleyball Dynasty |
| `bgm_08.m4a` | Volleyball Victory |
| `bgm_09.m4a` | Volleyball Victory Anthem |
| `bgm_10.m4a` | Volleyball Victory Anthem (1) |

### 2.2 예약 2곡 (이번 제외 — 사용자 결정 2026-07-07)

아래 2곡은 **추후 결승전/우승 전용 BGM**으로 쓰기 위해 순환 목록에서 **의도적으로 제외**했다(원본 WAV에는 존재).
지금은 프로젝트에 넣지 않는다 — 결승/우승 연출을 붙일 때 별도 트랙으로 도입.

| 원곡명 | 용도(예정) |
|---|---|
| Championship Final | 결승전 전용 |
| The Final Bell | 우승 확정 전용 |

### 2.3 재생 모델 (매니저 `audio/bgm.ts`)

- **단일 플레이어 1개 + `player.replace(source)` 전환**(더블버퍼 금지 — 독립 리뷰 결정). `loop=false` 필수
  (`true`면 `didJustFinish`가 발화하지 않아 다음 곡으로 못 넘어간다).
- `addListener('playbackStatusUpdate', …)`의 `didJustFinish` → 다음 곡으로 전진(**모듈러 순환**, 랜덤 아님, 10곡
  후 `bgm_01`로 루프). **in-flight 플래그**로 중복 `didJustFinish`를 1회만 전진(경합 차단).
- **static require** 로 10곡 등록만 하고, 실제 플레이어는 **1개**만 만든다(메모리).

### 2.4 상태 모델 (독립 리뷰 핵심 — 명령형 pause/resume 금지)

명령형 `pause()`/`resume()` 호출이 화면 전환·AppState 이벤트와 순서 경합을 일으키므로, **3개 플래그 + 파생 계산**
한 함수로 단일화한다.

```
started      : startBgm() 됐는가(루트 1회)
suppressed   : 경기 화면인가(관전 중 = 음악 정지)
backgrounded : 앱이 백그라운드인가(AppState)
volume       : 0..1 (0이면 정지 — 배터리)

desired = started && !suppressed && !backgrounded && volume > 0
applyState(): desired면 play(), 아니면 pause()  ← 유일한 재생/정지 진입점
```

- **모든** 상태 변화(startBgm·suppress·AppState·volume)는 플래그만 바꾸고 `applyState()`를 호출한다 →
  AppState × 경기화면 × 볼륨의 순서 경합이 원천 차단된다.
- **일시정지→재개는 위치 보존**(처음부터 재시작 금지). `pause()`는 위치를 유지하고 `play()`가 이어서 튼다.

### 2.5 자가치유 (AppState 'active' 복귀)

- 백그라운드 동안 곡이 끝나면 플랫폼에 따라 `didJustFinish`가 안 올 수 있다. 'active' 복귀 시 **끝난 상태면 다음
  곡으로 전진 후** `applyState()` — 멈춘 채로 남지 않게 자가치유한다.

### 2.6 API

| 함수 | 역할 |
|---|---|
| `initBgm()` | 부트 1회 — 오디오 모드 보장 + 단일 플레이어 생성 + 리스너 부착 + Fast Refresh 가드. 멱등 |
| `startBgm()` | 재생 시작(멱등 — 이미 시작이면 no-op, 중복재생 금지) |
| `setBgmSuppressed(v)` | 경기 화면 진입/이탈(true=정지). `applyState` 경유 |
| `setBgmVolume(v)` | 0..1 클램프 후 플레이어 즉시 반영. **v==0이면 pause(위치 보존)**, >0 복귀 시 재생 |

### 2.7 오디오 모드 단일화

`setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })`는 **BGM 매니저가 부트 시 1회**
호출(`ensureAudioMode()`)하고, `audio/sfx.ts`는 이 함수를 **재사용**한다(두 파일에 동일 설정 중복 금지 — 상호참조
주석). SFX·BGM이 **전역 오디오 모드를 공유**한다.

### 2.8 설계 결정 (독립 리뷰 반영)

| # | 결정 | 이유 |
|---|---|---|
| ① | **`mixWithOthers` 유지** — 유저가 틀어둔 음악과 겹칠 수 있음(의도) | SFX 철학과 일관·전역 오디오 모드 공유. 유저 음악을 끊는(`doNotMix`) 쪽이 오히려 무례. 볼륨 0으로 완전 무음 가능 |
| ② | **volume 0 = pause**(위치 보존) | 볼륨 0으로 소리만 죽이고 디코딩을 계속 돌리면 배터리 낭비 → 아예 정지. >0 복귀 시 이어서 재생 |
| ③ | **128kbps AAC 채택** | 음악 품질/용량 균형(10곡 ~27.6MB). 용량이 문제면 **96kbps 다운그레이드** 옵션 존재(재변환만) |
| ④ | **크로스페이드 배제** | 단일 플레이어 `replace` 전환. 더블버퍼(2 플레이어 겹침)는 상태 경합·메모리 비용 대비 이득 작음 |

> **페이드인**: 시작 시 1.5초 볼륨 램프(저비용). expo-audio 볼륨 즉시반영 특성상 setInterval 램프로 구현.

---

## 3. 설정 (BGM 볼륨 슬라이더)

- 설정 화면(`app/settings.tsx`) "게임" 그룹, **효과음 행 옆에 "BGM" 행 + 슬라이더 0~100%**.
- 슬라이더 = `@react-native-community/slider`(Expo Go 번들 모듈). `onValueChange`→`setBgmVolume` 즉시(라이브 청음),
  `onSlidingComplete`→스토어 커밋(렌더 churn 분리). 표시 % 정수.
- **⚠ EAS 재빌드 필요**: `@react-native-community/slider`는 네이티브 모듈이라 **EAS dev client / 프로덕션 빌드를
  다시 만들어야** 실기기에서 동작한다(Expo Go 앱 자체에는 번들돼 있어 Expo Go 실행은 OK). 새 네이티브 의존이므로
  다음 EAS 빌드 전까지 dev client에는 반영 안 됨.
- 스토어 `bgmVolume`(number, 기본 0.8) 영속 — `sfxEnabled` 선례와 동일(설정 그룹, 세이브 초기화해도 유지).

---

## 4. 검증

### 자동 가드
- `tools/_dv_bgm.ts` — `assets/bgm` 파일 수==10·명명 규칙(`bgm_01`~`bgm_10`)·`bgm.ts` TRACKS require 수 일치·
  `bgmVolume` 마이그레이션 키(SAVE_DEFAULTS·KIND·partialize 3곳) 존재. exit 0/1.
- 회귀 무결성: `npx tsc --noEmit` 0 · `npm test`(207) · `npx tsx tools/checkSubs.ts`.

### 에뮬 청음 체크리스트 (메인 Fable이 커밋 전 수행)
| 케이스 | 확인 |
|---|---|
| 이어재생 | 곡이 끝나면 다음 곡으로 자연 전환(끊김·정지 없음), 10곡 후 01 복귀 |
| 경기 경계 | 경기 보드 진입 시 BGM 정지 → 관전 종료(뒤로가기)로 이탈 시 재개(위치 보존) |
| 볼륨 즉시반영 | 설정 슬라이더 드래그 중 즉시 음량 변화, 0%면 완전 무음(정지) |
| 백그라운드 복귀 | 홈 버튼 후 복귀 시 정지 없이 재생 이어짐(끝나 있었으면 다음 곡) |
| 중복재생 없음 | Fast Refresh·재진입 후에도 트랙이 겹쳐 들리지 않음 |
