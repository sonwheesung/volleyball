# 월드컵 참가 (World Cup) — 설계 문서 (유료 DLC)

> **★ 구현 현황(2026-06-29)**: 📋 **설계 완료 · 구현 추후(미착수)**. 100세션 재검증(판정 *holds-with-fixes*·성립 92%) +
> 현실 일정 출처 확인을 반영한 정본. 개발 착수 시 이 문서의 단계·통과조건을 코드가 구현한다.
> 핵심 교정: 이 기능은 "강화/밸런스"가 아니라 **발견·영입·역사**다([[evaluate-features-as-chronicle]]).

> 한 줄: **4년마다 비시즌에 국가대표 월드컵이 열리고, 차출 선수는 성장하며, 거기서 빛난 선수는 다음 FA의 표적이 된다.**
> 유료 DLC(비소모 1회 구매)로 구매자 세계에만 이 레이어가 생긴다. 미구매자에겐 0영향(비트단위 동일).

---

## 0. 철학 (불변)
- **pay-to-win 아님.** 이 게임은 압도적 승리가 아니라 **역사가 흐르는 관전 연대기**다(사용자 확정 2026-06-29).
  차출 경험치는 노쇠·성장처럼 *그냥 흐르는 역사*지 승리 버튼이 아니다. 안티과금(CLAUDE.md 기둥3)의 뜻은
  "과금이 **현실성**을 깨면 안 된다"이지 모든 강화 금지가 아니다 → 차출 XP가 현실적이면 부합.
- **DLC = 콘텐츠(역사 레이어), 파워 아님.** 구매자는 "내 세계에 월드컵·국가대표·메달이 생기고, 국대 무대가 영입 시장의
  쇼윈도가 되는 것"을 산다. 차출자 유무와 무관하게 의미를 갖는 이유가 여기 있다(아래 5장).
- **새 저장 최소·순수 파생·결정론.** [[NEWS_SYSTEM]]·[[BROADCAST_SYSTEM]]과 동일 철학. 무저장 재계산 모델([[REALTIME_SIM_SYSTEM]]) 보존.
- **가짜 드라마 금지** — 차출/메달은 시드 결정론 산물(사실)만. 관전형([[idle-definition]]) — 강제 화면·푸시 없음.

## 1. 현실 근거 → 오프시즌 4년주기로 확정 (출처 확인, [[verify-domain-definitions]])
실제 일정을 출처로 확인한 결과 **국제대회는 V리그 비시즌(여름)에 열려 시즌과 거의 안 겹친다**:

| | 시기 | 출처 |
|---|---|---|
| V리그 여자부 시즌 | **10월 중순 ~ 4월 초**(겨울 리그). 2025-26 10/18~4/5, 2024-25 10/19~4/5 | Wikipedia 2025–26 V-League |
| FIVB 여자 월드컵 | **8월 말~9월**(역사적 9월·일본). 2027 8/20~9/5. 2019후 폐지→2027 부활(올림픽 예선) | Wikipedia FIVB Women's World Cup |
| 국제대회 일반(올림픽·세계선수권·VNL) | **여름(5~9월)** = V리그 비시즌 | Wikipedia V-League |

- 월드컵(8월 말~9월)은 V리그 개막(10월 중순)보다 ~6주 전 종료 → **시즌 중 중단 불필요**.
- 예외: 세계선수권(격년·가을)이 길어지면 V리그 **개막을 약간 늦추는** 조정 정도(한복판 중단 아님) — 게임에선 무시.
- **결정(2026-06-29)**: 월드컵은 **오프시즌 4년주기 이벤트**(시즌 종료→비시즌 월드컵→다음 시즌 개막). **시즌 중 break 금지.**
  - 근거 ①현실 일치 ②결정론 안전: 시즌 중 break는 `SEASON_DAYS=164` 상수·일정 dayIndex·보드 재생 인덱스·구매/미구매
    시즌길이 비대칭을 깨고 `_dv_seasondays` FAIL을 부른다. 오프시즌은 픽스처가 없어 **휴식 구현비용 0**.
  - "리그 지연" 연출이 필요하면 표시(일정/대시보드 "월드컵 비시즌")로만. 복귀 피로는 다음 시즌 개막 첫 N경기 form 음계수.

