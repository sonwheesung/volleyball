# 세이브·마이그레이션 시스템 (SAVE_SYSTEM)

> 사용자 폰에 저장된 세이브가 **앱 업데이트로 데이터 구조가 바뀌어도 깨지지 않게** 하는 체계.
> CLAUDE.md 8장(저장소)·SEASON_SYSTEM 0·7장(리플레이·상태)을 출시 안전 관점으로 확장한다.
> 핵심 질문(2026-06-26 사용자): "구조가 바뀌면 자동 업데이트되나, 오류나나?" → 아래 정책으로 **자동·안전**하게.

---

## 0. 저장 아키텍처 (현재)

- **저장소**: `zustand persist` + `AsyncStorage`. **키는 계정별**(`baeknyeon-save:<userId>` — §7). 한 기기에 여러 계정 슬롯이 공존하고, 로그인한 계정의 슬롯만 로드된다. (구 고정 키 `baeknyeon-save`는 §7.2 레거시 이관 후 소멸.)
- **얇은 리플레이 세이브**: 진화된 스탯·순위·생산을 저장하지 않는다. **base 스냅샷(`playerBase`/`rosters`) +
  `currentDay` + `results` + 누적 기록(archive/통산/명전/마일스톤…)** 만 저장하고, 화면·순위·생산은 시드로 **재계산**.
- **부호화**: `partialize`(저장 필드 화이트리스트, §1) → 직렬화. 복원은 `onRehydrateStorage`가 base를
  레지스트리에 커밋(`commitPlayerBase`/`commitRosters`/`commitStaff` 등).
- **시뮬 결과 캐시(2026-06-27, REALTIME_SIM Phase1)**: 53번째 필드 `simCache`(계산된 순위·생산) — 재로드 시 재계산
  제거. **폐기 가능**(검증 실패/구세이브=null→재계산 폴백)이라 하드 마이그레이션 불요. 워밍된 것만 저장(stale 금지).

---

## 1. 영속 스키마 (~~59~~ **67** 필드 — 단일 진실)

