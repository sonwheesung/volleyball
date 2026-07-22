# 선발 로테이션 & 벤치 사유 심리 (ROTATION_MORALE) — SPEC

> 상태: **✅ 구현 완료**(2026-06-22 설계+구현). B+C+C.4(감정·사유·기대치·누적→FA)·#3(로드매니지먼트) 전부 구현 — §0.2.
> 사용자 요구 3종을 한 시스템으로: ①순위 굳으면 주전 휴식(로드 매니지먼트, 검증 #3) ②벤치 *사유*를
> 선수가 정확히 인지 ③사유 + **선수 성격**에 따라 불만/무감정/긍정 상태가 변경·유지.
> 검증: `simStarters`(선발 9/9)·`simMood`(심리 6/6)·`_ev_rest`(#3 휴식·관전==순위 일치). 버그 가드: EC-LU-01·02.
> **+ 신인 등용(F, 2026-07-22)**: PO 탈락 확정 팀이 잔여 경기에 신인(`career.seasons===0`)을 선발 승격(휴식과 대칭·같은 라인업 레이어). 검증 `_dv_promote`(3경로 일치·six 포함·바이트동일·상한·A/B·결정론).

---

## 0. 설계 원칙 / 결정론 제약 (가장 먼저)

- **부상 forward-pass(`data/dynamics.ts`)는 results-독립**(시드 기반: 부상·징계·폼). 여기에 "순위 기반 휴식"을
  넣으면 결과→라인업→부상→결과 **순환**이 생긴다. → **휴식은 forward-pass에 넣지 않는다.**
- **휴식은 라인업 레이어**(경기 시뮬 + 생산 귀속 시점)에서만 적용. "순위가 굳었나"는 `teamClinch(teamId,
  playedThroughDay(results))`로 **results에서 파생**(인과적: D일 라인업은 D−1까지 치른 results 기준 → 순환 없음).
- 부상 노출(forward-pass)은 휴식 미반영(근사) — 휴식 선수도 그날 부상 굴림 대상일 수 있음. 부상 ~0.4건/경기라
  영향 미미, 사유 명시. (정합이 더 필요해지면 후속.)
- 감정·사유 인지는 **파생·무저장**(관전형 척추 — `currentDay`+`results`에서 재계산). 새 영속 필드 없음.

### 0.1 #3 순환 함정과 해결 (구현 전 필수)
- `restedOnDay`는 clinch(순위)가 필요 → clinch는 `computeStandings → seasonResults → allResults()`(**전 경기 재시뮬**)에서 나온다.
  휴식을 그 재시뮬 안에서 적용하면 **재시뮬이 자기 자신(clinch)을 호출하는 무한 순환**.
- **해결**: production의 전 시즌 패스를 **날짜 오름차순 + 러닝 순위 누적**으로 돌린다. D일 경기를 시뮬하기 전,
  **D−1까지 누적된 러닝 순위**로 `restedOnDay(D)` 판정(인과적 — 자기 결과 안 봄). 그렇게 만든 결과가 `allResults()`.
- 관전(match board)은 `restedOnDay(teamId, D)` = `computeStandings(D−1)`(=캐시된 allResults 필터)로 — 패스가 쓴 러닝 순위와
  **동일 집합**(days ≤ D−1)이라 일치. 재귀는 패스 *내부*에서 러닝 순위를 직접 써서 끊는다(computeStandings 재호출 금지).
- → **production 코어 리팩터**(현 일괄 패스 → 날짜순 누적 패스)가 #3의 전제. 결정론 회귀(`npm test`·real save/reload·
  `_gt_determinism`·관전==순위==생산 일치)로 반드시 검증.

### 0.2 구현 단계 (위험 낮은 것 먼저 — 2026-06-22 순서 확정)
1. **Phase 1 = B+C+C.4 (감정·사유·FA)** — ✅ **구현(2026-06-22)**: `benchCauseOf`(사유 귀속)·`discontentOf` 사유×성격×기대치
   분기·`moodOf`(불만/무감정/긍정)·선수 상세 "지금 마음" 표시·**누적 부당벤치→재계약 거부→FA**(`sustainedBenchRefuse`).
   검증 `tools/simMood.ts`(6체크 PASS). 'rested' 사유는 #3 전까지 휴면.
2. **Phase 2 = A (#3 로드매니지먼트)** — ✅ **구현(2026-06-22)**: `pickRest`(engine/lineup, 고령 우선·백업 있는 주전·리베로 유지·
   최대 2명)·`restedOnDay`(data/rotation, day−1 clinch)·순위 재시뮬(allResults) 러닝 순위로 동일 적용·생산·관전 보드 연결.
   순환은 0.1대로 해결(allResults는 러닝 순위로 pickRest 직접 호출, 나머지는 restedOnDay). 'rested' 사유·#5 활성.
   검증 `tools/_ev_rest.ts`(휴식 18팀-경기·경합기 0·리베로 유지·**관전==순위 불일치 0**)·`simStarters` #3·#5 PASS·결정론 유지.

---

## A. 로드 매니지먼트 (#3 — 순위 굳으면 주전 휴식)

### A.1 언제 쉬나 (팀 단위)
`teamClinch(teamId, playedThroughDay(results))`:
- `clinched`(PO 확정) → 주전 보호(부상 회피·벤치 경험). 휴식 ON.
- `eliminated`(탈락) → 유망주·벤치에 출전 경험. 휴식 ON.
- `contention`(경합) → **휴식 없음**(전력).

### A.2 어느 경기 (일부 — 전부 아님)
잔여 경기 중 일부만. 경기별 결정론: `rest:{teamId}:{day}` 시드로 `REST_GAME_RATE=0.45`(≈45%) 경기에서 휴식 발동(`engine/lineup.ts pickRest`).
~~빅매치(상위권 직접 대결)는 굳었어도 휴식 자제(연출 가치).~~ → **미구현(2026-07-15 발견 모드 2차)**: `pickRest`·`restedOnDay`에 상대 순위·`isBigMatch` 검사가 없다 — 순위가 굳으면 빅매치 여부와 무관하게 0.45로 휴식이 발동한다(연출 자제 로직 미연결). 백로그 #123(빅매치 휴식 자제).

### A.3 누가 쉬나 (주전 1~2명 — 라인업 붕괴 금지)
휴식 우선순위: **고령 단독**(`pickRest`는 `b.age - a.age`로 정렬, tiebreak=id — §0.2 정본과 일치). ~~저폼(form<1)·고피로·부상이력 보유~~ → **정정(2026-07-15 발견 모드 2차)**: 코드는 나이만 본다(폼·피로·부상이력은 우선순위에 미입력). 한 경기 1~2명만(`REST_SECOND_RATE=0.4`로 2명째 추가).
- 대체 = 빼도 그 포지션이 백업으로 채워지는 주전만(`cnt[position]>=2` 필터, 이후 `buildLineup` 폴백이 재충원). **리베로는 항상 유지**(`buildLineup` libero 슬롯, EC-LU-01 가드 재사용).
- ~~팀 OVR 급락 방지: 휴식 후 라인업 OVR이 전력 대비 −Δ(예: −4) 이내. 초과 시 휴식 축소.~~ → **미구현(2026-07-15 발견 모드 2차)**: `pickRest`에 OVR 급락 검사가 없다 — 동포지션 백업 존재(`cnt>=2`)만 확인하고 휴식 후 라인업 OVR 델타는 보지 않는다(백업만 있으면 −4 초과라도 휴식). §미해결 1(−4 상한)과 정합. 백로그 #123.

### A.4 구현 형태 (결정론) — ✅ 구현됨
- `pickRest(avail, teamId, day)`(`engine/lineup.ts`, 순수) + `restedOnDay(teamId, day)`(`data/rotation.ts`, clinch는 day−1).
- `match/[id].tsx`·`data/production.ts`(allProdRows)가 `restedOnDay`로, 순위 재시뮬 `data/standings.ts`(allResults)는
  **러닝 순위로 같은 `pickRest`를 직접 호출**(0.1 순환 회피) → 세 경로 동일 휴식 집합. forward-pass(부상)는 미사용.

---

## B. 벤치 사유 귀속 (선수가 *왜* 벤치인지 인지)

비출전 선수의 사유를 우선순위로 단일 분류 (`benchCauseOf(p, teamId, day) → SitCause`):
| 순위 | 사유 | 감지 |
|---|---|---|
| 1 | `injured` | `teamInjuriesOn` |
| 2 | `suspended` | `suspendedOnDay`(사건사고) |
| 3 | `rested` | `restedOnDay`(A — 신규) |
| 4 | `ownerBenched` | `benchDirectives`(🪑) |
| 5 | `outclassed` | available인데 `buildLineup` 미선발(실력 밀림) |
| — | `starter` | 선발(출전 중) |

---

## C. 감정 모델 = f(사유, **성격**)  ← 핵심

### C.1 성격 입력 (새 필드 없이 기존 데이터)
- `prefWeightsOf(p)` — **play**(출전 갈망)·**win**(우승 갈망) 가중치. = 핵심 성격 축.
- 멘탈 특성(`player.traits`, cat='멘탈': clutch/bigGame/choke 등) — 자존심·멘탈 강도 프록시.
- (선택) `consistency`/`focus` 멘탈 스탯.

### C.1b 주전 기대치 게이트 (2026-06-22 사용자 피드백 — **구현됨**)
출전 불만 = `w.play(출전 갈망) × 사유 스케일 × **주전 기대치(expectsPlay 0..1)**`.
- `expectsPlayOf(p)` = 동포지션 최약 주전과의 OVR 격차(±9) + 경력(베테랑↑·신인↓)로 산출(`data/owner.ts`).
- **OVR 낮고 경력 짧은 후보(기대치≈0)는 못 나와도 불만 없음**("아직 내가 부족하지" — 당연히 받아들임).
  에이스(기대치≈1)가 벤치면 부글부글. → 사용자 지적("저OVR·저경력이 출전율만 낮다고 불만은 비현실") 해결.
- 검증: `tools/simMood.ts` ⑤ — 같은 선수·같은 성격, 기대치만 1.0↔0.1 → 불만 on/off(엔진 A/B).
- **사유 스케일**: 부당벤치(`ownerBenched`) 1.0 · **실력 밀림(`outclassed`) 0.7**(2026-06-24 상향 0.5→0.7) · 그 외 0.
  - **0.7 상향 이유(2026-06-24 사용자 피드백)**: "91이 93에 2점 밀려 벤치인데 불만없음"이 화면의 성격과 어긋났다.
    구 0.5에선 출전형(w.play 0.55)조차 주전급 근접(기대 0.78)서 `0.55×0.5×0.78=0.21<0.25`로 불만 안 떴다.
    0.7로 올려 **출전형은 주전 문턱 ±3 OVR서 밀리면 불만**(`0.55×0.7×0.78=0.30`), 팀퍼스트(w.play 0.10)는 여전히 수용.
    "어디서든 주전 원하는 선수 vs 백업 만족 선수"가 둘 다 의미 있게 — 부당벤치(1.0)보단 약함은 유지.
  - 검증: `simMood.ts` ⑦ — 실력 밀림 2점 차에서 출전형→불만 / 팀퍼스트→수용(성격↔마음 일치, A/B).
- **성격 화면 표시(2026-06-24)**: 선수 상세 구단주 면담 카드에 **성격(`ARCHETYPE_KO`: 연봉중시/우승갈망/팀충성/
  출전갈망/연고애착)** + 벤치 태도 한 줄을 띄운다 → "얘는 충성형이라 백업도 수용 / 출전형이라 벤치에 민감"이 한눈에.
  `data/owner.ts ARCHETYPE_KO` · `app/player/[id].tsx`.

### C.2 사유 → 기저 감정 → 성격 변조

> **정정(2026-07-15 발견 모드 2차)**: 아래 원표는 **지향 설계(미구현 세분)**로 보존한다. **코드 정본**(`engine/owner.ts minutesGrievance`·`moodOf`)은 훨씬 단순하다:
> - **불만(discontent)**: `ownerBenched`(scale `1×expectsPlay`) · `outclassed`(scale `0.7×expectsPlay`)만 발화 — 나머지 사유(`injured`·`suspended`·`rested`·`starter`)는 출전 불만 scale 0 → **감정 0(neutral)**. (win/money/hometown 불만은 사유와 독립.)
> - **긍정(positive)**: `moodOf`는 `sitCause==='starter' && recentRankAvg ≤ teamCount×0.5` **단일 조건**만 positive로 — 표의 rested 베테랑 긍정·injured 조바심·outclassed 투지/위축 세분은 없다.
> - **성격 입력**: `prefWeightsOf`의 `w.play`/`w.win`/`w.money`/`w.home`만 쓴다. **`player.traits`(멘탈 특성 choke/bigGame 등)는 감정 산출에 미입력** — 표의 "스타·멘탈강 → 강한 불만 / choke → 위축" 변조는 구현되지 않았다.
>
> 원표(지향 설계 — 미구현 세분):

| 사유 | 기저 감정 | 성격 변조 |
|---|---|---|
| injured | 무감정(체념) | 출전갈망↑ → 복귀 조바심(약), 무던 → 무감정 |
| suspended | 자책(무감정) | — (자기 잘못, 구단 무관) |
| rested(#3) | 양해/무감정 | 출전갈망·자존심↑ → 약한 불만("난 더 뛸 수 있다") / 베테랑·팀퍼스트 → 긍정(관리 고마움) |
| ownerBenched | **불만(강)** | 출전갈망↑·스타·멘탈강 → 강한 불만 / 무던·저연차 → 약 |
| outclassed | 약불만/투지 | 야망(win·play↑) → 투지(긍정적 동기) / 멘탈 약(choke) → 위축 |
| starter(승격 포함) | 긍정/만족 | 백업이 출전 기회 → 출전갈망↑일수록 강한 긍정 |

### C.3 상태 모델
- **출력**: `{ mood: 'discontent'|'neutral'|'positive', cause: SitCause, topic?, weight, label }`.
- 사유가 유지되면 상태 유지, 사유가 바뀌면 재평가(파생). 기존 `discontentNow` 확장(출전 불만을 사유 인지로 분기).
- 기존 `minutes` 불만의 단일 조건(`playRatio<0.34`)을 **사유 분기로 교체**: 부상·징계·휴식은 불만 억제, 구단주 벤치·실력밀림만 불만(성격 변조).

### C.4 누적 부정 → 팀 호감도 → 재계약 거부 → FA (2026-06-22 추가 → **구현됨**)
> 구현 메모: `sustainedBenchRefuse(playRatio, weight)`(`engine/owner.ts`)를 `buildOwnerFx`의 재계약 거부에 가산.
> **출전율(playRatio)이 곧 "얼마나 오래 앉아있었나"** 라 별도 배선 없이 누적 반영(시즌 내내 벤치=playRatio≈0→거부↑).
> 출전 불만(topic='minutes', 사유·성격·기대치 게이트 통과)일 때만 가산 — 부상 결장은 무관. 미리보기=결과 자동 유지.
> 검증 `tools/simMood.ts` ⑥: 만료 예정 선수, 정상 출전 시 거부 0% → 시즌 내내 벤치 시 80%(A/B).

- 시즌 동안 **누적된 부정 감정**(주로 `ownerBenched` 불만 × 지속 기간 × 성격[출전갈망·자존심])이 쌓이면
  **팀 호감도 하락**(파생·무저장) → 선수가 재계약을 거부하고 **FA로 이탈**.
- **기존 메커니즘 연결**(중복 신설 금지): 오프시즌 재계약 거부는 이미 `discontentNow → refuseResignProb +
  sinkingShipBias(fanScore)`로 동작(`data/owner.ts`). 여기에 **누적 부정**을 입력으로 정교화 —
  스냅샷 불만(현재 한 시점)이 아니라 **시즌 누적**(벤치 지속 경기수 × 성격)을 반영.
- **사유별 기여**: `ownerBenched`(부당 벤치)·`outclassed`(위축형)는 호감도 하락에 기여 / `injured`·`suspended`·
  `rested`(#3 관리)·`outclassed`(투지형)는 기여 없음·미미(구단 탓 아님 → 떠날 이유 약함).
- **성격 가중**: `prefWeights.play`(출전갈망)↑·자존심(멘탈 특성)↑일수록 같은 벤치에도 호감도 더 떨어져 FA 위험↑.
  반대로 팀퍼스트·저갈망 선수는 벤치를 감내하고 잔류.
- **무저장**: 호감도는 `results` + `benchDirectives` 이력에서 재계산(관전형 척추 — 새 영속 필드 없음).
- **연출**: 시즌 중 누적 부정이 임계 근처면 뉴스/면담에 신호("출전 불만 누적 — 재계약 빨간불"), 오프시즌 거부 시
  기사화(기존 transfer/FA 뉴스 연동).

---

## D. UI / 연출 (관전형 — 보는 것)
- 선수 상세: 사유+감정 한 줄("부상 결장 — 복귀를 기다림" / "구단주 벤치 — 출전 불만" / "휴식 관리 — 양해" / "기량 경쟁 — 증명 의지").
- squad 데코: `부상`/`정지` 결장 마커(라벨 pill, ~~🚑~~~~✚~~ 2026-07-04)·🪑(벤치지시). 감정 뱃지(😟불만/😊긍정)는 **선수 상세 전용**(목록 비노출 — 2026-06-30 사용자 요청).
- 면담·팬심: 사유 인지 반영(부당 스타 벤치만 팬 anger 유지).

## E. 검증 (simStarters 확장 + A/B)
- #3: 굳은 순위에서 휴식 발동(일부 경기·1~2명)·리베로 유지·경합기엔 미발동. ~~OVR 급락 없음~~ → **정정(2026-07-15 발견 모드 2차)**: OVR 급락 방지 로직 자체가 미구현(§A.3 ROT-2·백로그 #123)이라 이 검증 항목은 성립하지 않는다(제외).
- 사유 귀속 정확도: 부상/징계/휴식/구단주벤치/실력밀림 분류가 데이터와 일치.
- **감정=f(사유,성격) A/B**: 같은 사유·다른 성격(play 가중치↑↓) → 다른 감정(핵심 자가검증).
- #5 재해석: "구단주가 벤치 건의 거절당한 선수가, 순위 굳어 휴식 대상이 되며 오히려 안 나올 수도" = rested가 directive와 독립.

---

## F. 신인 등용 (PO 탈락 확정 팀 신인 선발 승격) — Phase 1 (2026-07-22 사용자 결정 · ✅ 구현)

> 요구: "PO 탈락이 확정된 팀은 남은 경기에서 유망 신인을 선발로 올려 경험을 준다"(관전형 서사 —
> 탈락팀의 '내년 농사' 장면). A(로드매니지먼트 휴식)와 같은 레이어(라인업)·같은 결정론 골격의 **대칭 기능**이다.

### F.1 발동 조건 (팀 단위 — 휴식보다 **좁다**)
`teamClinch(teamId, day−1).state === 'eliminated'` 인 팀의 잔여 정규 경기만.
- `eliminated`(PO 탈락) → 신인 등용 ON.
- `clinched`(PO 확정) → **무발동**(주전 경기감각 유지 — PO가 정규 막판 form을 씀). 휴식(A)은 clinched도 ON이지만 **등용은 아니다**(사용자 확정). clinched 팀은 주전을 쉬게는 해도(휴식) 신인을 선발로 올리진 않는다.
- `contention`(경합) → 무발동(전력).
- **바이트 동일 보장**: clinched·contention 팀 경기는 승격 로직이 빈 집합 → `buildLineup` force 인자 빈 셋 → 기존과 byte-동일.

### F.2 어느 경기 (일부) · 누가 (신인 1~2명)
- 경기별 결정론: `dev:{teamId}:{day}` 시드로 `PROMOTE_GAME_RATE=0.5`(≈50%) 경기에서 발동(`engine/lineup.ts pickPromote`). 휴식의 `rest:{}:{}` 0.45와 **독립 스트림**(같은 경기에 휴식·등용이 각각 독립 굴림).
- **신인 정의 = `career.seasons === 0`**(데뷔 전 = 진짜 신인 = **신인상(ROY) 풀과 동일 정의**, `data/awards.ts:63`과 일치). ~~`≤1`~~ → **확정: `===0`**(2026-07-22). 실측 근거(season0 fresh seed): `===0`도 eliminated 팀-경기 13건에서 비선발 신인 보유·잠재 승격 연인원 20(≈50% 발동 후 ~10/시즌)로 풀이 충분하고, `≤1`은 +5(25)에 불과하며 2년차(비신인)까지 섞여 "신인 등용"의 의미가 흐려진다. `owner.ts`의 `≤1`(기대치 게이트)와는 용도가 달라 별개.
- **비선발 신인만 후보**: 이미 선발(default `splitLineup`)인 신인은 승격 대상 아님(올려도 no-op). 실력으로 이미 뛰는 신인은 제외 → 승격은 "벤치 신인에게 코트를".
- 인원: 1~2명(`PROMOTE_SECOND_RATE=0.4`로 2명째 추가 — 휴식 `REST_SECOND_RATE`와 대칭).
- 후보 정렬: **OVR 내림차순**(가장 준비된 유망주에게 먼저 무대), tiebreak=id(결정론). 포지션 슬롯(S1·OH2·MB2·OP1·L1) 초과 강제 방지(같은 단일 슬롯 포지션에 2명 강제 금지 — 유효 승격만 카운트).

### F.3 승격 메커니즘 (제외-해킹 금지 — 리뷰 블로커 2)
- ~~빼기(default 주전 제외)로 신인을 끌어올린다~~ → **금지**. `buildLineup`은 OVR순이라 default 주전을 빼면 신인이 아니라 *차선 백업*이 올라온다(승격 실패). → **정공법**: `buildLineup(players, dvPhilosophy, forceStarters?: Set<string>)` 신설.
  - 기본값 = 빈 셋 → 기존 호출부(엔진·forward-pass·도구) **전부 byte-동일**(force 없으면 OVR 정렬 그대로).
  - 지정 id는 `bestByPos`에서 **force-first 정렬**(force 우선, 그다음 OVR)로 해당 포지션 슬롯 상위 점유 → six[]에 실제 진입.
  - `splitLineup`(생산 귀속의 선발/벤치 분리)도 동일 force 인자 수용 → six[]와 선발 집합이 일치(승격 신인 matches++·데뷔 판정 정합).
- **가드 단언**: 승격 신인이 `six[]`(및 splitLineup starters)에 실제 포함됨을 `_dv_promote` ②가 단언.

### F.4 상한 · 최소 라인업 보전 (리뷰 ⚠)
- **휴식(A)과 중첩 상한**: 팀 총 이탈 주전(휴식으로 안 뛰는 주전 + 승격에 밀려난 default 주전) ≤ **3**. 우선순위 = **휴식 먼저**, 승격은 남은 상한 안에서 `maxPromote = min(2, 3 − restCount)`.
- **최소 라인업 보전**: 승격은 선수를 *빼지 않고* 우선순위만 바꾸므로(force) 풀 크기 불변 → `buildLineup` 폴백 오염·throw 없음(휴식이 이미 통과시킨 avail이면 승격 후에도 성립). 리베로 슬롯은 그대로(L 신인 승격 시에만 L 슬롯 교체 — F.6).

### F.5 3경로 정합 (리뷰 필수 — 휴식과 동형)
순수 코어 `pickPromote(avail, teamId, day, restCount)`(`engine/lineup.ts`, 순수) + 자격 주입형 래퍼 `promotedOnDay(teamId, day)`(`data/rotation.ts`, clinch는 day−1·eliminated만). 세 경로가 **동일 승격 집합**:
- **순위 재시뮬**(`data/standings.ts allResults`): 러닝 순위의 `eliminated` 집합에서 `pickRest`→post-rest squad→`pickPromote`를 **직접 호출**(`computeStandings` 재호출 금지 = 순환 회피, `pickRest`/`restedOnDay` split과 동형). force를 `simulateMatch` opts(`homeForce`/`awayForce`)로 주입.
- **생산**(`data/production.ts allProdRows`): `restedOnDay`+`promotedOnDay`로 동일 집합, `attributeProduction`에 force 전달(선발 귀속 일치).
- **보드**(`data/matchBox.ts buildMatchBox`): `restedOnDay`+`promotedOnDay`로 동일 집합, `simulateMatch` opts에 force 주입.
- 순환: A와 동일(0.1·§7.9). 승격 자격 = clinch(day−1) = day−1까지 results 파생(인과적·비순환). standings는 러닝 순위로 clinch를 인라인 재구성.

### F.6 결정론 근사 (휴식과 동일 사유 — FORM·부상 forward-pass 미반영)
- 부상+FORM `forward-pass`(`data/dynamics.ts compute`)는 **results-독립**이라 clinch(=results 파생)에 걸리는 승격을 넣을 수 없다(넣으면 결과→라인업→부상/폼→결과 순환). → **승격도 휴식과 똑같이 forward-pass 미반영**:
  - 승격 신인의 출전은 `played`/`teamDays`(경기감각 소스)에 **미기록** → 그 신인은 승격 경기를 뛰어도 form 페널티가 남는다(벤치 상태 form 유지). 휴식이 백업의 form을 안 올려주는 것과 대칭.
  - **보드-생산 드리프트 없음**: 세 소비 경로(보드·생산·순위)가 전부 같은 `availableTeamPlayers→applyForm(formFactorOnDay)`(동일 forward-pass)를 써서 승격 신인에게 **같은 form**을 적용 → 결과 일치(`_dv_promote` ①이 실측 단언). 근사이지만 자기일관적. 부상 노출도 미반영(승격 신인은 forward-pass 부상 굴림 대상 아님 — 휴식·부상 ~0.4건/경기라 영향 미미, §0).
- 리베로 신인(L) 특수성: L 슬롯은 1. L 신인 승격 시 default 리베로를 교체(그 신인에게 리베로 경험). 리베로 유지 가드(EC-LU-01)는 "리베로가 코트에 **있는가**"라 승격(리베로↔리베로 교체)은 위반 아님.

### F.7 AWARDS 정합
- **신인상(ROY, `career.seasons===0`)**: 승격은 ROY 풀에 직접 볼륨을 더한다 → 탈락팀 가비지 볼륨 신인이 ROY를 독식하지 않는지 A/B 검증(`_dv_promote`/다시즌 배터리 — 풀시즌 주전 신인의 30+경기 대비 승격 ~5경기는 열세라 왜곡 미미 실측).
- **기량발전상(MIP) 시너지**: MIP 자격 = **전시즌 seasonLine 존재**(`data/awards.ts priorImpactMap`). 벤치만 지키던 신인은 seasonLine이 없어 차기 MIP 후보에서 배제되는데, 승격이 이번 시즌 실출전(`matches>0`)→seasonLine을 만들어 **차기 시즌 MIP 자격을 열어준다**(등용→기량발전 서사 연결).

### F.8 파라미터 (실측 확정)
| 파라미터 | 값 | 근거 |
|---|---|---|
| 신인 정의 | `career.seasons === 0` | ROY 정의 일치·풀 충분(season0 eliminated 13경기)·2년차 배제 |
| 발동 자격 | `eliminated`만 | 사용자 확정(clinched는 PO 대비 주전 유지) |
| `PROMOTE_GAME_RATE` | 0.5 | ~50% 발동(관전형 — 매 경기 아님) |
| `PROMOTE_SECOND_RATE` | 0.4 | 2명째 추가 확률(휴식 대칭) |
| 인원 상한 | `min(2, 3−restCount)` | 휴식+승격 총 이탈 주전 ≤3 |
| 시드 | `dev:{teamId}:{day}` | 휴식 `rest:` 스트림과 독립 |

### F.9 미구현/후속 (범위 밖 — 제안만)
- UI 표면화(선수 상세 "탈락팀 승격 출전 — 기회" 사유·뉴스 "○○ 프로 데뷔") — 별건.
- `owner.ts benchCauseOf`: 승격에 밀려난 default 주전은 현재 `outclassed`로 귀속(정확히는 "신인에게 자리 양보"). 감정 스케일 0.7이라 무해, 후속 세분 여지.
- `app/exhibition.tsx`·`sim-web/main.ts` 프리뷰: 승격 미반영(전력 표시 = 휴식만 제외). 프리뷰 정합은 후속.

## 미해결(검토 시 결정)
1. 휴식 발동 비율(40~50%?)·1경기 휴식 인원(1~2명?)·OVR 급락 상한(−4?).
2. 긍정 상태를 어디까지 surface(면담에 "기회 줘서 감사" 카드 추가?).
3. 성격 변조 강도(특성까지 볼지, prefWeights만으로 충분한지).
4. 부상 노출 근사(휴식 미반영) 허용 여부 — 정합 필요 시 후속 설계.
