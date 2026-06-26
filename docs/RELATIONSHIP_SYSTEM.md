# 선수 인간관계망 (RELATIONSHIP_SYSTEM) — 설계 플랜

> **상태: 📋 플랜(미구현)**. 사용자 요청(2026-06-26): 선수끼리의 인간관계망을 만들고, **팀 계약(영입·재계약·
> 방출·이적)에 관계도가 확률적으로 작용**하게 한다. 예: "우승팀 가고 싶고 A·B와 뛰고 싶다 / 우승팀이지만 싫은
> 선수가 있어 기피 / 싫지만 우승 위해 간다 / 연봉 좀 적어도 우승팀+친구 있는 팀에 간다."
>
> CLAUDE.md 2번 기둥(**데이터 누적 서사**)의 가장 큰 빈칸을 채운다 — 지금 선수 간 엮임은 세터-공격수 케미 하나뿐
> (MATCH_SYSTEM 9.2). 관계망은 "팀이 하나의 인간관계망"이라는 서사를 만든다.

---

## 0. 핵심 원리 — 기존 의사결정에 "관계 항" 하나를 더한다

선수의 팀 선택/잔류는 이미 **가중합 의사결정**이다. 관계는 **트레이드오프를 만드는 또 하나의 가중 항**으로,
−(기피)도 될 수 있어 사용자의 4가지 시나리오가 **수학적으로 자연 발생**한다(§4). 새 결정 시스템이 아니라 **기존
`offerScore`/`refuseProb`에 항 추가** — 파급 최소·밸런스 안전.

> **설계 제약(엄수)**: ① **무저장 결정론**(rollFAPref·rollTraits처럼 id 시드 파생 — 새 영속 필드 0, 세이브
> 마이그레이션 부담 0) ② **소폭**(능력·우승·돈을 압도하지 않음 — 가중치로 균형) ③ **외인/아시아쿼터 제외**
> (1년 계약, clubTenure 리셋, FA·면담 비대상 — 관계 누적이 없음) ④ **엔진 경기 무파급**(관계는 FA/재계약
> *결정*에만, rally.ts 미변경 → KOVO 불변. 단 **누가 어느 팀에 가나**가 바뀌어 로스터 구성→parity는 측정 대상).

---

## 1. 관계 모델 (무저장 결정론 파생)

### 1.1 affinity(A, B) ∈ [−1, +1]
두 **국내 선수** 사이의 호감/기피. **저장하지 않고 파생**한다 = `innate(시드) + bond(함께 뛴 세월)`.

- **innate(고정 성향)**: `createRng(strSeed(pairKey))`, `pairKey = [idA, idB].sort().join(':')` —
  순서 무관 **대칭**(affinity(A,B)==affinity(B,A)). 분포(대부분 중립 — 관계가 희소해야 의미):
  | 관계 | 값 | 분포(placeholder) |
  |---|---|---|
  | 절친 | +0.7 | ~6% |
  | 친함 | +0.35 | ~12% |
  | 중립 | 0 | ~60% |
  | 불편 | −0.35 | ~14% |
  | 라이벌/앙숙 | −0.65 | ~8% |
  > 불편/라이벌이 친함보다 약간 많게(드라마). 같은 포지션 경쟁자는 라이벌 가중(선택 — §10).
- **bond(누적 우정)**: 현재 **같은 팀에서 함께 뛴 세월**이 우정을 키운다(케미와 같은 결).
  `+ BOND_K × min(clubTenure_A, clubTenure_B)/6`(같은 팀일 때만, 상한 +0.3). → "오래 같이 뛴 동료는 친해진다",
  innate가 라이벌이어도 세월이 누그러뜨림(완전 상쇄는 안 함 — 앙숙은 남음).
  > **무저장 한계**: "former 팀메이트는 헤어져도 친구" 같은 *과거* 기억은 현재 clubTenure로 못 잡음(저장 필요).
  > Phase 4+에서 관계 로그(영속) 도입 시 확장. 1차는 innate + 현재-팀 bond로 충분(innate가 cross-team
  > "스타 A와 뛰고 싶다"를 이미 표현).

