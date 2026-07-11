# 영입·오프시즌 엣지 케이스 레지스트리 (EDGE_CASES)

> **목적**: 단장 의사결정 루프(FA·드래프트·외인 트라이아웃·스태프·시즌 중 이동·재정)의
> **정상 케이스(골든 패스)** 와 그동안 발견·수정한 **엣지 케이스(버그)** 를 한곳에 모은
> 회귀 체크리스트. 로직을 고칠 때마다 이 문서의 도구를 돌려 **옛 버그가 되살아나지 않았는지**
> 확인한다. 새 버그를 찾으면 이 문서에 행을 추가하고, 그걸 잡는 감사/도구에 가드를 심는다.
>
> **분담**: 경기 보드 연출은 [`BOARD_RULES`](./BOARD_RULES.md)(verify-board 스킬), 장기 전력 균형은
> `sim-league` 스킬, 엔진 분포(KOVO)는 `tools/simKovo.ts`. 본 문서는 **"한 사람=한 팀" 불변식과
> 영입 정합**(돈·계약·소속)을 관장한다.
>
> **연동 스킬**: 문서 작성/갱신 = `analyze-cases`(1세션) 또는 `edge-swarm`(100+ 세션 대량 발굴 — 합의도·생성사각),
> 시뮬 검증/수정 = `verify-cases`. (엔진 검증 스웜 = `engine-verify` — 둘은 `engine-verify/lenses.md` 카탈로그 공유.)

---

## 0. 핵심 불변식 (이 문서가 지키는 것)

1. **한 사람 = 한 팀** — 어떤 선수/감독/코치/스카우터도 동시에 두 팀에 속하지 않는다.
2. **돈과 선수는 따로 새지 않는다** — 영입에 돈을 냈으면 그 선수는 내 팀에. 보상으로 빠지는 건
   비보호 선수뿐, '돈만' 선택이면 아무도 안 빠진다.
3. **자금·캡 게이트** — 운영 자금(지갑)·샐러리캡을 넘는 영입은 불가. 미리보기 = 실제 결과.
4. **공급 고갈 없음** — 풀(감독·코치·외인)이 말라 AI 팀이 공석이 되지 않는다.
5. **만료 = 명단 이탈** — 계약 만료 선수/감독은 재계약하거나 풀로. 명단에 유령으로 남지 않는다.
6. **결정론** — 같은 시드·같은 입력 → 같은 결과. 모든 검증은 재현 가능.
7. **정원 경계** — 어떤 경로(방출·영입·드래프트·은퇴충원·악질입력)로도 로스터는 `ROSTER_MIN(10)`~
   `ROSTER_MAX(18)`(`engine/transactions.ts`). **방출은 내 유효 로스터(시즌초+시즌중영입) 선수만** —
   타 팀/존재 안 함 id는 거부(`store.release` 가드).

---

## 1. 검증 도구 대조표

| 도구 | 검사 범위 | 핵심 불변식 | 표본 인자 |
|---|---|---|---|
| `tools/simAudit.ts` | **종합 감사** — 13개 체크(아래) 한 번에 | 0·1·3·4·5 전부 | `[시즌=12]` |
| `tools/simFaDup.ts` | FA 경쟁·보상선수·AI 충원·드래프트 후 선수 중복 | 1·2 | `[시즌=300]` |
| `tools/simStaffDup.ts` | 감독·코치·스카우터 중복/오배정 | 1(스태프) | `[시즌=60]` |
| `tools/simCareerTrace.ts` | 외인 재계약 연속성·좀비(은퇴자 잔존) | 5·외인수급 | `[시즌]` |
| `tools/simTxDup.ts` | 시즌 중 이동(방출/영입) 단일 소속 | 1·2 | `[시즌]` |
| `tools/simOwnerRefuse.ts` | 면담/재계약 거부 선수 풀 이동 정합 | 5 | `[시즌]` |
| `tools/simBrokeSign.ts` | 자금 부족 시 외인 영입 차단 | 3(외인) | `[시즌]` |
| `tools/simMoneyOnly.ts` | '돈만' 보상 — 유출 면제·보상금 가중 | 2 | `[탐색시즌=60]` |
| `engine/compensation.test.ts` | 보상금 배수·보상선수 선정 규칙(단위) | 2 | — |
| `engine/draft.test.ts` | 드래프트 위시 우선순위·중복 지명·슬롯 한도 | 1 | — |
| `tools/_gt_facontract.ts` | **재계약·FA 영입 시나리오 15케이스**(reSign 게이트: 정상/타팀/음수·0·NaN/years·잔여/8억초과/캡/외인면제/프랜차이즈11억 · FA: 큐·등급 A>B>C·endSeason 정원·캡 불변식). 정상=적용·비정상=거부 양방향(A/B). exit 0/1 | 1·2·연봉/캡 | — |
| `tools/_gt_bench.ts` | **주전·벤치 시나리오 9케이스**(라인업 6+리베로·벤치 제외·마지막 리베로 EC-LU-01·7인 가드·ownerBenched 사유 · 건의 게이트: 타팀/쿨다운16 · suggestStart 최약 주전 벤치 EC-LU-02 실제 액션). exit 0/1 | 5·라인업 | — |
| `tools/_dv_bench.ts`·`_dv_bench2.ts` | **독립 검증(2026-06-24 독립 세션)** — 문서서 불변식 9종 도출, A/B 자가검증 내장. _dv_bench2: EC-LU-02 옛버그(최강벤치) 재주입 91/91 검출·incumbent 명세일치(I5++)·사유 우선순위. _dv_bench: 라인업·게이트·pickRest(리베로 휴식 0·≤2명, 무거움). 메인 _gt_bench가 허위 오라클 아님 교차확인. **2026-07-07 오라클 정정(Opus)**: `suggestStart` 반환이 boolean→`{ok,reason}`(06-24 이후)으로 바뀌어 I5++가 감독 거부(coachCall)를 성공으로 오판 → 스퓨리어스 FAIL(엔진 WAI). `.ok` 판정+거부 스킵으로 수정, 재계산 오라클을 엔진과 동일 키(멤버십=폼 라인업·최약=순수 OVR)로 정렬. TEST_METHODOLOGY §4 "return-shape drift" | 5·라인업 | `_dv_bench` 무거움(on-demand) |

**악질 유저/원숭이(adversarial·monkey) 퍼저군** — 실제 zustand 스토어를 Node에서 구동(액션 난사·적대 입력).
**먼저 `import './_gt_mock'`**(AsyncStorage 인메모리 모킹)이 필요. 시드 결정론·재현 가능.

| 도구 | 검사 범위 | 핵심 불변식 | 표본 인자 |
|---|---|---|---|
| `tools/_gt_monkey.ts` | 스토어 무작위 액션 난사(방출·영입·드래프트·setDay·endSeason·세이브) — 매 스텝 불변식 | 1·7·정원·이중소속 | `[steps] [seed] [clean]` |
| `tools/_gt_adversarial.ts` | 데이터층 적대 입력(가짜/빈 id·음수·NaN 자금·전원 영입·전원 보호·거대/음수 시즌·60시즌 소크) | 0·1·3 | — |
| `tools/_gt_seqbreak.ts` | 순서 꼬기(day0 endSeason·역행 setDay·무팀 endSeason·오프시즌 도중 영입) | 7·크래시/소프트락 無 | — |
| `tools/_gt_determinism.ts` | 결정론 + **실제 persist** partialize·onRehydrate 충실도(파생 순위·로스터·감독·focus). 베낀 복사본 아님 — A/B(필드 누락 검출) | 6 | — |
| `tools/_gt_owner.ts` | 구단주/면담 퍼징(requestInterview·suggestBench·suggestStart·unbench 적대 인자) — fanScore 0~100·benchDirectives≤2·중복없음·쿨다운 enforce·무크래시 | owner | — |
| `tools/_gt_derived.ts` | **파생데이터 무결성**(시상·마일스톤·HOF·careerTotals·careerLog) 장기 churn 실제 endSeason 구동 — HOF 중복·미래참조·이중집계(단조성)·NaN·achievement 범위. A/B(HOF중복·NaN·미래마일스톤 주입 검출). 더블탭 endSeason 적대 | 파생/업적/기록 | `[seasons] [seed]` |
| `tools/_ev_routes.ts` | **화면 이벤트①** 죽은 네비게이션 링크(모든 router.push/navigate/replace ↔ 라우트 파일, 동적·그룹·쿼리 정규화) | UI 네비 | — |
| `tools/_gt_repro_release.ts` | **EC-TX-03** 팬텀 방출 재현(오라클 자가검증: 클린 통과·익스플로잇 검출) | 1·2 | — |
| `tools/_gt_repro_cash.ts` | EC-TX-03 영입비 누수 재현 | 2 | — |
| `tools/_gt_repro_oversize.ts` | **EC-RM-01** 정원 초과 재현(순수 endSeason=대조군 vs churn) | 7 | — |

**`runAcquisitionAudit`의 13개 체크** (`data/acquisitionAudit.ts`, 인앱 `app/audit.tsx` 공유):
`player`(선수 유일성) · `foreign`(외인 1팀 1명) · `faLeak`(내 영입 FA 유지) · `head`(감독 1인 1팀·경질팀 복귀 금지) ·
`staff`(코치/스카우터 유일·슬롯) · `roster`(정원 10~18) · `cap`(국내연봉 ≤ 35억) · `salary`(연봉·계약 정상치) ·
`supply`(AI 감독 공백 없음) · `newid`(신규 id 충돌 없음) · `intx`(시즌 중 단일 소속) · `cash2`(현금 초과 영입 없음) ·
`contract`(만료 선수 명단 잔존 없음).

---

## 2. 정상 케이스 (골든 패스 — 이게 나와야 정상)

### 2.1 FA 시장
- 상위 FA가 **캡 AND 운영 자금 안에서** 경쟁 입찰로 이적. 내가 찍어도 더 좋은 오퍼에 질 수 있다.
- A/B 영입 시: **보상선수 1명(비보호 최고 OVR) + 보상금**(A 200%·B 100% × 직전연봉) 또는
  **'돈만'**(A 300%·B 200%, 보상선수 면제). 신규 영입 FA·외인은 보상선수 대상 제외.
- 내가 영입 성공한 FA(`signedByMe`)는 **전원 내 팀**에 남는다(보상으로 안 빠짐).
- FA 센터 미리보기 = `endSeason` 실제 결과(정산 후 자금·동일 ownerFx).

### 2.2 감독·스태프 생애주기
- 매 오프시즌 감독 `age+1`. 계약 만료 시 AI는 성적·연령으로 재계약 또는 FA, 플레이어는 스태프 화면에서 선택.
- 최하위/장기부진 AI 감독은 경질 → 풀(또는 은퇴) → 새 감독 선임. **경질한 감독은 그 팀에 다시 안 온다.**
- 시즌 중 경질 시 전문 코치 1명이 **대행**(카리스마 ×0.7) → 새 감독 영입 시 대행 해제.
- 풀은 은퇴 선수(고VQ)→코치→감독 승격으로 순환. **풀이 마르지 않아 AI 팀은 항상 감독 보유.**
- AI 팀 기본 스태프: 전용 id(`ai-ac-*`·`ai-sc-*`)로 코치 2 + 스카우터 1(플레이어 영입 풀과 분리).

### 2.3 외국인 트라이아웃
- 외인은 **1년 계약** — 매 오프시즌 만료 → 트라이아웃 재참가. 팀당 1명. 추첨(역순) 지명.
- 자금 부족이면 외인 공석(현금 게이트 — 시즌 중 교체와 일관). 매년 풀 유입으로 멸종 없음.

### 2.4 드래프트
- 역순 로터리 순번. 위시리스트 우선순위 존중, 같은 신인 중복 지명 불가, 팀별 슬롯 한도.
- 신인·외인 **신규 id는 기존 선수와 충돌하지 않는다**(충돌 시 레지스트리 덮어써 선수 증발).
- **AI 픽 3티어(2026-06-25, FA §3.1)**: ①특급(`prospectValue≥81`, 상위~10%) 있으면 포지션 무관 BPA →
  ②부족 포지션(gap>0)만 → ③부족 없으면 OVR+성격. 위시(인간)는 전 티어 우선. `resolveDraft`가 픽 사유(reason) 반환.
  별 등급 `prospectStars`도 드래프트가치 기준(★★★ 상위~11%, 구 maxPot 포화 교정).

### 2.4b 재계약·공약·타팀 소식 (2026-06-25 리뷰 라운드)
- **AI 재계약 확률(`aiRetainProb`)**: 절벽 컷이 아니라 OVR·나이 연속 확률(결정론 시드). 엘리트는 노쇠에도
  소프트 플로어(32세 에이스 안 버림). 순잔류 ~58%(구 이진과 동률), 나이·OVR 매끄러운 그라데이션.
- **재계약 협상 3택(`resignOptions`)**: 표준(시장가·3년)/후하게(+15%·나이적합 연수)/짧게(−15%·단기).
  후하게 연수는 나이적합(어림 5·노장 2) — 34세에 5년 안 줌. 전부 개인상한(`maxSalaryFor`)·캡(`canAfford`) 게이트.
- **면담 공약 파기**: 성공시킨 '주전 보장' 약속 + 그 시즌 벤치(여전히 출전 불만) → 배신 → 재계약 거부 급등(0.5 가산).
  약속 지키면(출전) 거부 0. 외인/아시아쿼터는 계약 관리 비대상(트라이아웃 전용 — release/reSign/FA예정 차단).
- **타팀 선수 뉴스**: 방출/재계약 불발(`kind='release'`)·거물 이적은 내 팀 항상 + 타팀 거물(`overall≥71`)만.
  이동 시점 OVR 고정(`Transfer.ovr`)으로 이후 노쇠 무관. 매달린 참조 0·중복 0·결정론.

### 2.5 시즌 중 이동·재정
- 방출 → FA 풀, 포지션 구멍 긴급 영입(전 구단 AI, 캡·정원 적용). 날짜 인지 명단(`rosterIdsOnDay`).
- **방출은 내 유효 로스터(시즌초 명단 + 시즌 중 영입) 선수만** — 타 팀/존재 안 함 id는 `release()`가 거부.
  방출은 `ROSTER_MIN(10)` 하한을 지킨다(그 밑으론 불가).
- 운영 자금 = 모기업(성적 보너스·긴축) + 직관 + 굿즈. 캡과 별개 지갑. 적자는 모기업 보전(바닥 0).

### 2.6 정원·은퇴 충원
- 오프시즌 은퇴 구멍은 신인으로 포지션별 `ROSTER_IDEAL`까지 채우되, 팀 정원은 **`ROSTER_MAX(18)`를
  넘지 않는다**(시즌 중 영입으로 명단이 차 있어도). 외인+아시아쿼터 2명도 이 상한 안.

### 2.7 인간관계망 + FA 점수→확률 (2026-06-26 신설 — RELATIONSHIP_SYSTEM·FA_SYSTEM §2.7)
- **affinity(A,B) ∈ [−1,+1]** = innate(id 시드 무저장·**대칭**·중립 ~60%) + bond(영속·함께한 시즌) + posRivalry(같은 포지션 경쟁 −).
  **외인은 0**(관계망 밖). `engine/relationships.affinity`.
