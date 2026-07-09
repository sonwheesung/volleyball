# 선수 인간관계망 (RELATIONSHIP_SYSTEM) — 설계 + Phase 1a 구현

> **상태: ✅ Phase 1a 구현(2026-06-26)** — affinity·bond 누적·FA 수락확률 가중·관계 뉴스(`engine/relationships.ts`·
> `data/relationships.ts`, 가드 `_dv_relations`·`_dv_fa_relations`·`_dv_releasenews`). 이후 심화 단계는 플랜. 사용자 요청(2026-06-26): 선수끼리의 인간관계망을 만들고, **팀 계약(영입·재계약·
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

> **사용자 결정(2026-06-26)**: ① 라이벌 = **같은 포지션 경쟁 가중**(주전 다툼이 앙숙) ② 강도 = **은은하게**
> (우승·돈 우선, 관계는 타이브레이커 — parity 안전) ③ 과거 기억 = **영속 bond**(헤어진 동료도 우정 기억).
>
> **설계 제약(엄수)**: ① **결정론 + 최소 저장**(innate·포지션 라이벌은 id 시드 무저장 파생, **bond만 영속 1필드** —
> SAVE_SYSTEM 마이그레이션이 필드 추가를 안전 처리, drift 가드 자동) ② **은은**(가중치 modest — 능력·우승·돈을
> 압도 금지) ③ **외인/아시아쿼터 제외**(1년 계약·clubTenure 리셋·관계 누적 없음) ④ **엔진 경기 무파급**(관계는
> FA/재계약 *결정*에만, rally.ts 미변경 → KOVO 불변. **누가 어느 팀에 가나**가 바뀌어 parity는 측정 관문).

---

## 1. 관계 모델 (무저장 결정론 파생)

### 1.1 affinity(A, B) ∈ [−1, +1]
두 **국내 선수** 사이의 호감/기피 = `innate(시드·무저장) + bond(함께 뛴 세월·영속) + posRivalry(같은 포지션 경쟁·파생)`.

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
- **bond(누적 우정·영속 — 과거 기억)**: **함께 뛴 시즌이 쌓일수록** 우정이 자란다. **헤어져도 기억**(사용자 결정 ③).
  - 저장: `store.bonds: Record<pairKey, number>`(영속 1필드, 0~상한). endSeason에서 **같은 팀 국내 선수 쌍마다
    `+BOND_GROW`**(상한 `BOND_MAX`), 떨어져 있으면 아주 천천히 감쇠(`×BOND_DECAY`, 완전 소멸 안 함 — "옛정").
  - bond는 affinity에 **양(+)으로만** 더함(함께한 세월은 우정 — 앙숙도 누그러뜨리되 완전 상쇄는 안 함).
  - **바운딩(필수)**: 약한 bond(<임계)·장기 미접촉은 가지치기, 맵 크기 상한(예: 최근/강한 순 4000쌍)으로
    100시즌+ 저장 폭주 차단(milestones/transfers 바운딩과 같은 패턴, SAVE_SYSTEM §1).
  - SAVE_SYSTEM: 새 영속 필드라 `partialize`+`SAVE_DEFAULTS`에 추가(record), `_dv_migrate` drift 가드가 키 일치 자동 검증.
- **posRivalry(같은 포지션 경쟁 — 파생, 사용자 결정 ①)**: **같은 포지션**(외인 제외, 리베로 등)의 두 선수는
  주전 자리를 다퉈 라이벌 기운이 든다. `− POS_RIVAL_K`(소폭 음수), **같은 팀에서 둘 다 주전급(OVR 근접)일수록 강하게**
  (`× 경쟁도` — OVR 격차 작을수록↑). 단 bond(오래 함께)가 크면 완화(라이벌이자 전우). 무저장 파생(포지션·OVR·tenure).

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

### 3.1 FA 영입 — 점수(100)→확률 모델 (FA_SYSTEM §2.7, 2026-06-26 사용자 재설계)
> 단순 "관계 항 추가"를 넘어, FA 수락을 **argmax → 점수(가산/감점 0~100)→확률(완만 S곡선)→정렬·롤·fallback·SIT**로
> 재설계했다(사용자 결정). 관계(relT)는 그 점수의 **±항**(친구 +·싫은 선수 −). 상세·엣지·동시성은 **FA_SYSTEM §2.7**.
- 관계 입력: `teamAffinity(playerId, teamId, bonds)`(§2) → score의 `w.rel·relT·100` 항.
- 효과: 사용자 시나리오 1·2·3·4가 점수 가산/감점 + 확률로 자연 발생(§4). 여러 팀 오퍼·동시성·시즌아웃 처리는 FA §2.7.3~4.

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

### 3.6 AI 재계약(aiRetainProb, aiGM.ts:66) — ❌ 반영 안 함(2026-06-27 독립 리뷰로 결정)
- AI 팀 자체 재계약은 관계 미반영. FA 시장(resolveFAMarket)은 **AI 선수도 offerScore**라 관계가 league-wide로
  작동 → 리그 전체 이동에 이미 반영(여기서 관계 서사는 충분히 발생).
- **결정: 넣지 않는다**(rule 1.5 독립 리뷰, 2026-06-27). 세 가지 이유:
  1. **기제 모순(결정적)** — affinity는 *선수의 선호* 신호다. 기존 반영처(FA 선택·구단주 재계약 거부)는 둘 다
     **선수 측**에서 작동해 정합적인데, `aiRetainProb`는 **팀의 잔류 *제안* 결정**이다. 구단은 우정으로 재계약하지
     않는다(성과·나이·캡) → 선수 선호를 팀 결정에 주입 = "우정 때문에 잡았다"는 **없는 인과(가짜 드라마)**.
  2. **가시성 0 vs parity 리스크 100%** — AI 내부 재계약 판정은 플레이어 눈에 안 보임(관전형: 자기 팀·리그
     흐름만 봄). 서사 보상 ~0인데, EC-REL-01(관계 자기강화→왕조)을 **잔류 측에서 재발**(bond는 함께한 세월로
     자라 강팀 코어가 가장 큼 → 강팀이 덜 흩어짐, FA 유입 보정과 복리)시킬 parity 리스크는 실재.
  3. **리그 생동 역행** — `aiRetainProb`(확률)가 `aiKeepsFA`(이진)를 대체한 이유가 "가끔 노장 잔류·영건 이탈 =
     리그 생동". 관계 잔류는 친구를 뭉쳐 로스터를 고정 → 이동(=서사 원료) 감소.
- **혹시 나중에 재검토한다면**(C안): "팀 제안"이 아니라 **선수 *수락* 의사**(§3.2 미러)에 붙이고, bond 기여 상한·
  약팀 대칭·**뉴스화(보이게)** 까지 묶을 때만. 그조차 가성비 낮음 — 더 보이는 기능에 검증 예산을 쓰는 게 낫다.

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

- **선수 상세**(`app/player/[id].tsx`): "친한/라이벌" 카드(`relationsOf`) ✅ + **이번 시즌 각별한 동료 방출 시 "💔 동요 중 — 재계약 거부 위험↑"**(Phase 3 friendLeave를 화면으로, 2026-06-26).
- **FA 센터**(`app/fa.tsx`): FA 풀 선수마다 **우리 팀 친구/라이벌 표시**(`teamRelations`, 2026-06-26) — "이 선수 영입하면 우리 팀 OO와 친하다" = 영입 확률 판단 정보. 결정엔 이미 작동(relT), 이제 화면에도.
- **FA 뉴스**(NEWS_SYSTEM): 이적 기사에 **"새 팀에는 각별한 동료 XX가 있다"**(`topFriendOnTeam`, 현재 사실) ✅ +
  **방출 기사에 "각별한 동료 XX를 남기고 떠난다"**(이적의 정서적 대칭, 2026-06-27) ✅ — 둘 다 *현 로스터 사실*만
  진술(가짜 드라마 금지: 과거 이동 사유 추정 X). 친구 임계 affinity≥0.4라 자연 게이팅(노이즈 적음).
  **용어**: "절친"은 프로 기사 톤에 안 맞아 **"각별한 동료"** 로 통일(2026-06-27, 사용자 피드백 — 선수 상세 카드 포함).
- **방출 회고 다이얼로그**(`app/contracts.tsx` doRelease, 2026-06-27) ✅: 방출 *전* 확인 Alert에 **"💔 각별한 동료
  X, Y — 방출에 동요할 수 있습니다 (재계약 거부 위험↑)"**(`teamRelations(p,팀).friends`, 현재 사실 — §3.2② friendLeave
  메커닉을 *행동 전*에 surface). Alert는 josa 자동교정 밖이라 주격조사 병기 대신 대시(—)로 끊음.

