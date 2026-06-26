# 세이브·마이그레이션 시스템 (SAVE_SYSTEM)

> 사용자 폰에 저장된 세이브가 **앱 업데이트로 데이터 구조가 바뀌어도 깨지지 않게** 하는 체계.
> CLAUDE.md 8장(저장소)·SEASON_SYSTEM 0·7장(리플레이·상태)을 출시 안전 관점으로 확장한다.
> 핵심 질문(2026-06-26 사용자): "구조가 바뀌면 자동 업데이트되나, 오류나나?" → 아래 정책으로 **자동·안전**하게.

---

## 0. 저장 아키텍처 (현재)

- **저장소**: `zustand persist` + `AsyncStorage`, 키 `baeknyeon-save`. 각 기기 로컬 JSON 1개.
- **얇은 리플레이 세이브**: 진화된 스탯·순위·생산을 저장하지 않는다. **base 스냅샷(`playerBase`/`rosters`) +
  `currentDay` + `results` + 누적 기록(archive/통산/명전/마일스톤…)** 만 저장하고, 화면·순위·생산은 시드로 **재계산**.
- **부호화**: `partialize`(저장 필드 화이트리스트, 51필드 §1) → 직렬화. 복원은 `onRehydrateStorage`가 base를
  레지스트리에 커밋(`commitPlayerBase`/`commitRosters`/`commitStaff` 등).

---

## 1. 영속 스키마 (51 필드 — 단일 진실)

> 출처: `store/useGameStore.ts` `freshSave`(158-206)·`partialize`(870-922)·`types/index.ts`. 구조가 바뀌면
> **이 표를 먼저** 갱신한다(DOC_DISCIPLINE). 자료구조 분류가 마이그레이션 정규화기(§3)의 근거다.

### 설정(새 게임에도 유지 — freshSave 밖)
| 필드 | 타입 | 기본 |
|---|---|---|
| `onboarded` | boolean | false |
| `supporter` | boolean | false |
| `sfxEnabled` | boolean | true |
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

### 선수·로스터 (base 스냅샷)
| 필드 | 자료구조 | 기본 | 비고 |
|---|---|---|---|
| `playerBase` | Record<playerId, Player> \| null | null | **전체 Player**(신체·멘탈·기술·xp·potential·talentBase·catTalent·contract·career·seasonLines·traits·faPref·isForeign·isAsianQuota·nationality). types/index.ts 42-95 |
| `rosters` | Record<teamId, playerId[]> \| null | null | 팀별 명단 |

### 역대 기록 (append-only, 일부 바운드)
| 필드 | 자료구조 | 기본 | 바운드 |
|---|---|---|---|
| `archive` | SeasonArchive[]{season,championId,awards?,standings?,streaks?,series?,record?} | [] | 무제한(시즌수) |
| `hallOfFame` | HofEntry[]{id,name,position,teamId,seasons,points,blocks,digs,spikes?,aces?,assists?,retiredSeason,legend} | [] | 무제한 |
| `expelledLog` | ExpelRecord[] | [] | 무제한 |
| `transfers` | Transfer[]{season,playerId,name,fromTeam,toTeam,kind?,ovr?} | [] | 최근 200 |
| `retirements` | RetireRecord[] | [] | 최근 200 |
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
| `trainingFocus` | {primary:[id,id],secondary:[id,id,id]} \| null | null |

### 구단주 레이어·재정
| 필드 | 자료구조 | 기본 |
|---|---|---|
| `interviews` | InterviewLog[]{playerId,season,day,topic,card,ok} | [] (최근 200) |
| `benchDirectives` | BenchDirective[]{playerId,fromDay} | [] |
| `talkCooldown` · `benchCooldown` | Record<playerId, number> | {} |
| `fanScore` | scalar(number) | 50 |
| `releaseAnger` | scalar(number) | 0 |
| `cash` | scalar(number) | 50000 |
| `lastFinance` | SeasonFinance \| null | null |

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
| **① 필드 추가**(새 옵셔널 필드) | ✅ 자동·안전 | zustand 기본 merge `{...초기값, ...저장값}` — 새 필드는 저장본에 없어도 초기 기본값으로 채움. 지금까지 모든 신기능이 이 패턴 |
| **② 엔진 로직 변경**(예: OP 공격 집중) | ✅ 안전 | 파생값 미저장 → 옛 세이브를 **새 엔진으로 재계산**. 과거 확정 기록(archive·통산·명전)은 시즌 경계 박제로 보존, 미래만 새 엔진 |
| **③ 기존 필드 모양/의미 변경**(이름·구조 재편) | ⚠ **version+migrate 필요** | 옛 값이 그대로 병합돼 새 코드가 깨질 수 있음 → §3 마이그레이션으로 변환 |