- **bond**: 같은 팀 국내 쌍이 매 시즌 `+BOND_GROW`(상한 0.3), 떨어지면 `×BOND_DECAY`(옛정), `<0.02` prune, 맵 `≤4000`(저장 폭주 차단). `data/relationships.accrueBonds`(endSeason).
- **FA 수락 = 점수→확률**: offerScore(돈·우승·근속·주전·**±관계**) → `acceptProb`(완만 S곡선 `[0.22,0.60]`). 여러 오퍼 = P 정렬→롤→첫 성공→전부 실패 시 최고 P→1팀이면 자동→**최고<`SIT_OUT`(0.14) 시 시즌 아웃(FA 잔류)**. `resolveFAMarket`.
- **친구 연쇄**: relT는 **그 시점 로컬 rosters** 기준(`teamAffinityFor`) → A가 먼저 입단하면 친구 B의 그 팀 점수↑(자연 발생, 순서 고정=결정론).
- **재계약**: 친한 동료 방출 → 그 친구 거부확률↑(`buildOwnerFx` `REL_LEAVE_K×Σmax(0,affinity)`, uniform unrest 위에). 내 팀 한정.
- **은은하게(parity 보호)**: rel 가중 ~0.03·`REL_SCALE_FA 6` — 관계는 타이브레이커, 권력 집중 안 함(30×8 std 3.12).
- **미리보기=결과**: `setRelationContext`(모듈 컨텍스트, rehydrate+endSeason)로 FA 센터 예상==실제. **무저장 원칙**: bond 1필드만 영속(SAVE_SYSTEM, `_dv_migrate` drift).

---

## 3. 엣지 케이스 레지스트리 (발견·수정된 버그 — 회귀 감시)

> 형식: **ID · 증상 → 근본 원인 → 수정 위치(커밋) · 잡는 도구**. 새 버그는 같은 형식으로 append.

### FA·보상
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-FA-01 | 방금 영입한 FA가 보상선수로 원소속팀에 넘어감("돈은 내고 선수는 상대 팀") | `pickCompensation`이 신규 영입 FA를 후보에 포함 → `signedByMe` 제외 추가 (`e2ccfb6`) | simFaDup(f)·audit `faLeak` |
| EC-FA-02 | 보상선수로 외인이 빠져 받는 팀 외인 2명 | 외인이 보상 후보에 포함 → `if (p.isForeign) continue` (`c6d0968`) | simFaDup(e)·audit `foreign` |
| EC-FA-03 | FA 센터에서 "영입 불가"인데 실제론 가능(미리보기≠결과) | 정산 전 자금으로 미리보기 → 모기업 지원 누락. `projectSettledCash`로 정산 후 자금 사용 (`072779a`) | fa.tsx=endSeason 동일 소스 |
| EC-FA-04 | (예방) '돈만' 선택인데 보상선수가 빠지거나 보상금 미가중 | 신규 기능 — `moneyOnlyIds` 전파 + `pickCompensation` 건너뜀 + `compensationMoneyOnly` (`e9bb4b6`) | simMoneyOnly |
| EC-FA-08 | **가드 오라클 오판(엔진 WAI)** — `simMoneyOnly`가 등급을 `faMarketPreview.snapshot`(시장 해석 후·신규 계약 연봉 반영)으로 매겨, 직전연봉 순위로는 C인 선수를 A로 오분류 → C 영입의 정상 `compCash=0`을 "돈만 미가중" 위반으로 오판(신재은 2건, FA_SYSTEM §2.2 "직전연봉 순위"). 엔진 `resolveFAMarket`은 pre-FA 스냅샷으로 등급을 매겨 정확. **엔진 무결·가드 결함**(진단·수정=Opus 에이전트, 발견·검증=Fable 5, 2026-07-06) | 가드가 `buildOffseason(pre-FA).snapshot`으로 등급 산정하도록 정정(엔진 등급 입력과 동일) → simMoneyOnly 위반 0·A/B 민감도(가중 무력화 변이=8위반) 유지 | simMoneyOnly |
| EC-FA-09 | **화면↔endSeason 인자 누락(EC-FA-08의 UI 형제)** — ① `app/draft.tsx`·`app/draft-live.tsx`가 `buildDraftContext`에 `tryoutWish·keepForeign·moneyOnlyIds·asianWish·keepAsian`를 빠뜨려(9인자까지만) `endSeason`(14인자)과 다른 컨텍스트 → **라이브 확정 지명 신인이 실제 입단 안 함**(moneyOnly 설정 시 슬롯 [0] vs [])·keepForeign=false 시 AI 픽 발산. ② `app/fa.tsx` 등급·요구연봉·보상 라벨·돈만 게이트·compNeeded를 **post-market**(`pv.snapshot`, 해석 후 신규 계약 연봉) 스냅샷으로 산정 → 엔진 pre-FA 등급과 40.7% 불일치(측정, EC-FA-08과 동일 원인의 UI판). ③ fa.tsx 미리보기가 트라이아웃/아시아 토글을 `[]·null` 하드코드로 무시. 전수조사 2026-07-08 발견 | **단일 소스 조립** `data/offseasonArgs.ts`(`offseasonResolveArgs` 11 꼬리 튜플 → `draftContextFor`/`resolveDraftContextFor`/`resolveFAPreviewFor`)로 화면·endSeason이 **같은 튜플**을 spread(인자 누락 구조적 불가). fa.tsx는 등급/요구연봉을 **pre-market**(`base.off.snapshot`)으로 + 요구연봉에 `scandalRepMap` 할인(엔진 :150 산식) + 토글 구독. contracts.tsx FA 예정 등급은 **리그 전체 willBeFA 풀**로(내 부분집합→1명 무조건 A 수정). endSeason(store) 전환은 웨이브2(`draftContextFor` 인계) | `_dv_uictx`(A 정합 24케이스 0불일치·B 등급 pre-FA 0불일치/post 40.7% 이빨·C 5인자 누락 8/12시즌 변경 이빨) |
| EC-FA-16 | **인시즌 재계약(override)이 재계약 거부(`refuseProb`)를 완전히 우회** — `contractOverrides`가 `rolloverPlayer`에서 `remaining≥1`로 계약을 교체하면 `buildOffseason`이 만료(`remaining≤0`) 버킷이 아닌 **keep 버킷**으로 보내 `refuses()`를 **미호출**. 시뮬 확증: `refuseProb` 0.99 강제해도 override 보유자 **46/46 잔류**(override 없으면 46/46 이탈) → "재계약 확정=불만 무시 100% 잔류 버튼", '짧게' 조합 시 최저가 확정 익스플로잇. OWNER_SYSTEM("잡아도 떠날 수 있다")·§2.5 모순. **왜 놓쳤나**: 거부 경로 가드(`simOwnerRefuse`)가 override 없는 케이스만 태웠고, `_dv_resignrollover`는 발효 연수(off-by-one) 의미론만 봤지 거부 상호작용은 미검. **형제 사냥**: `Record<string,Contract>` override 중 거부 우회는 `contractOverrides` 뿐(`keepForeign`/`keepAsian`=boolean·외인 전용, `refuses` 무대상 — 유사 우회 없음, grep 확인) (발견·수정 2026-07-10, D안 독립 리뷰) | **봉인**: override 보유 **만료자**(롤오버 전 base `willBeFA`)도 `refuses()` 롤. 거부 시 override 폐기→원계약(`remaining 0`) FA 풀행. 시드 `resign-refuse:{id}:{season}`(정상 경로와 동일 per-player 해시, rng 순서 무영향). + money 불만이 대기 override 연봉에 반응(`discontentNow` salaryRatio). AI 무관(myTeam 전용, simLeague md5 0드리프트) | `_dv_resignrefuse`(HI 이탈/LO 잔류 A/B·봉인제거 mutant 검출·preview=result·money 토글)·`simOwnerRefuse`(override 유일성 확장) |
| EC-FA-17 | **재계약 결과가 화면·연대기에 무피드백** — 제안 성공 시 시트만 닫힘·수락 확정 뉴스 부재·불발도 사유 없는 일반 방출 기사로 뭉개짐(캡압박/뿌리침/미제안 구분 불가). 오퍼=제안·확정=시즌말 `refuses()`(EC-FA-16 D안) 모델이 화면에 **읽히지 않아** "재계약이 FA 대비 재미없다"(사용자 불만). 잔류 토글 캡션("시장가로 재계약을 제안")도 엔진 진실(토글은 override를 안 만듦 — 구 연봉으로 money 불만 평가)과 균열 (2026-07-11, 측정 N=10,837 만료자·560시즌: money 불만 0.05%·옵션 밴드 divergence 40%·오퍼일→시즌말 flip 2.5%) | **UX 격상(FA §2.5c-격상)**: ①잔류 캡션을 엔진 진실로 교정(A안 '토글=시장가 override'는 결정론 오프시즌 회귀+EC-FA-16 변종 재개방이라 기각) ②오퍼 시트 캡션 3분기+money 불만만 옵션별 밴드(`resignOptionOutlooks` — 엔진 위임) ③제안 직후 결과 시트(밴드 전→후·"최종 결정은 시즌 종료 시") ④`buildOffseason`이 사유맵(`myReleaseReasons`)·도장(`myResigned`)을 버킷팅에서 산출→`Transfer.reason`+`kind:'resign'`(옵셔널=세이브 안전·마이그레이션 불요), 도장=오프시즌 결산 1건·불발=사유별 리드. 은퇴자 무대상(`applyRetirements` 선행) | `_dv_resignfeedback`(옵션 위임 A/B·버킷 일치 3시나리오·도장 뉴스·스포일러 무해·결정론)·`_ms_resignfeedback`(측정, on-demand) |
| EC-FA-18 | **재계약 오퍼 레버 격상 — 저연봉+주전보장 콤보 우회 + 세탁·과완화·드리프트 위험** — 3 프리셋을 FA식 빌더(연봉 배율·기간·주전보장)로 여니 ① 비-money 아키타입에 **최저가+주전보장**을 걸면 대가 없이 싸게 락업(money 문턱 `<0.75 && w.money≥0.25`이 비-money를 안 잡음) ② 이번 오퍼 주전보장으로 **기존 계약 파기(breach 0.5)를 세탁**(보장→벤치→재보장) ③ 완화가 면담 카드와 겹쳐 과완화(확정 잔류) ④ 레버 추가가 **표준·무오퍼 경로를 드리프트**시켜 기존 세이브/리플레이 회귀. (설계 2026-07-11, 독립 리뷰 수정 채택) | **두 공유 primitive**(`engine/owner`, buildOwnerFx·resignOutlookNow 공유=미리보기=결과): `lowOfferRefuse(ratio,wMoney)=K·wMoney·max(0,R0−ratio)`(R0 0.95·K 2.0) — money 문턱과 **독립 가산**(비-money도 w.money만큼 반응, 콤보 차단), `ratio≥R0`이면 **정확히 0**(표준·무오퍼 bit-동일 by construction). `guaranteeRelief(refuseBias)` — **minutes 기여+sustainedBenchRefuse만 완화**, breach는 `max(FLOOR,base+accum−relief)+breach`로 **완화 뒤 add=세탁 봉인**, 면담 카드와 합산 상한 0.25·잔여 하한 0.05(확정 잔류 금지). **채널 분리**: 파기=`p.contract.starterGuarantee`(기존)·완화=`override.starterGuarantee`(오퍼) | `_dv_resignfeedback` ⑤(레버 조합 6종 셀렉터==primitive 재구성·breach 완화 검출 / 표준·무오퍼 bit-동일 / 0.8×≥1.0× 단조·money 실증가 / 전원보장 no-op / **세탁 봉인 A/B** / 합산 상한)·`_ms_resignfeedback` ④⑤(N≥10,000 A/B·K 스윕)·`_dv_resignoutlook`(오퍼 배율=marketVal 정합) |
| EC-CA-01 | 현금 없는데 국내 FA 영입됨 | 입찰 게이트가 캡만 봄 → `offer + compCost <= cashLeft` 추가 (`a91f967`) | audit `cash2` |
| EC-CA-02 | 외인 트라이아웃 + 국내 FA 합산이 정산현금 초과(각자 전액 게이팅 → 이중 사용) | `resolvePreDraft`/`faMarketPreview`가 `runTryout`·`resolveFAMarket`에 같은 `myCash` 전달 → 외인 incoming 비용을 국내 FA 지갑에서 차감(`cashAfterForeign`) | simBrokeSign |
| EC-CA-03 | 생애주기 keep(자기 선수 유지)로 팀 국내연봉이 캡 소폭 초과(대전 +1.5% @S6) — `buildOffseason` keep 경로(`offseason.ts:257`, 미만료 선수)는 캡 미게이트. **결정: (A) 정상 인정(WAI)** — 현실 배구도 자기 선수 유지는 캡 초과 허용, 트레이드 없는 게임서 미만료 강제 방출은 과함. 새 영입/재계약(만료자)은 게임이 `≤캡` 하드 게이트 유지. **감사 비최종 캡 임계 `×1.0→×1.05`**(>5%=진짜 새영입 버그는 계속 잡힘) (`acquisitionAudit.ts:167`, 2026-06-20) | audit `cap`(비최종 ×1.05) |
| EC-FA-06 | **AI 잔류 과이탈(성장 C 파급)** — `aiRetainProb`의 절대 OVR 앵커(62·82)가 성장 C(훈련 상한=포텐−12)의 리그 OVR 하향(FA 모집단 <70: 27%→46%·중앙값 72→69)으로 암묵 강화 → 순잔류 60.1%→45.0%(12시즌)·39.4%(24시즌, C세대 누적일수록 심화). 로직 회귀 아님 — "분포 이동 vs 절대 임계" | 상수 재중심(−3)은 한 지평에서만 맞아 기각 → **리그 국내 OVR 중앙값 상대 앵커** `aiRetainProb(p, medOvr)`(앵커를 `medOvr−MED_REF(72)`만큼 평행이동, `aiKeepsForeign(domesticAvg+15)` 선례). 재측정 12시즌 56.9%·24시즌 54.2% 모두 밴드(50~62%) 내 (`engine/aiGM.ts`·`data/offseason.ts`·`data/tryout.ts`, 2026-07-02) | _ev_airetain(12·24 다지평, A/B=preC 워크트리 60.1% 대조) |
| EC-FA-07 | **연봉 디플레 → 재정 긴장·캡 밀착 사멸(EC-FA-06의 형제)** — 연봉 앵커 `abilityMul(overall−55)`도 절대라 성장 C의 중앙값 −3이 리그 연봉 ~−11% 레벨 시프트(나선 아님) → 수입(순위 기반) 불변으로 잔고 21.4→46.6억·자금부족 입찰좌절 14→0회·모기업 보전 9→0회(simFinance 120시즌, 잔류 수술 후에도 잔존)·캡(35억=현실 KOVO 고정) 밀착 중앙 74→~66% | **독립 리뷰(1.5단계) A안**: `marketValue/computeSalary(p, medOvr, …)` **필수 파라미터**(기본값 없음 — 누락=컴파일 에러, 미리보기≠결과 봉쇄) + `data/awardSalary setSalaryEra` 주입 컨텍스트(setAwardScores 패턴 — UI·AI·오프시즌 전역 일관) + 시드/신인=MED_REF(시대 0 — day0 캡 정합·루키 스케일 고정). MED_REF·medianOvr은 `engine/overall.ts` 단일 출처. FA 등급은 연봉 순위(상대)라 무관 확정·displayOvr는 절대 유지(서사 자산). 재측정: simFinance 복원(보전 8%·좌절 16회·잔고 18.3억)·캡 밀착 중앙 74% 복원·유닛 206 (2026-07-02) | simFinance(120)·_dv_cappressure(중앙 밴드+A/B 디플레 주입 거부)·_dv_capdomestic(day0)·salary.test(시대 단조) |
| EC-TX-06 | **AI가 자기 팀이 방출한 선수를 재영입** — 방출(주입)로 생긴 구멍을 `aiSign`이 그 방출 선수로 되메꿈(day88부터 옛 팀 재등장 21건). "유저=배신 웃돈 ×1.5, AI=공짜" 비대칭 + 무의미 churn. 잠재 규칙 공백(자기방출자 제외 없음)이 6/21~7/1 구성 변화(아시아쿼터 전환 등)로 표면화 — j21(6/21) 0건 vs cf60ed6·HEAD(7/1~) 21건 A/B | `data/dynamics.ts`에 `releasedByTeam` 추적 + `aiSign` 풀에서 자기 방출자 제외(타팀 영입은 자유 — TRANSACTION 0장 ⑥). dyn 재생 변경이라 `ENGINE_VERSION 2→3`(캐시 게이트 의도 무효화) (2026-07-02) | simTxDup(불변식4)·simTxEdge·simTxSeason·_dv_simcache(G3) |

