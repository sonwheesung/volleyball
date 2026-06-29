# 구단 재정 (Finance) — 설계 문서

> **구현 현황(2026-06-11)**: ✅ `engine/finance.ts` + store(cash/lastFinance, endSeason 정산,
> FA·시즌중 영입 자금 게이트) + UI(대시보드 재정 카드, FA 화면 자금 표시).
> 설계 추가 결정: **운영 고정비 8억**(없으면 잔고 무한 누적 — 시뮬이 잡음) +
> **모기업 긴축**(잔고 15억↑ 85%, 50억↑ 70% 지원 — 모기업은 메꿔주는 기관이지 쌓아주는
> 기관이 아니다). 기존 fanBudgetFactor(팬심→예산 계수)는 이 시스템이 대체.
> 검증: `tools/simFinance.ts` 120시즌 — ~~잔고 평균 8.0억·보전 9회(8%)·좌절 21/96(엔진 HEAD·2026-06-27)~~ ⟨옛 체력 기준, v2서 무효⟩.
> **현행(2026-06-28 v2 체력, FINANCE 2.0 Stage1)**: 잔고 **9.1억**·보전 **8%**·좌절 **28/105**(성사 59)·✅ 건강.
> **모기업 베이스 22~30→25~33억(+3억, 06-27) → 24.3~32.3억(base 250000→243000, 06-28)** — 회귀 수정 + v2 재조율:
> > ⚠ **재정 회귀였다가 수정(2026-06-27, 문서-코드 일관성 검사 발견)**: 구단 정체성(06-18)+성장/노쇠 변경으로 payroll
> > 인플레 누적 → 평균 net −2.87억/시즌(만성 적자) → ~~잔고 1.6억·보전 50%·FA 성사 25/96·"❌ 튜닝 필요"~~. sponsorBase
> > +3억으로 net 회복 → 위 건강 수치. (~~9.9억·19%, 엔진 49ccb61·2026-06-14~~는 stale·무효 — STATS_PROTOCOL.)

> 2026-06-11 설계. 지금까지 돈은 샐러리캡(전 구단 공통 35억) 하나였다. 이 시스템은
> **구단주의 지갑**을 만든다 — 모기업이 주고, 관중이 벌어주고, 스타가 팔아주는 돈.
> 핵심 연출: **"캡은 남는데 운영 자금이 없어서 못 뽑는다."**

---

## FINANCE 2.0 — "AI FA 판도 + 리그 서사" (2026-06-28 설계 확정, 구현 중)

> **재프레이밍(검증 수렴, 1·2차 독립리뷰 + 100에이전트 코드대조 — 구조적 blocker 0)**: 모기업 기조(`sponsorStance`)는
> "내 팀이 지른다"가 아니라 **AI FA 시장을 살아 움직이게 + 리그 서사**가 본체. ~~"모기업이 캐시 +15억 주입(농심式)"~~
> 폐기 — V리그는 **샐러리캡이 있어** 모기업 빈부차를 평탄화한다. 현실의 "큰손"은 캡 초과 현금이 아니라 *캡 풀가동 + 마퀴 FA*다.

### 동기
- 직전 +3억(아래 헤더) 후 자금 과잉 → "캡OK·현금부족" 좌절 0회 → 재정 레이어 장식화(simFinance ❌). FINANCE 2.0이 재조율.

### 설계 (확정)
- **sponsorStance**(전 구단, 매 오프시즌): `{thrifty, normal, aggressive}`. **시드 + 관측 성적신호만**(직전순위·우승·다년추세 — archive/standings로 전 팀 재계산, 대칭·무저장). cash/적자 이력 **안 씀**.
  - 트리거: aggressive=① 상위권 한끗부족 ② **장기무관 가뭄끝(약팀, 동등비중)** ③ 저확률 새스폰서 / thrifty=저확률 시드사건(성적약함 금지=데스스파이럴 회피) / normal=다수. 빈도 aggressive 팀당 ~12~15시즌, **1회성**(다음시즌 normal).
  - 용어: `sponsorStance`(선수 `mood`/morale과 구분). 뉴스 kind 신규 `sponsor`.
