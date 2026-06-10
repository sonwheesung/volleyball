# 시즌 진행·일정·순위·오프시즌 (SEASON_SYSTEM)

> CLAUDE.md Phase 3(시즌 루프) + 11장(SOLID 오케스트레이션)을 구현 수준으로 정리한 문서다.
> 다른 시스템(훈련/노쇠/경기/생산/FA/드래프트)을 **호출로 조합**하는 "진행"의 본체.
> 모든 것은 시드 결정론 + 리플레이(상태 저장 대신 `currentDay`+`results`에서 재계산).

---

## 0. 핵심 원칙 — 저장하지 않고 재계산

- 세이브에 **진화된 스탯을 저장하지 않는다.** `currentDay`(시즌 내 경과일)와 `results`(치른 경기)만 둔다.
- 화면/순위/생산은 그 시점 base 스냅샷 + `currentDay` 로 **매번 재계산**(`evolvePlayer`).
- 선수별 RNG는 id 해시로 고정 → 같은 날 = 같은 결과(결정론).
- 시즌 경계에서만 진화 결과를 **base 스냅샷으로 커밋**(`commitPlayerBase`/`commitRosters`).
  → 다음 시즌 리플레이 비용을 시즌 1개로 한정(100시즌 운영 성능).

---

## 1. 일정 (engine/season.ts)

- **더블 라운드로빈 × 6라운드(LEGS=6)** — KOVO 여자부 정규리그. 서클 방식 결정론 생성.
- 7개 팀(홀수) → BYE 슬롯 추가, 라운드당 3경기. **매 라운드 홈/원정 반전.**
- 라운드 수 = (8−1) × 6 = **42 매치데이**, 경기 수 = 42 × 3 = **126경기**.
- `GAME_INTERVAL=4`(매치데이 간 4일), `SEASON_OFFSET=0`(첫 매치데이 day 0) → 마지막 day 164.
- `teamScheduleEntries`: 선택 팀 기준 캘린더(경기 + 경기 전날 '전술 훈련' 이벤트).

## 2. 캘린더 (lib/calendar.ts)

- 시즌 시작 `2025-10-18`(`SEASON_START`). `dateForDay(dayIndex)` → 실제 날짜.
- `monthGrid` 6주(42칸) 그리드. UI 캘린더가 현재일(`currentDay`)을 추적.

## 3. 순위·리더보드 (data/standings.ts)

- `seasonResults(uptoDay)` — `results`를 `fixture.dayIndex ≤ uptoDay`로 필터.
- `computeStandings(uptoDay)` — 승–패–세트득실로 정렬. `baseVersion`별 캐시.
- `standingsWorstFirst()` — 드래프트 순번(하위 우선) 소스.
- 개인 리더보드/대시보드 요약은 `data/production.ts`(생산)와 `overall`로 산출.

## 4. 경기 진행 ("진행" 1일)

진행 버튼은 **함수 호출 합성**이다(시스템 교체 가능, SOLID):

```
advance(targetDay):
  for 지나간 매치데이의 각 fixture:
    home/away = getEvolvedTeamPlayers(teamId, fixture.dayIndex)   // 그날 스탯
    sim = simulateMatch(fixture.seed, home, away)                 // 풀 랠리 체인 엔진
    recordResult(sim)                                             // 세이브
  setDay(targetDay)
```

- 진화(훈련+노쇠)는 `getEvolvedTeamPlayers`가 `evolvePlayer(base, 감독선호, day)`로 그날 재계산.
- **명단은 날짜 인지**: standings/production/playoffs는 `availableTeamPlayers(team, day)`
  (= 그날 명단(시즌 중 이동 반영) − 부상자)를 사용(`data/dynamics.ts`). 과거 경기는 그때 명단으로 고정.
- 개인 생산은 순위/리더보드 조회 시 `leagueProduction`이 `attributeProduction`으로 재귀속.
- **모든 팀**에 진화·생산이 동일 적용(사용자 팀 특례 없음). 현재 전 구단 자동.

## 5. 포스트시즌 (engine/playoffs.ts, data/playoffs.ts)

