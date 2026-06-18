# 시상식 (Awards) — 설계/구현 문서

> 한 시즌을 자동으로 굴린 단장에게 주는, 1년에 한 번 "멈춰서 음미하는 순간".
> 통산 숫자(career)를 *이름 붙은 영예*로 바꾸는 ②데이터 누적 서사의 첫 장치.

## 0. 기둥 연결
- **②서사**: 은퇴 시 "통산 4,200점" → "MVP 3회·득점왕 5회·영구결번"으로. 커리어에 훈장.
- **①방치형**: 시즌 마감의 연례 의식. [[idle-definition]] — **푸시 없음**, 앱에서 볼 때 surface.
- **④단장결정**: 내 용병이 MVP, 내 신인이 신인상, 내 코치가 기량발전상 → 결정의 피드백.
- **상은 OVR이 아니라 실제 코트 생산(production)에 준다.** OVR≠실전력 이슈를 우회.

## 1. 상 라인업 (확정)
| 갈래 | 상 | 선정 |
|---|---|---|
| 영예 | 정규리그 MVP | 생산 × **팀 성적 가중**(1위 ×1.0 … 꼴찌 ×0.5). "성적 없는 MVP 없다" |
| 영예 | 챔피언결정전 MVP | 우승팀 최고 생산자 (우승 필수) |
| 미래 | 신인상 | 데뷔 시즌(career.seasons===0) 최고 생산 |
| 미래 | **기량발전상** | 비-신인 중 시즌 OVR 델타 최대 (코치·훈련의 성적표) |
| 기록왕 | 득점·공격·블로킹·서브·디그·세트왕 | **순수 1위, 팀 성적 무관**(약체팀의 빛). 용병 독식=현실 그대로 |
| 베스트7 | S·OH·OH·OP·MB·MB·L | 포지션별 최고(어시/득점/디그 기준) |
| 시즌 중 | **라운드 MVP** | 6라운드(leg)별 최고 생산자. 조용히 갱신, 알림 없음 |

## 2. 선정 철학 (수치는 튜닝 placeholder)
- `impactScore(l) = points + 0.25·assists + 0.18·digs` (`engine/awards.ts`) — 득점 위주, 세터·리베로도 경합 가능.
- MVP만 `× teamWeight(rank)`. 기록왕·베스트7은 순수 1위.
- 동률은 playerId 사전순으로 결정론 해소.
- 리시브왕 ✅ 구현(2026-06-18): `ProdLine.receives` 추가 — `attributeProduction`이 서브권 추적으로 받는 팀
  패서(리베로+OH)에 귀속(skReceive 가중). 측정: 포지션 점유 OH 56%·L 33%(W형 정렬), 리시브왕→상위 리베로.
  기록 전용(밸런스 무영향).

## 3. 영속 (중요)
production 캐시는 롤오버에서 날아간다. **시상식은 `endSeason`에서 계산해 `archive`에 구워넣는다**(시즌별 영구 보존). 과거 시즌 시상은 archive에서만 조회.
- `archive[].awards: SeasonAwards` 추가.
- 라운드 MVP는 시즌 *중* 갱신 표시(현재 시즌은 production 재계산), 시즌 마감 시 archive에 박힘.

## 4. 누적
- **선수 상세 수상 이력(2026-06-11 구현)**: `awardHistoryOf(archive, playerId)`(data/awards, 순수) —
  MVP·챔프MVP·신인상·기량발전상·부문 기록왕·베스트7·라운드MVP(시즌당 횟수)를 연표로.
  `app/player/[id].tsx` "수상 이력" 섹션.
- **시즌별 기록 라인(2026-06-11 구현)**: `Player.seasonLines[]` — endSeason에서
  `appendSeasonLine`(engine/production)으로 그 시즌 생산(경기·득점·세트·디그, 소속=뛴 팀
  prevTeamOf)을 선수 베이스에 적립. 은퇴 시 베이스와 함께 정리(세이브 자동 다이어트).
  통산 `career.assists`(세트)도 함께 누적 시작(구세이브는 0부터).
- 은퇴 시 명예의전당 판정 근거로 확장(추후).
- 연속 수상(3년 연속 득점왕)은 추후 강조.

## 5. 코드 맵
- `engine/awards.ts` — 순수 `computeSeasonAwards(input)`. 리그/스토어 의존 0.
- `data/awards.ts` — production·standings·playoffs·rookie·OVR델타를 모아 엔진 호출. `currentSeasonAwards()` / `seasonLegProduction()`.
- `store` — `endSeason`에서 계산 → archive 적립.
- `app/(tabs)/history.tsx` — 시즌별 시상식 표시.