- **AI 효과(binding, 본체)**: stance → AI 입찰 공격성 — aggressive=offer 배수 + 타겟 +1, **단 캡 천장 안 clamp**. thrifty=관망. → 지금은 AI 입찰 강약이 0(다 같은 호가)이라 시장이 죽어있음 → 이걸로 시장이 살아남(판 출렁, 거물 행선지 변동).
- **내 팀 효과(advisory, 강제 금지)**: 외인 프리미엄 **폐기**. aggressive=**소폭 1회성 현금 보너스**(시드+성적 도출=안티과금[구매불가]·결정론). thrifty=**분위기/권고만**(지갑 사용 강제 차단 금지 — "재정=구단주 직접" 권한표). 기존 `faAggressive` 토글 유지, stance는 곱수 중복 금지.
- **뉴스(예고, 소문 톤)**: "OO 큰손 등판 — 거물 노린다" / "OO 긴축 — FA 관망". *의도*라 불발 가능(스포츠 현실). 예고·결과 둘 다 실제 stance 셀렉터 파생(가짜드라마 0).

### 착수 전 확정 결정 (100에이전트 검증 — clamp/주입/분리)
1. **캡 게이트 = clamp, drop 아님**: `offer = min(round100(asking×배수), LEAGUE_CAP − payroll[t])`. (단순 ×배수면 캡 근접 공격팀이 입찰 탈락해 거물을 *덜* 잡는 역설 — offseason.ts:155/157/158.)
2. **stance는 resolveFAMarket 내부에서 단일 도출** → 호출부 2곳(offseason.ts:373 resolvePreDraft·:427 faMarketPreview)에 동일 적용 → **preview=result** 보존. 내 팀 현금보너스도 endSeason cash(useGameStore:826) + 미리보기 projectSettledCash 양쪽.
   > ⚠ **수정(2026-06-29, Stage3 착수 grounding)**: ~~"teamPrestige 패턴(season+committed standings)으로 도출"~~ — **불가**(검증). `teamPrestige`·`buildPlayoffs(season)`은 *현재* 누적 standings(`computeStandings(MAX)`)만 읽고 `season`은 플옵 RNG 시드일 뿐 → **과거 시즌 우승팀(가뭄 트리거의 다년 이력)에 데이터 계층 접근 불가**. 과거 우승은 `archive`(store)/`simArchive`(sim)에만 있다. → **대안 채택**: `setAwardScores`/`awardScoreOf` 컨텍스트 주입 패턴을 그대로 미러 — 새 `data/leagueHistory.ts`(`setSeasonHistory(archive)`·`teamStanceOf(teamId,season)`·`setStanceEnabled` parity 토글). 스토어가 archive 변화 시(248/627/866/953=setAwardScores 동일 지점) 주입, simLeague도 `setSeasonHistory(simArchive)`. `sponsorStanceOf(teamId,season,archive)`는 **순수 유지**(Stage2a 가드 `.length===3` 보존), archive는 컨텍스트가 공급. **파라미터 스레딩 0**(11개 호출부 시그니처 무변경).
3. **bidGap(참가) vs posGap(점수) 분리**: 타겟+1을 참가 게이트(:154)에만 적용, offerScore.posGap(:162)엔 안 흘림(playT 0.15→0.65 오인 방지).
4. stance는 **별도 RNG 시드**(공유 :128 스트림 소비 금지 — 기존 FA 회귀 baseline 보존). 엔진버전 게이트 권장.

### 검증 가드 (커밋 전 전부 0)
- 재정 건강(simFinance): ~~현금부족 좌절 8~15%~~ → **옛 검증 healthy 수준 복원**(좌절 ~20-27%·보전 ~8%·잔고 ~9억·파산0). 단일유니버스라 좌절% 노이즈 큼(243k=27%·244k=33%·246k=17% 비단조) — 밴드로 판정. 주 압박은 캡, 현금은 그 위 + stance 변동.
- ✅ **parity(simLeague 40×16 stance on/off A/B, 2026-06-29)**: 전 지표 노이즈 밴드 내 동일 — parityStd off 4.01±1.32 vs on 4.19±0.92 · 최장왕조 6.0/5.9(둘 다 max12) · 지속성 r 0.19/0.17 · 1위점유 32%/33% · 약팀반등 100%/100%. **부익부 재점화 없음** → 폴백(트리거①폐기/배수↓) 불필요. (G-2: simArchive championId/standings 누적 완료.) 재확인: `STANCE_OFF=1` vs 기본.
- **레버 효과 A/B(B4)**: aggressive vs normal 동일시드 — AI 거물 행선지 Δ(×배수·타겟+1 **분리 측정**) + 내 팀 보너스 Δ. Δ≈0=장식.
- **권한 무영향**: thrifty 시 내 팀 cashLeft Δ=0.
- **캡 불변**: 어떤 stance도 payroll+offer≤LEAGUE_CAP 위반 0. **stance 대칭**: 같은 시드, 같은 팀이 내팀/AI 동일.
- **외인-공석 A/B**: 현금보너스↔외인 게이트(tryout 41000/25000) 상호작용 실측("0 가정" 금지).
- **1만시즌 인플레0**: 잔고/페이롤/FA호가 + assignFAGrades 래칫.