## 2. DLC 게이팅 — 2필드(owned + epoch), forward-only
> 월드컵은 **리플레이를 가로지르는 첫 DLC**다(서포터팩은 코스메틱·엔진 0히트라 "비트단위 0영향"이 상속되지 않음).
> 중도 구매가 과거 시즌에 차출 XP를 소급 주입해 역사를 재작성하면 안 된다(누적 서사 기둥 붕괴).

- `worldCupOwned: boolean` — 구매 자산. **설정군**(freshSave 밖 → `resetSave` 생존, 서포터팩 패턴 1:1). 새 게임에선 유지.
- `worldCupActivatedSeason: number` — **활성화 epoch**(freshSave 안 → 새 게임 리셋, 0=비활성 sentinel).
- **forward-only**: 차출/XP는 `owned && season >= epoch && (season - epoch) % 4 === 0`인 시즌경계에만 적용.
  forward-bake 모델 자체가 과거 base를 재계산하지 않으므로 "소급 재작성 불가"는 구조 보장 — epoch는 "이번 경계에서 돌릴까" 판정만.
- **비활성 = RNG 0뽑기 즉시 패스**(미구매자 desync 차단). 엔진엔 store 직참조 금지·명시 파라미터 주입. `_dv_worldcup` A/B로 비트동일 증명.

## 3. 차출 (국가대표 선발)
- **국내 선수만**: `!isForeign && !isAsianQuota`(국가대표=자국). 전용 유닛테스트로 "외인 0명 차출" 단언.
- **기준 = 실제 생산 + 능력**(시상 철학과 동일 — 상은 OVR이 아니라 코트 생산에 준다): 직전 시즌(들) 생산 + 능력치
  기반 포지션별 베스트. `engine/awards.pickTop`/`BEST7_SLOTS`를 **engine 공용 util(selectTopN/pickRosterByPosition)로 승격**해 재사용(awards 회귀 가드).
- **소수 정예 ~12~14명**(리그 전역, 구단당 보통 0~2명 → 선별적·명예). 포지션 정원 + **막내 슬롯(영건 age≤23)** 한 자리(세대 서사).
- **OP 풀 부족 폴백**: OP가 외인 자리라 국내 OP가 얕음 → 정원 완화/백필(awards `winner=null` 패턴) 또는 빈 슬롯 허용.
- **결정론**: 선발은 순서민감 production 직참조 금지 — base 스냅샷 + 공용 pickTop. 선발 결과는 `worldCupLog`에 박제(리플레이·재튜닝 일관).

## 4. 차출 효과 (성장 + 사고 면제 + 출전 보장)
- **경험치(성장)**: 합성 ProdLine → `engine/experience.applyMatchXp` **만** 호출(시즌경계 1회·epoch 게이트·exactly-once).
  - **통산기록·시상·HOF·마일스톤 오염 금지**: `accrueCareer`/`appendSeasonLine`은 **절대 경유 안 함**(국제대회 킬/블록이 V리그 통산을 오염).
    통산 차출/메달은 별도 `worldCupLog`로만 집계. (코드리뷰 고정 규칙.)
  - applyMatchXp의 potential 상한·ageMul·talentFor·헤드룸 감쇠를 그대로 상속 → "국대 갔다오니 +5 스파이크" 비현실 점프가 구조적으로 통제됨(새 성장수학 0줄).
- **사고 면제(사용자 요청)**: 차출 기간 동안 그 선수는 **사건·사고 롤에서 제외**(`data/dynamics seasonScandals`/`rollExpulsion` 결정론 필터).
  국가대표로 뽑힌 선수가 그 시기에 사고 치는 건 서사상 어색 — 집중·영광의 기간.
- **출전 보장(부상만 예외, 사용자 요청)**: 차출 자체로는 결장·정지 없음(오프시즌이라 리그 경기를 놓치지도 않음).
  **유일한 대가 = WC 부상** → 복귀(다음 시즌 개막) 후 결장/컨디션 하락 가능. 이 기능의 유일한 "음(陰)"이라 드라마가 거기 집중.

