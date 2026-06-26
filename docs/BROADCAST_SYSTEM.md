# 중계 현수막 (Broadcast Lower-Third) — 설계+Phase1 구현 (2026-06-17 설계 / 2026-06-18 구현)

> **★ 구현 현황(2026-06-19)**: Phase 1 ✅ — `data/broadcast.ts buildMatchBanners`(기록 경신·PO 확정/탈락·**트리플 크라운**)
> + `components/BroadcastBanner.tsx`(하단 현수막 큐 애니메이션, kind 무관 tint/icon/title 렌더) + `app/match/[id]` finished 게이트 주입.
> 검증 `tools/simBroadcast.ts`·`tools/checkTripleCrown.ts`: 시즌0 PO확정 3·탈락 13·트리플크라운 1(KOVO 후위공격 기준)/126경기, 합성 1000점 돌파 현수막 ✅, 스포일러 누출 0(구조 보장).
> **추후**: 우승 현수막(플레이오프는 경기단위 관전 안 함 — 보류), 경기 *중* 실시간 기록(랠리별 귀속 선결, Phase 3).

> 실제 배구 TV 중계처럼, 큰 사건(우승·기록 경신·플레이오프 확정)을 경기 보드 **하단 현수막**으로
> 띄운다. 관전형 1순위(보는 경험의 품질, CLAUDE.md 2장)에 직결되는 연출 투자.

## 0. 원칙
- **새 저장 없음 — 순수 파생(결정론).** [[NEWS_SYSTEM]]과 동일 철학. archive(우승)·milestones(기록)·
  standings/일정(확정)에서 재계산. 현수막은 *데이터*가 아니라 *연출*이다.
- **뉴스 피드와 역할 분리:** 뉴스(`NEWS_SYSTEM`)는 *지나간 일*을 대시보드/연표로 조용히 전달(수동).
  현수막은 *지금 이 경기*의 사건을 보드 위에서 영화처럼 보여준다(관전 중 능동). 소스는 공유, 표면이 다름.
- **가짜 드라마 금지** — 기록에 근거한 사실만(뉴스와 동일).

## 1. 스포일러 정책 (가장 중요 — 결과 은닉과의 충돌 해소)

경기 보드는 **관전이 끝나기 전까지 결과(세트 스코어·승패)를 숨긴다**(`app/match/[id].tsx`의 `finished`
게이트, 결정론 시뮬이라 미리 알아도 숨김). 현수막이 결과를 드러내면 이 설계가 깨진다. 그래서 사건을
**결과 노출 여부로 2분류**한다:

| 분류 | 사건 | 띄우는 시점 | 이유 |
|---|---|---|---|
| **결과-결정** | 우승 확정 · 플레이오프 확정/시드 | **관전 종료 후(finished)만** | 이기는 걸 알게 됨 → 경기 중 금지 |
| **결과-중립** | 개인 기록 경신(통산 1만점 등) | **경기 중 실시간 가능** | 승패와 무관(패배 중에도 기록은 나옴) |

→ 사용자 요청 "경기 종료 시 + 경기 중 실시간"을 이렇게 매핑한다: **실시간 = 기록 한정**,
**우승·PO확정 = 종료 직후**. (우승·확정을 굳이 경기 중에 띄우려면 스포일러를 감수하는 명시적 옵션이
필요 — 기본은 금지.)

## 2. 트리거 4종 — 데이터 출처 & 신규 작업

| 트리거 | 출처 | 상태 | 신규 작업 |
|---|---|---|---|
| **우승 확정** | `archive.championId` (data/playoffs.ts) | ✅ 있음 | 없음 — 챔프전 종료 현수막 |
| **기록 경신** | `Milestone`(engine/milestones.ts `crossedThresholds`) | ⚠ 시즌말 계산만 | **경기단위 감지** `detectMatchMilestones()` — 선수 career 기준선 + 이 경기 생산으로 임계 교차 판정 |
| **PO 확정/시드** | `computeStandings` + 잔여 일정 | ✅ **구현** `engine/clinch.ts`·`data/clinch.ts` | 보수적 승수 기반 확정/탈락/경합+매직넘버. 일정 화면 표시 중. 시드 세분(1번 시드 확정 등)은 추후 |
| **트리플 크라운** (KOVO 공식, 결과-중립, 2026-06-19 구현) | `production`(before/after diff) | ✅ **구현** `data/broadcast.ts` | 한 경기 **후위공격·블로킹·서브 에이스 각 3개 이상**(KOVO 공식 정의, 2005-06 도입). 엔진 생산이 공격을 후위/전위 미분리 → `production`이 OH/OP 킬에 `BACK_ATK_RATE=0.24`로 **후위공격(backSpikes) 별도 귀속**(독립 rng — 기존 spike/block/ace 귀속 불변, backSpikes만 가산. 검증: backSpikes/spikes 18.8% ≈ 엔진 백어택 18.3%). 빈도(`tools/checkTripleCrown.ts`): **시즌당 ~1건**(실제 KOVO 여자부도 매우 희귀 — 후위공격 3+이 블록 3+·에이스 3+와 동시 = 극히 드묾). 개인 업적이라 승패 무노출 → finished 후 안전 |

