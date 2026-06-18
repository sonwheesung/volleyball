# 뉴스 피드 (News) — 설계/구현 문서 (캡스톤)

> 자동으로 흘러간 리그를, 신문이 대신 이야기해준다(①방치형 전달 + ②서사 종합).
> 매 경기를 안 보는 단장이 "무슨 일이 있었는지"를 아는 수단.

## 0. 원칙
- **새 저장 없음.** archive(시상)·milestones·hallOfFame·injuries 에서 **순수 파생**(결정론).
- **가짜 드라마 금지** — 기록에 근거한 사실만.
- **중요도(big)** 로 헤드라인/단신 구분. 최신 시즌 우선, 같은 시즌 내 헤드라인 우선.
- 방치형 [[idle-definition]]: 푸시 없음. 켜면 쌓여있는 피드.
- **본문(body)도 사실 기반(2026-06-18)**: 헤드라인만이 아니라 `NewsItem.body`에 분류별로
  **실제 사실을 담은 2~3문장**을 생성한다(선수·팀·부상 심각도·결장 경기수·포지션·MVP·통산 수치 등).
  과거엔 본문이 분류별 고정 한 줄(모든 부상이 "당분간 코트를 비운다")이라 "기사 같지 않다"는
  지적을 받았다 → 같은 데이터를 더 구체적으로 풀어쓴다(가짜 드라마 금지 원칙은 유지). body가 없는
  구결과/예외는 화면이 분류별 기본 리드(LEAD)로 폴백.

## 1. 기사 소재 (1~4 종합)
| 소재 | 출처 | big |
|---|---|---|
| 우승 | archive.championId | ★ |
| 정규 MVP | archive.awards.mvp | ★ |
| 챔프MVP·신인상·기량발전상·득점왕 | archive.awards | 단신 |
| 기록 경신 | milestones | m.big |
| 명예의전당 헌액 | hallOfFame | legend=★ |
| 큰 부상(중상·시즌아웃) | seasonInjuryReport() | 시즌아웃=★ |

## 2. 표면 (no-push)
- **대시보드**: 최근 5건 뉴스 티커 + 라운드 MVP 위젯(조용히 갱신). → 전체는 history로.
- **history**: 리그 뉴스 아카이브(최근 40건) — 한 우주의 연대기.
- 내 팀 기사 accent 강조.

## 3. 코드 맵
- `data/news.ts` — `buildNewsFeed(archive, milestones, hallOfFame, season)` 순수 집계.
- `app/(tabs)/index.tsx` — 뉴스 티커 + 라운드 MVP 위젯.
- `app/(tabs)/history.tsx` — 전체 뉴스 아카이브.
- `tools/simNews.ts` — N시즌 누적 후 피드 sanity.

## 4. 추후
- FA 영입/이적 기사(signedByMe 영속 필요), 연승/업셋, 라이벌, 선수 인터뷰.
