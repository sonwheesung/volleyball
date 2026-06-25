# 엔진 테스트 콘솔 (sim-web) — 웹 브라우저

> 상태: **구현됨(2026-06-22)**. PC 브라우저에서 게임 엔진을 직접 돌려 검증하는 **백엔드 없는** 콘솔.
> 앱(Expo)과 별개. `tools/sim*.ts`(CLI 검증)의 인터랙티브 웹 버전 — 우리가 콘솔로 보던 엔진을 화면으로.
> 코드: `sim-web/`. 로컬 안내: [`sim-web/README.md`](../sim-web/README.md).

---

## 1. 무엇 / 왜
- `engine/`·`data/` **순수 TS**를 esbuild로 브라우저 번들 → 16탭으로 엔진을 직접 실행·검증.
- 앱을 켜지 않고(시뮬레이터·기기 불필요) PC/폰 브라우저에서 바로 결과를 본다.
- **결정론**: `resetLeagueBase()` 후 앱과 동일한 셀렉터를 쓰므로 관전·순위·생산과 일치.
- **읽기 전용**: 엔진을 검증만 한다(세이브·스토어 무관, 상태 변경 없음).

## 2. 실행
```
npm run sim:web          # 빌드+감시+정적 서버 → http://localhost:5051/  (폰: http://<PC IP>:5051/)
npm run sim:web:build    # 1회 빌드만 (sim-web/index.html 직접 열어도 됨)
```
- 포트 **5051**(사도전 콘솔이 5050이라 충돌 회피). `node sim-web/build.cjs --serve --port=NNNN` 으로 변경.
- `0.0.0.0` 바인딩이라 같은 네트워크의 폰에서도 접속 가능.

## 3. 구조 (`sim-web/`)
| 파일 | 역할 |
|---|---|
| `build.cjs` | esbuild 번들(`main.ts`→`dist/bundle.js`, platform=browser·IIFE) + `--serve` 정적 HTTP 서버. RN·AsyncStorage·expo는 `_stubs/`로 alias(엔진은 순수라 실제 미사용). |
| `index.html` | 셸(헤더·`#tabs`·`#controls`·`#out`) + CSS(민트/코트 테마). |
| `main.ts` | 탭 프레임워크 + 각 탭 `mountX`(컨트롤 채우기)·`runX`(폼→엔진→`#out` 렌더). |
| `_stubs/` | `react-native`·`async-storage` no-op 스텁. |
| `dist/` | 빌드 산출물 — **gitignore**(커밋 안 함). |

## 4. 탭 ↔ 엔진 (16)
| 탭 | 엔진/셀렉터 |
|---|---|
| 경기 | `simulateMatch`(+`box` 싱크) (박스스코어: 공격 성공/시도/성공률·서브·블록·디그·세트·**리시브 효율**(KOVO 공식 (정확−실패)/시도)·범실 — 실제 스윙 단위, 네이버 종합 탭 스타일 / N경기 승률·세트 분포) |
| 경기 중계 · 현수막 | `matchMvp`(경기 MVP+리캡)·`situationFeed`(상황 인지 중계 — 세트/매치포인트·듀스·연속)·`buildMatchBanners`(중계 현수막: 기록 경신·트리플 크라운·PO 확정/탈락). 경기 분석 / 시즌 전 경기 현수막 스캔 / 현수막 4종 미리보기. 게이머 리뷰 1·2 + BROADCAST_SYSTEM |
| 선발 라인업 | `availableTeamPlayers`→`buildLineup`(+`restedOnDay`)·`benchCauseOf` (경기별 주전 7인 + 제외 사유 + what-if 부상 주입 `setInjuryOverride`) |
| 분포 KOVO | `sim.points[].how` 분류 → 킬·블록·에이스·범실 비중 vs KOVO 목표 |
| 시즌 | `computeStandings`·`buildPlayoffs`·`currentSeasonAwards`·`restedOnDay` |
| 관계·선수 심리 | `discontentNow`·`benchCauseOf`·`expectsPlayOf`·`buildOwnerFx` ([ROTATION_MORALE](./ROTATION_MORALE_SYSTEM.md)) |
| 성장·노쇠 | `peakAge`·`potential` (성장기/전성기/노쇠기) |
| 연봉 산정 | `marketVal`·`LEAGUE_CAP`·`isFranchise` |
| 재정 | `settleSeason`·`teamFanbaseNow` |
| FA 시장 | `isFAEligible`·`assignFAGrades`·`askingPrice` |
| 외국인 | `buildDraftContext`.tryout/asianTryout |
| 영입·드래프트 | `buildDraftContext`.cls |
| 시즌 중 이동 | `seasonTxLog` |
| 부상·사고 | `seasonInjuryReport`·`seasonScandals` |
| 뉴스 | `buildNewsFeed` |