### 감독·스태프
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-CO-01 | 경질한 감독이 같은 팀에 다시 영입됨 | `hireHeadCoach`에 firedFrom 체크 없음 → `firedFrom.includes(teamId)` 차단 (`59c2e05`) | simStaffDup·audit `head` |
| EC-CO-02 | 시드 감독이 그 팀 감독 아닌데 teamId 점유(고아) | 첫 영입 시 시드 감독 teamId 안 비움 → 영입/배정 시 시드 감독 해제 (`59c2e05`·`a1c8af2`) | audit `head`(고아 점유) |
| EC-CO-03 | FA 감독인데 계약연수 잔존(`teamId=null` & `contractYears>0`) | 경질·교체 시 teamId만 비우고 계약 안 비움 → `contractYears=undefined` 동반 (`d091d4c`) | audit `salary` |
| EC-CO-04 | AI 팀 감독 공백(공급 고갈) | 플레이어가 풀을 빨아들임 → `makeInterimCoach` 안전장치(공석 팀 임시 감독) (`d091d4c`) | audit `supply` |
| EC-CO-05 | 대행 감독이 정식 풀·생애주기에 섞임 | `acting_` 접두 제외 누락 → 생애주기·고아 점검에서 제외 (`23e8cb1`) | simStaffDup·audit `head` |
| EC-CO-06 | 스카우터 슬롯 무제한(코치는 `COACH_SLOTS` 제한, 스카우터는 예산만) — 예산 되면 무한 영입 | `hireScout`에 `>= COACH_SLOTS` 슬롯 게이트(코치와 일관, `data/league.ts:277`). ※ `scoutReveal` 상한(depth≤0.15@4)이라 익스플로잇은 아니었고 예산 낭비 방지·일관성 (2026-06-21) | 정적: hireScout↔hireAssistant 슬롯 검사 일관 |

### 시즌 중 이동·외인
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-TX-01 | 방출 선수를 두 팀이 영입 → 이중 소속 | `applyTx` 영입이 기존 소속 미확인 → 단일 소속 가드(이미 가진 팀이면 무시) (`489a968`) | simTxDup·audit `intx` |
| EC-TX-02 | 방출 외인이 시즌 중 재등장(리그 이탈해야) | 방출 외인 추적 누락 → 방출일 이후 소속 금지 검사 | audit `intx` |
| EC-TX-04 | **검증 없는 `reSign` 계약으로 캡 무력화** — 내 선수를 ①음수/0 연봉(→payroll 음수 -1.4억) 또는 ②거대 연봉(개인 7.1조·팀 캡 35억 초과)으로 재계약하면 롤오버가 그대로 적용 → 캡 무력화 + 비정상 연봉 새 시즌 잔존 | `store.reSign` 미검증 + `rolloverPlayer`가 override 클램프 없이 사용 → reSign에 **유효 로스터+계약정상치+캡 인지**(재계약 후 국내 payroll>캡이면 거부) 게이트 + `rolloverPlayer`가 비정상/캡초과 override 무시(심층방어) (`store/useGameStore.ts:232`·`engine/rollover.ts:58`, 2026-06-20) | _gt_resign(A/B 음수)·_gt_monkey(reSign 적대계약, 거대 양수) |
| EC-TX-03 | **타 팀 선수 id를 방출에 넣으면 팬텀 방출** — 그 선수가 내 FA풀에 뜨면서 원 소속팀에도 남음(이중 소속) + 영입 시 자금만 차감되고 안 들어옴(누수) + 6회 반복 시 정상 방출 전면 차단(자기 DoS) | `store.release()`가 소유권 미검증 + `applyTx` release가 그 팀 소속 미확인(영입과 비대칭) → `release()`에 유효 로스터(시즌초+영입) 가드 + `applyTx`에 `if(!arr.includes)return`(영입과 대칭) (`store/useGameStore.ts:236`·`data/dynamics.ts:122`, 2026-06-20) | _gt_repro_release(오라클)·_gt_repro_cash·_gt_monkey(full) |
| EC-TX-05 | **reSign 개인상한 우회** — 팀캡(35억)만 검사해, 싼 동료 9명 + 한 선수에 거대연봉(예: 30억 > 개인상한 8억) 주면 팀합은 캡 이하라 통과 → 단일선수가 개인상한(MAX_SALARY/FRANCHISE_MAX) 초과(EC-TX-04 잔여 — 팀캡만 막고 개인상한 누락) | `reSign`에 `salary > maxSalaryFor(target)` 거부 게이트 추가(`store:248`) + `_gt_invariants` 가드를 `≤LEAGUE_CAP`→`≤maxSalaryFor`로 강화(개인상한 클래스 monkey가 잡게) (2026-06-21) | _gt_monkey(reSign 적대계약)·_gt_invariants(개인상한) |
| EC-ST-01 | **setDay(NaN) → currentDay 오염** — `Math.max(s.currentDay, NaN)=NaN` → 이후 모든 `evolveOnDay(id, NaN)` 전파(NaN/Infinity 미가드) | `setDay`에 `Number.isFinite(day)` 가드(비유한 거부) (`store:226`, 2026-06-21) | _gt_monkey(setDay 적대값) |
| EC-FG-01 | 자금 부족인데 외인 영입됨 | `runTryout`이 현금 미검사 → `myCash >= FOREIGN_SALARY` 게이트 (`6be1ea7`) | simBrokeSign |
| EC-FG-02 | 외인 좀비/멸종(재계약 연속성 깨짐) | 외인 1년 계약 흐름 분리 검증 | simCareerTrace |
| EC-FG-03 | **외국인/아시아쿼터가 "연고 애착 / 고향 팀에서 뛰는 게 꿈"**(국내 전용 성격) — V리그는 외인에게 연고(고향팀) 개념이 없는데 표시됨(사용자 보고 2026-06-28, 아시아쿼터 호주 선수). 근본: `makePlayer`→`rollFAPref`가 **외국인에도 무게이트로** hometown 아키타입+preferredTeamId 부여 | ① 생성: `rollFAPref(rng, teamCount, isForeign)` — 외국인은 hometown 제외(4개 재분배)·preferredTeamId 없음(국내는 RNG/결과 불변=결정론 보존). ② 기존 세이브(이미 박힘): `discontentOf` hometown unmet에 `!p.isForeign` 게이트(연고 향수 mood 차단) + `effectiveArchetypeOf(p)`(외인 hometown→winnow 표시 매핑, player 화면 사용) (2026-06-28) | **`_dv_foreign_archetype`**(생성 외인 hometown/preferredTeamId 0·국내 도달가능 대조군·effectiveArchetypeOf·discontentNow 게이트, A/B) |

> EC-FG-03 발견 방법(왜 기존 테스트가 못 잡았나 — **하위집단 유효성 사각**): 아키타입 부여는 *분포*(hometown ~10%?)만 봤지, **그 속성이 그 선수의 하위집단(외국인)에 유효한가**를 대조하는 렌즈가 없었다. 다른 국내전용 속성(`isFranchise`·FA자격)은 `!isForeign` 게이트가 있었는데(형제사냥 결과 정상) **faPref만 누락** = "개별값은 유효하나 하위집단엔 무효"인 단일 칸. 가드도 분포가 아니라 **(외국인=0) × (국내=도달가능 대조군)** 교차로 짠다(허위통과 차단).

### 드래프트·면담
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-DR-01 | 신인 id가 기존 선수와 충돌 → 선수 증발 | 신규 id 생성이 기존 레지스트리와 충돌 가능 → 충돌 검사 | audit `newid` |
| EC-DR-02 | 위시 우선순위 무시·중복 지명·슬롯 초과 | 드래프트 해석 정밀 검증 3종 추가 (`f1b00eb`) | draft.test.ts |
| EC-OW-01 | 면담/재계약 거부 선수가 풀로 안 감(소속 모호) | 거부 경로 풀 이동 정합 검증 (`35f9e7b`) | simOwnerRefuse |

### 정원·은퇴 충원
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-RM-01 | **오프시즌 신인 충원이 정원 초과 → 19명**. 시즌 중 FA 영입으로 명단이 차오른 팀이 은퇴 구멍을 메울 때(순수 endSeason은 정상=대조군, churn 시 시즌5에 발생) | `fillRosters`가 포지션별 `ROSTER_IDEAL`까지 채우는데 **전역 정원 상한 없음** → `if(ids.length>=ROSTER_MAX)break` (`data/rookies.ts:38`, 2026-06-20) | _gt_repro_oversize·_gt_monkey(clean)·audit `roster` |

### 화면·표시(UI)
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-UI-01 | **결과 상세 박스스코어 ≠ 실제 기록·관전 결과**. 부상·정지·벤치 선수가 있는 경기를 결과 상세로 열면 standings/production/관전 화면과 다른 명단으로 재시뮬 → 다른 스코어(관전형 1순위 위반) | `app/matchresult/[id].tsx`가 `getEvolvedTeamPlayers`(원본 명단)로 시뮬 — 정사(`production.ts`)·관전(`match/[id].tsx`)은 `availableTeamPlayers`(부상·정지·벤치 반영). → matchresult도 `availableTeamPlayers`로 통일 (2026-06-21, 독립검증 도출) | **`_ev_simsource`**(모든 simulateMatch 호출부가 availableTeamPlayers 쓰는지·getEvolvedTeamPlayers 금지, A/B 자가검증) |
| EC-NEWS-01 | **첫 경기 전(0경기) 리그 뉴스가 미래를 노출**. `경기 결과`는 "아직 치른 경기 없음"인데 같은 순간 리그 뉴스가 유망주 데뷔전 N점 6건 + 미래 부상(13경기 결장) + 시즌 후반(160일째) 사건(도박 30경기 정지)을 표시(에뮬레이터 C0, 2026-06-30). 스포일러 + 화면 간 모순 | 앱 전체(대시보드·results·schedule·standings·history·player·staff·contracts)는 `leagueDisplayDay(currentDay)=currentDay−1`(관전/미래 경기 제외)로 통일됐는데 **`buildNewsFeed`만 raw `currentDay`** 를 받았고, 부상·사건(`seasonInjuryReport`/`seasonScandals`)은 day 경계 자체가 없어 `dyn()` 시즌 전체 선생성분을 노출. → 호출부 3곳(index·news·news/[id])이 `leagueDisplayDay(currentDay)` 전달 + buildNewsFeed 부상·사건 루프에 `from>leagueDay continue` (`data/news.ts`, 2026-06-30). standings의 playedThroughDay 수정이 뉴스엔 안 옮겨진 **형제 버그** | **`_dv_newsday0`**(첫 경기 전 실시간 뉴스 0 + A/B: 경계 해제 시 13건 재현=필터 민감)·simNews(장기 무결성·중복0) |
| EC-UI-02 | **관전 중인 경기를 라인업 변경으로 리롤/어긋남**. 경기 이어보기 대기 중(`watchProgress`) 선발/벤치 건의를 하면, 경기는 매 진입 시 `availableTeamPlayers(dayIndex)`로 재시뮬(EC-UI-01)이라 ① 저장된 이어보기 지점이 *바뀐 경기*로 이어져 어긋나고 ② "질 것 같으면 나가서 선발 바꿔 리롤" 가능(관전형 = 결과는 정해진다 위반) | 건의(`suggestBench`/`suggestStart`)의 `benchDirective.fromDay`를 **이어보기 대기 시 `currentDay+1`** 로(평소 `currentDay`) — 관전 중 경기엔 미적용, 다음 경기부터 반영. `watchProgress`는 다음 미관전 경기에만 생기고 건너뛰기 없음(`setDay(nextFixture)`)이라 "비어있지 않음 == 현재 경기 관전 중" 단순 판정 성립. 플레이어 화면 수락 알림에 "다음 경기부터" 안내 (2026-06-28, 옵션 A — OWNER_SYSTEM 2.3) | **`_ev_suggest_defer`**(이어보기 유무만 바꿔 fromDay 델타=1 — 0이면 옛 미적용 검출, A/B) |
| EC-REC-01 | **선수 상세 "통산 기록 (N시즌)" 헤더가 실제 플레이 시즌보다 큼**. 시즌3 시작 직전인데 헤더 "4시즌", 다른 선수 "5시즌"인데 그 아래 시즌별기록은 2줄뿐이고 통산 경기수(68=32+36)도 2시즌만 반영(사용자 실기기, 2026-07-04). 즉 헤더 N이 인게임 전용 통산 숫자와 모순 | 헤더가 `career.seasons`를 썼는데, `data/seed.ts:187`이 **시드 베테랑을 `career.seasons=age-19`(게임 전 가상 데뷔 추정)로 초기화** + `rollover.ts:58` 시즌마다 +1. 반면 통산 숫자·시즌별기록(`seasonLines`)은 **출전한 인게임 시즌만**(`appendSeasonLine`). → **해결(2026-07-04 사용자 결정): "N시즌"(세는 숫자) 폐기, V리그식 연도 라벨 전환**(`data/seasonLabel.ts seasonYear`: 1시즌=2025-26, 100시즌+ 겹침0). 일정 헤더("2025-26 일정 · 1번째 시즌")·선수상세(시즌별기록/통산 범위/수상/마일스톤)·기록화면(스텝퍼/연표/마일스톤/HOF은퇴)·순위/포스트/시상/FA/뉴스/대시보드/배경스토리 전부 연도. **예외=count 유지**: 통산 리더보드 현역 스팬(`seasonLines.length`, 1차 수정)·HOF 커리어 longevity(`h.seasons` — 게임 이전 커리어가 세계관 정본, 레전드 "17시즌"=서사). `career.seasons`는 FA자격(≥6)·은퇴(≥8)·신인판정 사용이라 **불변** | **`_dv_careerseasons`**(실store 3시즌: 통산경기==ΣseasonLines.matches=분모정당·career.seasons>seasonLines.length 91명 재현·A/B갭15) + **`_dv_seasonlabel`**(연도 앵커·100년 겹침0·범위) |
| EC-UI-03 | **선수 상세에 부상 표기가 안 뜬다** — 선수단 목록은 🚑(결장)인데 그 선수를 눌러 들어간 상세엔 "부상 결장"이 없음(사용자 보고, 2026-07-04). 정지(🚫 배너)도 동일. | **화면 간 날짜 기준 불일치**: 선수단(`squad.tsx`)·대시보드는 출전상태를 **`currentDay`**(현재)로 판정, 선수 상세(`player/[id].tsx` role·정지배너)만 **`displayDay=currentDay−1`**(생산 통계용 컷오프)로 판정 → 부상 span 경계에서 하루 어긋남. 특히 **부상 첫날**(currentDay==from) 선수단 🚑 인데 상세 표기 없음. 부상 span `from`은 항상 과거 경기서 굴려져(`from=경기일+GAME_INTERVAL`) currentDay 사용은 스포일러 아님. → 상세 role·정지배너를 **`currentDay`로 정렬**(생산·시장가만 displayDay 유지). 형제(정지배너 line 238)도 동시 수정 | **`_dv_injury_daybasis`**(시드리그 7팀×166일 A/B: 상세=displayDay면 불일치 37건[선수단🚑·상세무 19 + stale 18] 재현 → 상세=currentDay면 0건) |
| EC-CAP-01 | **샐러리캡에 외인 연봉이 섞여 허위 초과(빨강)**. 인천 타이드 선택 시 대시보드/단장실 "총연봉/캡"이 37.7억/35.0억(빨강)인데, 캡은 **국내 전용**이라 실제 국내 페이롤은 30.6억(캡 이하). 외인 2명(7.1억)이 캡에 더해져 멀쩡한 팀이 초과로 보임. 시즌중이동(`transactions`)은 표시뿐 아니라 **capLeft 축소→영입 차단(기능 버그)** 까지. (에뮬레이터 C0 항목7 사용자 질문, 2026-06-30) | 캡은 국내 선수만(외인=1년 트라이아웃 별개 지갑, FOREIGN_SYSTEM 2장 — `roster.ts domesticPayroll`). 계약관리(`contracts.tsx`)만 옳게 `!isForeign` 필터를 썼고, **대시보드·단장실·시즌중이동·FA** 4곳이 전체 페이롤을 국내 캡과 비교. → 4곳 모두 `!p.isForeign` 필터(`index`·`office`·`transactions`·`fa`, 2026-06-30). **이전 세션이 "구단 정체성 시작조건이라 WAI"로 추정·종결**했던 것을 실측(전 구단 국내<캡)으로 뒤집음 — 추정 금지 위반 사례 | **`_dv_capdomestic`**(day0 전 구단 국내 페이롤 ≤ 캡=0초과 + A/B: 외인 포함 규칙은 ≥1팀 초과로 잡힘=필터가 판정을 바꾼다는 증거 + 인천 사례 국내<캡<전체) |
| EC-NEWS-02 | **뉴스 목록↔상세 인덱스 어긋남**. 목록에서 기사를 눌러 들어간 상세가 다른 기사(만료 기사가 하나라도 있으면 대부분 행이 어긋나고 읽음까지 오염). 시즌 중반 18행 중 16행 오배선(사용자 보고, 2026-07-07). 숙성 세이브(만료 기사 2주+)에서만 재현 | 목록(`news.tsx`)은 `freshNews`로 거른 배열의 인덱스로 라우팅, 상세(`news/[id].tsx`)는 **거르지 않은** `buildNewsFeed(...)[i]`로 집음 → 만료 1건이면 인덱스 시프트. 2026-07-05 표시계층 만료 필터 도입 시 상세 미배선(형제). → **안정 키(newsKey) 라우팅** + 상세도 목록과 **동일 파생**(`freshNews`)에서 `find(byKey)` (`data/news.ts`, 2026-07-07) | **`_dv_newskey`**(만료 기사 있는 상태서 목록 인덱스 k의 newsKey == 상세가 그 키로 집는 기사 0불일치·읽음대상 정확 + A/B 구 인덱스 라우팅 되돌리면 어긋남 재현) |
| EC-SEASON-01 | **시즌 종료 후 마지막 매치데이 영구 누락**. 순위/결과/대시보드/뉴스/기록(라이브 표면)이 시즌 마지막 경기일을 안 보여주는데 PO/시상/아카이브(영구 표면)는 보여줘 **같은 순간 두 표면이 모순**(PO 진출팀 2/20 유니버스 상이·기록왕 14/20). 방금 관전·기록한 현재 경기일도 컷오프 밖(2026-07-07) | 컷오프 `leagueDisplayDay=currentDay−1`의 전진 동력이 "다음 경기 버튼"인데 **시즌 종료 후 동력 소멸** → 마지막 경기일 미승격. → **`displayCutoff(currentDay, results, myTeamId)`**: 내 전 일정 완료 시 `SEASON_DAYS`로 승격(=아카이브/PO와 동일), 방금 기록 경기 포함, 미관전 미래는 누수 0 (`data/standings.ts`, 2026-07-07) | **`_dv_displaycutoff`**(방금경기 포함·시즌말 top3==PO시드·경기수==풀시즌·미래누수 0·적대 유니버스 + A/B leagueDisplayDay 단독으로 되돌리면 방금경기·시즌말 누락 재현) |