## 5. ★ 스카우팅 쇼케이스 — "내 선수 없어도 볼 이유" (심장, 재구성)
> **재검증이 잡은 핵심 결함(코드 확인)**: 원안 "월드컵서 빛난 선수를 모든 단장이 노린다"는 **AI 쪽에서 안 돈다.**
> `offerScore`/AI 입찰게이트(`data/offseason.ts:158~`)엔 선수 화제성/desirability 항이 **전무**(포지션 구멍·기조·캡만 봄).
> 게다가 몸값만 올리면(marketVal↑→askingPrice↑) `acceptProb`(offer/asking 비율)가 떨어져 **빛난 선수가 오히려 미계약 잔류** —
> "쟁탈전"의 정반대. `faPref`도 desirability가 아니라 선수 본인 동기(시드 1회)라 설계가 지목한 통로 자체가 오인.

→ **MVP는 "몸값/인기 nudge(엔진) + 발견(UI·서사)"로 재구성하고, "AI 도그파일"은 확장으로 분리한다.**
- **가치 nudge(엔진, capped)**: WC 영예를 **검증된 시상 채널 미러**로 흡수 — `setAwardScores`를 1:1 미러한 `setShowcaseScores` →
  `data/awardSalary marketVal`에 AWARD_BONUS급 **상한(capped) 프리미엄** + `data/owner` popularity 가산.
  **`offerScore`/입찰게이트는 절대 안 건드린다**(faMarket.ts:128 주석의 200시즌 parity 튜닝 폭탄 회피). 이미 튜닝된 award→연봉 체인을 타서 +25% 천장이 눈덩이를 자동 억제.
- **발견·영입(UI·서사)**: FA센터 **"WC 발견" 뱃지 + 워치리스트(점찍기, `faSignings`/`wanted` 패턴) + 뉴스**("국대 스타 FA 시장 나온다").
  인간 단장은 `wanted`로 직접 점찍어 영입하므로 **발견→영입 루프가 정직하게 닫힌다**. 차출자 0명이어도 "다음에 누굴 영입할지 보러" 옴.
- **루프**: 월드컵서 발견 → (자격 시) FA 영입 → 다음 회차엔 우리 구단 소속으로 태극마크. 또는 내가 키운 유망주가 국대 → 지킬까/거액에 보낼까.
- **FA 자격 현실 수용**: FA 게이트(`faMarket.ts:64` `!isForeign && career.seasons≥6 && remaining≤1`)상 "터진 어린 스타"는 계약에 묶여 즉시 영입 불가, 외인 OP는 FA 원천 배제.
  트레이드 제외(7장)라 우회로 없음 → **워치리스트로 자격 시점까지 추적 + FA 진입 시 뉴스 리마인드**로 메운다.
  **외인 WC 스타는 `resolveFAMarket`이 아니라 `tryoutWish`/트라이아웃 풀로 라우팅** — "차출자를 FA로"는 외인엔 거짓이므로 경로 분리 명문화.
- **AI 기계적 격화(확장)**: AI가 실제로 더 달려드는 heat(입찰게이트 `gap===0` 완화 — aggressive의 `gap<0` branch가 템플릿)는
  **`simLeague` 200시즌 parity A/B 통과 시에만** 추가. 비싼 한 조각이 MVP 출시를 막지 않게 분리.

## 6. 결정론 (선결 — 무저장 재계산 모델 보존)
- **시즌경계 bake 단일화(부채 정리)**: 현재 시즌경계 진화 bake가 3곳 중복(`store.endSeason`·`acquisitionAudit:260`·`simLeague:52`).
  → **`engine/seasonBake.ts` 단일 순수함수로 추출**해 세 경로가 공유. WC bake는 **1곳에만** 삽입하면 모든 결정론/패리티
  가드(`_gt_determinism`·`simLeague`·`_dv_simcache`)가 자동 커버. (이 DLC가 트리거하는 영구 부채 청소.)