### 1.2 생성 위치
- `engine/relationships.ts`(신규, 순수): `affinity(idA, idB, sharedTenure)` + 상수. rollFAPref 패턴(id 시드, 메인 RNG 불간섭).
- **외인/아시아쿼터**: `isForeign`이면 affinity = 0(관계망 비대상). 셀렉터에서 제외.

### 1.3 선수별 "관계 민감도" — faPref에 차원 추가
사람마다 관계를 얼마나 중시하나가 다르다(돈/우승처럼). `rollFAPref`(faMarket.ts:32)의 가중치 프로필에
**`rel` 항 추가**(기본 소폭 + 가끔 "관계 중시형" 높게). 정규화 합은 유지(money/win/loyal/play/home/**rel**).
- 대부분 `rel≈0.05~0.12`(은은하게), 일부 `rel≈0.3+`("절친 따라가는" 의리파). 분포는 측정으로 튜닝.

---

## 2. 팀 affinity 셀렉터 (player ↔ 그 팀)

`data/relationships.ts`(신규): `teamAffinity(playerId, teamId, day) → relT ∈ [−1, +1]`
- 그 팀 로스터(`getTeamPlayers(teamId)`/`currentRosters` — 외인 제외)의 각 선수와 `affinity` 합산 후 정규화:
  `relT = clamp(Σ affinity(player, mate) / REL_SCALE, −1, 1)` (REL_SCALE≈2~3 — 친구 2~3명이면 포화).
- **양수**: 친한 동료 다수 → 끌림. **음수**: 앙숙 존재 → 기피(한 명만 강한 −여도 끌어내림).
- `getTeamPlayers` 등 기존 셀렉터(league.ts:134-139) 재사용.

---

## 3. 의사결정 통합 (정확한 지점)

### 3.1 FA 영입 — offerScore (faMarket.ts:100-112)
현재 합산(라인 111): `w.money·moneyT + w.win·winT + w.loyalty·loyT + w.play·playT + w.home·homeT + 0.05·rand + (talkBias??0)`.
- **추가**: `+ w.rel · relT`. `OfferCtx`에 `relationAffinity: number(−1..1)` 필드 추가.
- **호출처**(offseason.ts:142-154 `resolveFAMarket` 입찰 루프): 각 (선수, 팀 t) 오퍼 전
  `relT = teamAffinity(id, t, day)` 계산해 주입. **양·음 모두** → 친구 있는 팀 끌림 / 앙숙 팀 기피.
- 효과: 사용자 시나리오 1·2·3·4 전부 자연 발생(§4).

### 3.2 재계약 거부 — buildOwnerFx (data/owner.ts:106-126)
현재 refuseProb 합산: `refuseResignProb + sinkingShipBias + sustainedBenchRefuse + breach + releaseUnrestBias`.
- **추가 ① 친구 잔류 → 거부↓**(잔류 유인): 내 로스터에 친한 동료가 남아 있으면 `− REL_STAY_K × posRelT`
  (relT 양수면 거부 확률 감소, 상한 −0.12). "밴드를 유지하고 싶다."
- **추가 ② 친한 동료 방출/이탈 → 거부↑**: `releaseUnrestBias`(engine/owner.ts:241-245)를 **affinity 가중**으로
  정밀화 — 현재 방출자 명성을 만료자 *전원*에 동일 적용 → **그 방출자와 친한 선수만** 더 흔들리게
  (`+ affinity(만료자, 방출자) × stature`). "내 절친을 방출했으니 나도 못 믿겠다."
- buildOwnerFx 내부 계산이라 **6개 호출처(endSeason+미리보기 5) 자동 적용 → 미리보기=결과 유지**(검증된 구조).

### 3.3 방출 여파 — releaseAnger/팬심 (TRANSACTION_SYSTEM 0.5)
- 현재 방출 분노는 **명성** 기반(팬심). 관계는 위 §3.2 ②(라커룸 동요)로 반영 — *팬*이 아니라 *동료*가 흔들림.
- (선택) 방출 회고 다이얼로그에 "절친 X가 동요할 수 있습니다" 경고(서사·UX).

### 3.4 면담(OWNER) — 보조
- 면담에서 "전력 보강" 약속이 **그 선수의 친구 영입**으로 이행되면 신뢰 가산(기존 interviewEffects 재사용).
  1차는 보류 — Phase 4 서사 확장.

### 3.5 외인/아시아쿼터 — 제외
- `isForeign` 선수는 relT=0(관계망 밖). 트라이아웃 지명/재계약은 관계 무관(현행 유지).

### 3.6 AI 재계약(aiRetainProb, aiGM.ts:66) — Phase 후순위
- AI 팀 자체 재계약은 관계 미반영(1차). FA 시장(resolveFAMarket)은 **AI 선수도 offerScore**라 관계가 league-wide로
  작동 → 리그 전체 이동에 이미 반영. AI 잔류까지 넣을지는 parity 측정 후 결정.

---

## 4. 트레이드오프 수학 (사용자 시나리오가 어떻게 나오나)

`팀 t 매력 = w.money·moneyT + w.win·winT + … + w.rel·relT(t)`. relT가 ±라 자연 발생:

| 사용자 시나리오 | 수학 |
|---|---|
| 우승팀 + A·B와 뛰고 싶다 | winT↑ **AND** relT↑(친구) → 두 항 동반 상승 = 강하게 끌림 |
| 우승팀이지만 싫은 선수 있어 기피 | winT↑ but relT<0. **관계 중시형**(w.rel 큼)이면 `w.rel·\|relT\| > w.win·winT` → 다른 팀 선택 |
| 싫지만 우승 위해 간다 | **우승 중시형**(w.win 큼, w.rel 작음)이면 winT가 음의 relT를 압도 → 그래도 감 |
| 연봉 양보하고 우승팀+친구 팀 | 낮은 offerSalary로 moneyT↓지만 winT+relT가 보전 → 더 주는 팀보다 이 팀 택 |

→ **같은 상황도 선수 성향(w)에 따라 다른 선택** = 살아있는 FA. 새 분기 로직 없이 가중합이 처리.

---

## 5. 결정론·SOLID·밸런스

- **결정론**: affinity는 pair 시드 + 현재 clubTenure(파생). 메인 RNG 불간섭 → 경기 결과·시드 재현 불변.
- **무저장**: 새 영속 필드 0(SAVE_SYSTEM 마이그레이션 무관). 관계는 매번 파생(리플레이 척추).
- **SOLID**: `engine/relationships.ts`(순수) → `data/relationships.ts`(셀렉터) → faMarket/owner가 *출력*만 소비.
- **밸런스 리스크(핵심)**: 친구가 **우승권 팀에 몰리면 super-team → parity↓**(FOREIGN/FA에서 겪은 prestige
  자기강화와 같은 클래스). **w.rel을 modest로 두고 `simLeague` 다중 유니버스로 parity 측정**, 깨지면 w.rel/REL_SCALE
  하향. 연례 외인 추첨·FA 분산이 완충(기존 레버).
- **경기 KOVO 불변**: 관계는 경기 엔진 밖 → simKovo 23지표 무영향(코트엔 늘 6인). parity만 관문.

---

## 6. 서사 surfacing (보는 맛 — 관전형 1순위)

- **선수 상세**(`app/player/[id].tsx`): "친한 동료: X, Y · 라이벌: Z"(같은 리그 상위 affinity), 면담 카드에 한 줄.
- **FA 뉴스**(NEWS_SYSTEM): "OO, 절친 XX 따라 △△ 이적" · "OO, 라이벌 있는 우승후보 거절 — 의리 택했다" — 이동
  사유에 관계가 드러나면 기사화(transfer 뉴스 확장). 가짜 드라마 금지(실제 affinity·이동에 근거).
- **방출 회고**: "절친 X가 동요할 수 있다" 경고(TRANSACTION 0.5 회고 확장).

---

## 7. 단계 구현 계획 (각 단계 측정·커밋)

| Phase | 내용 | 위험 | 검증 |
|---|---|---|---|
| **1. 모델+표시(무영향)** | `engine/relationships.ts`(affinity)·`data/relationships.ts`(teamAffinity) + 선수 상세에 친구/라이벌 표시. **결정 미반영** | 0(관측만) | `_dv_relations`(결정론·대칭·분포·bond 단조)·tsc |
| **2. FA 영입 반영** | offerScore에 `w.rel·relT` + rollFAPref에 `rel` 가중 + resolveFAMarket 주입 | **parity** | 시나리오 A/B(4종 오더 플립)·`simLeague` parity 불변·`simKovo` 불변 |
| **3. 재계약 반영** | buildOwnerFx 친구잔류(−)·친구방출(+, affinity 가중 releaseUnrestBias) | 미리보기=결과 | `simMood`/owner 가드·미리보기=결과·A/B |
| **4. 서사 확장** | 뉴스(이적 사유 관계)·방출 회고·면담 연동 | 가짜 드라마 | `simNews` 무결성·매달린 0 |

> Phase 1은 무영향이라 안전·즉시. Phase 2가 parity 관문(핵심). 단계마다 문서 갱신·커밋.

---

## 8. 검증 계획 (가드)

- **`_dv_relations`**: affinity 결정론·**대칭**(A,B==B,A)·분포(중립 ~60%·희소)·bond 단조(tenure↑→우정↑)·외인 0.
  A/B 자가검증(시드 바꾸면 분포 유지·특정 쌍 값 변화).
- **시나리오 A/B**(Phase 2): 4 시나리오를 합성 로스터로 구성 → relT 유무로 offerScore 순위가 의도대로 뒤집히는지
  (우승+친구>우승, 관계중시형은 앙숙팀 회피, 우승중시형은 강행). 허위 오라클 차단(관계 0이면 기존과 동일).
- **`simLeague` parity**(Phase 2·3, 다중 유니버스): std·왕조·우승경험·반등이 도입 전과 동등(관계가 균형 안 깸).
  깨지면 w.rel 하향 후 재측정(STATS_PROTOCOL N≥1만).
- **`simKovo`**: 23지표 불변(경기 무파급 sanity).
- **외인 제외 가드**: 외인 선수 relT=0·관계망 미포함.

---

## 9. 코드 맵 (예정)
- `engine/relationships.ts` — `affinity(idA, idB, sharedTenure)`·상수(분포·BOND_K). 순수·id 시드.
- `data/relationships.ts` — `teamAffinity(playerId, teamId, day)`·`friendsOf`/`rivalsOf`(표시용 셀렉터).
- `engine/faMarket.ts` — `OfferCtx.relationAffinity` + offerScore 합산 항 + rollFAPref `rel` 가중.
- `data/offseason.ts` — resolveFAMarket 입찰 루프에서 teamAffinity 주입.
- `engine/owner.ts`·`data/owner.ts` — buildOwnerFx 친구잔류/친구방출(affinity 가중 releaseUnrestBias).
- `app/player/[id].tsx`·`data/news.ts` — 표시·뉴스.
- `tools/_dv_relations.ts`·시나리오/parity 가드.

---

## 10. 미확정 — 사용자 결정 대기

1. **라이벌 정의**: 순수 시드 랜덤만 vs **같은 포지션 경쟁자 가중**(주전 다툼이 앙숙 만들기). 후자가 서사 풍부하나 복잡.
2. **관계 강도(w.rel 분포)**: "의리파"가 얼마나 흔하고 강한가(능력·우승을 얼마나 이길 수 있나). 측정으로 튜닝하되 상한 결정.
3. **과거 팀메이트 기억**(헤어져도 친구): 무저장 한계라 Phase 1엔 제외. 도입하면 영속 관계 로그 필요(마이그레이션). 넣을지.
4. **AI 팀 재계약(aiRetainProb)에도 관계 반영**할지(현재 FA 시장만) — parity 측정 후.
5. **방출 회고 경고**·면담 연동 범위(서사 Phase 4).

> 위 결정 후 Phase 1부터 착수. 각 Phase는 표준 작업 순서(문서 갱신→구현→측정)로 진행.
