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
> **연동 스킬**: 문서 작성/갱신 = `analyze-cases`, 시뮬 검증/수정 = `verify-cases`.

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
| `tools/_dv_bench.ts`·`_dv_bench2.ts` | **독립 검증(2026-06-24 독립 세션)** — 문서서 불변식 9종 도출, A/B 자가검증 내장. _dv_bench2: EC-LU-02 옛버그(최강벤치) 재주입 88/88 검출·사유 우선순위. _dv_bench: 라인업·게이트·pickRest(리베로 휴식 0·≤2명, 무거움). 메인 _gt_bench가 허위 오라클 아님 교차확인 | 5·라인업 | `_dv_bench` 무거움(on-demand) |

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
| EC-CA-01 | 현금 없는데 국내 FA 영입됨 | 입찰 게이트가 캡만 봄 → `offer + compCost <= cashLeft` 추가 (`a91f967`) | audit `cash2` |
| EC-CA-02 | 외인 트라이아웃 + 국내 FA 합산이 정산현금 초과(각자 전액 게이팅 → 이중 사용) | `resolvePreDraft`/`faMarketPreview`가 `runTryout`·`resolveFAMarket`에 같은 `myCash` 전달 → 외인 incoming 비용을 국내 FA 지갑에서 차감(`cashAfterForeign`) | simBrokeSign |
| EC-CA-03 | 생애주기 keep(자기 선수 유지)로 팀 국내연봉이 캡 소폭 초과(대전 +1.5% @S6) — `buildOffseason` keep 경로(`offseason.ts:257`, 미만료 선수)는 캡 미게이트. **결정: (A) 정상 인정(WAI)** — 현실 배구도 자기 선수 유지는 캡 초과 허용, 트레이드 없는 게임서 미만료 강제 방출은 과함. 새 영입/재계약(만료자)은 게임이 `≤캡` 하드 게이트 유지. **감사 비최종 캡 임계 `×1.0→×1.05`**(>5%=진짜 새영입 버그는 계속 잡힘) (`acquisitionAudit.ts:167`, 2026-06-20) | audit `cap`(비최종 ×1.05) |

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

> EC-UI-01 발견 방법(왜 기존 테스트가 못 잡았나): 단위/시뮬은 **데이터층(production)** 만 검사 — 화면이 *자기 시뮬*을 돌리는 줄 몰랐다(계층 우회 §4 + reported-but-unwired §1.F). **문서-코드 drift 독립검증**(INJURY 0 "동일 availableTeamPlayers" 약속 ↔ matchresult 코드 대조)이 잡음.

### 선발·벤치(라인업)
| ID | 증상 | 근본 원인 → 수정 | 잡는 도구 |
|---|---|---|---|
| EC-LU-01 | **벤치 지시가 팀의 마지막 리베로까지 빼서 리베로 0으로 경기**(상대 리베로는 정상 출전 → 우리 팀만 리베로 없음). 프로팀이 리베로 없이 뛰는 비현실. 사용자 보고(2026-06-22) | `availableTeamPlayers`/forward-pass의 벤치 필터가 **총원 7인 가드만** 보고 포지션은 안 봄 → 리베로 전원 벤치 시 코트 리베로 null. → 공유 헬퍼 `applyBenchDirective`에 **마지막 리베로 보호**(리베로 벤치만 무효) 추가, 양 경로 공유로 결정론 유지 (`data/dynamics.ts`) | **`simStarters`** G1 (전 리베로 벤치 → 코트 리베로 존재, A/B FAIL→PASS) |
| EC-LU-02 | **선발 기용 건의(`suggestStart`) 수락 시 동포지션 '최강' 주전을 벤치**(에이스 강등). 주석은 "최약 주전"인데 코드가 정반대 → 백업 선발 건의가 에이스(90+)를 벤치로 | `suggestStart` 인컴번트 선택이 `sort((x,y)=>overall(y)-overall(x))[0]`(내림차순=최강). → 실제 경기 라인업(`buildLineup(availableTeamPlayers)`)의 동포지션 **최약 주전**을 벤치하도록 수정 (`store/useGameStore.ts`) | **`simStarters`** G2 (수락 시 벤치=최약 주전인지, A/B FAIL→PASS) |

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
| **OP 톱 득점 드리프트(형제 사냥)** | 문서+코드 | MB와 같은 클래스("§1.1 포지션 수치 box 미재측정")를 **형제 사냥**으로 추가 발견: 문서 "OP 톱 ~5.3점/세트" vs box 실측 **3.28**(legacy 3.96 — 둘 다 5.3 미달, 경로무관) | ⚠ **재측정 필요·미확정**(원인=stale인지 "톱" 정의(리그 최고 1인 vs 별개측정) 차이인지 불명). SALARY §1.1에 형제 표기. 세터어시(11.7)·리베로디그(4.55)는 일치라 측정 정합 — **이 둘이 OP/MB 드리프트가 진짜임을 보증하는 대조군** |
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
  - **개선 예정(후속)**: 현재 스피너+텍스트 1차 구현. ① 스켈레톤/플레이스홀더 레이아웃, ② 브랜드 연출(로고·코트 모션),
    ③ 제외 화면 중 시즌 누적으로 무거워지면 재평가(records 외 results도 후보), ④ 지연 임계(아주 빠르면 스피너 생략) 검토.
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