- **exactly-once**: `applyMatchXp`는 비멱등(재로드 시 더블카운트) → epoch + 시즌경계 1회 bake(endSeason 더블탭 가드 내)로 강제.
- **단일 소스 `worldCupLog`**(바운드 영속, append-only `slice(-N)`): `{season, playerId, teamId 스냅샷, medal, showcaseScore}`.
  회차당 시즌경계 1회 bake(~100년 25엔트리). 인기·몸값·업적·뉴스가 **이 저장값만** 읽음(day 컷오프 다른 lazy 재계산 금지 — REALTIME §6 드리프트 동형).
  teamId는 **차출 시점 소속 스냅샷**(HOF "마지막 소속" 오귀속 회피).
- **세이브**: 가산 필드(`worldCupOwned`/`worldCupActivatedSeason`/`worldCupLog`/통산 카운터)는 `SAVE_DEFAULTS` 정규화로 `SAVE_VERSION` 불변.
  6지점 동시 등록(GameState·freshSave·partialize·SAVE_DEFAULTS·KIND·`_dv_migrate` 필드수 단언). epoch는 sentinel-number 또는 nested record로 새 KIND 회피.

## 7. 업적 · 뉴스 · 연출
- **업적**(`engine/achievements`, `careerTotals` 패턴): 통산 차출 N회 · 메달(금/은/동) · **국대 영웅 영입**(worldCupLog teamId 매칭). 미소유 시 done/total 제외(완성률 불변).
- **뉴스**(`data/news` 변주엔진·POOLS·조사교정 재사용): 새 kind `national` — 차출 발표 · 메달 · "국대 스타 FA 나온다" 쇼케이스. 디노이즈 게이트·최신 회차 한정.
- **연출**: `MedalIllustration`(react-native-svg) + `enshrine`/`ChampionCelebration` 클론 메달 세리머니. **0명/미구매 시 자동 통과**(빈 화면 강요 안 함).

## 8. 스포일러 정책 (메달 — [[BROADCAST_SYSTEM]] §1 재사용)
- 차출(결과-중립) = 실시간 표시 가능. **메달(결과-결정)** = 결과 노출 경계 → WC 관전(확장) 시 종료 후 공개. MVP는 결과화면 중심이라 자연 안전.

## 9. 공수 · 단계 (구현은 추후)
- **MVP ≈ 11~16 사람-일**(1인) · **확장 ≈ +7~12일(총 18~28)**. 핵심 원칙: **새 채널 신설 금지, 기존 capped 파이프(award/popularity/applyMatchXp) 경유** — parity·결정론 위험 0에 근접.

| 단계 | 산출물 | 공수 |
|---|---|---|
| **P0** | DLC 게이트(owned+epoch) + 세이브 스키마 6지점 + `engine/seasonBake.ts` 단일화 + `_dv_worldcup` A/B 골격 | 2~3일 |
| **P1** | 차출 선발(공용 pickTop·국적게이트·막내슬롯·OP폴백) + 합성 ProdLine→applyMatchXp(epoch·1회·career 비오염) + `worldCupLog` | 3~4일 |
| **P2** | 쇼케이스(setShowcaseScores→marketVal capped + popularity) + 업적 + 뉴스 + 메달 세리머니 + FA센터 발견 뱃지·워치리스트. 전 표면 DLC 게이트 | 5~6일 |
| **P3** | parity/결정론 검증 + 풀배터리 0건 + 가드 README 등록 | 2~3일 |
| **(확장)** | AI heat 입찰게이트(200시즌 parity 재튜닝) + 외인 tryoutWish 경로 + 리그 전역 국적 모델 + 풀 경기(결승만 코트) 관전 + 복귀 피로 | 7~12일 |

