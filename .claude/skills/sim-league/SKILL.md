---
name: sim-league
description: Run the long-horizon league simulation (N seasons of full match engine + offseason draft/FA/aging/retirement) and report championship distribution, parity, bottom-team comebacks, and dynasties. Invoke when the user asks to "시뮬 돌려", "100년 돌려", "장기 시뮬", "리그 시뮬레이션", "parity/밸런스 확인", or wants to check long-term balance after engine/training/FA tuning. Accepts a season count argument (default 100, supports 200/500+).
---

# sim-league — 장기 리그 시뮬레이션

`tools/simLeague.ts` 가 `store.endSeason` 오케스트레이션을 재현해 N시즌을 끝까지 돌린다(전 구단 AI, 결정론). 경기 엔진/훈련/노쇠/FA/드래프트 튜닝 후 **우승 분포·전력 균형(parity)·하위팀 반등·왕조**가 건강한지 검증하는 용도.

## 실행

```
npx tsx tools/simLeague.ts [시즌수]
```

- `시즌수` 생략 시 100. `200`, `500` 등 그 이상도 가능(시즌당 풀 리그 재시뮬이라 길이에 비례해 느려짐 — 100시즌 ≈ 수 분).
- 결정론: 같은 시즌수 = 같은 결과(고정 리그/시즌 시드). RNG 변동 없음.
- 진행 상황은 stderr(`…25/100시즌`), 최종 리포트는 stdout.

### 오래 걸리는 실행은 백그라운드로

100시즌+ 는 수 분 걸리므로 `run_in_background: true` 로 띄우고, 완료 알림이 오면 출력 파일을 Read 한다. 폴링하지 말 것 — 완료 시 자동 통지된다.

## 출력 해석 (보고 시 이 항목들을 짚어준다)

1. **우승 횟수 분포** — 팀별 우승수·평균순위. 한 팀이 독식하면 parity 문제.
2. **전력 균형(parity)** — 표준편차(낮을수록 균형, 완전균등 기대치 = 시즌수/팀수), 우승 경험 팀 수(N/N 이상적), 최장 연속우승(왕조 길이).
3. **꼴찌 → 나중 우승 반등** — 방치형 장기 서사의 핵심. 약팀도 세대교체로 후일 우승할 수 있어야 건강.
4. **우승 연표(≤120시즌)** 또는 **10년 단위 최다우승(>120시즌, 왕조 시대 요약)**.

## 건강 기준 (현재 밸런싱 목표)

- 표준편차: 한 팀 독식(예: 15+)이면 밸런스 결함. 5 안팎이면 건강(2026-06 감독성향 대칭화 후 5.1 달성).
- 우승 경험: 전 팀(N/N)이 한 번씩은 우승.
- 왕조: 8연패 정도까지는 "시대(era)"로 허용, 그 이상 영구 독식이면 의심.
- 반등: 대부분의 약팀이 꼴찌 후 후일 우승.

문제가 보이면 원인 모듈을 좁혀 측정한다(감독성향=`engine/rally.ts` 의 style 계수, 훈련=`engine/training.ts` focus, OVR↔실전력 괴리=`engine/overall.ts`). 관련 메모: 표시 OVR이 실전력을 잘 못 잡는 알려진 이슈가 있다.

## 검증

- 코드 수정 시 `npx tsc --noEmit` 0 오류 확인(이 도구는 `**/*.ts` 에 포함돼 타입체크 대상).
- 이 도구는 결과를 만들 뿐 게임 상태를 바꾸지 않는다(순수 재계산, 세이브 무관).