> EC-UI-01 발견 방법(왜 기존 테스트가 못 잡았나): 단위/시뮬은 **데이터층(production)** 만 검사 — 화면이 *자기 시뮬*을 돌리는 줄 몰랐다(계층 우회 §4 + reported-but-unwired §1.F). **문서-코드 drift 독립검증**(INJURY 0 "동일 availableTeamPlayers" 약속 ↔ matchresult 코드 대조)이 잡음.

> EC-UI-02 발견 방법(왜 늦게 봤나): **시간차/stale-snapshot 사각**(TEST_METHODOLOGY §4 ①) — "행동 시작↔결과 확정 사이 상태 변함". 관전(이어보기 시작)과 라인업 변경 사이 시차를 대조하는 렌즈가 없었다. 사용자 질문("강제종료 후 선발 바꾸면 결과 달라지나")으로 드러남 → 의도 결정(옵션 A) + 가드.

> EC-REC-01 발견 방법(왜 못 잡았나): **"두 소스가 같은 것을 세는지" 대조 부재**(EC-NEWS-01·EC-CAP-01과 동류 — 같은 개념을 여러 곳이 각자 계산). `career.seasons`(시드+롤오버)와 `seasonLines`(인게임 출전)는 애초에 다른 것을 세는데, 헤더는 전자·바로 아래 리스트는 후자를 써서 **한 화면 안에서 모순**. EMULATOR_E2E C6 "통산 기록 라인 누적" 체크는 *라인이 쌓이는지*만 봤지 **헤더 숫자가 라인 수와 일치하는지**는 안 봤다(존재 검사 ↔ 정합 검사 사각). 환원: 통산 숫자 옆 "N시즌"은 그 숫자를 만든 시즌 수(seasonLines)여야 한다 + 가드가 ΣseasonLines.matches==career.matches로 분모 정당성 못박음. 형제: 은퇴/HOF는 seasonLines가 은퇴 시 정리돼 career.seasons만 남음 → 의도적으로 longevity 유지(WAI), 다른 화면(records-archive HOF)도 동일 기준.
> EC-CAP-01 발견 방법(왜 못 잡았나): ① **규칙 한 곳만 옳고 형제 4곳이 틀린 걸 대조하는 검사가 없었다**(계약관리=국내전용 ↔ 대시보드/단장실/이동/FA=전체). 같은 개념(캡)을 여러 화면이 **각자** 계산하는데 일치 검사 부재 = EC-NEWS-01과 동류(공통 셀렉터 미사용 → 형제 누수). `domesticPayroll` 헬퍼가 있었는데도 호출부가 안 썼다. ② **추정으로 종결**: 이전 세션이 "예산 초과 빨강 = 구단 정체성 시작조건 WAI"라 **측정 없이** 단정(추정 금지 위반). 실측(`_dv_capdomestic`: day0 전 구단 국내 페이롤 캡 이하)으로 뒤집힘. → 교훈: "WAI"도 시뮬로 확인한다(STATS_PROTOCOL 0장). 환원 = 공통 헬퍼 강제 + 형제 grep(`payroll.*LEAGUE_CAP`).
> EC-NEWS-02 발견 방법(왜 못 잡았나): **인덱스 신원 계약 사각**(TEST_METHODOLOGY §4) — 데이터 가드(만료 필터 자체·`_dv_newsorder`)는 PASS인데 **화면 간 라우팅 파라미터의 의미**(필터된 배열 순번 ↔ 무필터 배열 순번)를 보는 렌즈가 없었다. 숙성 세이브 + 상세 미배선(형제)이라 에뮬 초기상태로도 재현 불가. 환원 = 안정 키 라우팅(newsKey) + 목록·상세 동일 파생 가드 + 형제 화면 전수 grep.
> EC-SEASON-01 발견 방법(왜 못 잡았나): **정지 상태 교차 표면 동등성 사각**(TEST_METHODOLOGY §4) — 순위 가드는 한 표면의 내부 정합만 봐 전부 PASS(EC-NEWS-01·EC-CAP-01의 "같은 개념 여러 표면"과 동류, 표면이 화면일 뿐). 스포일러 정책이 "진행 중"만 상정, 컷오프 전진 동력이 죽는 **터미널 상태**가 매트릭스에 없었다. 환원 = 경계 3점에서 라이브 표면 vs 아카이브/PO 시드 동등성 단언 + "누가 전진시키나"를 케이스에 등록.

### 선발·벤치(라인업)
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-LU-01 | **벤치 지시가 팀의 마지막 리베로까지 빼서 리베로 0으로 경기**(상대 리베로는 정상 출전 → 우리 팀만 리베로 없음). 프로팀이 리베로 없이 뛰는 비현실. 사용자 보고(2026-06-22) | `availableTeamPlayers`/forward-pass의 벤치 필터가 **총원 7인 가드만** 보고 포지션은 안 봄 → 리베로 전원 벤치 시 코트 리베로 null. → 공유 헬퍼 `applyBenchDirective`에 **마지막 리베로 보호**(리베로 벤치만 무효) 추가, 양 경로 공유로 결정론 유지 (`data/dynamics.ts`) | **`simStarters`** G1 (전 리베로 벤치 → 코트 리베로 존재, A/B FAIL→PASS) |
| EC-LU-02 | **선발 기용 건의(`suggestStart`) 수락 시 동포지션 '최강' 주전을 벤치**(에이스 강등). 주석은 "최약 주전"인데 코드가 정반대 → 백업 선발 건의가 에이스(90+)를 벤치로 | `suggestStart` 인컴번트 선택이 `sort((x,y)=>overall(y)-overall(x))[0]`(내림차순=최강). → 실제 경기 라인업(`buildLineup(availableTeamPlayers)`)의 동포지션 **최약 주전**을 벤치하도록 수정 (`store/useGameStore.ts`). **"최약 주전" 정의(2026-07-07 정밀화)**: *주전 멤버십*은 폼 반영 라인업(`buildLineup(availableTeamPlayers)` — bestByPos가 폼-조정 OVR로 선발)로 정하되, 그중 *'최약' 판정*은 **순수 OVR**(`squad`=`rosterIdsOnDay`→`evolveOnDay`, 폼 미반영)로 오름차 정렬한 첫 선수 — 주전은 폼≈1.0이라 통상 동일하나 폼≠1이면 갈릴 수 있어 규칙을 명시(코드 주석 = 정본) | **`simStarters`** G2 (수락 시 벤치=최약 주전인지, A/B FAIL→PASS) |

> EC-LU 발견 방법: 사용자 관전 보고("우리 리베로만 경기 안 나옴, 90+인데") → **home/away 대칭 엔진에서 팀-특정 필터 추적**(injured/suspended는 전역 → 유일 비대칭 = 벤치 지시) → 재현 프로브(`_ev_libero_bench`) → **선발 검증 시뮬(`simStarters`)** 로 5요인(지시·OVR·징계·부상·폼) 전수 + 가드 상설화. 도구 자체 A/B(수정 전 FAIL 확인 → 수정 후 PASS).

> **악질/원숭이 — 견뎌낸 것(WAI, 버그 아님, 견고성 증거)**: 가짜/빈/존재안함 id, 음수·NaN 자금,
> '전원 영입'·'전원 보호'·'전원 재계약 거부', 거대/음수 시즌 번호, day0 `endSeason`, 무팀 `endSeason`,
> 역행 `setDay`, 60시즌 소크 — 전부 크래시·소프트락·불변식 위반 없이 우아하게 거부/처리됨
> (`_gt_adversarial`·`_gt_seqbreak`). 데이터층 순수 함수의 가드가 견고. NaN/Infinity 미발생.
>
> **구단주/면담(owner)**: requestInterview·suggestBench·suggestStart·unbench를 적대 인자(가짜 id·badcard·
> badreason) 3000스텝 난사 — crashes 0·불변식 0(fanScore 0~100·benchDirectives≤2·중복없음)·쿨다운 enforce.
> 액션 가드(쿨다운·BENCH_MAX·중복·무팀·invalid 선수)가 탄탄(`_gt_owner`, A/B 검증).
>
> **화면 UI 이벤트**: 죽은 네비 링크 0(`_ev_routes`), 핸들러 정적감사 36화면 — 동적 라우트 undefined 가드·
> 멱등성·빈상태·disabled↔store 일치 전부 OK(크래시 0). 단 `coachShare`는 malformed focus(손상 세이브)에
> 가드 추가(`engine/training.ts:80`, save-corruption 내성).

> **주의(WAI, 버그 아님)**: 캡 초과 2종은 정상이라 감사가 허용한다 — ① **드래프트 직후**: 신인 의무 수급
> (저가 슬롯)으로 정원 채우려 캡 직전 팀도 신인을 받음 → ×1.1. ② **비최종(생애주기·FA)**: 자기 선수 유지
> (keep)로 소폭 초과 → ×1.05(EC-CA-03). **새 영입/재계약(만료자)은 게임이 `≤캡` 하드 게이트**(이건 정상
> 초과가 아니라 막힌다). 비최종 >5%·드래프트 >10%는 진짜 버그로 잡힌다.

---

## 3.5 독립 도출 후보 (2026-06-21, 3세션: 문서만·코드만·drift) — 검증 대기

> 새 세션 3개가 *서로·기존 레지스트리 안 보고* 도출. 이미 등록된 것(EC-TX-03/04·RM-01·FA·CA)은 제외.
> 아래는 **처음 본 케이스만** 기록 — 추정 금지 원칙상 **시뮬/실측으로 확인 후** §3에 정식 등록한다(아직 버그 단정 아님).
> EC-UI-01은 이 도출에서 나와 검증·수정 완료(위 §3 UI 표).

| 후보 | 시스템 | 무엇 | 상태/심각 |
|---|---|---|---|
| reSign 개인상한 미클램프 | TX | `reSign`이 `≤LEAGUE_CAP`만 보고 `maxSalaryFor` 미적용 → 단일선수 거대연봉 가능(EC-TX-04 잔여) | ✅ **해결 → §3 EC-TX-05** (2026-06-21 검증·수정) |
| ~~면담 성공 무효(비만료)~~ | OWNER | **버그 아님(오독)** — line 48 `continue`는 **refuseProb 전용**(만료자만 거부권). 면담 효과(offerBias)는 `interviewEffects`로 전 선수 배선됨 | ❌ 기각(검증) |
| NaN 미가드 진입점 | store | `setDay(NaN)` → `Math.max(x,NaN)=NaN` currentDay 오염 전파 | ✅ **해결 → §3 EC-ST-01** (setDay NaN 거부). recordResult는 리플레이가 SEASON 기준이라 무효항목 무시(저위험, 유지) |
| hireScout 슬롯 무제한 | STAFF | 코치는 `COACH_SLOTS` 제한, 스카우터는 예산만 → 무한 영입 | ✅ **보강 → §3 EC-CO-06**(슬롯캡). 단 `scoutReveal` 상한(depth≤0.15@4)이라 **익스플로잇 아니었음**(예산 낭비뿐) |
| toggleProtect 멤버십 미검증 | TX | 보호명단에 타팀/유령 id 추가 가능 → 보호 슬롯 낭비 | ✅ **수정**(내 로스터만 보호 가드, `store:328`, 2026-06-21) |
| LEGEND 9000↔7500 | HOF | 문서(SEASON 89)는 9000, 코드는 7500(도달성 리밸런스) | ✅ **문서 정정**(SEASON 89 → 7500) |
| offerScore 공식 drift | FA | 문서(FA 131)는 wYrs·wAge 항, 코드는 home 항 | ✅ **문서 정정**(FA 131 → 코드 6항 일치 + wYrs/wAge 미구현 명기) |
| FORM "중첩없음" 표현 | FORM | 문서 5의 −7% clamp가 form 계수(sk*)만 — 만성·정지는 form 밖 별도 손실 | ✅ **문서 명확화**(FORM 53) |
| subPolicy 죽은 상태 | MATCH | 제거 결정(2026-06-18) 후에도 store가 subPolicy persist·미배선 | ✅ **제거**(store 상태·액션·persist·DEFAULT_SUB_POLICY 삭제, 2026-06-21). 엔진 `match.ts` DEFAULT_POLICY는 유지(감독 자동 집행) |
| 프리뷰 OVR 원본명단 | UI | 일정/대시보드 OVR이 `getEvolvedTeamPlayers`(부상·벤치 무시) — EC-UI-01과 동류이나 *프리뷰*라 설계 논의 필요 | ✅ **수정**(2026-06-21): 전력 프리뷰 3곳(일정 다음경기·대시보드·exhibition) `availableTeamPlayers`로 — 각자 띄우는 실제 경기와 동일 소스. 명단관리 화면(squad·office·contracts)은 전체 명단 유지(의도) |
| endSeason 더블탭 | store | 확정 버튼 연타 시 시즌 2전진(데이터무결성 OK=검증됨, UX 디바운스) | ✅ **가드**(2026-06-21): endSeason 진입부 `planNextAction(SEASON,my,results).kind!=='seasonOver'`면 return. 롤오버가 results={}로 비워(749) 둘째 탭은 'match'→차단. 검증 `tools/_ev_endseason_guard.ts` |