> 추가로, **잘못된 타입의 저장값**(손상·구버전)은 zustand의 `?? []`/`?? {}`(null만 방어)로 안 막혀
> `[...value]`·`Object.keys(value)`에서 크래시할 수 있다(조사 2026-06-26: `inSeasonTx`/`faPool`/`benchDirectives`/
> `archive`/`coachPool`/`staffHead` 등). §3 정규화기가 **컨테이너 모양을 강제**해 이걸 닫는다.

---

## 3. 마이그레이션 정책 (구현 — `store/saveMigration.ts`)

### 3.1 버전 + migrate
- `persist`에 **`version: SAVE_VERSION`**(현재 1)을 둔다. 기존 무버전 세이브 = version 0 → 로드 시 `migrate` 호출.
- **`migrate(persisted, fromVersion)`** = `migrateSave`:
  1. (향후) `fromVersion`이 낮으면 그 버전→다음 버전 **변환 단계**를 순서대로 적용(필드 이름변경·구조재편).
  2. 마지막에 **`sanitizeSave`**(컨테이너 모양 정규화)로 모든 필드를 기대 자료구조로 강제.
  - v0→v1은 **구조 동일** → 변환 단계 없이 정규화만(현 세이브를 안전하게 수선).

### 3.2 정규화기(`sanitizeSave`) — 컨테이너 모양 강제
필드별 자료구조(§1)대로 코어스(coerce):
- **scalar**: `typeof` 일치(+`Number.isFinite`)면 유지, 아니면 기본값. nullable(selectedTeamId·keepForeign 등)은 null 허용.
- **array**: `Array.isArray`면 유지, 아니면 `[]` → 모든 `[...arr]`·`.map`·`.filter`·`.slice` 안전.
- **record**: 평범한 객체(`typeof==='object' && !Array.isArray`)면 유지, 아니면 `{}` → `Object.keys`·spread 안전.
- **nested**: `careerLog`(4 num)·`careerTotals`(6 num)는 각 숫자 필드 기본 0으로 보강. `coachPool`은 null이거나
  `{coaches:array, assistants:array}`. `trainingFocus`는 null이거나 `{primary:array, secondary:array}`(malformed→null,
  리그가 감독 기본값으로 재유도). `lastFinance`는 null이거나 객체.
- 기준 기본값은 `SAVE_DEFAULTS`(= `freshSave` + 설정 4필드) **단일 소스**.

> 범위: v1은 **컨테이너 모양**(array/record/scalar)을 보장해 *크래시*를 닫는다. 배열 *항목*의 깊은 필드 검증
> (예: 모든 archive의 awards 모양)은 소비처의 옵셔널 체이닝 + 향후 per-item 정규화로(과한 비용 회피). 깊은 접근
> 크래시 후보(archive.awards·playerBase.contract·hallOfFame 옵셔널·interviews/benchDirectives 인덱스)는
> 소비처에서 옵셔널 체이닝/길이 체크로 별도 방어(EDGE_CASES와 연동).

### 3.3 안전 복원 (try/catch 리셋)
- `onRehydrateStorage` 본문을 **try/catch**로 감싼다. 정규화에도 불구하고 커밋이 throw하면(심층 방어):
  콘솔 경고 + **fresh 상태로 리셋** + `hydrated:true` → **크래시 루프 대신 깨끗한 새 게임**으로 진입(데이터 1개라 최악도 1인 손실).
- migrate/sanitize는 순수 코어스(throw 없음)라 정상 경로에선 리셋이 안 일어난다.

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
- `store/useGameStore.ts` — `persist` 옵션에 `version`·`migrate` 추가, `onRehydrateStorage` try/catch.
- `data/league.ts`·`data/dynamics.ts`·`data/awardSalary.ts` — 복원 커밋(`commitPlayerBase` 등). 정규화 후 입력이라 안전.
- `tools/_dv_migrate.ts` — 마이그레이션 가드(아래).

## 6. 검증
- `npx tsc --noEmit`(+ test config) · `npm test`.
- `npx tsx tools/_gt_determinism.ts` — 실제 persist `partialize`/`onRehydrate` 충실도(베낀 복사본 아님).
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

> 검증 루틴(README)에 `_dv_migrate`(순수)·`_dv_migrate_e2e`(실 store) 등록. 세이브 필드 추가·구조 변경 시 갱신·재실행.