KOVO 방식:
- **준PO/PO**: 정규 2위 vs 3위, **3전 2선승**(target=2).
- **챔피언결정전**: 정규 1위 vs PO 승자, **5전 3선승**(target=3).
- 상위 시드 홈 어드밴티지 **+2 OVR**. 매치업별 시드로 `playSeries` 결정론.
- 우승 팀은 `recordChampion(season, championId)` → `archive`에 연표 보존.

## 6. 오프시즌 오케스트레이션 (store.endSeason)

시즌 종료 → 다음 시즌 base를 만드는 **단일 합성 함수**. 단계(2026-06 갱신):

```
0)   시상식·마일스톤: currentSeasonAwards → archive에 영구 보존(AWARDS_SYSTEM),
     detectSeasonMilestones → milestones 적립(big 영구+일반 300건, MILESTONE_SYSTEM),
     seasonInjuryDays 채집(만성용, INJURY_SYSTEM)
0.4) 시즌 중 이동 반영: seasonTxLog(방출/영입, 플레이어+AI)를 commitRosters로 영구 반영(TRANSACTION_SYSTEM)
1)   buildDraftContext: 롤오버(evolve 164일+나이+1+경력+1) · 은퇴 · 경쟁 FA(영입/보상) · 순번 · 신인 클래스
2)   resolveDraft:      내 위시리스트 + AI 니즈 기반 지명(순번 존중, 스카우트 공개도)
3)   fillRosters:       클래스 소진 후 남은 공백 신인 자동 충원
3.5) 경기 생산 → 성장·통산: leagueProduction(전체) → applyMatchXp + accrueCareer (experience/production)
3.6) 명예의전당: 은퇴자 중 통산 4000점↑ 등재(9000점↑ 영구결번급)
4)   이적자 clubTenure=0 (프랜차이즈 판정)
4.5) 만성 노쇠가속: 7경기↑ 결장자 jump 영구 -1 (INJURY_SYSTEM)
4.6) 다음 FA 풀: 미계약·비은퇴 → faPool (시즌 중 영입 풀, TRANSACTION_SYSTEM)
→ commitPlayerBase + commitRosters + setTxContext, 세이브 리셋(season+1, currentDay 0; archive/HOF/milestones 보존)
```

- 각 단계는 독립 순수 모듈. 한 시스템(예: 경기 엔진)을 바꿔도 타입 계약(`SimResult`/`ProdLine`)만
  지키면 나머지는 무영향.

## 7. 상태/저장 (store/useGameStore.ts, data/league.ts)

- 세이브(영속): `selectedTeamId, season, currentDay, results, 계약/방출 오버라이드,
  playerBase, rosters, FA/드래프트 선택, protectedIds, archive(+awards), hallOfFame,
  milestones, inSeasonTx, faPool, subPolicy, trainingFocus, staffHead/Assistants/Scouts`.
- `data/league.ts`: 싱글톤 LEAGUE/SEASON + 가변 로스터·선수 레지스트리 + `baseVersion`(파생 캐시 무효화).
- 리하이드레이트 시 `commitPlayerBase`/`commitRosters`로 base 복원.

---

## 8. 구현 현황 / 미구현

| 영역 | 상태 |
|---|---|
| 일정·캘린더·순위·리더보드 | ✅ |
| 시즌 자동 진행(진화+경기+생산 재계산) | ✅ |
| 포스트시즌 + 역대 우승 아카이브 | ✅ |
| 오프시즌 오케스트레이션(롤오버~성장 적립) | ✅ |
| 이어하기(세이브/리하이드레이트) | ✅ |
| MVP·개인 타이틀·명예의전당/영구결번 | ✅ 구현(2026-06) — AWARDS_SYSTEM(시상식·archive 보존), HOF는 endSeason 3.6 |
| 부상 결장·시즌 중 이동(명단 날짜 인지) | ✅ 구현(2026-06) — INJURY/TRANSACTION_SYSTEM(`data/dynamics.ts`) |
| 포스트시즌 직접 지휘 / 라인업 수동 개입 | ❌ 미구현(자동 완성 후 오버라이드로 개방 예정) |

> 검증: `npm test`(104) · `npx tsc --noEmit`(+ `-p tsconfig.test.json`) · `npx expo export --platform android`.