## 3.6 독립 도출 2차 (2026-06-25, 3세션: 문서만·코드만·문서+코드) — 검증 완료

> 이미 커버된 영역(보드·박스귀속·FA/재계약·벤치·트랜잭션) 제외하고 신규 엣지를 3시각으로 도출. 메인 세션이 전부 **직접 재현**함.

| 후보 | 시각 | 무엇 | 상태/조치 |
|---|---|---|---|
| **MB 블록 세트당 드리프트** | 문서+코드 | SALARY §1.1 "MB 블록 0.5/세트"는 구 legacy production 경로(simStatRecord) 측정값. **2026-06-24 box 단일화(실제 블로커=MB ~97% 귀속) 후 게임 truth는 ≈0.98/세트**(+96%). 세터어시·리베로디그는 일치. STATS_PROTOCOL §3 stale | ✅ **문서 정정**(SALARY §1.1에 box 재측정값 명기, 가중치는 legacy 한정 표기). 재현 `_dv_drift_posrate`(N=600, MB블록 0.98)·`_dv_drift_ab`(box vs legacy 점유 97% vs 66%) |
| **OP 톱 득점 드리프트(형제 사냥)** | 문서+코드 | MB와 같은 클래스("§1.1 포지션 수치 box 미재측정")를 **형제 사냥**으로 추가 발견: 문서 "OP 톱 ~5.3점/세트" vs box 실측 ~3.3(legacy 과장) | ✅ **재측정 확정·해결(2026-06-26, N=10,000·엔진 76c66ad)**: 팀별 OP톱 3.26·리그최고 3.70·OP평균 3.38·외인OP 2.40 — **어떤 해석도 5.3 미달 = 정의 무관 stale**(원인: legacy `ATK_FOCUS=2.0`가 OP 1옵션 집중 과장, 실제 엔진 스윙은 분산). "OP톱" 정의 확정 = **팀별 OP 득점 1위 세트당 평균**(가드 정의). 문서 교정(SALARY §1.1·FOREIGN_SYSTEM·가드 baseline 5.3→3.3·MB 0.5→0.98). ✅ **밸런스 follow-up 적용(2026-06-26, 사용자 A)**: 엔진 공격 집중 도입(`rally.ts ATK_FOCUS=3.0·OP 2.0`) → OP 톱 3.26→**4.31/세트(~27%)** KOVO 진입, KOVO·parity·결정론 보존(MATCH_SYSTEM 4.x). 재현 `_dv_drift_posrate 10000`(baseline 4.3)·`_dv_op_interp`·`simKovo 250`·`simLeague 20×6` |
| resetSave 레지스트리 누수 | 문서만 | 한 프로세스서 게임 후 `resetSave()` 해도 생성 선수(드래프티·외인 id)가 `getPlayer`로 잔존 → **in-process 다중 resetSave 재플레이 시 S1+ 오프시즌 비결정**(S0·cross-process는 완전 결정론, 무결성 0위반) | ⚠ **제품 무영향**(앱 세션=1프로세스·재시작=fresh). **미수정 등록** — 위험은 *in-process 다중 resetSave* 검증 도구의 false-oracle뿐(그런 도구는 cross-process로). 재현 `_dv_docs_rollover`(누수 프로브) |
| buildLineup <6 가용 동일선수 중복 | 코드만 | `engine/lineup.ts:42` 가용<6이면 같은 Player를 여러 코트 슬롯에 배치(묵음, 박스 부풀림). 가드 없음 | ⚠ **시즌층 의존**(로스터≥10·부상동시≤3 → 가용≥7 정상 보장, 부상+정지 극단 누적 시만 도달). **미수정 등록**(시즌층이 보장, 엔진은 계약 의존). 재현 `_dv_code_lineup`(5인→distinct six=5) |
| pickRest 빈 avail throw → 생산 크래시 | 코드만 | 빈 `avail`에 `pickRest`→`buildLineup` throw("시즌 계층 가드 위반"). `data/production.ts:52 allProdRows`가 try/catch 없이 호출 → 시즌 통계 재계산 전체 중단 | ⚠ **빈 avail 정상 도달 불가**(부상≤3·로스터≥10) + throw는 **의도적 loud assertion**(묵음 손상보다 나음). **미수정 등록**(마스킹 회피). 재현 `_dv_code_rest`(빈 avail rest-roll일 throw) |
| 정적 상수·KOVO 분포 | 문서+코드 | 캡35억·개인8억·프랜11억·정원10~18·외인4.1/2.5억·타임아웃2·교체6·듀스·승점3210·득점유형분포(±1%p) | ✅ **전부 일치**(드리프트 없음). 견고 확인 — `_dv_drift_kovo`(N=3000) |

> 견고 확인(위반 0): 시즌 롤오버(나이/정원/외인·아시아/좀비), 부상(동시상한 정확히 3·코트제외·시드무의존), 경기 세트경계(듀스/5세트), 시상(신인=데뷔·챔프MVP↔우승·archive 보존), 결정론(cross-process 동일 해시), 순수함수 경계(NaN/0/음수/Infinity 안전). 도구: `_dv_docs_*`·`_dv_code_*`·`_dv_drift_*`(A/B 자가검증 내장).

---

## 3.7 독립 도출 3차 (2026-06-25, 문서+코드 드리프트) — 검증 완료

> 2차에 이어 한 번 더. 신규 드리프트 **1건 + 형제 1건**. 둘 다 "문서 표가 코드 정의(상수 그룹)와 어긋난" 같은 클래스.

| 후보 | 시각 | 무엇 | 상태/조치 |
|---|---|---|---|
| **agility 노쇠 표 오기** | 문서+코드 | `TRAINING_SYSTEM §1.6` 표가 `민첩`을 "유지/상승(노쇠 없음)"으로 잘못 분류. 그러나 `CLAUDE.md 5.1`("민첩성 — 노쇠 시 하락")·`engine/aging.ts`(`DECAY_STATS`에 `agility` 포함)·`aging.test.ts:54`(이미 민첩 하락 단언)이 정본 → **표가 단독 오기**(내부 모순: 같은 문서 §1.3 ageMul 표·§0 현황표는 민첩을 신체로 정확히 분류). 35→38세 실측 agility −7(jump와 동일) | ✅ **문서 정정**(§1.6 표에서 민첩을 하락(신체)으로 이동 + 정정 주석). 가드 `_dv_drift2_agility`(A/B: 반응·위치선정 Δ0 대조군) |
| **체력코치 노쇠둔화 대상 누락(형제)** | 문서+코드 | 형제 사냥: `STAFF_SYSTEM.md:19` 체력코치 노쇠둔화 대상을 "jump·staminaMax·staminaRegen"로 적어 **agility 누락**. 그러나 `staff.ageSlow`는 `applyAgingDay`에서 `DECAY_STATS` **전체**에 곱해짐(민첩 노쇠도 둔화) | ✅ **문서 정정**(대상에 agility 추가 + "노쇠 지연은 DECAY_STATS 전체" 명기) |

> 사각: "한 코드 상수(`DECAY_STATS`)를 **여러 문서 표가 각자 손으로 다시 나열**하는데, 그 나열을 상수와 대조하는 가드가 없었다." TEST_METHODOLOGY §4 사각표 참조. 가드 `_dv_drift2_agility`가 노쇠 그룹 멤버십을 코드에서 직접 읽어 대조.

---

## 3.8 독립 도출 3차 — 코드세션 발견: 외인 FA 풀 오염(실제 엔진 버그) — 수정 완료

> 코드만 보는 적대 세션이 **실제 도달 가능한 엔진 버그**를 발견(드리프트 아님). 직접 재현·근본수정·A/B·형제사냥 전부 집행.

| 항목 | 내용 |
|---|---|
| **버그** | `availableFAsOnDay`(셀렉터, `data/dynamics.ts:275`)가 방출 tx를 `isForeign` 무관 **전부** FA 풀에 add. 그러나 정본 `applyTx`(forward-pass, line 145)는 `!isForeign`만 add(FOREIGN_SYSTEM 3장: 외인은 방출/교체 시 리그를 떠남). **두 재구성이 드리프트.** |
| **도달성(정상플레이)** | `replaceForeign`(시즌중 외인 교체 — 정식 기능, store:520)이 **옛 외인 release tx**를 남김 → 그 시즌 내내 옛 외인이 `availableFAsOnDay`에 잔존. 매뉴얼 `release(외인)`도 동일(store.release에 isForeign 차단 없음). |
| **피해** | (1) UI 누수: 교체한 외인이 인시즌 FA 영입 목록(`app/transactions.tsx:36`)에 뜸. (2) **익스플로잇**: 소비처 `signInSeason`(store:299)이 `isForeign` 가드 없이 **풀 멤버십만** 검사 → 방출 외인 재영입 가능(캡·현금 여유 시). 새 외인 영입 후 옛 외인까지 재영입하면 **로스터 2외인** 가능. A/B(수정 revert)로 `signInSeason(외인)=true` 실증. |
| **근본수정** | `availableFAsOnDay`에 `applyTx`와 동일한 `!getPlayer(tx.playerId)?.isForeign` 가드 1줄(`data/dynamics.ts:281`). UI·`signInSeason` 양쪽 누수 동시 해소. |
| **형제 사냥(전수 5점)** | "외인이 국내 영입 풀로 새는" 모든 진입점을 코드 직독(문서 불신)으로 점검: ① 인시즌 FA **방출 분기**(`availableFAsOnDay`) = **버그(수정)** · ② 인시즌 FA **시드**(`faPool`←`nextFaPool` store:717) `!isForeign` ✅ · ③ 오프시즌 FA 시장(`isFAEligible` faMarket:54) `!p.isForeign` ✅ · ④ 팀 명단(`rosterIdsOnDay`) applyTx와 동일·외인은 명단서 정상 이탈 ✅ · ⑤ 아시아쿼터(`replaceAsian`) seed가 `isForeign=true` → 같은 1줄이 커버 ✅. **5곳 중 1곳만 버그**, 나머지 4곳 clean. 가드의 "풀내 외인수=0"이 ①+②(시드+방출) 동시 방어. |
| **구조적 잔존 위험** | ①은 `availableFAsOnDay`(셀렉터)와 `applyTx.faAvail`(정본)이 **같은 집합을 두 번 재유도**해 생긴 일. 시점별 질의 때문에 셀렉터가 정본을 그대로 반환할 순 없어 1줄 가드로 정합. 같은 클래스 재발 방지는 "동일 집합 두 곳 재구성 시 대조 가드"(TEST_METHODOLOGY §4 병렬재구성). |
| **가드** | `tools/_dv_foreign_fa_leak.ts`(exit 0/1) — 실제 `release`+`signInSeason` 구동, 외인 미포함·국내 포함(대조군)·외인 재영입 거부·국내 영입 허용 + A/B(구 전부-add 로직은 외인 검출=도구 민감). README 검증루틴 등록. |

---

## 3.9 리뷰 발견 — 계약 관리 외인 방출 공석 구멍(UX/도달 버그) — 수정 완료

> 독립 리뷰어(선수관리 점검)가 발견. §3.8의 후속 — §3.8은 "방출된 외인이 FA 풀로 새는 것"을 막았는데, 그 수정으로 외인 방출 = **리그에서 완전 소멸**이 확정됐다. 그러나 **방출 자체를 막지 않아** 외인을 방출하면 공석만 남는 상위 버그가 남아 있었다.

| 항목 | 내용 |
|---|---|
| **버그** | `app/contracts.tsx`가 외인·아시아쿼터를 국내 선수처럼 **방출·재계약·"FA 예정"** 에 노출. `store.release`에 `isForeign` 차단 없어 외인 방출 시 — §3.8 가드로 FA 풀에도 안 가 — **그 자리가 시즌 1회 교체 외엔 못 메우는 공석**(OP 통째로 비는 시즌). |
| **도달성** | 정상 UX — 계약관리 화면에서 외인 행 눌러 "방출"이면 즉시. `willBeFA`(faMarket:58)에 `!isForeign`이 없어 외인이 "FA 예정" 잔류/포기에도 잘못 노출. `reSign`도 외인 차단 없이 override 생성 가능(잘못된 경로). |
| **근본수정** | 계약 관리 = **국내 전용**. `store.release`/`reSign` 외인 거부(엔진 가드), `willBeFA`에 `!isForeign`, `app/contracts.tsx`는 외인을 **읽기전용 "외국인 선수" 섹션**으로 분리(관리는 트라이아웃/교체로 안내). |
| **형제(동시 수정)** | 같은 뿌리("계약관리가 외인을 국내 취급")의 3갈래를 한 번에: release(공석)·reSign(잘못된 override)·willBeFA(FA예정 오노출). 아시아쿼터는 `isForeign=true`라 같은 가드가 커버(release 가드 1줄이 외인+아시아 동시 차단 — A/B 실증). |
| **가드** | `tools/_dv_foreign_contract.ts`(exit 0/1) — release(외인/아시아) 거부·release(국내) 허용 대조군·reSign(외인) override 미생성·willBeFA(외인) false + A/B(가드 제거 시 release(외인)=true FAIL 실증). |

> 사각(왜 §3.8서 못 잡았나): §3.8은 **결과(FA 풀 오염)** 만 보고 다운스트림(셀렉터)에서 막았다. **행동(방출) 자체가 도메인 위반**(외인은 국내 방출 대상이 아님)인지를 업스트림(release 진입·UI)에서 묻는 렌즈가 없었다. TEST_METHODOLOGY §4 "다운스트림 증상만 봉합" 참조.

---
| **부수 발견(허위 오라클)** | `tools/simForeign.ts`의 "FA 풀 외인 오염 0건"은 **루프 본문이 비어** `faPoolForeign`이 한 번도 증가 안 함(pass 조건에도 없음) → **공허하게 0 보고하던 죽은 오라클**. 그 계층(오프시즌)은 이 인시즌 불변식을 못 본다. 미측정 명시 + 전용 가드로 이관(죽은 카운터 제거). |

> 사각(왜 못 잡았나): TEST_METHODOLOGY §4 "병렬 재구성 드리프트" + "죽은/공허 오라클" 2행 참조. 같은 논리 집합(FA 풀)을 **두 함수가 따로 재구성**(authoritative forward-pass vs on-demand selector)했는데 **둘을 대조하는 검사가 없었고**, 명목상 가드는 빈 루프(공허)였다.

---

## 3.10 리뷰 라운드 신규 기능 — 정상+엣지 케이스 등록 (2026-06-25)