> **정정(2026-07-08, 전수조사 #67)**: 실측 67필드(partialize == SAVE_DEFAULTS, `_dv_migrate`가 동치 단언 — 코드끼리는 일치). 구 제목 "59"·saveMigration 주석 "65"는 가산 필드 추가를 따라가지 못한 표기 드리프트. 아래 표에 빠져 있던 `simCache`(§0 시뮬 결과 캐시)·`lastGrowthDay`(num — 성장 리포트 기준일)도 영속 필드다. **필드 수의 정본은 문서 숫자가 아니라 `SAVE_DEFAULTS` 키 집합**(가드 `_dv_migrate`) — 문서 숫자는 참고용.

> **다이아 이코노미 필드**(표 미개별화, 정본=`store/saveMigration.ts SAVE_DEFAULTS`): `diamonds·saveId·campLog·campTrainedThisOffseason·campDoneSeason·pendingCamp·claimedAch·adState`. **`campDoneSeason`**(num, 기본 -1, 2026-07-04 추가): 전지훈련을 "마친" 시즌번호 — 오프시즌↔개막전 게이트(MONETIZATION §11.2). `===season`이면 완료(시즌번호라 새 시즌 자동 리셋). 추가는 §2① 자동 처리(누락=기본값 -1).

> 출처: `store/useGameStore.ts` `freshSave`(163-212)·`partialize`(892-945)·`types/index.ts`. 구조가 바뀌면
> **이 표를 먼저** 갱신한다(DOC_DISCIPLINE). 자료구조 분류가 마이그레이션 정규화기(§3)의 근거다.

### 설정(새 게임에도 유지 — freshSave 밖)
| 필드 | 타입 | 기본 |
|---|---|---|
| `onboarded` | boolean | false |
| `supporter` | boolean | false |
| `sfxEnabled` | boolean | true |
| `bgmVolume` | number | 0.8 |
| `seenTips` | Record<string,true> | {} |

### 기본 진행 상태
| 필드 | 자료구조 | 기본 | 의미 |
|---|---|---|---|
| `selectedTeamId` | scalar(string\|null) | null | 내 팀 |
| `season` | scalar(number) | 0 | 0-based 시즌 |
| `currentDay` | scalar(number) | 0 | 시즌 내 경과일 |
| `results` | Record<fixtureId, MatchResult{fixtureId,homeSets,awaySets}> | {} | 치른 경기 결과(세트 스코어만 — 랠리는 시드 재생) |
| `watchProgress` | Record<fixtureId, number> | {} | 관전 이어보기 위치 |

### 계약·방출·거래
| 필드 | 자료구조 | 기본 |
|---|---|---|
| `contractOverrides` | Record<playerId, Contract{salary,years,remaining,signedAtAge}> | {} |
| `released` | string[] | [] |
| `inSeasonTx` | Tx[]{day,teamId,playerId,kind:'sign'\|'release'} | [] |
| `faPool` | string[] | [] |
| `resignDecisions` | Record<playerId, boolean> | {} |
| `faSignings` | string[] | [] |
| `faAggressive` | scalar(boolean) | false |
| `protectedIds` · `moneyOnlyIds` · `draftPicks` | string[] | [] |
| `draftSelections` (2026-07-08) | string[] | [] (라이브 드래프트 내 슬롯 순서 확정 픽 — endSeason resolveDraft mySelections. FA/재계약 변경 시 clear. FA_SYSTEM §3.2.1) |

### 선수·로스터 (base 스냅샷)
| 필드 | 자료구조 | 기본 | 비고 |
|---|---|---|---|
| `playerBase` | Record<playerId, Player> \| null | null | **전체 Player**(신체·멘탈·기술·xp·potential·talentBase·catTalent·contract·career·seasonLines·traits·faPref·isForeign·isAsianQuota·nationality·**debut**). types/index.ts 42-95. **debut**(2026-07-06 신설, additive 옵셔널)=입단 스냅샷{ovr,15원본} — 커리어 누적 성장 표시 전용·생성 시 1회·엔진 불간섭. 통째 영속이라 자동 포함, 구세이브/도입 전 선수는 `undefined`(UI 폴백) → **버전 불변**(additive=자동, TRAINING §성장리포트) |
| `rosters` | Record<teamId, playerId[]> \| null | null | 팀별 명단 |
| `bonds` | Record<playerId, number> | {} | 함께한 시즌 bond 누적(RELATIONSHIP — 복원 시 `setRelationContext`). 맵 바운드 |

### 역대 기록 (append-only, 일부 바운드)
| 필드 | 자료구조 | 기본 | 바운드 |
|---|---|---|---|
| `archive` | SeasonArchive[]{season,championId,awards?,standings?,streaks?,series?,record?} | [] | 무제한(시즌수) |
| `hallOfFame` | HofEntry[]{id,name,position,teamId,seasons,points,blocks,digs,spikes?,aces?,assists?,retiredSeason,legend} | [] | 무제한 |
| `expelledLog` | ExpelRecord[] | [] | 무제한 |
| `transfers` | Transfer[]{season,playerId,name,fromTeam,toTeam,kind?,ovr?} | [] | 최근 200 |
| `retirements` | RetireRecord[] | [] | 최근 200 |
| `seasonDraftLog` (2026-07-08, 슬라이스6) | DraftPickRecord[]{season,teamId,playerId,name,position,round,overallPick} | [] | 최근 150 (오프시즌 결산 개막 뉴스 — 드래프트 입단. NEWS §3.7) |
| `seasonForeignLog` (2026-07-08, 슬라이스6) | ForeignSwapRecord[]{season,teamId,asian,outId?,outName?,inId?,inName?} | [] | 최근 150 (외인·아시아쿼터 교체. NEWS §3.7) |
| `milestones` | Milestone[]{season,playerId,name,teamId,kind,text,big} | [] | 최근 300(big 무제한) |
| `readNews` | string[] | [] | 최근 1500 |
| `careerLog` | {faSigns,coachHires,staffHires,interviews:number} | 0×4 | 누적 |
| `careerTotals` | {points,aces,setsWon,setsLost,matchWins,matchLosses:number} | 0×6 | 누적 |

### 감독·스태프·훈련
| 필드 | 자료구조 | 기본 |
|---|---|---|
| `coachPool` | {coaches:Coach[],assistants:AssistantCoach[]} \| null | null |
| `staffHead` | Record<teamId, coachId> | {} |
| `staffAssistants` · `staffScouts` | Record<teamId, id[]> | {} |
| `trainingFocus` | {primary:[id,id],secondary:[id,id,id]} \| null | null (현재 방침 — 표시·UI용) |
| `focusLog` (A4, v2) | FocusSeg[]{fromDay:number, focus:{primary,secondary}\|null} | [] (훈련 방침 타임라인 — 진화가 소비) |

### 구단주 레이어·재정
| 필드 | 자료구조 | 기본 |
|---|---|---|
| `interviews` | InterviewLog[]{playerId,season,day,topic,card,ok} | [] (최근 200) |
| `benchDirectives` | BenchDirective[]{playerId,fromDay,toDay?} | [] (A3: `toDay`=철회 종결일, 옵셔널 — 없으면 활성) |
| `interventions` (2단계, 구현) | Record<fixtureId, MatchIntervention[]{at,side,kind,outId?,inId?}> | {} (경기 개입 로그 — 타임아웃·교체 좌표. `KIND='rec'` 정규화. §2① 자동 처리) |
| `coachModeLog` (#128, 구현) | CoachModeChange[]{day,manual} | [] ("경기 지휘" 설정 forward-only 체인지로그 — MATCH_INTERVENTION §4.1. 손상 세그먼트 제거 정규화. §2① 자동 처리) |
| `talkCooldown` · `benchCooldown` | Record<playerId, number> | {} |
| `fanScore` | scalar(number) | 50 |
| `releaseAnger` | scalar(number) | 0 |
| `cash` | scalar(number) | 50000 |
| `lastFinance` | SeasonFinance \| null | null |

> **구현 완료(2026-07-12, 경기 개입 2단계 — 순수 로그 방식)**: `interventions` 필드 구현. 정본 `docs/MATCH_INTERVENTION_SYSTEM.md` §2.2.
> §1 필드 수 67 → **68**(개입 1필드 추가). `benchDirectives`와 동형 패턴이라 §2① 자동 처리(누락=기본값 `{}`, `SAVE_DEFAULTS`+`KIND='rec'`).
> - `interventions`: `Record<fixtureId, MatchIntervention[]>` — 내 팀 경기 개입 로그(타임아웃·교체 좌표), forward-only, bounded(시즌 ~36경기). 기본 `{}`. 재관전 재생 입력(§3 프리픽스 불변).
> - **스냅샷 필드 없음**(§2.2 조정): 개입 경기 결과·박스를 동결하는 대신, **모든 sim 호출부**(관전 `matchBox`·순위 `standings`·생산 `production`)가 `interventionsFor(id)`로 로그를 실어 재시뮬 → split-brain 원천 소멸. `_dv_intervention_consistency` 가드가 전 호출부 바이트 동일을 증명.

> **구현 완료(2026-07-15, "경기 지휘" 설정 토글 #128)**: `coachModeLog` 필드 추가. 정본 `docs/MATCH_INTERVENTION_SYSTEM.md` §4.1.
> §1 필드 수 68 → **69**(`coachModeLog` 1필드 추가). 추가는 §2① 자동 처리(누락=기본값 `[]`) — **구세이브 로드 시 항상 감독 자동(=바이트 동일)**. `SAVE_VERSION` 범프 불필요(순수 가산 필드).
> - `coachModeLog`: `CoachModeChange[]{day:number, manual:boolean}` — 설정 "경기 지휘"(감독 자동/구단주 직접) 변경 이력. forward-only: 토글 변경 시 `(currentDay, manual)`을 append(동일 날은 그 날 항목 덮어쓰기 → 로그 무한 증가 방지). 시즌 경계에서 **현 유효값을 day0 baseline으로 접음**(focusLog와 동형 — 설정은 시즌 넘어 유지되나 day 공간은 리셋). 기본 `[]`=감독 자동.
> - **정규화(§3)**: `KIND` 미등록(특수 분기) — `sanitizeField` `case 'coachModeLog'`가 `day`(유한수)·`manual`(불리언) 유효 세그먼트만 통과시켜 손상 항목 제거(focusLog와 동형 방어). 로드 후 `manualSideFor`가 안전하게 소비.

### 외국인·아시아쿼터
| 필드 | 자료구조 | 기본 |
|---|---|---|
| `tryoutWish` · `foreignAltPool` · `asianWish` · `asianAltPool` | string[] | [] |
| `foreignSubUsed` · `asianSubUsed` | scalar(boolean) | false |
| `keepForeign` · `keepAsian` | scalar(boolean\|null) | null |

---

## 2. 구조가 바뀔 때 — 3가지 경우 (사용자 질문 답)

| 변경 종류 | 자동 처리? | 메커니즘 |
|---|---|---|
| **① 필드 추가**(새 옵셔널 필드) | ✅ 자동·안전 | 커스텀 `merge`(§3.2.1) `{...초기값, ...sanitizeSave(저장값)}` — 새 필드는 저장본에 없어도 `SAVE_DEFAULTS` 기본값으로 채움(정정 2026-07-08 #1: 구 "zustand 기본 merge" → 상시 정규화 merge로 교체, 동작 동일+손상 수선 추가). 지금까지 모든 신기능이 이 패턴 |
| **② 엔진 로직 변경**(예: OP 공격 집중) | ✅ 안전 | 파생값 미저장 → 옛 세이브를 **새 엔진으로 재계산**. 과거 확정 기록(archive·통산·명전)은 시즌 경계 박제로 보존, 미래만 새 엔진 |
| **③ 기존 필드 모양/의미 변경**(이름·구조 재편) | ⚠ **version+migrate 필요** | 옛 값이 그대로 병합돼 새 코드가 깨질 수 있음 → §3 마이그레이션으로 변환 |

> 추가로, **잘못된 타입의 저장값**(손상·구버전)은 zustand의 `?? []`/`?? {}`(null만 방어)로 안 막혀
> `[...value]`·`Object.keys(value)`에서 크래시할 수 있다(조사 2026-06-26: `inSeasonTx`/`faPool`/`benchDirectives`/
> `archive`/`coachPool`/`staffHead` 등). §3 정규화기가 **컨테이너 모양을 강제**해 이걸 닫는다.

---

## 3. 마이그레이션 정책 (구현 — `store/saveMigration.ts`)

### 3.1 버전 + migrate
- `persist`에 **`version: SAVE_VERSION`**(현재 **3**)을 둔다. 기존 무버전 세이브 = version 0 → 로드 시 `migrate` 호출.
- **`migrate(persisted, fromVersion)`** = `migrateSave`:
  1. (향후) `fromVersion`이 낮으면 그 버전→다음 버전 **변환 단계**를 순서대로 적용(필드 이름변경·구조재편).
  2. 마지막에 **`sanitizeSave`**(컨테이너 모양 정규화)로 모든 필드를 기대 자료구조로 강제.
  - v0→v1은 **구조 동일** → 변환 단계 없이 정규화만(현 세이브를 안전하게 수선).
  - **v1→v2(2026-07-08, A4 훈련 방침 타임라인)**: 구세이브는 단일 `trainingFocus`(day0부터 소급 적용)만 있고 `focusLog`가 없다 →
    `focusLog`가 비어있고 `trainingFocus`가 있으면 **`[{fromDay:0, focus:trainingFocus}]`로 시드**한다. day0부터 상수 방침 = **옛
    리플레이와 바이트 동일**(회귀 무해). 방침 미설정(trainingFocus=null)이면 `[]`. 신규 세이브(focusLog 존재)는 시드 스킵(보존).
    가드: `tools/_dv_batch_a4.ts`(마이그레이션 바이트 동일 + focusLog 시드 케이스).
  - **v2→v3(2026-07-08, A안 포스트시즌 달력 편입 SEASON §5.3)**: 구세이브가 **정규 완료 + `archive[season].championId` 존재**
    (=이미 포스트시즌을 소비)인데 `currentDay`가 정규 범위(<`POSTSEASON_LAST_DAY=183`)에 멈춰 있으면, 새 일정 화면이 이를
    "플옵 미진행"으로 오인해 **재관전을 강요**한다 → `currentDay`를 `183`으로 승격해 오프시즌 체인 직행. 진화 조회는
    `min(day, SEASON_DAYS)` 클램프라 currentDay 승격이 스탯·순위·생산에 **무영향**(동결 규칙). 가드: `tools/_dv_postseason.ts` ④.

### 3.2 정규화기(`sanitizeSave`) — 컨테이너 모양 강제
필드별 자료구조(§1)대로 코어스(coerce):
- **scalar**: `typeof` 일치(+`Number.isFinite`)면 유지, 아니면 기본값. nullable(selectedTeamId·keepForeign 등)은 null 허용.
- **array**: `Array.isArray`면 유지, 아니면 `[]` → 모든 `[...arr]`·`.map`·`.filter`·`.slice` 안전.
- **record**: 평범한 객체(`typeof==='object' && !Array.isArray`)면 유지, 아니면 `{}` → `Object.keys`·spread 안전.
- **nested**: `careerLog`(4 num)·`careerTotals`(6 num)는 각 숫자 필드 기본 0으로 보강. `coachPool`은 null이거나
  `{coaches:array, assistants:array}`. `trainingFocus`는 null이거나 `{primary:array, secondary:array}`(malformed→null,
  리그가 감독 기본값으로 재유도). `lastFinance`는 null이거나 객체.
- 기준 기본값은 `SAVE_DEFAULTS`(= `freshSave` + 설정 4필드) **단일 소스**.

#### 3.2.1 상시 정규화 — `merge`로 버전 무관 경유 (정정 2026-07-08, 재판정 #1)
- **문제(회귀)**: `persist`는 저장본 `version`이 **현행과 다를 때만** `migrate`를 부른다. 그래서 `sanitizeSave`가
  `migrate` 안에만 있으면 **현행 버전(=SAVE_VERSION) 세이브가 손상돼도 정규화를 아예 안 탄다** —
  ~~"손상 세이브는 항상 `sanitizeSave`가 수선한다"~~는 §3.2·§3.3의 전제가 **구버전에만 참**이었다.
  실측: 동일 손상 페이로드가 v0에선 수선 로드, v3(현행)에선 비정규화 값이 그대로 state로 유입되거나
  `onRehydrateStorage`의 커밋이 throw → §3.3 안전망이 **fresh로 전손 리셋**.
- **수정**: `persist`에 **`merge` 옵션**을 두어 `sanitizeSave`를 **버전 무관 매 rehydrate 상시 경유**시킨다.
  `merge(persisted, current)`는 zustand가 버전과 무관하게 항상 호출한다 →
  `persisted == null`(신규 설치)이면 `current` 그대로(기본값 덮어쓰기 금지), 아니면 `{...current, ...sanitizeSave(persisted)}`.
- **멱등 보장**: 구버전은 `migrate`가 먼저 `sanitizeSave`(+단계 변환)한 뒤 `merge`가 **다시** `sanitizeSave`한다.
  `sanitizeSave`는 멱등(각 필드 코어스는 이미 정규화된 값에 무변화; `migrate`가 시드한 `focusLog`·승격한 `currentDay`도
  정규화가 보존) → 이중 적용이 결과를 바꾸지 않는다. §3.3 fresh 리셋 폴백은 **최후 방어**로 유지.
- 가드: `_dv_migrate_e2e.ts` ④(version=현행 손상 → 수선 로드·`selectedTeamId` 보존·정규화 적용) + ④-A/B(merge 없는 대조 store → 손상값 누출로 가드 민감도 증명).

> 범위: v1은 **컨테이너 모양**(array/record/scalar)을 보장해 *크래시*를 닫는다. 배열 *항목*의 깊은 필드 검증
> (예: 모든 archive의 awards 모양)은 소비처의 옵셔널 체이닝 + 향후 per-item 정규화로(과한 비용 회피). 깊은 접근
> 크래시 후보(archive.awards·playerBase.contract·hallOfFame 옵셔널·interviews/benchDirectives 인덱스)는
> 소비처에서 옵셔널 체이닝/길이 체크로 별도 방어(EDGE_CASES와 연동).

### 3.3 안전 복원 (try/catch 리셋)
- `onRehydrateStorage` 본문을 **try/catch**로 감싼다. 정규화에도 불구하고 커밋이 throw하면(심층 방어):
  콘솔 경고 + **fresh 상태로 리셋** + `hydrated:true` → **크래시 루프 대신 깨끗한 새 게임**으로 진입(데이터 1개라 최악도 1인 손실).
- migrate/sanitize는 순수 코어스(throw 없음)라 정상 경로에선 리셋이 안 일어난다.
- **정정(2026-07-08, #1)**: 이 리셋은 이제 **버전 무관 상시 정규화(§3.2.1 `merge`) 이후**의 최후 방어다. 과거엔 현행 버전
  손상 세이브가 정규화를 건너뛰어 여기로 곧장 떨어져 **전손**했다 → merge 상시 경유로 대부분 수선 로드되고, 리셋은 커밋이
  여전히 throw하는 잔여 케이스에만 발동한다.

---

## 4. 미래 변경 작업 규칙 (이 시스템을 쓰는 법)

- **필드 추가**: 그냥 추가(초기값 + partialize). version 불변. ①경로로 자동 안전.
- **필드 삭제**: partialize에서 빼면 됨(옛 값은 merge서 무시). version 불변.
- **필드 모양/의미 변경(breaking)**:
  1. `SAVE_VERSION`을 **+1**.
  2. `migrateSave`에 `if (version < N) { ...옛→새 변환... }` 단계 추가(이전 모양을 새 모양으로).
  3. §1 스키마 표 갱신 + 이 문서에 변경 기록(취소선 정정).
  4. `_dv_migrate` 가드에 그 변환 케이스 추가(옛 모양 입력 → 새 모양 출력 단언 + A/B).
- **출시 후 불변식**: 한 번 출시한 `SAVE_VERSION`의 의미는 고정. 새 변경은 항상 새 버전으로(과거 변환 단계 보존).

---

## 5. 코드 맵
- `store/saveMigration.ts` — `SAVE_VERSION`·`SAVE_DEFAULTS`·`sanitizeSave`·`migrateSave`(신규).
- `store/useGameStore.ts` — `persist` 옵션에 `version`·`migrate`·**`merge`(§3.2.1 상시 정규화)**·**`skipHydration:true`(§7 — 계정 확정 전 자동 로드 금지)** 추가, `onRehydrateStorage` try/catch. 비영속 런타임 필드 **`saveScopeUserId`**(현재 로드된 계정, §7.3).
- `store/saveScope.ts` (§7 신규) — `saveKeyFor(userId)`·`switchSaveScope(userId)`(전환 시퀀스)·`deleteSaveSlot(userId)`. 계정↔슬롯 전환의 단일 진실.
- `store/persistStorage.ts` — 디바운스 영속 + **`flushGameSave()`**(§7 전환 전 대기 쓰기 즉시 flush). 키를 **엔트리 시점에 고정**(flush 시점 아님) — 키 전환 오염(§7.4 함정 b) 원천 차단.
- `store/useAuthStore.ts` — `signIn`(성공 후 `switchSaveScope`)·`deleteAccount`(`deleteSaveSlot` 후 signOut). saveScope는 **동적 import**(순환 의존 회피).
- `app/_layout.tsx` — 콜드 부팅 시 캐시 세션→`switchSaveScope` 트리거 + 인트로 ready 게이트(§7.5). `components/BootGate.tsx` — 로그인 벽 뒤 **스코프 게이트**(`saveScopeUserId===session.userId` 아니면 Loading — 함정 a).
- `data/league.ts`·`data/dynamics.ts`·`data/awardSalary.ts` — 복원 커밋(`commitPlayerBase` 등). 정규화 후 입력이라 안전.
- `tools/_dv_migrate.ts` — 마이그레이션 가드(아래).

## 6. 검증
- `npx tsc --noEmit`(+ test config) · `npm test`.
- `npx tsx tools/_gt_determinism.ts` — 실제 persist `partialize`/`onRehydrate` 충실도(베낀 복사본 아님).
- **`npx tsx tools/_dv_savescope.ts`** — 계정별 슬롯 격리(§7): 모킹 AsyncStorage 위 실 store로 ①A 진행→로그아웃→B 로그인=freshSave(A 노출 0) ②A 복귀=바이트 복원 ③레거시 1회 이관 ④B 진행해도 A 슬롯 불변(함정 b) ⑤계정 삭제=슬롯 제거 ⑥같은 계정 재로그인 no-op + **A/B**(고정 키 대조 store는 ①에서 A 데이터 노출=FAIL로 민감도 증명). exit 0/1.
- **`npx tsx tools/_dv_migrate.ts`** — 마이그레이션·정규화 가드:
  - **손상 입력 무크래시**: 모든 필드에 잘못된 타입(배열→`{}`·record→`[]`·scalar→객체·null·NaN·문자열) 주입 →
    `migrateSave`가 throw 없이 **유효 스키마**(§1) 산출. 정규화 후 `onRehydrate`의 모든 spread/Object.keys 안전.
  - **정상 입력 멱등**: 유효 현 세이브 → `migrateSave`가 의미 보존(필드값 불변).
  - **A/B 자가검증**: 정규화 *없이* 손상 입력을 복원 경로에 넣으면 크래시(또는 위반)함을 확인 → 정규화가 실제로 막는지 증명(허위 오라클 차단).
  - **버전 누락=0 취급**: version undefined/0 입력에 migrate가 동작.
- **`npx tsx tools/_dv_migrate_e2e.ts`** — **실제 persist 파이프라인 E2E**(순수 함수가 아니라 진짜 store):
  모킹 AsyncStorage(`_gt_mock`)에 세이브를 넣고 `useGameStore.persist.rehydrate()`로 migrate→merge→onRehydrate→commit을
  끝까지 태운다. ① 손상 타입 세이브 → 크래시 없이 live store에 sanitize 로드(+유효 필드 보존=리셋 아님 증명) ②
  유효 세이브 → 값 보존 + `playerBase` 실제 커밋(`getPlayer` 동작) ③ sanitize 통과하나 commit이 throw(playerBase
  값이 null) → try/catch가 fresh 리셋(hydrated=true·크래시 루프 없음). ③의 콘솔 경고는 안전망 작동의 의도된 출력.
  **④(2026-07-08, #1) 현행 버전(version=SAVE_VERSION) 손상 세이브** → `merge` 상시 정규화(§3.2.1)로 수선 로드(전손 아님)·
  `selectedTeamId` 보존·비정규 값 정규화 확인 + **④-A/B**: `merge` 없는 대조 store(구현 이전 모사)에 같은 손상 v3 페이로드를
  넣으면 정규화 못 해 손상값이 그대로 누출됨을 단언(가드가 실제 결함을 잡는다는 민감도 증명 — 허위 오라클 차단).

> 검증 루틴(README)에 `_dv_migrate`(순수)·`_dv_migrate_e2e`(실 store) 등록. 세이브 필드 추가·구조 변경 시 갱신·재실행.

---

## 7. 계정별 세이브 슬롯 (2026-07-15, 사용자 결정)

> **결정**: "다른 계정으로 로그인하면 구단을 처음부터, 원래 계정으로 돌아오면 원래 구단이 복원." 온라인 전환(AUTH_SYSTEM)으로
> 계정이 재화·결제의 소유 주체가 됐으니, **세이브도 계정 단위**여야 한다. 기존엔 고정 키 하나(`baeknyeon-save`)라 기기를 공유하면
> 계정을 바꿔도 같은 세이브가 로드됐다. 이 절이 그걸 계정별 슬롯으로 분리한다.
>
> **불변식(핵심)**: 이 변경은 **키만** 바꾼다 — payload 스키마·`SAVE_VERSION`·`migrate`·`sanitizeSave`·`partialize`는 **불변**.
> 결정론(리플레이)도 불변(슬롯 내부는 §0 얇은 리플레이 그대로). 그래서 **`SAVE_VERSION` 범프 불요**(§4 "필드 모양 변경"이 아님).

### 7.1 키 스킴
- `saveKeyFor(userId) = \`${SAVE_KEY}:${userId}\`` (`baeknyeon-save:google:…` / `baeknyeon-save:dev-local:…`). userId=세션 userId(`store/useAuthStore` Session).
- 하드 로그인 벽(AUTH §1)이라 **게임 진입 시 세션은 항상 존재** → 로드할 슬롯이 항상 확정된다. 세션이 없으면(로그인 벽) 게임 스토어는
  **자동 로드하지 않고 대기**한다(`persist` 옵션 **`skipHydration:true`** — 계정 확정 전 아무 슬롯도 안 읽음).

### 7.2 레거시 이관 (1회, 개발 세이브 연속성)
- 기존 고정 키 `baeknyeon-save`(=`SAVE_KEY`) 세이브가 있으면 **최초로 스코프되는(빈 슬롯) 계정의 슬롯으로 1회 이관**(복사 후 원본 삭제 = rename).
- 이후 그 계정은 이관된 세이브로 이어가고, 레거시 키는 사라진다(다음 계정은 빈 슬롯 = 신규). 미출시라 실사용자 부채 없음 — 개발 세이브 연속성용.

### 7.3 전환 시퀀스 — `switchSaveScope(userId)` (`store/saveScope.ts`)
계정이 확정되는 순간(로그인 성공 / 콜드 부팅 캐시 세션) 다음을 **직렬**로 수행한다:
1. **`flushGameSave()`** — 현 스토어의 디바운스 대기 쓰기를 **현재(이전 계정) 키로** 즉시 flush. 쓰다 만 저장 유실·지연 쓰기 오염 방지(함정 b).
2. **레거시 이관**(§7.2) — 새 슬롯이 비었고 레거시 키가 있으면 rename.
3. **`persist.setOptions({ name: 새 키 })`** + `resetLeagueBase()`(이전 계정의 리그 레지스트리 비움).
4. **슬롯 유무 분기**:
   - **빈 슬롯(신규 계정)**: `resetSave()` + 계정 캐시 0화(`diamonds:0`·`claimedAch:[]`·`adState` fresh) → **freshSave**(온보딩/구단선택부터). 서버 잔액은 로그인 후 `syncWallet`이 수렴.
   - **기존 슬롯(복귀 계정)**: `persist.rehydrate()` — `merge`가 `sanitizeSave`로 **전 필드를 그 슬롯 값으로 덮어써** 이전 계정 데이터가 새지 않는다(sanitize=SAVE_DEFAULTS 전 키 산출).
5. 완료 후 비영속 런타임 필드 **`saveScopeUserId = userId`** 세팅(로드 완료 계정 표식 — §7.5 게이트가 읽음).
- **직렬화·멱등**: 전환은 프라미스 체인으로 직렬. **같은 계정 재로그인은 no-op**(`activeScope===userId`이면 즉시 반환). 로그아웃은 flush만(스토어 리셋 안 함 — 로그인 벽 뒤라 화면 미노출, 다음 로그인 전환이 덮음).

### 7.4 함정 (문서에 명기 + 가드로 봉인)
- **(a) 스코프 완료 반영 타이밍** — 로그인으로 `session`이 B로 바뀌는 즉시 `BootGate`가 게임을 렌더하면, `switchSaveScope`가 끝나기 전
  **이전 계정(A) 메모리 상태가 한 프레임 노출**될 수 있다. → `BootGate`가 로그인 벽 통과 후 **`saveScopeUserId===session.userId`가 아니면
  Loading**을 렌더(§7.5). 콜드 부팅은 인트로 ready 게이트가 스코프 완료까지 대기해 게임 화면 자체가 안 뜬다.
- **(b) 디바운스 미flush 상태 키 전환 오염** — 대기 쓰기가 새 키로 새면 A의 늦은 쓰기가 B 슬롯을 오염. → (1) `persistStorage`가 **키를
  엔트리(setItem 호출) 시점에 고정**해 flush가 늦게 돌아도 항상 원래(A) 키로 쓴다 + (2) 전환 1단계에서 **명시적 flush**로 이중 방어.

### 7.5 게이트 배선
- **콜드 부팅**(`app/_layout.tsx`): `authHydrated && session`이면 `switchSaveScope(session.userId)`. 인트로 스플래시 `ready = fontsLoaded && authHydrated && (세션 없음 || (게임 hydrated && saveScopeUserId===session.userId))` — 캐시 세션이면 그 계정 슬롯 로드+캐시 워밍까지 대기.
- **로그인 중 전환**(`store/useAuthStore.signIn`): 세션 저장 후 `switchSaveScope`. `BootGate`의 스코프 게이트가 로드 완료 전까지 Loading으로 막음(함정 a).

### 7.6 계정 단위 필드 — 슬롯 분리로 자연히 계정별
`diamonds`(표시 캐시)·`claimedAch`·`adState`·`saveId`·`supporter` 등은 세이브 payload 안에 있으므로 **슬롯이 분리되면 계정별로 자연 분리**된다.
서버 진실(다이아 잔액·업적 지급·광고 캡)은 로그인 후 `syncWallet`이 어차피 수렴하므로 로컬 캐시는 슬롯 값→서버 값으로 정정된다.
`resetSave`/`selectTeam`의 계정필드 보존(`_dv_reset_preserve`)은 **슬롯 내부 동작**이라 이 변경과 무관·불변.

### 7.7 계정 삭제
`useAuthStore.deleteAccount` 성공 시 그 계정 슬롯을 **`deleteSaveSlot(userId)`로 AsyncStorage에서 제거**(로컬 파기 — AUTH §7 방침 정합) 후 `signOut`.
슬롯 삭제는 `activeScope`도 리셋해 재로그인(같은 userId여도) 시 재스코프되게 한다(삭제된 슬롯 = 빈 슬롯 = freshSave).

---

## 8. 세이브 코퍼스(골든 마스터) — OpenTTD 관행 차용 (2026-07-16)

> **목적**: 출시 후 세이브 파손은 이 게임 최악의 사고다 — 수십 시즌 누적 서사가 상품이므로,
> 사용자 세이브가 새 버전에서 안 열리면 곧 그 이야기의 소멸이다. §3의 마이그레이션·정규화가 "손상 입력을
> 안 깨지게" 지킨다면, 이 절은 **"실제 진행으로 만든 과거 세이브가 새 코드에서 계속 열리는가"**를 회귀로 지킨다.
> OpenTTD가 실 세이브 파일을 저장소에 박제해 로드 회귀를 막는 관행을 차용했다.

`_dv_migrate`/`_dv_migrate_e2e`(§6)는 **합성 입력**(손상 타입 등)을 검사한다. 코퍼스는 대조적으로 **실제 게임
진행으로 만든 세이브를 박제**해, 스키마가 진화해도 그 실물이 계속 로드됨을 증명한다.

### 8.1 위치·포맷
- 코퍼스: **`corpus/saves/*.json`**. 파일명 규약 `vN_YYMMDD_<라벨>.json`(예: `v3_260716_fresh.json`).
- 포맷: persist가 AsyncStorage에 쓰는 그대로 **`{"state": <partialize 산출>, "version": <SAVE_VERSION>}`**.
  모킹 AsyncStorage(`tools/_gt_mock`) 위 **실 store**를 `selectTeam`/경기 진행으로 구동해
  `persist.getOptions().partialize`로 캡처한 실물(합성 아님). 생성 스크립트는 **일회성 — 커밋하지 않고 산출 JSON만 커밋**.
- 각 파일의 생성 조건(스키마 버전·시점·구단·시즌 상태·필드 수·용량)은 **`corpus/saves/README.md` 표**에 기록.
- 초기 박제(2026-07-16): `v3_260716_fresh`(구단 선택 직후·day0)·`v3_260716_progressed`(정규 중반·day80·내 팀 18경기).
  > **주의**: 시즌0 세이브의 `playerBase`/`rosters`는 `null`이 정상(시드 재구성) — 유효성은 로드 후 라이브 레지스트리로 판정(§8.3).

### 8.2 박제 규율 (스키마 변경의 선행 조건)
1. **`SAVE_VERSION` 범프 또는 partialize 영속 필드의 모양 변경** 커밋에는, 변경 **전** 스키마의 실 세이브를
   `corpus/saves/vN_YYMMDD_*.json`으로 박제하는 것이 **선행**된다(변경 후엔 그 시점 스키마를 못 만든다).
2. **스토어 릴리즈**(스토어 업로드·주요 OTA)마다 그 시점 세이브 1개를 박제한다(릴리즈된 세이브 = 반드시 열려야 할 세이브).
3. **`_dv_save_corpus` 그린이 스키마 변경 커밋의 통과 조건**이다(코퍼스 로드 회귀가 하나라도 깨지면 머지 불가).

### 8.3 가드 `tools/_dv_save_corpus.ts`
- `corpus/saves/*.json` 전체를 순회: 각 파일을 모킹 AsyncStorage에 넣고 `persist.rehydrate()`를 완주시켜
  ① throw 없음 ② **리셋 아님**(로드 후 `selectedTeamId`가 파일 값과 일치 — 로드 전 센티넬 주입으로 "무변화 false-pass" 차단)
  ③ **마이그레이션 후 유효**(내 팀 `availableTeamPlayers`→`buildLineup` 성립, 선발 6인 충족)를 검사.
- **비공허 증명 2종**(무의미 그린·팬텀 차단): ⓐ 코퍼스 디렉터리가 비면 FAIL, ⓑ `--selftest`는 코퍼스 파일 하나를
  메모리에서 **절단(truncate)**해 주입하고 가드가 "로드 실패"로 검출함을 단언(원본 OK · 절단본 FAIL의 A/B 격차 = 민감도).
- 코퍼스 파일이 늘어도 **코드 수정 없이 전부 순회**(파일 추가만). exit 0/1.

### 8.4 검증 (§6 연장)
- **`npx tsx tools/_dv_save_corpus.ts`** — 코퍼스 전체가 현재 코드에서 로드·유효(exit 0/1).
- **`npx tsx tools/_dv_save_corpus.ts --selftest`** — 절단 입력을 가드가 로드 실패로 검출(팬텀 A/B, 허위 오라클 차단).

---

## 9. 세이브 내보내기/가져오기 — ZenGM 리그 파일 관행 (2026-07-16, 사용자 결정)

> **목적**: 출시 후 지원(support)의 **마지막 안전망**. §3(손상 입력 방어)·§7(계정 슬롯)·§8(코퍼스 회귀)이 세이브를
> "안 깨지게" 지킨다면, 이 절은 사용자가 자기 세이브를 **파일로 손에 쥐게** 한다 — 버그 재현(사용자→개발자 첨부),
> **기기 이전**(폰 교체), **복구**(세이브 꼬임 시 백업본 복원). ZenGM(웹 스포츠 시뮬)의 "리그 파일 export/import" 관행 차용.
>
> **불변식**: §7과 같이 이 기능은 **payload 스키마·`SAVE_VERSION`·`migrate`·`sanitizeSave`·`partialize`를 건드리지 않는다**.
> 내보내기 원천은 `store/useGameStore.ts`의 `captureReplaySave()`(persist가 저장하는 것과 **바이트 동일한** `{state, version}` — 가드 `_dv_snapshot_replay`가 보증)를 그대로 쓴다.
> 가져오기 검증·정규화는 §3의 `migrateSave`/`sanitizeSave`를 재사용한다 — 새 로직 없음, 기존 파이프라인의 **파일 입출력 래퍼**일 뿐.

### 9.1 파일 포맷
- 봉투: `{ app: 'baeknyeon', kind: 'save-export', version: SAVE_VERSION, state: <captureReplaySave().state> }` (2-space pretty JSON).
  - `app`/`kind`는 **오식별 방지 태그** — 아무 JSON이나 세이브로 오인해 덮어쓰는 사고를 막는다(가져오기 1차 게이트).
  - `version`은 캡처 시점 `SAVE_VERSION`. `state`는 `partialize` 산출(§1 영속 필드 전체) — 손 선별 금지(로더 계약 "영속 객체 통째").
- 파일명: **`baeknyeon-save-s<season+1>-d<currentDay>.json`**(예: `baeknyeon-save-s1-d80.json`). season은 0-based라 표시용 +1.
- 순수 빌더/파서는 **`lib/saveTransfer.ts`**(React 무의존 — 헤드리스 가드로 왕복 검증). UI(`app/settings.tsx`)는 파일 I/O·다이얼로그만.

### 9.2 내보내기 흐름 (`app/settings.tsx`)
1. `captureReplaySave()` → null이면(세이브 없음) 버튼 자체가 비활성(선택 구단 없음).
2. `buildExportPayload(cap)` → `serializeExport()`(pretty JSON) → `exportFileName(cap.state)`.
3. **cache 디렉터리에 기록**: `expo-file-system`(SDK54 신 API — `File`/`Paths` 클래스) `new File(Paths.cache, name)` → `create({overwrite:true})` → `write(text)`.
4. **공유**: `expo-sharing.isAvailableAsync()`면 `shareAsync(file.uri, { mimeType:'application/json', UTI:'public.json' })`. 공유 불가 기기 폴백은 RN 코어 `Share.share({ message: text })`(문자열 직접).

### 9.3 가져오기 흐름 — 안전 게이트가 핵심 (`app/settings.tsx`)
1. **선택·읽기**: `expo-document-picker.getDocumentAsync({ type:'application/json', copyToCacheDirectory:true })` → `new File(asset.uri).text()`.
2. **`parseImportPayload(text)`**(순수) — 봉투 검증, 실패 시 **사유와 함께 거부**(현재 세이브 무접촉):
   - JSON 파싱 실패 / `app!=='baeknyeon'` / `kind!=='save-export'` / `state` 비객체(배열·누락 포함) → 거부.
   - `version > SAVE_VERSION` → "앱을 최신으로 업데이트한 뒤 가져올 수 있어요"(미래 스키마 — 손실 위험 차단).
   - `version ≤ SAVE_VERSION` → 통과(구버전은 §3 `migrate`가 로드 시 흡수).
3. **드라이런 게이트(중요) — `dryRunImport(state, version)`**(순수, 스토리지 **쓰기 전**):
   - `sanitizeSave(migrateSave(state, version))`를 실행(§3 그대로) + **최소 유효성** 확인:
     - `selectedTeamId`가 유효 문자열(진행 중 구단 진입점) — null이면 "진행 중 구단 없음" 거부.
     - `playerBase`가 비-null이면 **모든 엔트리가 객체**여야 함(엔트리 null/비객체는 `commitPlayerBase`의 `p.traits` 접근에서 throw → §3.3 안전망이 **fresh 리셋** → 현재 세이브 전손. `_dv_migrate_e2e ③`이 이 크래시 벡터를 문서화). 이 확인이 **쓰기 전에** 그 상태를 걸러 낸다.
   - 실패 시 **현재 세이브 무접촉**으로 거부. 검증 없이 슬롯을 덮어쓰면, commit-throw 세이브가 §3.3 fresh 리셋을 유발해 **유저의 기존 세이브를 날린다** — 드라이런은 그 전손을 원천 차단한다.
4. **확인 다이얼로그**: 기존 `showAlert`/`AppDialog` **재사용**(settings에 신규 Modal 금지 — #129 모달 레이스 예방). 문안: "현재 구단 진행이 선택한 세이브로 대체됩니다. 되돌릴 수 없어요 — 먼저 '내보내기'로 백업해 두는 걸 권장해요." + 재화 안전 카피(§9.4).
5. **적용 — 원자 래치(정정 2026-07-16, 에뮬 E2E 발견 버그)**:
   > ~~`flushGameSave()`(대기 쓰기 정리) → 현재 로그인 슬롯 키에 `{state, version}` 기록 → `persist.rehydrate()` → 성공 토스트.~~
   **버그였다**: 이 순진한 경로는 **영속에 원자적이 아니다**. 백업 write와 `rehydrate`의 storage 읽기 **사이**에, 동시 `setState`
   (React 이펙트·`syncWallet`·`AppState` 백그라운드 flush)가 **이전(현재) 상태 값**으로 persist 디바운스 쓰기를 걸어 백업을 덮으면,
   `rehydrate`가 **옛 세이브를 읽어** 복원이 조용히 실패한다(엉뚱한 구단 로드). 실기기에서 "인천 복원했는데 홈은 여전히 대전"으로 재현.
   - **수정**: 적용은 **`restoreSaveAtomic(state, version)`**(`store/useGameStore.ts`) — **쓰기 억제 래치**. 적용 구간 동안 persist 스토리지를
     **쓰기 no-op 래퍼**(getItem은 통과)로 바꿔 백업 write와 rehydrate 사이 어떤 디바운스 쓰기도 storage에 못 닿게 한다(원자 구간).
     순서: **억제 먼저 → `flushGameSave()`(기존 대기분만 비움) → 백업 직접 write → `rehydrate` → 원래 스토리지 복구**. 저장 내용·스키마·결정론 불변(쓰기 타이밍만 격리).
   - **로드 결과 검증(조용한 오적용 차단)**: `rehydrate` 후 로드된 `selectedTeamId`가 **백업의 구단과 일치**할 때만 성공(토스트+홈 이동), 불일치면 **실패 알림**.
     구 판정(`selectedTeamId` truthy)은 클로버로 옛 구단이 로드돼도 truthy라 통과해 **조용한 오적용**을 놓쳤다.
   - 진행 중엔 **기존 `busy` 블로킹 오버레이 재사용**(Modal 수 불변). 가드 `_dv_save_transfer (g)`가 클로버 재현 + 래치 A/B로 봉인.

### 9.4 재화 안전 — 가져오기는 치트 벡터가 아니다 (서버 진실 원칙)
- 표시 카피: **"다이아·결제 재화는 이 파일이 아니라 계정(서버)에 안전하게 보관돼요. 이 파일은 구단 진행(시즌·선수·기록)만 담아요."**
- 구조적 근거(§7.6·MEMORY 서버 진실): `state`는 `partialize` 산출이라 `diamonds`·`claimedAch`·`adState` 필드가 **물리적으로는 포함**되지만,
  이들은 **표시 캐시**일 뿐 진실이 아니다. 가져오기 후 로그인 슬롯의 `syncWallet`이 **서버 잔액·업적·광고캡으로 수렴**시켜 조작값을 덮는다.
  **소비(전지훈련)·적립·결제는 무조건 서버 확인 후 반영**(CLAUDE §8)이므로, 파일의 `diamonds`를 손으로 부풀려 가져와도 **쓸 수 있는 재화가 생기지 않는다**.
  즉 이 기능이 재화 인플레 벡터가 되지 않는 것은 "파일에서 재화를 뺐기 때문"이 아니라 **재화 진실이 애초에 서버에 있기 때문**이다.

### 9.5 UI 위치 (`app/settings.tsx`)
- "세이브 관리" 섹션(데이터 섹션 = 세이브 초기화 근처). 2행: **내보내기**(구단 진행을 파일로 저장·공유)·**가져오기**(파일에서 불러오기).
- UI_RULES 준수: 무거운 작업(파일 I/O·rehydrate)은 블로킹 오버레이(재사용)로 재입력 차단, 결과는 토스트/다이얼로그로 알림. 세이브 없으면 내보내기 비활성.

### 9.6 가드 `tools/_dv_save_transfer.ts`
`lib/saveTransfer.ts` 순수 함수 + 실 store 왕복(§6·§8 패턴). exit 0/1.
- **(a) 왕복 동일성**: 코퍼스 세이브 state로 `buildExportPayload`→`serializeExport`→`parseImportPayload`가 원 state와 **딥 동등**.
- **(b) 미래 버전 거부**: `version = SAVE_VERSION+1` 봉투 → 거부 + 사유("최신 업데이트").
- **(c) 쓰레기 입력 거부**: 비-JSON·`app` 불일치·`state` 배열/누락 → 각각 사유와 함께 거부.
- **(d) 드라이런 게이트 증명**: commit-throw 손상 state(`playerBase:{p:null}`)를 가져오기 시도 → **거부**되고 모킹 스토리지의 기존 세이브 **바이트 불변**(현재 세이브 보호).
- **(e) 실 store E2E**: `corpus/saves/v3_260716_progressed.json`의 state를 export→import→모킹 스토리지 기록→`persist.rehydrate()` 완주(**day 80 복원** 확인).
- **(f) A/B 민감도**: 게이트를 우회한 경로(파서에 시임 두지 않고 가드 안에서 "게이트 없었다면 바로 write+rehydrate" 재현)로 (d)의 손상 state를 적용하면 **§3.3 fresh 리셋(현재 세이브 전손)** 이 실제로 일어남을 단언 → 드라이런이 막는 결함이 실재함을 증명(허위 오라클 차단).
- **(g) 쓰기 경합 원자성**(2026-07-16 신설): 팀 A 확립 후 팀 B 백업 복원 중 **동시 setState의 stale flush를 in-window 주입** → ⓐ 래치 없는 구 경로는 백업이 덮여 **옛 구단(A) 로드**(버그 재현) ⓑ **`restoreSaveAtomic`** 은 같은 주입에도 **백업(B) 정상 로드**(래치 held)·슬롯 스토리지도 B. A/B 격차로 래치가 실제 결함을 막음을 증명. 동시 쓰기가 실기기 클로버 벡터임을 헤드리스로 재현(모킹 E2E의 write-contention 사각 봉인).

### 9.7 검증 (§8.4 연장)
- **`npx tsx tools/_dv_save_transfer.ts`** — 왕복 동일성·미래버전/쓰레기 거부·드라이런 게이트·실 store E2E·A/B 민감도·**(g) 쓰기 경합 원자성**(exit 0/1).

---

## 10. 시즌 종료 서버 백업 — 클라우드 안전망 (2026-07-16, 사용자 결정)

> **목적**: §9(수동 파일 export/import)이 "사용자가 손으로 백업"이라면, 이 절은 **시즌이 끝날 때마다 조용히 자동으로 서버에 백업**한다.
> 폰 분실·세이브 꼬임·기기 교체 시 **설정에서 서버 백업을 골라 복원**한다. §9와 같은 payload(봉투)를 쓰되 전송 매체가 파일이 아니라 서버다.
>
> **불변식(§7·§8·§9와 동일)**: 이 기능은 **payload 스키마·`SAVE_VERSION`·`migrate`·`sanitizeSave`·`partialize`를 건드리지 않는다**.
> 업로드 원천은 §9와 **동일한** `captureReplaySave()` → `buildExportPayload`+`serializeExport`(새 포맷 금지). 복원도 §9.3의 **가져오기 파이프라인 그대로**(`parseImportPayload`→`dryRunImport`→확인→적용). 이 절은 그 파이프라인의 **서버 전송 래퍼**일 뿐이다.
>
> **세이브 스키마 불변(핵심)**: "마지막 성공 백업 시즌"은 세이브 payload(§1의 69필드)에 **넣지 않는다** — `partialize`에 필드를 추가하면 코퍼스 박제 규율(§8.2)을 발동시키고 스키마 드리프트를 낳는다. 대신 **AsyncStorage 별도 키**(`baeknyeon-backup-last:<userId>`, 계정별)에 비영속으로 기억한다.

### 10.1 API 계약 (서버와 공유 — 고정)
- `POST /api/save-backup` (Bearer) body `{ season:number, payload:string }` → `{ ok:true, id, keptCount }`. payload = §9.1 봉투 문자열 그대로. 서버는 계정당 **최근 5개** 유지(초과 삭제 = `keptCount`).
- `GET /api/save-backup` (Bearer) → `{ ok:true, backups:[{ id, season, createdAt, sizeBytes, saveVersion }] }` 최신순.
- `GET /api/save-backup/<id>` (Bearer) → `{ ok:true, payload:string }`.
- 서버 통신은 `lib/server.ts` 패턴 미러(**Bearer 주입·타임아웃·throw 없음**). Bearer는 `useAuthStore.session.token`, base는 `EXPO_PUBLIC_SERVER_URL`. 미설정/네트워크 실패는 `offline`로 조용히 흡수 — 관전/시뮬은 이 계층을 안 탄다(로컬 결정론).

### 10.2 자동 업로드 (`store/useGameStore.ts endSeason` + `lib/saveBackup.ts`)
- **트리거**: `endSeason`이 모든 상태를 `set(...)`으로 커밋한 **직후**(오프시즌 롤오버 완료 = `season=nextSeason`, `currentDay=0`) **fire-and-forget** 1줄:
  `void import('../lib/saveBackup').then((m) => m.triggerSeasonBackup()).catch(() => {})`. 동적 import로 순환 의존(saveBackup→store) 차단.
- **조용한 실패**: 업로드 실패(오프라인·서버 오류)해도 **게임 진행 무영향·무알림**. `triggerSeasonBackup`은 절대 throw 안 하고 store를 **건드리지 않는다**(결정론·바이트 불변).
- **태그 시즌**: `body.season = 캡처된 세이브의 season`(= 커밋 후 새 시즌 번호). 성공 시 `baeknyeon-backup-last:<userId>`에 그 season을 기록.
- **진행 중 구단 없으면 스킵**(`selectedTeamId==null` → 백업 안 함).

### 10.3 재시도 (부팅·로그인 후 1회)
- **판정(순수)**: `shouldRetryBackup(lastBackupSeason, currentSeason, online)`:
  - `!online` → **false**(오프라인이면 통과 — 재시도 안 함).
  - else → `currentSeason > (lastBackupSeason ?? -1)`(마지막 성공 백업이 현재 시즌보다 뒤처졌으면 = 시즌 종료 백업이 유실됐으면 재시도).
- **배선**: `onRehydrateStorage`(§0 — 계정 확정 후 슬롯 로드 완료 지점 = "부팅/로그인 후"의 owned 훅. SAVE_SYSTEM §7.5 `switchSaveScope`가 콜드부팅·로그인 양쪽에서 rehydrate를 부른다) 끝에 `void import('../lib/saveBackup').then((m) => m.retryBackupOnBoot())`.
  > 대안(향후): boot 트리거를 `app/_layout.tsx`/`switchSaveScope`로 옮길 수 있으나, 이번 구현은 owned 파일(store) 안에서 완결하기 위해 `onRehydrateStorage`에 뒀다. 둘 다 "슬롯 로드 완료 = 로그인 후" 시점이라 의미 동일.
- **1회 소진 시점 — 이중 rehydrate 시퀀스 (정정 2026-07-16, 에뮬 실기기 E2E 발견)**:
  > ~~`retryBackupOnBoot`은 **세션당 1회**(모듈 boolean 플래그)만 실제 시도하고, 나머지는 즉시 반환.~~ **버그였다**: 진입 즉시 플래그를 소진했다.
  실제 부팅은 **rehydrate가 2회**다 — ① 콜드부팅 auto-rehydrate(이 시점 `useAuthStore` 미하이드레이션 → `session?.userId` **undefined** → 조기 반환), ② 인증 완료 후 `switchSaveScope`의 계정 슬롯 rehydrate(세션 있음 = 진짜 재시도 지점). 구 로직은 ①에서 플래그를 태워 ②가 **영원히 스킵** → 부팅 재시도가 실전에서 죽어 있었다(서버 POST 0건).
  - **수정**: 플래그 소진을 **"자격 있는 시도"(= `userId` + 유효 세이브 `selectedTeamId` 통과) 뒤로** 옮긴다. 세션/세이브가 없어 조기 반환한 호출(①)은 **소진하지 않는다** → ②가 살아난다.
  - **`retriedFor: Set<userId>`**(모듈 비영속): boolean 대신 **계정별** 1회. 같은 세션에서 A 로그아웃→B 로그인 시 B도 1회 재시도를 받는다(계정 전환 대응). 같은 계정 재-rehydrate(설정 import 등)는 Set 히트로 스킵.
  - 가드 `tools/_dv_save_backup.ts` ⑤가 이 **이중 rehydrate 시퀀스를 모킹으로 재현**(세션X 호출→세션O 호출→업로드 1회 발화)해 회귀를 봉인 + A/B로 구 로직(진입 즉시 소진)이 죽음을 증명. 순수 가드(②③)는 함수를 격리 검증해 이 **시퀀스 사각**을 못 봤다(TEST_METHODOLOGY §4).

### 10.4 복원 UI (`app/settings.tsx`)
- "세이브 관리" 섹션에 **"서버 백업에서 복원"** 행 추가(내보내기·가져오기 아래).
- 흐름(신규 Modal 금지 — #129, 기존 `showAlert`/블로킹 오버레이 재사용):
  1. 탭 → `listBackups()`(busy 오버레이) → 실패면 사유 다이얼로그(오프라인/로그인/오류), 빈 목록이면 안내.
  2. 목록을 **`showAlert` 세로 버튼 스택**(ActionSheet 대용 — 최대 5행 + 취소)으로: 각 행 `N시즌 · 날짜 · 크기`.
  3. 선택 → `fetchBackup(id)`(busy) → **기존 가져오기 파이프라인 그대로**: `parseImportPayload`→`dryRunImport`→확인 다이얼로그(§9.3 재화 안전 카피)→`applyImport`(§9.3-5 **`restoreSaveAtomic` 원자 래치 + 로드 구단 일치 검증**). 드라이런 게이트·쓰기 억제 래치를 서버 복원도 파일 가져오기와 동일하게 통과(같은 적용 경로라 §9.3-5의 클로버 버그·수정을 공유).
  4. 진행 중 표시는 §9.5의 `importing`/`busy` 블로킹 오버레이 재사용(Modal 수 불변).
- **카피**: "시즌이 끝날 때마다 자동으로 서버에 백업돼요(최근 5개). 다이아·결제 재화는 계정에 항상 안전해요."

### 10.5 재화 안전 — §9.4와 동일
서버 백업 payload도 `partialize` 산출이라 `diamonds`·`claimedAch`·`adState`가 물리적으로 포함되지만 **표시 캐시**일 뿐. 복원 후 로그인 슬롯의 `syncWallet`이 서버 잔액·업적·광고캡으로 수렴(서버 진실). 소비·적립·결제는 서버 확인 후에만 반영 → 백업/복원은 재화 인플레 벡터가 아니다.

### 10.6 코드 맵
- `lib/saveBackup.ts`(신규) — 순수 판정(`shouldRetryBackup`)·바디 빌더(`buildBackupBody` = saveTransfer 재사용)·서버 클라(`uploadBackup`/`listBackups`/`fetchBackup`, lib/server 패턴 미러)·오케스트레이션(`triggerSeasonBackup`/`retryBackupOnBoot`)·마지막 백업 시즌 별도 키 I/O. React 무의존(순수부 헤드리스 가드).
- `store/useGameStore.ts` — `endSeason` 커밋 직후 자동 업로드 훅 1줄 + `onRehydrateStorage` 끝 재시도 훅 1줄(둘 다 동적 import fire-and-forget). **시뮬/결정론 경로 무접촉**.
- `app/settings.tsx` — "서버 백업에서 복원" 행 + `listBackups`/`fetchBackup` → 기존 import 파이프라인 재사용.

### 10.7 가드 `tools/_dv_save_backup.ts` (순수부 — 서버 없이)
라이브 왕복은 **서버측 가드(`_dv_backup_live`)** 가 커버 — 여기선 순수부만(중복 금지). exit 0/1.
- **① 페이로드 포맷 동일**: `buildBackupBody(cap, season).payload === serializeExport(buildExportPayload(cap))` + 파싱 시 봉투(`app`/`kind`/`version`/`state`) 복원 + `season` 패스스루.
- **② 재시도 판정 표**: `shouldRetryBackup`을 (마지막 백업 시즌 × 현재 시즌 × 온라인) 조합 표로 검증(오프라인=false, null 이력=현재>−1, 뒤처짐=true, 동일/앞섬=false).
- **③ endSeason 결정론 무영향**: 실 store로 `resetSave→selectTeam→completeSeason→endSeason`을 **업로드 성공/실패/미호출 3케이스**(fetch 모킹·세션 토글)로 구동 → 커밋된 세이브(`captureReplaySave().state`)가 **3케이스 바이트 동일** + 성공·실패 케이스는 fetch 호출됨·미호출 케이스는 미호출(케이스가 실제로 다름을 증명). 훅이 fire-and-forget임을 코드 레벨로 봉인.
- **④ A/B 민감도**: ②의 표를 **교란된 판정 변이**(예: `>=`·온라인 게이트 제거)에 돌리면 최소 1행 불일치(표에 이빨이 있음 = 회귀를 잡는다) — 허위 오라클 차단.
- **⑤ 부팅 시퀀스 재현**(2026-07-16 신설): 이중 rehydrate(인증 전 세션X → 인증 후 세션O)를 모킹으로 재현 → **실제 `retryBackupOnBoot`** 을 순서대로 구동해 세션X는 업로드 0·플래그 미소진, 세션O는 업로드 1회 발화, 같은 계정 재호출은 0, 계정 전환은 1회를 검증 + A/B(구 "진입 즉시 소진" 로직 재현이 인증 후 업로드 0 = 재시도 죽음)로 시퀀스 사각을 봉인.

### 10.8 검증 (§9.7 연장)
- **`npx tsx tools/_dv_save_backup.ts`** — 페이로드 포맷·재시도 표·endSeason 무영향·A/B 민감도(exit 0/1).
