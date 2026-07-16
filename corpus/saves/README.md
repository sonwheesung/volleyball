# 세이브 코퍼스 (골든 마스터) — `corpus/saves/`

실제 게임 진행으로 만든 세이브 파일을 저장소에 **박제**한 회귀 코퍼스다(OpenTTD 관행 차용).
목적은 단 하나 — **출시 후 과거 버전 세이브가 새 코드에서 열리는가**를 상설 가드(`tools/_dv_save_corpus.ts`)로 지키는 것.
누적 서사가 상품인 게임에서 세이브 파손 = 최악의 사고이므로, 스키마가 진화해도 이 파일들이 계속 로드돼야 한다.

정본 설계·규율은 `docs/SAVE_SYSTEM.md` §8.

## 파일 포맷

zustand persist가 AsyncStorage에 쓰는 그대로: `{"state": <partialize 산출>, "version": <SAVE_VERSION>}`.
모킹 AsyncStorage(`tools/_gt_mock`) 위에서 **실 store**를 구동해 `selectTeam`/경기 진행 후
`useGameStore.persist.getOptions().partialize`로 캡처한 실제 산출물이다(손으로 만든 합성 데이터 아님).

## 코퍼스 목록

| 파일 | 스키마 | 박제 시점 | 구단 | 시즌 상태 | state 필드 | 용량 |
|---|---|---|---|---|---|---|
| `v3_260716_fresh.json` | v3 | 2026-07-16 | t0(시드 리그 1번 구단) | 구단 선택 직후(`selectTeam`) · day 0 · 미진행 | 69 | ~2.0KB |
| `v3_260716_progressed.json` | v3 | 2026-07-16 | t0 | 정규시즌 중반 · day 80 · 내 팀 경기 18건 기록 | 69 | ~64KB |

> **시즌0 세이브의 `playerBase`/`rosters`는 `null`이 정상**이다 — 시즌0은 영속 base를 굽지 않고
> 로드 시 시드 레지스트리가 로스터를 재구성한다(`store/useGameStore.ts` onRehydrateStorage 주석).
> 따라서 가드의 유효성 판정은 저장 필드가 아니라 **로드 후 라이브 레지스트리**(`availableTeamPlayers`→`buildLineup`)로 한다.

## 생성 방법(재현)

일회성 생성 스크립트는 커밋하지 않는다(산출 JSON만 커밋). 재생성 절차:

1. `import './_gt_mock'` 후 `useGameStore.persist.rehydrate()`(빈 스토리지 정착).
2. `useGameStore.getState().selectTeam(LEAGUE.teams[0].id)` — fresh 세이브.
3. 진행분: 내 팀 `SEASON` fixture를 dayIndex 오름차순으로 중반(day≤82)까지
   `setDay(f.dayIndex)` → `buildMatchBox(...)` → `recordResult(...)` 재생(실 `schedule` advance 흐름과 동형).
4. `const opts = useGameStore.persist.getOptions()`; `{state: opts.partialize(getState()), version: opts.version}` 를 JSON으로 기록.

## 코퍼스 추가 규율(SAVE_SYSTEM §8)

- `SAVE_VERSION` 범프 또는 partialize 영속 필드의 **모양 변경** 커밋에는, 변경 **전** 스키마의 실 세이브를
  `corpus/saves/vN_YYMMDD_*.json`으로 박제하는 것이 **선행**된다.
- 스토어 릴리즈(스토어 업로드·주요 OTA)마다 그 시점 세이브 1개를 박제한다.
- 파일을 추가만 하면 가드가 코드 수정 없이 전부 순회한다.