> 선수관리 리뷰에서 도출한 7개 기능을 구현하며 각각 **경계/엣지를 가드로 박았다**(개별 A/B). 여기서 케이스로 등록.
> 형식: 기능 · 정상(골든) · 엣지/경계(가드가 막는 것) · 잡는 도구.

| 기능 | 정상 | 엣지/경계(가드) | 잡는 도구 |
|---|---|---|---|
| **AI 드래프트 3티어** | 특급 BPA→필요→OVR+성격, 위시 우선 | 특급 컷 포화(maxPot 71%→prospectValue 상위~10%로 교정)·티어 발화·사유 정확·결정론 | `_ev_draftpick`(통제 [super,need,need,best]·불변식 I1~4=0·성격 A/B) |
| **AI 재계약 확률** | OVR·나이 연속, 순잔류~58% | 절벽 0%(33-34·OVR<70)→그라데이션·단조(OVR↑·나이↓)·엘리트 유지·과이탈/고착 차단 | `_ev_airetain`(구 이진 A/B·나이/OVR 구간 잔류율) |
| **재계약 협상 3택** | 표준/후하게/짧게 | 후하게≥표준≥짧게·후하게≥시장가·개인상한 클램프·**나이항**(노장 후하게도 2년) | `_ev_resign`(어림5>노장2·캡내) |
| **면담 공약 파기** | 주전약속 지키면 거부0 | 주전약속+벤치=거부 급등(0.95)·카드 특정(전력보강+벤치≠파기)·이행<파기 | `_ev_promise`(4시나리오 A/B) |
| **타팀 이적/방출 뉴스** | 내 팀 항상+타팀 거물 | 거물 게이트(타팀 OVR≥71)·구세이브 무게이트 로그 범람 차단(렌더 ovr 게이트)·이동시점 OVR 고정·매달린참조0·중복0 | `_ev_transfernews`(15시즌·구세이브 엣지) |
| **계약관리 외인 차단** | 국내만 방출·재계약·FA예정 | 외인/아시아 release·reSign 거부(공석 방지)·willBeFA 외인 false·아시아=isForeign 커버 | `_dv_foreign_contract`(가드 제거 시 release(외인)=true A/B) |
| **시즌 길이 단일상수** | `SEASON_DAYS` 한 곳 | 6곳 손복제 통합·실제 일정(max dayIndex 164)과 일치 대조 | `_dv_seasondays` |

> **적대 퍼징 견고성(2026-06-25)**: 위 store 게이트(외인 release/reSign·signInSeason·replaceForeign·endSeason)를
> `_gt_monkey` **6시드(1·2·7·13·42·99)×3000~4000스텝**(full+clean) + `_gt_adversarial` + `_gt_seqbreak`로 난사 →
> **크래시 0·불변식 위반 0**(한 사람=한 팀·정원·캡·자금·결정론 전부 유지). 새 게이트가 적대 시퀀스에도 안전.

---

## 3.11 인간관계망 + FA 점수→확률 — 정상+엣지 케이스 (2026-06-26 신설)

> RELATIONSHIP_SYSTEM(Phase 1a~4) + FA_SYSTEM §2.7 구현·검증 중 도출. 형식: 기능 · 정상 · 엣지/경계(가드) · 잡는 도구.

| 기능 | 정상 | 엣지/경계(가드) | 잡는 도구 |
|---|---|---|---|
| **affinity 모델** | innate 중립~60%·친구/라이벌 소수·같은팀 bond↑ | **대칭**(A,B==B,A)·결정론·범위[−1,1]·**외인 0**·posRivalry 같은포지션만 −·bond가 라이벌 완화 | `_dv_relations`(분포·대칭·외인0·bond단조·A/B) |
| **영속 bond** | 같은 팀 누적→0.3·떨어지면 옛정 감쇠 | **맵 바운드 ≤4000**(100시즌+ 저장폭주 0)·prune<0.02·외인 쌍 미생성·손상세이브 정규화(rec) | `_dv_relations`(누적·바운드)·`_dv_migrate`(bonds drift·키일치)·`_dv_migrate_e2e` |
| **FA 점수→확률** | offerScore±관계→S곡선→정렬·롤·fallback | **단일소속 보존**(순차+슬롯차감, 이중계약0)·캡·자금 게이트·1팀=자동·결정론(시드 롤) | `simAudit`(13체크 0)·`simFaDup`·`_dv_fa_relations`(4시나리오·S곡선·SIT) |
| **4시나리오 트레이드오프** | relT ± 가중합 | 우승파=싫어도 강행·의리파=앙숙 회피·연봉 양보+친구·우승+친구 동반 | `_dv_fa_relations`(성향별 점수 플립 A/B) |
| **재계약 관계** | 친한 동료 방출→그 친구 거부↑ | uniform unrest 위에 가산(친구는 초과)·내 팀 한정(parity 무관)·미리보기=결과. **방출은 만료자의 출전 역할도 바꾼다**(동포지션 밀린 만료자=주전 승격→출전불만 base 소멸): unrest 항은 늘 가산되나 total은 base 이동으로 내려갈 수 있음(0.5④=항 가산만 보장, total 단조 아님, EC-REL-04) | `_dv_release_unrest`(base불변=정확히+uCore·역할변동=floor≥uCore+rel·친구 초과)·`simMood` |
| **미리보기=결과** | setRelationContext 모듈 컨텍스트 | rehydrate+endSeason 동기·로컬 affinity(친구연쇄) preview==actual | `simAudit`(영입 일관)·결정론 |

### 발견·수정된 엣지(이번 세션 — 구현/검증 중)
| ID | 증상 → 원인 | 수정 | 잡는 도구 |
|---|---|---|---|
| EC-REL-01 | **친구 연쇄 장기 parity 집중** — 30시즌×8 관계 ON std 4.06 vs OFF 3.42·왕조 11. 친구가 컨텐더에 몰려 super-team(20×6 단기 측정엔 안 보임) | rel 가중 ~0.05→0.03·`REL_SCALE_FA` 3.5→6 → ON std **3.12**(OFF보다 낮음)·왕조 8·r −0.18 (e45b13b) | **`simLeague 30 8` A/B**(관계 격리 NO_REL 진단)·sim-league 스킬 |
| EC-REL-02 | **friendStay가 기준 refuse 음수화** → refuseProb는 양수만 저장 → 방출 델타 측정 교란(`_dv_release_unrest` FAIL) | friendStay 제거(친구 잔류는 Phase 2 FA 시장 relT가 처리) → friendLeave만 가산 (49f61a4) | `_dv_release_unrest`(델타 ≥uniform) |
| EC-REL-03 | `rollFAPref` 가중치 합 테스트 FAIL — rel 키 추가로 6개 정규화인데 테스트는 5개만 합산 | 테스트 합산에 `rel` 포함 (8a17887) | `faMarket.test`(합≈1) |
| EC-REL-04 | **가드 기대 모델 스테일 — 방출 전 refuse를 기준선으로 오용**(`_dv_release_unrest` FAIL: d4_5 핵심방출 후 0.127 < 0.638). 구모델 `B[id] ≥ A[id](방출前)+uCore`는 **base 불변**을 전제. 그러나 방출된 핵심(MB)과 **동포지션에서 밀려 벤치(outclassed→출전불만)였던 만료자**는 핵심이 빠지자 **주전 승격→출전불만 base 소멸**(discontentNow가 라커룸과 별개로 정당 반응). unrest(+uCore)를 받아도 사라진 base(0.51)를 못 되살려 total↓. **엔진 WAI**(0.5④=unrest 항 전원 가산만 보장, total 단조 미보장) — **가드 모델이 스테일**(성장C 앵커 수술 07-02·구성변화로 동포지션 승격 만료자가 표면화) | **엔진 무수정**. 가드 기대식 정정: 만료자를 방출前後 discontent 지문(topic·weight·playRatio)으로 **두 갈래** — base불변=`B==A+uCore+relTerm` 정확히 / 역할변동=`B≥uCore+relTerm`(방출후 base≥0 하한). 무명 게이트도 동일 스코핑. 발견·검증=Fable 5 / 진단·수정=Opus 에이전트 (2026-07-06, 미커밋) | `_dv_release_unrest`(base불변 정확·역할변동 floor·A/B 변이 민감도: unrest 제거 시 양 갈래 FAIL 확인) |

### 감시 대상(잠재 — verify-cases 후속)
- **시즌 아웃 → 로스터 구멍**: 최고 점수<`SIT_OUT`(0.14)면 미입단. `SIT_OUT` 낮아 드물지만, 약팀 다수 시즌아웃 누적 시 `ROSTER_MIN` 압박 가능 → `fillRosters`(신인)가 메움. 감시: `simAudit roster`(정원 하한)·SIT 빈도 측정 도구 필요.
- **bond 무저장 결정론**: bond는 endSeason 누적 저장값(파생 아님). in-process 다중 resetSave 재플레이 시 §3.6 resetSave 누수와 결합 가능성 — 미측정(제품 무영향, fresh 재시작).
- **AI 팀 재계약 관계 미반영**: buildOwnerFx는 내 팀만. AI 잔류(aiRetainProb)에 관계 미적용 — 의도(1차). FA 시장은 league-wide 적용됨.

---

## 3.12 헌액 번호·번호 계보 — 정상+엣지 케이스 (2026-06-27 신설)

> BROADCAST_SYSTEM §8 구현·검증 중 도출. `engine/jersey.ts`·`data/legends.ts`. **비소모**(영구결번 아님)·id시드
> 결정론·무저장·**가짜 인과 금지**('계승' 아니라 '같은 번호를 단 과거 레전드'). 형식: 기능 · 정상 · 엣지/경계(가드) · 잡는 도구.

| 기능 | 정상 | 엣지/경계(가드) | 잡는 도구 |
|---|---|---|---|
| **jerseyNumber(id)** | 1~99 고정·세이브/세션 무관 | 범위[1,99]·결정론·**버전 동결**(`JERSEY_SEED_VERSION=1` — 바꾸면 과거 세이브 번호 흔들림→버전↑+문서화)·메인 RNG 비소모(자체 시드)·균등분포 | `_dv_jersey`(범위·결정론·동결스냅샷·균등) |
| **numberLineage** | 같은 구단·같은 번호 과거 레전드 통산 내림차순 | 본인 제외·**타팀 제외**(teamId=마지막 소속)·비레전드 제외·**먼저 은퇴만**(`beforeSeason` — 미래 레전드 안 뜸)·가짜 인과 금지 | `_dv_jersey`(같은팀·먼저은퇴·내림차순·본인/타팀/비레전드 제외) |
| **비소모(충돌=WAI)** | 99개뿐이라 세월 쌓이면 같은 번호 다수 = 정상(배정·고갈 없음) | 충돌은 버그 아님·**초레전드 금색**(통산≥`SUPER_LEGEND_POINTS`=10000, 1000년+ '레전드' 의미 인플레 방지·표시 전용) | (표시 — 충돌 빈도 측정 불요) |

### 감시 대상(잠재 — verify-cases 후속)
- **~~번호 계보 무한 증가~~ → 측정·종결(WAI, 표시 캡 불요)**: `numberLineage`에 상한(`.slice`) 없으나 **실측 결과 길이가
  사실상 0~1**이라 위험 아님. `_dv_lineage.ts`로 실제 시즌 루프를 굴려 측정 — 60시즌: 은퇴 405·레전드 9(2.2%)·(팀·번호)
  최대 1·**계보 최대 0**; 300시즌(5×): 은퇴 2038·레전드 64·팀당 9.1·(팀·번호) 최대 2·**계보 최대 1**(64명 중 3명만 1).
  레전드 희귀(7500점)+99번호 균등분산 → 같은 번호 중복 거의 0(1000시즌 외삽 ~2). 결정론 확인(재실행 레전드 서명 동일).
  표시 캡 불필요. (N=60·300시즌, 엔진 4f2b0db, 2026-06-27 · `tools/_dv_lineage.ts`)
- **방출 다이얼로그 '각별한 동료' 경고**: `app/contracts.tsx doRelease`가 `teamRelations(...).friends`로 경고(Alert).
  헤드리스 가드 없음(UI Alert) — 데이터원(`teamRelations`/`topFriendOnTeam`)은 `_dv_releasenews`·`_dv_relations`로
  간접 검증되나 **다이얼로그 분기 자체는 미가드**. 감시: 데이터 계층(친구 유무→경고 표출 여부) 순수 가드 가능.
- **UI-6 로딩 연출**: `Skeleton`/`BrandLoading` Animated 루프 — 언마운트 cleanup(`loop.stop`), `variant` 폴백,
  퍼센트 폭. tsc+expo 번들로 **구조**는 검증, 시각/애니메이션은 실기 확인 영역(헤드리스 불가).

---

## 3.13 결정론 — in-process resetSave 재플레이 (engine-verify 스웜 발견, 2026-06-27 · 확인됨·근본원인 추적 필요·미수정)

> engine-verify 100세션 스웜에서 **lineup:결정론 세션 1개만** 잡은 HIGH 클래스. 2차 적대 검수로 **재현 확인**.

- **증상(재현)**: `_gt_determinism.ts` — 같은 시드로 **같은 프로세스 내 `resetSave` 2회** 후 `computeStandings(MAX)`가
  상이(t0 91pt↔83pt). 저장 store 서명(rosters/season/day/cash)은 동일, **standings 행만** 다름.
- **2차 검수 결론(추정 금지·확인)**:
  - 제품 **실세이브 경로(partialize+rehydrate)는 결정론적 ✓** — 셰이브/복원은 정상.
  - 세션 추정 "standings.ts 캐시"는 **근본원인 아님** — 캐시 키 `baseVersion():txVersion()`의 `_baseVersion`은 리셋마다
    증가(0 리셋 아님)라 매 run 재계산됨. 즉 캐시가 stale을 반환하는 게 아니라 **재계산 입력이 run간 달라짐** =
    in-process 모듈 상태 누수(§3.6 resetSave 누수 클래스). 후보: 진화선수/부상/컨텍스트 잔존.
  - **제품 영향 잠재**: 앱에서 재시작 없이 **"새 게임"이 같은 `resetSave` 경로**를 타므로, 직전 게임 모듈 상태가
    새 게임 standings에 새면 비정규 순위 가능 → 근본원인 규명+수정 필요(미수정).
- **가드 결함(동시 발견)**: `_gt_determinism`의 A/B 자가검증 `partialize rosters 누락 검출 = false`(true여야 신뢰) =
  **허위 오라클** — 가드가 깨진 partialize를 못 잡음. 가드 자신 수정 필요(STATS_PROTOCOL 0장).
- **다음**: ① resetSave가 리셋하는 모듈 상태 전수(standings cache·getEvolvedTeamPlayers·relation/owner/award/tx 컨텍스트·
  injury) A/B로 좁혀 누수원 격리 ② 누수원을 resetSave에서 리셋 ③ `_gt_determinism` A/B 이빨 복구.

---

## 3.14 외인/아시아 트라이아웃 풀 생성 무한루프 (edge-swarm 클러스터 A, 2026-06-27 · ✅ 수정)

> edge-swarm 100세션 발굴에서 **5세션 합의**(foreign:경계극단·장기누적·적대입력 ×2 + asian)로 떠오른 최고 합의 엣지. 2차 검수로 실측 확인 후 수정.

- **증상**: `data/tryout.ts` `generateForeignPool`/`generateAsianPool`의 바닥보장 루프 `while (overall(p) < domesticAvg[+2])
  p = lift(p,3)`가 **무캡**. `lift`는 키·체력을 안 올려(`LIFT_KEYS`만 96 클램프) overall에 **천장(~89~93)**이 존재 →
  `domesticAvg`가 천장 근처(실측 **≥87**)면 조건이 영원히 참 = **무한루프=앱 프리즈**.