---

## 7. 단계 구현 계획 (각 단계 측정·커밋)

| Phase | 내용 | 위험 | 검증 |
|---|---|---|---|
| **1a. 모델+셀렉터 ✅(2026-06-26)** | `engine/relationships.ts`(`affinity`=innate+bond+posRivalry)·`data/relationships.ts`(`teamAffinity`·`relationsOf`). 결정 미반영 | 0 | ✅ `_dv_relations` ALL PASS(결정론·대칭·분포 중립59.6%·포지션라이벌·bond단조·외인0) |
| **1b. 영속 bond + 표시 ✅(2026-06-26)** | store `bonds` 필드(SAVE_DEFAULTS+partialize)·endSeason `accrueBonds`(같은팀 +BOND_GROW·감쇠 BOND_DECAY·prune·cap 4000) + 선수상세 "인간관계" 카드(친한/라이벌) | 저장 | ✅ `_dv_relations`(bond 누적·외인0·감쇠·affinity상승)·`_dv_migrate` drift(bonds 키)·e2e·205테스트 |
| **2. FA 영입 = 점수→확률 재설계 ✅(2026-06-26)** | offerScore에 relT 항(w.rel)·`acceptProb`(완만 S곡선)·`SIT_OUT` + resolveFAMarket argmax→정렬·롤·fallback·SIT + 로컬 affinity(친구연쇄) + 모듈 컨텍스트(`setRelationContext`, preview=result) | parity | ✅ `_dv_fa_relations`(4시나리오·S곡선)·`simLeague` parity 2.77(튜닝 후 기준 노이즈 내)·simKovo 38.9% 불변·simAudit/simFaDup 무결성 0·205테스트 |
| **3. 재계약 반영 ✅(2026-06-26)** | buildOwnerFx에 **친구 방출 → 거부↑**(`REL_LEAVE_K × Σ max(0,affinity)` — uniform unrest 위에 가산, 절친 방출일수록↑). "친구 잔류→거부↓"는 별도 항 없이 **Phase 2 FA 시장 relT**가 처리(만료자가 FA로 풀리면 내 팀 친구가 재계약 확률↑) | 내 팀 한정(parity 무관) | ✅ `_dv_release_unrest`(방출 시 ≥uniform·친구 초과)·205테스트·tsc |
| **4. 서사 확장 ✅(2026-06-26)** | 이적 뉴스에 **현재 사실**(옮긴 팀에 절친 있으면 "새 팀에는 절친 XX가 있다") — `topFriendOnTeam`. **가짜 드라마 금지** 준수(과거 사유 추정 X, 현 로스터 팩트만) | 가짜 드라마 | ✅ `_ev_transfernews`(무결성·매달린0)·`_ev_josa`(조사 교정)·tsc |

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