## 5. 새 탭 추가법
1. `main.ts` `TABS`에 `[id, '라벨']` 추가하고 `TabId` 유니온에 id 추가.
2. `mountX()`(컨트롤 HTML + 버튼 onclick)와 `runX()`(엔진 호출 → `#out` innerHTML) 작성, `MOUNTS`에 등록.
3. 엔진/셀렉터는 **상대경로 import**(`../engine/...`·`../data/...`) — esbuild가 번들. RN 의존을 새로 끌어오면 `build.cjs`의 `alias`에 스텁 추가.
4. **`npm run sim:web:check`** 로 타입체크(누락 import·미정의 참조 적발 — esbuild는 타입체크를 안 해 런타임까지 샌다).
5. `npm run sim:web` 으로 빌드+서빙, 브라우저로 렌더·콘솔 에러 0 확인.
- 이름 등 외부 입력은 `esc()`로 이스케이프(콘솔도 XSS 위생).

## 5.5 what-if 주입 (강제 부상/사고)
- **선발 라인업** 탭에서 선수를 클릭하면 그 선수에 **시즌아웃 부상을 주입** → 라인업 재구성 + **시즌·뉴스·생산 탭까지 파급**(진짜 엔진 이벤트).
- 훅: `setInjuryOverride(spans)`·`setScandalOverride(spans)`·`clearWhatIf()` (`data/dynamics.ts`). forward-pass 루프 전에 주입돼 `injuredOn`/`suspendedOn`이 시즌 전체에 반영.
- **안전**: 빈 배열이면 forward-pass 완전 동일(무동작 — `npm test`·`_ev_webparity` byte 일치 확인). **스토어는 호출 안 함** → 앱·세이브·결정론 무관. 브라우저 새로고침 시 초기화(모듈 상태 리셋).
- 검증: `tools/_ev_whatif.ts`(주입→라인업·순위 변화→초기화 복원, A/B 자가검증).

## 6. 한계 / 주의
- 콘솔 리그는 **1시즌(season 0)** 고정 — 누적 서사(우승 아카이브·명예의전당·마일스톤)는 비어 뉴스 탭은 실시간 기사 위주.
- 재정 탭의 스태프비·시작 잔고는 콘솔 기본값(앱 실제 저장과 다를 수 있음 — 엔진 동작 확인용).
- `sim-web/`는 Expo 앱 번들에 들어가지 않는다(앱 tsc 통과 확인). 출시 빌드와 무관한 개발 도구.

## 7. 인터랙티브 브라우저 테스트 (MCP puppeteer)
- 콘솔/앱 화면을 **보이는 브라우저로 직접 몰며** 확인하려면 MCP puppeteer 사용(`.mcp.json`에 등록 — `@modelcontextprotocol/server-puppeteer`, `headless:false`).
- **Claude Code 재시작 후** `mcp__puppeteer__*`(navigate·screenshot·click·fill·evaluate) 도구가 활성화된다(MCP 서버는 세션 시작 시 연결). 먼저 `npm run sim:web`으로 콘솔을 띄워 두고 `localhost:5051`로 navigate.