- **2차 검수(실측)**: 외인 후보 200명 무한 lift 후 overall 천장 **89~93**. 정상 `domesticAvg~64`(+2=66 ≪ 89)는 ~3회로
  자연 종료(안전). 도달 경로: 장기 인플레(domesticAvg↑) 또는 **손상·도핑 세이브**(국내 전원 고OVR → domesticAvg≈90)로 확실.
- **수정**: best-effort 반복 캡 `for (let g=0; g<60 && cond; g++)`. **정상 동작 불변**(캡은 64에서 미발동), 천장 초과 시
  best-effort 풀로 종료(프리즈 차단). `tools/_dv_tryout_pool.ts`(정상 바닥 충족 + 고/극단 domesticAvg 종료 — 옛 무캡은 hang = A/B 이빨).

### edge-swarm 발굴 배치 요약 (2026-06-27 · 100세션 · 383엣지 → 신규 ~314 · 미검수 클러스터 = verify-cases 후속)
> 합의 높은 미수정 클러스터(2차 검수 일부만 — 나머지는 `verify-cases`가 도구화·확정):
- **[B] clinch 승수 vs 승점 불일치(2세션)**: `engine/clinch.ts`는 `t.wins`(승 수)로 PO 확정/탈락 판정하나 `data/standings.ts`는
  KOVO 승점(3-0/3-1=3·3-2=2·풀세트패=1)으로 정렬 → 헤더가 '확정/탈락 100% 신뢰'라 보장하나 듀스 잦은 시즌에 표시 rank와 모순 가능. **감시 — verify-cases 확정 필요**.
- **[C] 외인 은퇴 누수(1세션)**: `engine/retire.ts applyRetirements`가 isForeign 미제외(offseason.expel은 제외) → 노장 외인이
  국내 은퇴/HOF/코치 파이프라인에 샐 가능(FOREIGN_SYSTEM 7 위반). ~~**감시**~~ → **✅ 수정(2026-07-08, 은퇴 재정비)**: `applyRetirements`가
  외인을 은퇴 루프에서 제외(rng 미소비·로스터 유지 → 하류 `returningForeign` 분리). 정년 40 외인도 국내 은퇴자 목록 비포함. 가드 `tools/_dv_retire.ts` ③(외인 41세 제외·rng 미소비 국내 판정 불변).
- **[D] 손상세이브 NaN 내성**(potential/catTalent 결손·salary/bonds NaN, 다수 세션): sanitize가 값 검증 약함 → NaN 전파. **감시**.
- **[E] 가용<7(부상 cap3 + 스캔들 정지 무캡 겹침)**: §3.6/§3.12 기지 클래스 재확인(스웜이 독립 재발견 = 검출 신뢰).

---

## 3.15 FINANCE 2.0 모기업 기조 — edge-swarm 발견(2026-06-29, 108세션) · ✅ 수정

> 2026-06-29 전 시스템 edge-swarm(108세션)이 **신규 표면(FINANCE 2.0)** 에서 잡은 실버그 2종. 합의 매우 높음(10+ 세션이
> 같은 코드로 수렴). 직접 코드 대조(2차 검수)로 확인·근본수정·A/B 가드까지. 나머지(가용<7·NaN내성)는 §3.14[D][E] 기지 재확인.

| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-FN-01 | **모기업 기조 AI 입찰 preview≠result** — FA 센터 미리보기에선 전 구단 stance=normal(평범)으로 보이는데 endSeason 확정에선 실제 stance(aggressive/thrifty)로 입찰 → 미리보기와 결과가 다름(EC-FA-03 류 preview=result 위반). 매 오프시즌 체계적 발생 | `resolveFAMarket`가 `teamStanceOf(t, season-1)`(archive-only) 사용 → 프리뷰 시점 historyArchive에 막 끝난 시즌 S 엔트리가 아직 없어(endSeason @630 setSeasonHistory에서만 주입) `sponsorStanceOf`가 전원 normal. → **`upcomingStances`(라이브 병합 — `computeStandings`로 S를 덧대 archive S 유무 무관)** 로 교체(`offseason.ts:135`). 내 팀 보너스(Stage4)는 이미 `upcomingStanceOf` 라이브 병합이었음 — AI 입찰만 누락이었음(형제 정합) | **`_dv_stance_preview`**(archive S 유무만 바꿔 upcomingStances 동일=0·옛 teamStanceOf는 122 차이=오라클 이빨, 833 팀-시즌) |
| EC-FN-02 | **AI aggressive 오퍼 음수/0·MIN_SALARY 미만** — payroll[t]≥LEAGUE_CAP(보장계약 keep는 무캡 누적 EC-CA-03)인 aggressive AI팀이 입찰 시 `offer=min(asking×1.2, cap−payroll)`의 둘째 항이 ≤0 → 음수 오퍼 + ok게이트(`payroll+offer≤cap`)가 항상 true로 무력화(no-op) | `offseason.ts:172` clamp가 상한만 보고 하한 없음 → **`room>asking`일 때만 프리미엄**(room=cap−payroll), room≤asking이면 offer=asking으로 두고 ok게이트가 정상 차단(`offseason.ts:172`). 음수/0·sub-MIN 오퍼·게이트 no-op 동시 해소 | `_dv_fa_stance`(캡 불변 — domesticPayroll≤cap 위반0)·코드리뷰 |
| EC-FN-03 | **영입 FA 첫해 몸값 이중과금(payroll + faSpend)** — `store.endSeason`이 영입 FA(국내·외인 공통, prev≠my)의 첫 해 salary를 오프시즌 `faSpend`에 더해 현금 차감(@1133)하는데, **바로 다음 시즌 `myPayroll`(finalR 전원 salary @1021)이 같은 salary를 또 부과** → 첫해가 두 채널 이중 차감(N년 계약이면 총 salary×(N+1) = 배수 (N+1)/N). 실측(통제 프로브 `simFaDoubleCharge` 40시즌): 국내 1.536×·외인 1.889×, faSpend/payroll 채널 각각 100% 적중 → 둘 다 이중. 상시 발생(모든 영입) | `store.endSeason` faSpend 루프에서 `faSpend += snapshot[id].contract.salary` **완전 제거**(국내·외인 공통) → 몸값은 **myPayroll 단일 채널**, faSpend=보상금(compCash)만. offseasonSigns(업적 카운트)는 salary 가산과 분리해 유지. 재정 재보정: 이중과금 제거로 잔고↑·좌절↓(수정 후 base 243000 단일런 좌절 5→0%·잔고 19.1→25.7억) → **sponsorBase 243000→225000**(다중유니버스 100시즌×8 좌절 27%·보전 12%·잔고 17.5억·파산0 = 설계 밴드 복원, 아래 도구 개편). ※발견 경위: FA 첫해 몸값 흐름 코드추적 중 payroll·faSpend 두 채널 교차 발견. ※단일 궤적 카오스(cash→FA→성적 되먹임)로 base 비단조 — `simFinance` 다중유니버스 평균화로 재보정 | **`simBrokeSign`(재작성 — 설계 오라클: 오프시즌 차감=보상금만·몸값 0 + `INJECT_DOUBLE=1` A/B 자가검증)** · `simFaDoubleCharge`(배수 실측) · `simFinance`(다중유니버스 밴드) |