## 10. 검증 가드 (구현 시 — 커밋 전 전부 0)
- `_dv_worldcup`: **DLC off = DLC前 엔진버전과 바이트 동일**(미구매자 0영향) + 비활성 RNG 0뽑기 + epoch forward-only(중도구매가 과거 무변).
- 국적 게이트 유닛: **외인/아시아쿼터 0명 차출** 단언 + OP 폴백.
- 통산 비오염: WC 생산이 career/HOF/시상/마일스톤에 **0 반영**(applyMatchXp만 탐) A/B.
- parity A/B: `simLeague WORLDCUP_OFF`(STANCE_OFF 패턴) N≥10,000 — parityStd·persistR·dynasty 꼬리·우승분포 관찰밴드 내(게이트 아닌 sanity, 철학상 "역사 그럴듯함" 확인). 차출자 OVR 격차가 평균회귀 범위인지.
- exactly-once: 재로드·리플레이 시 XP 더블카운트 0. `worldCupLog` 결정론·바운드.

## 11. 주요 리스크 + 해법 (재검증 합의)
1. **쇼케이스 심장 미구현(high)** — AI 입찰에 화제성 항 없음 + 몸값만↑하면 역효과(미계약). → MVP는 award 채널 nudge + UI/서사 발견, AI heat는 확장(5장).
2. **결정론 소급(high)** — DLC bool만으론 중도구매가 과거 재작성. → owned+epoch 2필드·forward-only·1회 bake·`_dv_worldcup`(2장·6장).
3. **bake 3중복(med)** — WC를 한 곳만 넣으면 패리티 가드 발산 + applyMatchXp 더블카운트. → `engine/seasonBake.ts` 단일화(6장).
4. **통산 오염(med)** — endSeason 묶음에 WC 생산 흘리면 V리그 기록 오염. → applyMatchXp만, accrueCareer 금지(4장).
5. **리그 break 오독(med)** — 시즌 중 중단은 SEASON_DAYS·보드재생·패리티 붕괴. → 오프시즌 4년주기 고정(1장).
6. **OP 국내 풀 부족(med)** — 국대 OP 쿼터 미충족. → 정원 완화/백필(3장).
7. **IAP 인프라(med, 달력 리스크)** — 비소모 1종은 서포터팩 IAP 토대가 깔리면 상품 등록+entitlement 매핑으로 축소. 코어 dev-day와 분리.

## 12. 코드 맵 (구현 예정)
- `engine/nationalTeam.ts`(신규) — 차출 선발(공용 selectTopN) + `applyCallupXp`(합성 ProdLine→applyMatchXp). 순수.
- `engine/seasonBake.ts`(신규·부채정리) — 시즌경계 bake 단일 순수함수(endSeason·acquisitionAudit·simLeague 공유), WC 게이트 1곳.
- `data/worldCup.ts`(신규) — `worldCupLog` 셀렉터·쇼케이스 점수·업적/뉴스 파생.
- `data/awardSalary.ts` — `setShowcaseScores`(setAwardScores 미러)·marketVal 프리미엄 채널.
- `store/useGameStore.ts`·`store/saveMigration.ts` — owned/epoch/worldCupLog 영속(6지점).
- `data/news.ts`·`engine/achievements.ts` — `national` kind·월드컵 업적.
- `app/worldcup.tsx`(구매·결과 화면, supporter 클론) · `components/MedalIllustration.tsx` · FA센터 발견 뱃지/워치리스트.
- 확장: `engine/match`·`engine/playoffs`·`components/MatchCourt`(풀 경기 관전, 팀ID 무의존 재사용) · 입찰게이트 heat.
- `tools/_dv_worldcup.ts`(신규) + `tools/simLeague.ts`(WORLDCUP_OFF 플래그).

## 변경 이력
- 2026-06-29 **설계 완료(구현 추후)**: 100세션 평가(green, MVP 9~15일) → 사용자 교정(pay-to-win 아님·역사흐름·**차출선수 영입**) →
  100세션 재검증(holds-with-fixes 92%, yellow — 쇼케이스 심장 결함·결정론 선결 발견) → 현실 일정 출처 확인(국제대회=비시즌 →
  오프시즌 4년주기 확정) → 사용자 규칙 추가(차출 기준·사고 면제·출전 보장[부상만]). 심장 재구성(award nudge+UI발견, AI heat=확장).