### 단계
0. ✅ **진단 완료(2026-06-28)**: 드리프트 원인=**체력 튜닝(ENGINE_VERSION 2)**. A/B 입증 — 옛 체력 잔고 8.0억(보전8%·좌절21/96) vs v2 18.8억(보전0·좌절0), 차이는 체력뿐. v2서 내 팀 성적↑→수입↑.
1. ✅ **L1 baseline 완료(2026-06-28)**: sponsorBase 250000→**243000**(24.3~32.3억) → v2 잔고 9.1억·보전8%·좌절28/105·✅ 건강(옛 healthy 복원). finance.test 단언·문서 동기.
2. ✅ **2a 완료(2026-06-28)**: `engine/sponsorStance.ts`(순수 도출, 별도 RNG) + 가드 `_dv_sponsorstance.ts` 8/8.
   ✅ **2b 완료(2026-06-29) — 뉴스 예고**: `data/news.ts` 새 kind `sponsor`(소문 톤·불발 가능) — 막 끝난 시즌 기준 다가오는
   오프시즌 FA 기류를 `sponsorStanceOf` 순수 파생(새 저장 0·가짜 드라마 0). aggressive="큰손 등판 — 거물 노린다"(내 팀 ★),
   thrifty="긴축 — 관망". 최신 시즌만(예고는 미래형). UI kind 맵(KIND_KO·LEAD) 보강. 검증 `simNews`(톤 일치·최신시즌만·건수 정합·무결성 0).