> **감시(verify-cases 인계)**: ① **draft/tryout 센터 preview≠result** — `app/draft.tsx`·`tryout.tsx`가 `buildDraftContext`에 raw `store.cash`를 넘기나 endSeason은 `walletCash`(정산+stance보너스) 사용(`app/fa.tsx`만 `projectSettledCash`로 정합). 내 팀 현금게이트 FA가 프리뷰≠결과 가능(스웜 #9·#10, 코드 확인 — 도구화 대기). ② 가용<7(§3.14[E])는 여전히 미수정 감시(시즌층 의존, 스캔들 정지 무캡).

> 발견 방법(왜 직전 검증이 못 잡았나): FINANCE 2.0(2026-06-29)은 **직전 edge-swarm(2026-06-27) 이후 추가된 표면**이라 미발굴 영역이었다. 또 stance 도출이 **두 경로(내 팀 보너스=라이브 병합 ✓ / AI 입찰=archive-only ✗)로 갈려** 한쪽만 고쳐진 "형제 비대칭"(TEST_METHODOLOGY §4 병렬 재구성). preview=result는 단일 시점 시뮬론 안 보이고 **프리뷰 시점 vs endSeason 시점의 archive 상태차**를 대조해야 보임.

---

## 3.16 edge-swarm 2차 검수 신규 감시 (2026-06-29, 108세션) — codeBasis 확인·실측 verify-cases 인계

> 108세션 스웜 후보(542) 2차 검수: 신규 실버그 2종은 §3.15(수정 완료). 아래는 **codeBasis는 코드에서 직접 확인**했으나
> *실제 파괴 여부·의도성*은 미확인 → **감시 대상 등록**(추정 금지 — 버그 단정 아님, verify-cases가 A/B로 확인). 나머지 대량 후보는
> 기지 클래스(§3.6/§3.14[E] 가용<7·[D] NaN내성)의 독립 재확인(검출 신뢰) 또는 WAI.

| ID | 의심 | codeBasis(확인됨) | 상태 |
|---|---|---|---|
| EC-SE-01 | **관전 우승/순위 ≠ archive** — endSeason이 `commitRosters(finalR)`(시즌중 거래 반영) **후** buildPlayoffs·computeStandings를 돌려, 유저가 관전(app/playoffs.tsx, commit 전)한 우승팀과 archive 우승팀이 시즌중 거래 시 갈릴 수 있음 | `store/useGameStore.ts:611` commitRosters → `:617` buildPlayoffs(season) → `:620` computeStandings(MAX) 순서(거래 후 로스터로 재계산) | 📋 감시 — verify-cases가 거래 유발 시즌서 관전챔프==archive챔프 실측(시즌중 거래 0이면 무영향) |
| EC-RY-01 | **edge(실력 배수) 비대칭** — 플옵 상위시드 edge(1.03)가 서브·리시브·공격엔 곱해지나 **블록·디그엔 미적용** → 상위시드가 수비할 땐 부스트 없음(균일 팀 배수 의도와 다를 수 있음) | `engine/rally.ts:348`(svPow eg)·`:349`(recvSkill eg)·`:517`(attackPower eg) **vs** `:221`blockEval·`:538`digStr(eg 없음) | 📋 감시 — 의도 확인(설계) + parity 영향 실측 |
| EC-CN-01 | **GAME_INTERVAL 상수 손복제** — `engine/season.ts:7`과 `data/dynamics.ts:18`에 `=4` 독립 사본(+owner.ts 주석) → 한쪽만 바꾸면 일정↔부상/사고 일수 환산 드리프트(SEASON_DAYS 손복제와 동류, `_dv_seasondays` 선례) | `season.ts:7`·`dynamics.ts:18` 두 지역 const = 4 | 📋 감시 — verify-cases가 두 상수 일치 가드(또는 calendar.ts 단일화) |
| (note) cap-hop 무귀속 | 랠리 8-hop 상한 강제종결(`how:'cap'`)은 점수만 나고 **박스 미귀속** → 팀 득점 합 > 선수 박스 합(드묾 ~0.1%) | `engine/rally.ts:624` 주석에 "박스 미귀속(특정 공격수 없음)" 명시 | ✅ **WAI**(의도적·loud) — `_ev_box_audit` 밴드 내. 인지용 기록 |
| EC-ACH-01 | **통산 업적 시즌 중 안 열림**(첫 득점·첫 승 — 문의 12e03390, 실기기+스냅샷) — `careerTotals`가 `endSeason`에서만 누적 → 시즌 중 0 → `evalAchievements`가 통산 업적 잠금 | 평가 시 `data/careerTotals.achTotals(저장 + 이번 시즌 진행분)`(진행분=endSeason 동일 공식, cutoff=playedThroughDay). 적용: `achievements.tsx`·`claimAchDiamonds`·`mypage` 버튼. rehydrate 시드는 stored만(과잉 pre-claim 방지) | `_gt_achmid`(3경기 A/B/C) + `_gt_achedge`(EC1 0경기 항등·EC2 가법성·EC3 임계 크로싱 876+124=1000→points_1k) + **에뮬 실화면 e2e**(경기→5/86→수령→prod 원장 ref 5건→대시보드 6.7%) |
| EC-CAMP-01 | **오프시즌 게이트 상태** — 전지훈련 마쳐야 개막전 노출(전지↔다음경기 XOR). campDoneSeason 신설 필드가 새 시즌마다 리셋돼야(안 그러면 다음 시즌 게이트 안 열림) | `campDoneSeason`=완료 시즌번호(`finishCamp`가 `season` 세팅). offseason=`currentDay0 && campDoneSeason!==season` → **시즌번호 방식이라 새 시즌 자동 리셋**(별도 초기화 불요). SAVE §1 영속·migrate 기본 -1 | `_gt_achedge`(EC4 finishCamp 멱등·EC5 endSeason 후 campDoneSeason(옛)≠새시즌=게이트 재개) + 에뮬 실화면(전지훈련 하러가기→마치기→개막전 노출) |
| (note) BYE 부상일 | 7팀(홀수) 리그 `__BYE__` 라운드가 부상 day-range[from,to]에 끼면 missMatches(경기수)↔일수 매핑이 BYE 한 칸만큼 어긋날 수 있음 | `dynamics.ts:207-208`(고정 GAME_INTERVAL stride)·`season.ts` singleRoundRobin BYE | 📋 감시(저위험) — verify-cases 실측 |

> **기지 클래스 재확인(대량 — 신규 아님)**: `<6 가용 → buildLineup 선수 중복·리베로 six 침투`(§3.6·§3.14[E])를 rally/rotation/match/lineup
> **수십 세션이 독립 재발견**. 스웜이 보강한 사실: ① 도달 경로 = 부상(cap3) + **출장정지(scandal, 팀 동시 상한 없음 — 검증)** + 휴식(≤2)
> 가 ROSTER_MIN(10)에서 가용<6까지 깎을 수 있음(§3.6의 "부상≤3→≥7 보장"은 scandal+rest 미반영=불완전) ② 피해 = box 2배 귀속(통산/시상 오염)·
> 같은 선수가 블록+디그 동시·concurrent 부상 카운트 왜곡(S9). → §3.14[E] 감시 유지하되 **버그 단정 + 방어 가드/엔진 클램프는 verify-cases**(가용<6 시 중복 대신 명시 처리 — 설계 결정 필요).

---

## 3.17 서브 에이스 개인 기장 공식화 (indirect ace) — 사용자 실관전 발견 (2026-07-06) · ✅ 수정

> 발견=사용자 실관전(recvErr 서브[리시버 터치 후 컨트롤 실패로 데드]+노터치 ace 연속 → 스코어박스 에이스 1로 표시) · 도메인검증=Fable 5(FIVB/NCAA 공식 출처) · 수정·문서=Opus 에이전트.
> 트리플크라운 오정의와 같은 클래스([[verify-domain-definitions]]) — 표기/기장 분리 결정 시 공식 규정 미대조.

| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-STAT-01 | **서브 에이스 개인 기장 공식 위반** — recvErr(난조 리시브 직접 실점) 랠리에서 보드는 "서브 에이스"로 표기하나 서버 개인 박스엔 에이스가 안 붙음(`srvAtt`만) → 서브왕·통산·연봉이 공식보다 서버 에이스를 과소 계상. FIVB/NCAA 공식: 리시브 범실이 기장되면 서버에게 **자동 서비스 에이스**(indirect ace, 실전에서 더 흔함) | 06-19 "보드 표기=에이스·개인 기장=리시브범실만" 결정이 표기는 맞으나 기장이 공식 위반. → `engine/rally.ts` recvErr 반환 경로에 `bx?.(sp.id, l=>{l.srvAce++;})` 추가(리시버 `recvErr` 기장은 불변 — 공식도 둘 다 기록). **분포 이원화**: `stats.aces`는 how='ace'(노터치 direct)만 유지(KOVO 유형분포·튜닝 보존), box.srvAce는 공식 inclusive(direct+indirect). `ENGINE_VERSION 4`(production/서브왕/skServe XP 변동→캐시 무효, 승패·서브확률·밸런스·유형분포 불변) | `_ev_box`·`_ev_box_audit`(오라클 `srvAce==stats.aces+stats.recvErrs` + A/B `srvAce+1` 검출) · `_iv_scorebox`(팀합 오라클 how='ace'∪'recvErr') · `_dv_drift_kovo`(how='ace' direct로 분포 불변 확인) · `_ev_scorer`(recvErr byId 없음=종결자 규칙 불변) |

> 실측(N=4,000경기·15,635세트·2026-07-06): 서버 에이스 **+1.27/세트**(direct 2.11→inclusive box.srvAce 3.39 · 4.83%→7.74%/서브). KOVO 유형분포 불변(에이스 4.8% direct·상대범실 25.7%, `_dv_drift_kovo` N=3,000). `_dv_drift_posrate` OP 톱 baseline 4.3→4.5(A/B 동시드 지분 +0.12).
> 사각(왜 못 잡았나): 가드가 box==stats **자기정합**만 봐(srvAce==stats.aces 일치=PASS) 정의의 옳음은 안 물음 → TEST_METHODOLOGY §4 "도메인 정의 미검증 — 표기/기장 분리 결정" 행.

---

## 4. 회귀 프로토콜 (로직 수정 시)

영입/오프시즌 계열 엔진·셀렉터(`engine/compensation·faMarket·cap·draft·staff·staffLifecycle·foreign·transactions·finance`,
`data/offseason·draftSetup·dynamics·tryout·league·financeProjection`)를 고쳤다면:

1. **풀 배터리** (수정 후 처음부터 — `resetLeagueBase`):
   ```
   npx tsc --noEmit
   npm test                                 # 단위(현재 205)
   npx tsx tools/simAudit.ts 60             # 종합 13체크
   npx tsx tools/simFaDup.ts 100            # FA·보상 중복
   npx tsx tools/simStaffDup.ts 60          # 스태프 중복
   npx tsx tools/simMoneyOnly.ts 200        # '돈만' 보상
   # 리뷰 라운드 신규 기능 가드(2026-06-25 — §3.10):
   npx tsx tools/_ev_draftpick.ts ; npx tsx tools/_ev_airetain.ts 12 ; npx tsx tools/_ev_resign.ts
   npx tsx tools/_ev_promise.ts ; npx tsx tools/_ev_transfernews.ts 15 ; npx tsx tools/_dv_foreign_contract.ts ; npx tsx tools/_dv_seasondays.ts
   # 인간관계망 + FA 점수→확률 가드(2026-06-26 — §3.11):
   npx tsx tools/_dv_relations.ts ; npx tsx tools/_dv_fa_relations.ts ; npx tsx tools/_dv_release_unrest.ts 8
   npx tsx tools/_dv_migrate.ts ; npx tsx tools/_dv_migrate_e2e.ts   # 세이브 bonds 필드 drift·E2E
   npx tsx tools/simLeague.ts 30 8          # 장기 parity(EC-REL-01 — 친구연쇄 집중, 단기 측정 미검출)
   # 건드린 영역에 따라: simTxDup · simBrokeSign · simCareerTrace · simOwnerRefuse
   # 악질/원숭이(스토어·정원·이중소속 — 관리 로직 수정 시 필수):
   npx tsx tools/_gt_repro_release.ts       # EC-TX-03 (오라클 자가검증)
   npx tsx tools/_gt_repro_oversize.ts      # EC-RM-01
   npx tsx tools/_gt_monkey.ts 3000 12345         # 악질 난사(full)
   npx tsx tools/_gt_monkey.ts 3000 777 clean     # 정원·은퇴충원(clean)
   npx tsx tools/_gt_adversarial.ts ; npx tsx tools/_gt_seqbreak.ts ; npx tsx tools/_gt_determinism.ts
   ```
2. **위반이 나오면 도구를 느슨하게 풀지 않는다** — 엔진/셀렉터를 고친다(설계 불변식이 기준).
3. **새 버그를 찾으면**: ① 본 문서 §3에 EC 행 추가(증상·원인·수정·도구) → ② 그걸 잡는 감사/도구에
   상설 가드 추가(같은 클래스 재발 방지) → ③ 가능하면 옛 버그를 임시 재주입해 가드가 잡는지 확인 후 원복.
4. **표본 규약**(STATS_PROTOCOL): 분포·확률 결론은 N≥10,000. 불변식(위반 0/1) 검증은 시즌 수만 명기.
5. 풀 배터리 0건 → 커밋(`YYMMDD :: 한국어 요약`) → push. 문서 갱신을 코드보다 먼저(CLAUDE.md 11장).

---

## 5. 미해결·후속 감시 대상

- '돈만' 보상이 AI 구단 의사결정엔 미적용(플레이어 전용 레버) — AI도 쓰게 할지 후속.
- AI 팀 능동 스태프 교체(현재 기본 스태프 시즌 불변) — 도입 시 EC-CO 계열 재검증 필요.
- 외인 '돈만'/보상 상호작용 없음(외인은 보상 대상 제외라 무관) — 외인 규칙 변경 시 EC-FA-02 재확인.
- **[해결 → EC-CA-03] 생애주기 keep(자기 선수 유지) 팀 캡 소폭 초과** — 결정: **(A) 정상 인정**. 상세 §3.
- **[수정됨] simAudit 외국인 체크 stale 오라클** — `acquisitionAudit` foreign 체크가 아시아쿼터 도입 전
  기준(`isForeign>1`)이라 외인1+아시아1=2를 **위반으로 오판(560건 false positive)**. 진짜외인≤1 AND
  아시아≤1로 교정(`data/acquisitionAudit.ts:151·160`). 오라클은 false negative(허위 통과)뿐 아니라
  **false positive(허위 위반)** 도 stale될 수 있음 — 시스템 추가 시 옛 감사도 갱신할 것.
- **[구현(2026-06-22) · UI 개선 예정] 로딩 화면** — 데이터를 불러오거나 무겁게 생성하는 화면에 로딩 표시 추가.
  - **공통**: `components/Screen.tsx`에 재사용 `Loading`(스피너+안내문)과 `useDeferredReady()`(첫 프레임 로딩 →
    다음 인터랙션 틱에 본문 마운트, `team/[id]` 패턴 일반화) 추가. 동기 계산이라 "빠르면 안 보이게"가 RN에서
    불가하므로 **무거운 화면에만** 적용(가벼운 화면은 깜빡임 유발 → 제외).
  - **시작 복원 게이트**: `(tabs)/_layout.tsx`가 `hydrated` 전 빈 화면 → `Loading`(AsyncStorage 복원 = 유일한 진짜 비동기).
  - **무거운 생성/재계산 화면(7)**: news·history·records·draft·fa·tryout·asian-tryout — wrapper/inner 분리로
    무거운 셀렉터(buildNewsFeed·buildDraftContext·faMarketPreview·careerLeaderboard 등)를 ready 후에만 마운트.
  - **제외**: results·standings(단순 집계, 가벼움 — 깜빡임 방지), 메인 탭 index/squad/schedule/office(주 루프, 즉시감 우선).
  - **2차 개선(✅ 2026-06-27 — UI-6)**: ① **스켈레톤 레이아웃** — 콘텐츠 화면 8개(news·history·records·draft·draft-live·
    fa·tryout·asian-tryout)는 `<Loading variant="list">`로 카드 골격 시머(곧 올 내용 예고). ② **브랜드 연출** — 앱 복원
    게이트(`(tabs)/_layout`)·워밍 게이트(`team/[id]`·`staff`)는 `<Loading variant="brand">`로 워드마크 "배구명가"+SVG 코트에
    통통 튀는 공 모션. 공통 `Skeleton` 시머(Animated opacity 루프·`useNativeDriver`·새 의존성 0, Expo Go 안전). 게이트 로직 불변(표시만).
  - **개선 예정(후속)**: ③ 제외 화면 중 시즌 누적으로 무거워지면 재평가(records 외 results도 후보), ④ 지연 임계(아주 빠르면 스피너 생략) 검토.
- **[기존 문제 · 도구] `_gt_determinism` 자가검증 오라클 stale** — "partialize에서 `rosters` 누락을 검출하는가" A/B가
  `false`(검출 실패)라 `DETERMINISM+SAVE OK=false`. 원인: `rosters`는 리하이드레이트 때 base 스냅샷에서 재구성돼
  **세이브에서 빠져도 복원 상태가 동일** → 누락이 결정론 차이를 안 만든다(오라클이 검사 대상을 잘못 고름). 실제 결정론
  (`real partialize+rehydrate identical`)·`different seed differs`는 통과. **2026-06-22 G1/G2 수정과 무관**(stash A/B로
  확인 — 수정 전에도 동일 false). 후속: 오라클을 정말 결정론에 영향 주는 필드(예: `results`·`currentDay`) 누락으로 교체.
- **[✅ 구현(2026-06-22)] 선발 휴식 + 벤치 사유 심리** — **[ROTATION_MORALE](./ROTATION_MORALE_SYSTEM.md)** 전부 구현:
  ①벤치 사유 인지(부상/징계/구단주벤치/실력밀림/휴식) ②감정=f(사유,성격,주전 기대치) ③누적 부당벤치→재계약 거부→FA
  ④순위 기반 주전 휴식(#3, 로드매니지먼트). 결정론: 휴식은 forward-pass 밖 라인업 레이어, clinch는 day−1 results-파생
  (순환은 allResults 러닝 순위로 회피) → **관전==순위==생산 일치 검증 0 불일치**. 가드 `simMood`·`simStarters`(9/9)·`_ev_rest`.

---

## 6. 왜 이전 테스트가 못 잡았나 (사각 분석)

> 발견 **방법**의 표준은 [`TEST_METHODOLOGY`](./TEST_METHODOLOGY.md). 케이스(무엇)와 발견법(어떻게)은
> 분리. 아래는 §3 신규 버그가 **왜 기존 도구를 빠져나갔는지**.

- **EC-TX-03 (팬텀 방출)** — 사각: **계층 우회 + valid 편향**. `simTxDup`은 `Tx[]`를 직접 만들어
  replay층(`applyTx`)에 먹여 **사용자 진입점 `store.release()`를 우회**했고, 적대 케이스도
  **이중 영입뿐**(타팀 **방출**은 안 함). 그래서 release()의 소유권 미검증을 한 번도 안 건드림.
  → `_gt_monkey`(store 직접 구동 + 타팀 id 방출)가 노출.
- **EC-RM-01 (정원 19)** — 사각: **단일 국면**. `acquisitionAudit`의 `roster` 체크는 **오프시즌 흐름만**
  보고, **시즌 중 FA churn으로 명단이 18까지 차오른 상태 × 오프시즌 충원**의 교차를 안 봄.
  → 장기 원숭이(`_gt_monkey`·`_gt_repro_oversize`)가 churn 후 endSeason에서 노출.
- **EC-REL-01 (친구 연쇄 parity 집중)** — 사각: **짧은 측정 지평 + 격리 부재**. Phase 2 도입 때 `simLeague` **20시즌×6**로
  parity를 보고 2.77(기준 2.64 노이즈 내)로 "안전"이라 판단했으나, **친구 연쇄(친구가 컨텐더에 누적)는 누적 효과라
  30시즌+ 장기 지평에서만 드러난다**(20시즌엔 왕조가 짧아 은폐). 또 "관계가 원인인지"를 **격리 측정(NO_REL A/B)**
  하지 않아 prob 재설계 vs 관계의 기여를 못 갈랐다. → 사용자 "검증 들어가" 지시로 **30×8 + 관계 격리 A/B**
  (OFF 3.42 vs ON 4.06)를 돌려 관계가 +0.64·왕조 11임을 규명, 재튜닝(3.12). **교훈: 누적·스노볼형 변경은
  장기 지평(≥30시즌)에서 측정하고, 새 요인은 격리(on/off) A/B로 기여분을 분리한다**(STATS_PROTOCOL — 단일 측정
  말고 대조). TEST_METHODOLOGY §1.5 ④의미정합 + 장기 누적 사각.

**동종 버그 사냥 결과(sibling hunt)** — 렌즈 "store 액션이 입력을 검증 없이 변이":
- **id 멤버십**: `release()`가 유일한 예외(EC-TX-03, 수정). 나머지 id 받는 액션은 가드 보유 —
  `signInSeason`(FA풀 `availableFAsOnDay`)·`replaceForeign`/`replaceAsian`(altPool+subUsed)·`toggleProtect`(캡).
- **구조 입력(미퍼징)**: 렌즈를 "**몽키가 안 부르는 액션 + 구조 입력**"으로 넓히니 `reSign(Contract)`가
  걸림(EC-TX-04, 수정) — 몽키 액션셋에 reSign이 없어 미검사였고, 음수 연봉이 캡을 뚫었다. 나머지 액션은
  id/불리언만(토글은 해소 시점 검증) → 구조 입력은 reSign이 유일. **두 클래스 모두 잔존 0.**
- **교훈 1**: 사냥 렌즈를 "검증 없는 변이" 한 줄로만 보지 말고 **퍼저 커버리지 갭(미호출 액션)** 도 함께
  봐야 한다. 미퍼징 액션 = 사각. → `_gt_monkey` 액션셋에 `reSign`(적대 계약) **추가 완료**.
- **교훈 2 (좁은 테스트 < 넓은 퍼저)**: EC-TX-04 1차 수정은 `reSign` 음수만 막았고 좁은 repro
  (`_gt_resign`, 음수만)는 통과했다. 하지만 **reSign을 넣은 확장 몽키가 거대 양수 연봉**(개인 캡 초과)으로
  여전히 캡을 뚫는 걸 잡아, 수정이 불완전함을 드러냈다 → 캡 인지 게이트로 재수정. **타겟 repro는 내가 상상한
  공격만 검사한다 — 무작위 퍼저가 상상 못 한 변종을 친다.** 수정 후엔 좁은 repro뿐 아니라 넓은 퍼저도 돌릴 것.

### EC-FA-05 — FA 보호선수 명단에 외국인 노출(2026-07-01, 실기기 사용자 보고)
- **증상**: FA 보호선수 명단(`app/fa.tsx`)에 **외국인이 섞여 나와** 토글해도 "보호"가 안 됐다(클릭 무반응처럼 보임).
- **원인**: 명단을 `myRoster.map`으로 그렸는데 `myRoster`(=`pv.myRoster`)에 외인이 포함. 외인은 **1년 계약이라 보상선수
  대상이 아님**(보호 개념 자체가 없음) → 토글이 무의미.
- **수정**: 보호 명단 렌더를 `myRoster.filter((p) => !p.isForeign)`로 거름(안내 문구도 "외국인 제외" 추가).
- **사각(왜 못 잡았나)**: 보호 로직(`pickCompensation`)은 외인을 이미 보상 대상에서 제외하므로 *경제 불변식*은
  안 깨졌고, 헤드리스 감사는 결과 정합만 봐서 **UI 명단에 무의미 항목이 떠도 통과**했다 = "표시 목록 ↔ 동작 대상" 대조 사각.
- **형제 점검**: 같은 "외인이 국내 전용 목록에 섞이나" 렌즈로 — FA 시장 풀(외인 별도 트라이아웃이라 풀 미포함, OK)·
  재계약 목록(만료 국내만, OK). 캡 합산은 이미 `!isForeign`만(EC-CAP-01). → 보호 명단이 유일 누락이었음.