> 기록 경신의 경기단위 감지는 **랠리별 개인 기록 귀속**에 의존(현재 알려진 공백 — PointLog→production
> 참가자 id). 경기말 집계는 근사 가능하나, 경기 *중* 실시간(그 랠리에 뜨는)은 귀속 정밀도가 선결.

## 3. 표면 & 연출

- **위치:** 경기 보드 하단(lower-third). 기존 상단 캡션 배지(`MatchCourt` `howBadge`)·중계 피드와 별도 레이어.
- **연출:** `Animated` 슬라이드 인 → 홀드(2~3초) → 슬라이드 아웃. 큐(여러 사건이면 순차). `howBadge` 스타일 재활용.
- **종류별 톤:** 🏆 우승(골드)·📊 기록(블루)·✅ 확정(그린). 내 팀이면 강조.
- **종료 현수막:** `finished` 게이트가 열리는 순간 결과-결정 현수막을 큐로 재생.

## 4. 구현 단계

- **Phase 1 (싸고·스포일러 안전):** 하단 현수막 컴포넌트 + **경기 종료 시** 재생. 우승(기존 데이터) +
  경기단위 기록 감지(`detectMatchMilestones`, 경기말). 결정론 파생.
- **Phase 2 (신규 시스템):** ✅ `clinch.ts` 매직넘버 감지 구현(확정/탈락/경합) — 일정 화면 표시. 현수막 연출·시드 세분은 추후.
- **Phase 3 (고비용):** 경기 *중* 실시간 기록 현수막 — 랠리별 개인 귀속 선결 후 그 랠리 시점에 띄움.

## 5. 코드 맵 (예정)
- `data/broadcast.ts` — `buildMatchBanners(fixture, sim, ...)` 순수 집계(우승·기록·확정 → Banner[]).
- `engine/clinch.ts` — `detectClinch(standings, remaining)` 매직넘버(Phase 2).
- `data/milestones.ts` — `detectMatchMilestones()` 추가(경기단위).
- `components/BroadcastBanner.tsx` — 하단 현수막 렌더/애니메이션.
- `app/match/[id].tsx` — finished 시 결과-결정 현수막 큐 주입.
- `tools/simBroadcast.ts` — N경기 현수막 발생 빈도·스포일러 누출 0 검증.

## 6. 검증 기준
- **스포일러 누출 0:** 결과-결정 현수막이 finished 이전에 절대 안 뜸(도구로 전수 검사).
- 결정론: 같은 시드 → 같은 현수막(파생이라 자동).
- 빈도 sanity: 현수막이 너무 잦으면(매 경기) 가치 하락 — big 사건 위주 게이팅.

## 7. 우승 축하 화면 (일러스트 연출, 2026-06-26 구현 — 사용자 요청)
> 현수막(하단 띠)과 별개로, **우승 확정 순간을 일러스트가 있는 큰 화면**으로 연출(관전형 1순위 — 보는 경험).
> 컨셉: 얼굴 없는 둥근 **블롭 선수들이 우승컵을 든** 미니멀 벡터(라바풍). sim-web '🏆 우승 화면' 탭에서 룩 합의 후 구현.
- **트리거**: `app/playoffs.tsx` — `po.championId === my`(내 구단 우승)일 때 화면 상단에 `ChampionCelebration` 표시.
- **컴포넌트**:
  - `components/ChampionIllustration.tsx` — `react-native-svg` 벡터(블롭 3인 + 컵 + 콘페티 + 배구공). 이미지 파일 0·전 해상도 선명.
  - `components/ChampionCelebration.tsx` — 어두운 팀색 카드 + 일러스트 + 팀명·N시즌 챔피언·(선택)MVP·"시즌 마무리 →".
  - `lib/teamColor.ts` `teamColors(id)` — **가운데 선수·배경·강조 텍스트가 우승팀 색**. **✅ `CLUB_IDENTITY` 실제 구단
    색(hue) 연결됨(2026-06-26)**: `clubIdentity(id)?.hue`를 우선 쓰고(비표준 id면 id 해시 폴백) 5색 파생 → 구단마다
    고유 시그니처 색(타이드=딥블루·블레이즈=스칼렛 등, CLUB_IDENTITY_SYSTEM §2). sim-web 우승 탭도 동일 `teamColors`
    임포트(자체 hue 재구현 제거 — 단일 소스).
- **MVP**: 챔프전 MVP(`finalsMvp`)는 endSeason 후에만 산출 → 플레이오프 시점(축하 화면)엔 생략(있으면 표시).
  **연표(기록 탭) 시상식 섹션은 이미 시즌별로 챔프전 MVP를 표시**(`app/(tabs)/history.tsx` 시상식 — 정규 MVP·
  신인상과 함께, 2026-06-26 확인). 축하 화면은 시점상 미산출이라 생략이 정상 — 추가 작업 없음.
- **재활용(추후)**: 같은 블롭 캐릭터로 컵→메달·꽃다발·기록판 교체해 시상식·기록 경신·연표 썸네일에 통일감 있게 확장.