3. ✅ **AI 입찰 공격성 완료(2026-06-29)**: 컨텍스트 주입(`data/leagueHistory.ts` — 결정#2 수정 참조) → resolveFAMarket AI 봇 stance별:
   - aggressive=참가게이트 타겟+1(gap===0도 입찰=depth) + offer `min(round100(asking×AI_AGGRESSIVE_MULT 1.2), LEAGUE_CAP−payroll[t])` **clamp** / thrifty=관망(gap≥2 뚜렷한 구멍만) / normal=기존(gap>0·offer=asking).
   - posGap 점수엔 실제 gap 유지(bidGap/posGap 분리). G-2: simLeague `simArchive`에 championId+standings 누적 + `setSeasonHistory`.
   - 가드 `_dv_fa_stance.ts` ✅ 5/5(120오프시즌): 레버 Δ267(68/120)·캡위반0·방향성 aggr0.81>norm0.60>thr0.21·결정론0·양stance발화. 무회귀 확인(_gt_facontract 15/15·simFaDup·simAudit·foreign-leak·유닛 205/205).
4. ✅ **완료(2026-06-29) — 내 팀 소폭 현금보너스**: `stanceCashBonus`(engine/finance) — aggressive 시 **1회성 +3억**(STANCE_AGGR_BONUS 30000,
   소폭·시드+성적 도출=구매불가 안티과금·결정론), thrifty/normal=0(**강제 차단 안 함** — 권한표). FA 지갑에 가산: endSeason `walletCash`
   + 미리보기 `projectSettledCash` 양쪽 동일 도출(`upcomingStanceOf` — 막 끝난 시즌을 라이브 셀렉터로 덧대 **preview=result**).
   가드 `_dv_stance_bonus.ts` ✅ 7/7(448 팀-평가): Δ==stanceCashBonus 정합·권한 무영향(thr/norm Δ0)·결정론·세 stance 관측.
5. ✅ **완료(2026-06-29) — 가드 일괄**: parity A/B(3 §parity ✅)·레버효과(_dv_fa_stance AI + _dv_stance_bonus 내 팀)·권한 무영향(_dv_stance_bonus)·
   캡 불변(_dv_fa_stance)·재정 건강 무회귀(simFinance 9.1억·8%·좌절28/105 그대로)·무회귀(유닛 205/205·josa·transfernews·foreign·audit·brokeSign·txDup 전부 0).
   인플레0: parity 40×16·simFinance 120 잔고 범위 0~54.8억 유계(런어웨이 0). **FINANCE 2.0 완성.**
> 각 단계 검증 통과분만 커밋, 미통과분 되돌림(추정 금지).

---

## 0. 철학 — 팬은 남고, 직관이 줄어든다

성적이 나빠도 팬덤(사람)은 잘 안 떠난다(OWNER 4.5 — 팬심이 천천히 움직임).
대신 **경기장에 오는 발길이 끊긴다.** 직관율이 성적에 민감하게 반응해 관중 수입이
먼저 마른다 — 팬은 그대로인데 지갑이 마르는 구단, 현실 그대로.

## 1. 수입 3원 (시즌 정산, 단위: 만원)

| 수입원 | 공식(placeholder) | 규모 | 성격 |
|---|---|---|---|
| **모기업 지원금** | 팀별 베이스 ~~22~30억~~ **24.3~32.3억**(시드 결정론 — 모기업 크기가 다르다. base 243000, FINANCE 2.0 Stage1) | 수입의 ~60% | 안정 기반 |
| **성적 보너스** | 베이스 × (0.2×정규순위 비례 + 우승 0.15 / 준우승 0.08) | 0~9억 | "정규 2위에 플옵 준우승이라 모기업이 더 쏜다" |
| **관중 수입** | 직관율 = 0.05 + 0.07×승률 + 0.03×팬심/100 (clamp 4~16%) → 관중/경기 = 팬덤×직관율 → ×홈 18경기 ×1만원 | 4.5~13억 | **성적 민감** — 꼴찌 시즌엔 반토막 |
| **굿즈(유니폼)** | 선수팬 총합(겹침 포함) × 0.25만원 | 1~3억 | 스타가 벌어준다 — 인기 선수의 재정 가치 |

## 2. 지출과 잔고

- 지출 = 선수 페이롤(25~33억) + 스태프 연봉.
- **운영 자금(cash)** = 이월 잔고 + 시즌 순익. 유일한 영구 저장값(나머지는 전부 파생).
- 적자로 잔고가 바닥나면 **모기업이 보전**(cash floor 0) — 파산은 없지만 뉴스에 나고
  그 시즌 영입 여력은 0이다.

## 3. 게이트 — 캡과 지갑은 다르다

- 영입(시즌 중 FA·오프시즌 FA 입찰)은 **캡 AND 운영 자금** 둘 다 통과해야 한다.
  자금 게이트 = 첫 해 연봉 ≤ 잔고(같은 오프시즌 다중 영입은 잔고를 차감하며 순차 판정).
- **내 팀만 적용.** AI 구단은 모기업 무한 보전(캡이 이미 AI를 제약 — AI 재정 시뮬은
  데스 스파이럴 위험 대비 가치가 낮다. 추후 난이도 옵션으로 개방 가능).
- 스태프 계약은 기존 budget 게이트 유지(추후 cash로 통합 검토).

## 4. 루프 (의도된 드라마)

성적↓ → 직관↓·보너스↓ → 잔고↓ → 캡이 남아도 영입 불가 → 리빌딩은 드래프트(공짜)로
→ 유망주 성장 → 성적↑ → 모기업 보너스 + 직관 회복 → 다시 지를 수 있다.
저점에서도 모기업 베이스(60%)와 보전이 받쳐주므로 **영구 침몰은 없다**(시뮬 검증 대상).

## 5. 검증 (simFinance — 120시즌)

- 잔고 궤적: 최저/최고/평균, 모기업 보전 발생 빈도(가끔이어야 — 매시즌이면 베이스 상향).
- **"캡 여유 있는데 자금 부족" 시즌 수** — 이 연출이 실제로 발생하는가(0이면 의미 없음, 절반이면 과함).
- 리그 건강: 내 팀 평균 순위·우승 분포 유지(재정이 내 팀만 제약하므로 parity 영향 미미 예상).

## 6. 코드 맵

- `engine/finance.ts` — 순수: sponsorBase/sponsorBonus/turnout/gate/merch/settleSeason + **`stanceCashBonus`**(FINANCE 2.0 Stage4 내 팀 1회성 보너스).
- `engine/sponsorStance.ts` — 모기업 기조 `sponsorStanceOf`(시드+성적, 순수, FINANCE 2.0 Stage2a).
- `data/leagueHistory.ts` — stance 컨텍스트 주입(`setSeasonHistory`·`teamStanceOf`·`upcomingStanceOf`·`setStanceEnabled`). setAwardScores 패턴 미러.
- `store` — `cash`+`lastFinance` 저장, endSeason 정산 + stance 보너스 walletCash → FA 게이트. setSeasonHistory 주입(248/627/866/953).
- `data/offseason.ts` — resolveFAMarket 내 팀 cash 게이트 + **AI 입찰 stance 공격성**(teamStanceOf, 캡 clamp). `data/news.ts` — `sponsor` 예고 뉴스.
- UI — 대시보드 재정 카드, FA 화면 "자금 부족" 표시.