## 10. 결정 사항 (2026-06-26 확정) + 후속

**✅ 확정(사용자)**:
1. **라이벌 = 같은 포지션 경쟁 가중**(§1.1 posRivalry — 주전 다툼 OVR 근접일수록 강한 −).
2. **강도 = 은은하게**(w.rel modest — 우승·돈 우선, 관계는 타이브레이커. parity 안전 목표).
3. **과거 기억 = 영속 bond**(§1.1 — 함께한 시즌 누적·헤어져도 옛정, 바운딩).

**후속(측정/Phase 후 결정)**:
4. ~~**AI 재계약(aiRetainProb)에도 관계 반영**할지~~ → **❌ 안 함으로 결정(2026-06-27, 독립 리뷰)**. 기제 모순
   (선수선호를 팀결정에 주입=가짜 인과)·가시성0 vs parity 리스크·리그 생동 역행. 상세 §3.6.
5. **방출 회고 경고**·면담 연동 범위 — 서사 Phase 4.
6. **bond 계수**(BOND_GROW/MAX/DECAY)·**w.rel 분포**·**POS_RIVAL_K** — 전부 placeholder, parity·시나리오 측정으로 튜닝.

> 위 확정으로 Phase 1부터 착수. 각 Phase는 표준 작업 순서(문서 갱신→구현→측정)로 진행.

---

## 📋 출시 후 로드맵(2026-07-09) — 선수 인연(스토리) 시스템

> 사용자 확정(2026-07-09, 전부 출시 후). **상태: 설계 아이디어 등록·미착수.** 지금 관계망(§1~9)은 **호감/기피의
> 수치(affinity)** 로 FA·재계약 *결정*에 작용한다. 이 로드맵은 그 위에 **"이야기가 되는 순간"(스토리 이벤트)** 을 얹는다 —
> 라이벌을 인위로 만드는 대신 **이미 일어난 실데이터에서 자연 발생하는 인연**만 사건·뉴스로 surface한다.

### 핵심 원칙 — 라이벌 조작이 아니라 실데이터 스토리 발굴 (가짜 드라마 금지 엄수)

사용자 지시: **"라이벌 시스템 대신 실데이터 기반 이야기 생성."** §1.1 `posRivalry`(같은 포지션 경쟁)는 이미 관계 *수치*에
반영돼 있으므로 **여기서 새 라이벌 감정을 지어내지 않는다.** 스토리는 전부 **실제 발생한 기록의 파생**이어야 한다:

