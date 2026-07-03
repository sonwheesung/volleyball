# 2사이클 E2E 점검 체크리스트 (첫 진입 → 2시즌)

> 목적: 첫 구단 선택부터 2 오프시즌 사이클 동안 **감독·FA·재계약·외국인·전지훈련(다이아)·업적 + AI 팀 성장**이
> 올바로 도는지 확인. 실행: `tools/_e2e_twocycle.ts`(헤드리스 — 실 store+engine, 서버는 fetch 스텁으로 대체).
> ※실 Android 에뮬레이터는 이 환경에서 adb 미도달. 헤드리스 하네스가 동일 코드 경로(store 액션)를 구동해 각 시스템을 단언.

## A. 첫 진입(온보딩, season 0 · currentDay 0)
- [ ] `selectTeam(myTeam)` → 로스터 존재(≥10명)·감독 배정·외국인 1명 존재
- [ ] 다이아 잔액 = 서버 지갑 동기화 값(표시 캐시), saveId 지연 생성

## B. 전지훈련(다이아 소비 — 사용자 최우선 확인)
- [ ] currentDay 0(오프시즌)에서만 가능(경기 중 `not-offseason` 거부)
- [ ] `trainingCamp(myPlayer, course)` 성공 → **다이아 정확히 CAMP_COURSE_COST 차감**(서버 확정 후에만)
- [ ] 대상 선수의 **3스탯 실제 상승**(applyCamp) + `campLog` 기록 + `campTrainedThisOffseason` 등재
- [ ] 같은 선수 오프시즌 2회차 → `already` 거부(선수당 1회)
- [ ] 다이아 부족 시 → `no-diamonds` 거부 + 스탯/차감 없음(원자성)
- [ ] 서버 차감 실패(offline) → 로컬 미적용(split-brain 없음)
- [ ] 3스탯 전부 99면 `maxed` 거부

## C. 재계약·FA·방출 (내 팀)
- [ ] 만료 예정 선수 `resignDecisions[id]=true` → 잔류 / `false` → FA 풀로
- [ ] FA 영입(`faSignings`) → 다음 시즌 로스터 합류(캡·정원 내)
- [ ] 방출 하한(10명) 가드 동작

## D. 감독·스태프
- [ ] `hireCoach(coachId)` → 감독 교체(예산 내), careerLog.coachHires++
- [ ] 감독 성향/카리스마 반영, 스태프 성향(코치 2.0) 표시

## E. 외국인 트라이아웃
- [ ] `setKeepForeign(true/false/null)` → 재계약/방출/자동
- [ ] endSeason 후 외국인 1명 유지(재계약) 또는 신규 트라이아웃 지명

## F. 오프시즌 진행(endSeason ×2)
- [ ] endSeason 후 season+1, currentDay 0, 순위/아카이브 누적
- [ ] 드래프트 신인 합류, 은퇴 처리, 명예의전당
- [ ] 2사이클 결정론(같은 입력 → 같은 결과)

## G. 업적
- [ ] 2사이클 진행으로 새 업적 달성 → `claimAchDiamonds()` 서버 확정 후 다이아 적립
- [ ] 이미 수령한 업적 재수령 안 됨(claimedAch 멱등)

## H. AI 팀 성장 (사용자 강조)
- [ ] AI 팀 로스터 OVR이 2사이클 뒤 **정체/붕괴 아님**(신인·성장·외인으로 유지·상승)
- [ ] AI 팀 감독/코치 tier가 성장(코치 2.0 성장)로 유지(전원 C 붕괴 없음)
- [ ] 특정 팀 독주 없이 리그 전체가 함께 굴러감

## 실행
```
npx tsx tools/_e2e_twocycle.ts
```
PASS/FAIL 단언 + 각 시스템 실측값 출력.