| 스토리 이벤트 | 트리거(실데이터만) | 데이터원(기존) |
|---|---|---|
| **친정팀과 첫 경기** | 이적한 선수가 **직전 소속팀**을 상대하는 첫 경기 | `store.transfers`(이적 이력, §3.3 슬라이스4에서 이미 적립)·`Transfer.fromTeam` |
| **FA 이적 후 첫 맞대결** | 위와 동일 축 — 이적(transfer) 후 옛 팀 상대 첫 경기 | `transfers` + 일정 |
| **복수전(지난 챔프전 상대)** | 지난 시즌 챔프전에서 맞붙은 두 팀의 재대결 | `archive.championId`·`archive.series`(플옵 W/L) |
| **통산 100/200/300경기** | 선수 통산 출전 임계 돌파 | MILESTONE §0 개인 통산 출전 임계(`CAREER_THRESHOLDS`)·`careerTotals.matches` |
| **주장 선임** | (신규 개념 — MILESTONE 로드맵 참조) | ⚠ `captain` 미존재 — 아래 |
| **마지막 시즌 / 은퇴 경기** | 은퇴 확정 선수의 그 시즌·마지막 홈경기 | `engine/retire.ts`·`store.retirements`(NEWS §3.4 은퇴 세리머니에서 이미 적립) |

**전부 "이미 있는 로그"의 파생** — `transfers`(이적)·`archive.championId/series`(챔프전)·`career/careerTotals`(통산)·
`retirements`(은퇴)를 읽어 **경기 전/후 컨텍스트로 사건을 얹는다.** 새 인과·없는 감정은 절대 만들지 않는다(§0 관계망 결정론 유지).

### 기존 시스템과의 연계·중복 구분 (흩어짐 방지)

- **본 관계망(§1~9)과의 관계**: 관계망은 affinity **수치 → 결정**(누가 어느 팀에 가나). 본 로드맵은 그 결정이 만든
  이동 이력을 **스토리 이벤트로 재서술** — 수치 레이어 위의 **표면 레이어**다(§6 서사 surfacing의 확장). affinity 산식·FA 가중은 불변.
- **NEWS_SYSTEM 연계(필수)**: 스토리 이벤트는 **뉴스+경기 컨텍스트**로 낸다 — `buildNewsFeed`에 새 소재로 배선하거나
  경기 보드 현수막(BROADCAST)으로. **NEWS §3.3(이적)·§3.4(은퇴)** 와 데이터원이 겹치므로 **중복 기사 방지**가 관문
  (이미 이적 기사가 나가는데 "친정팀 첫 경기"를 또 내면 겹침 — newsKey/kord 분리로 게이팅).
- **⚠ 2번(선수 인연) vs 7번(시즌 서사) 역할 구분(사용자 명시)**:
  - **2번(여기)** = **선수 개인에 귀속된 인연** — "이 *선수*가 친정팀을 만난다 / 통산 300경기 / 은퇴 경기". 주어가 사람.
  - **7번(NEWS §시즌 서사)** = **시즌·구단 서사** — "지난 챔프전 *리매치* / 창단 첫 우승 / 5년 연속 PO". 주어가 팀·시즌.
  - **겹치는 소재("지난 챔프전 상대")** 는 관점이 다르다: 2번은 *그 경기에 뛰는 선수의 복수전*, 7번은 *두 팀의 리매치 구도*.
    구현 시 **한 사건을 한 곳에서만**(중복 방지) — 선수 앵커면 여기, 팀·시즌 앵커면 NEWS 시즌 서사.

### 신규 개념 의존성 — "주장(captain)"
"주장 선임" 스토리는 **MILESTONE 로드맵의 주장(captain) 신규 개념에 의존**한다(코드에 아직 없음). 주장 설계가 확정되기
전엔 이 이벤트만 보류하고 나머지(친정팀·복수전·통산·은퇴)는 기존 데이터로 선행 가능. 주장 설계는 **표준 작업 순서 1.5단계** 태울 것.

### 원칙 합치
- **가짜 드라마 금지**(§0·§6.155 "각별한 동료" 선례와 동일): 스토리는 실 로그 팩트만 — 이적 *사유* 추정·없는 앙숙 금지.
- **엔진 무파급**: 스토리는 경기 밖 서사 — rally.ts 불변, simKovo 무영향. parity는 관계 수치(§2)만 관문(스토리는 표시).
- **무저장 지향**: 대부분 기존 로그 파생(새 영속 0). 주장이 임명형이면 그때만 최소 필드(SAVE_SYSTEM).
