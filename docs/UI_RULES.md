# UI_RULES — UI 상호작용 규칙 (검수 기준)

> 보드 연출은 [`BOARD_RULES.md`](./BOARD_RULES.md)(코트 마커·안무) 소관. 본 문서는 **일반 UI 상호작용**
> 규칙 — 버튼·로딩·비활성·빈상태 등 화면 *조작* 품질. `verify-board` 스킬이 이 문서도 대조 검수한다.
> 새 UI 주의사항이 나오면: ① 본 문서에 행 추가 → ② 화면 수정 → ③ 검증(아래 방법) → ④ 커밋. (CLAUDE.md 11장)

## 주의사항 ↔ 규칙 대응표

| # | 규칙 | 왜 | 구현 | 검증 |
|---|---|---|---|---|
| **UI-27** | **무거운 동기 작업 버튼은 ① 사전 페인트 오버레이(네이티브 스피너) ② 그 작업을 정직하게 설명하는 세계관 사유 문구를 필수로 띄운다** | 무거운 액션(base++ 재계산·전지훈련 정산·오프시즌 미리보기 재빌드)은 **JS 단일 스레드를 동기로 막아** RN JS 스피너조차 안 돈다(UI-1). staff.tsx가 증명한 패턴: **네이티브 `ActivityIndicator`는 UI 스레드에서 도는 별개 뷰**라 JS가 막혀도 계속 회전 → 오버레이를 **먼저 페인트한 뒤** 블록을 시작하면 "탭했는데 멈춘" 체감이 사라진다. 문구는 로딩이 "의도적"임을 알리고(관전형 1순위=보는 경험), **가짜 사유 금지** — 실제 하는 일을 게임 언어로(copylint 통과, 여자부 표현) | **공용 `components/BusyOverlay.tsx`**: `<BusyOverlay visible message sub?/>`(Modal+dim+네이티브 스피너, `theme.popup` 카드) + **`useBusyRun()`** 훅(`{busy, message, run}`) — `run(message, fn)`이 setState(오버레이 렌더)→**rAF×2**(네이티브 스피너 실페인트 대기)→무거운 sync `fn`→busy=false. **rAF 2회**: 1회는 커밋 전이라 모달이 아직 화면에 없을 수 있음(UI-4), 2회째면 커밋→네이티브 렌더가 한 프레임 지나 스피너가 얹힌 뒤 블록. **재진입 가드**(진행 중 run 무시)로 더블탭 중복 실행 차단. 적용: training-camp(코스 구매·전지훈련 마치기)·training-policy(방침 저장)·player/[id](선발/벤치 건의·복귀 지시)·오프시즌 체인(tryout·asian-tryout·fa·draft 지명/영입 토글). **비동기(서버) 작업**(전지훈련 서버 차감)은 rAF 대신 로컬 busy state로 오버레이를 await 동안 유지. **사유 문구는 아래 예시표 참조** | tsc 0 · `_dv_copylint` PASS(신규 문구 전부) · npm test · 에뮬: 무거운 버튼 탭 시 오버레이+스피너 회전(블록 중에도) 후 결과 |
| **UI-26** | **팝업/시트 표면색은 테마 토큰이어야 — 배경 하드코딩 + 테마색 텍스트 = 반대 모드에서 안 보임** | 공용 `Popup` 카드가 **다크 고정 `#161E2E`**(UI-10)인데 제목·본문은 `theme.text`/`theme.muted`(테마 적응)라, **라이트 모드에선 검정 제목이 다크 카드 위에서 안 보였다**(본문 muted는 회색이라 희미하게만 — 사용자 보고 "제목이 어두워서 안 보임", 전지훈련 마치기 confirm/ActionSheet, 2026-07-04). UI-25(전환 바탕)와 같은 계열 사각: **라이트 모드 추가(2026-07-01) 시 다크 전용 하드코딩 표면을 안 훑음**. AnnouncementModal은 `theme.card`라 무사고 → 하드코딩 표면만 문제 | 테마에 **`popup` 토큰**(다크 `#161E2E` / 라이트 `#FFFFFF`, `components/theme.ts`) 추가 → `Popup.styles.card`가 `theme.popup` 사용. 텍스트는 그대로 `theme.text`/`theme.muted`라 두 모드 다 대비 확보(다크 카드+밝은 글씨 / 밝은 카드+검정 글씨). `Popup`을 쓰는 **AppDialog(showAlert)·ActionSheet 전부 일괄 교정**. **일반 원칙**: 테마 텍스트를 올리는 표면은 반드시 테마 토큰(고정색 금지) — 안 그러면 반대 모드에서 대비 붕괴 | tsc 0 · 에뮬 라이트 모드: 계약관리 ActionSheet(원영우) 흰 카드+검정 제목·회색 부제·컬러 버튼 전부 선명(수정 전 제목 안 보임 → 후 정상). settings 초기화(자체 theme.card 모달)는 원래 정상 = 대조군 |
| **UI-25** | **화면 전환/뒤로가기 중 드러나는 바탕은 앱 루트를 테마색으로 깔아 가린다 — 네이티브 윈도우색(app.json)에 의존 금지** | `app.json backgroundColor:#0B1018`(네이티브 루트)는 정적이라 모드별로 못 바꾼다. native-stack 전환 중 화면 콘텐츠가 잠깐 detach되면 이 #0B1018이 드러나 **다크 모드엔 자연스럽지만(일치) 라이트 모드에선 검은 화면 플래시**(화이트모드 기록/선수 뒤로가기 시 검정, 사용자 실기기 2026-07-04). 앞서 다크의 흰 깜박임은 nav 테마 배경으로 막았으나(구 `NAV_THEME` 다크 박제), 그건 **라이트에선 오히려 검정을 고정**시켰다. 색 A/B(nav=빨강·content=초록) 실측 결과 전환 바탕은 **nav도 content도 아닌 app.json 네이티브 루트**로 확인 | 앱 루트 `<SafeAreaProvider style={{flex:1, backgroundColor: theme.bg}}>`(`app/_layout.tsx`) — React 루트가 현재 모드색으로 깔려 전환 중 detach 시 **테마색**(라이트=밝게·다크=어둡게)이 보인다. + nav 테마를 **모드별**로(`makeNavTheme(mode)`: 라이트=DefaultTheme·다크=DarkTheme 베이스 + 현재 theme색) 렌더에서 생성(구 다크 박제 폐기). RootLayout은 `useThemeMode()`+`key={mode}` 리마운트라 색이 토글 따라감 | tsc 0 · 에뮬 라이트 모드: 선수/기록 등 stack 뒤로가기 전환 바탕이 검정→밝은색(#EAF0F6). A/B 색테스트로 레이어 특정(nav/content 아님=native root). 다크 모드는 theme.bg=#0B1018=app.json값이라 무회귀 |
| **UI-24** | **한글 본문 줄바꿈은 어절(공백) 단위 — 음절 중간 끊김(char-break) 금지** | Android 라인브레이커(ICU)는 한글 음절 사이를 항상 줄바꿈 가능 지점으로 봐, 긴 본문이 `구단주입\|니다`처럼 글자 단위로 쪼개져 가독성이 깨진다(관전형=보는 게임이라 본문 가독성이 품질 척도). ~~`textBreakStrategy='simple'`(2026-06-30)~~ 은 **실기기서 효과 없음**(breakStrategy는 음절 간 끊김을 못 없앰) + RN0.81 `Text`가 forwardRef 아니라 컴포넌트 래핑도 불가 — 2026-07-04 에뮬 검증서 드러남(미검증 fix를 완료 표기한 사각) | **웹 `word-break:keep-all` 격**: 인접 두 한글 음절 사이에 **WORD JOINER(U+2060)** 삽입(`lib/koreanLineBreak.ts keepAllHangul` — 공백·문장부호·이모지·라틴 불변). 주입은 **JSX 런타임(jsx/jsxs/jsxDEV) 전역 래핑**으로 `type===Text` children만 변형(`app/_layout.tsx installKoreanKeepAll(Text)`) → import 순서·구조분해 무관·전 화면 적용. **렌더 전용 fix라도 그 에뮬 사이클 안에서 육안 검증 필수**(미룸=미작동 은폐) | `tools/_dv_keepall.ts`(음절삽입·경계불변·이모지안전·멱등·A/B민감도, exit 0/1) · tsc 0 · 에뮬: 스포트라이트/인트로 본문이 `카드를\|누르면` 아니라 `카드를 / 누르면`(어절 유지) |
| **UI-23** | **사용자 자유 입력 `TextInput`은 `maxLength`(클라)와 서버 길이 상한을 둘 다 둔다** | 상한 없는 입력은 (a) 서버가 조용히 잘라 UX가 어긋나고(입력은 됐는데 저장은 잘림) (b) 거대 문자열로 DB·페이로드가 부풀 수 있다. 문의 등록 화면 `TextInput`이 클라 `maxLength` 없이 서버만 `slice(0,4000)` 이던 걸 실기 점검서 발견(2026-07-03) — 서버는 막지만 사용자는 잘린 걸 모름 | 앱의 자유 입력은 딱 2곳: **문의 내용**(`app/support.tsx` `maxLength={SUPPORT_MAX=2000}` + 우하단 `n/2000` 카운터, 최소 5자 `trim()` 검사 유지) · **쿠폰 코드**(`app/coupon.tsx` `maxLength={30}` — 자유 문자열(welcome·volleyball·season2627 등), `autoCapitalize="none"`+`trim()`. **대소문자 무관**: 서버 `normalizeCode`(대문자+trim)가 redeem·발급 양쪽 정규화, 발급도 1~30자. **재사용 방지=DB**: `coupon_redemptions` UNIQUE(proj,coupon,user)로 유저당 1회, redeem은 트랜잭션 내 onConflictDoNothing(동시 차단). 2026-07-04). 서버도 병행 상한: 티켓 `content.slice(0,4000)`·기기필드 32, 티켓 `content<5` 거절. **새 `TextInput` 추가 시 cl23 세트(클라 maxLength+서버 slice+trim 검사) 필수** | tsc 0 · `grep "<TextInput" app/`(2곳, 둘 다 maxLength 보유) · 서버 `api/ticket` slice(0,4000)+len<5 거절 · 에뮬: 문의 입력 2000자에서 더 안 쳐지고 카운터 표시 |
| **UI-22** | **zustand 셀렉터가 매 렌더 *새 객체/배열*을 반환하면 안 된다 — 무한 리렌더** | `useGameStore((s) => ({ ... }))`처럼 셀렉터가 새 객체 리터럴을 반환하면 zustand 기본 동등비교(`Object.is`)가 매번 "변경"으로 봐 setState→렌더→새 객체 루프 → **`Maximum update depth exceeded` / `The result of getSnapshot should be cached`** 로 화면이 죽는다(문의 등록 화면 진입 시 크래시, 실기 발견 2026-07-03 `app/support.tsx Compose`). **헤드리스/tsc는 못 잡음**(타입은 정상, 런타임 렌더 루프) — 실기 진입에서만 드러나는 상태-구독 사각 | **필드별로 개별 셀렉터**로 뽑는다(`const a = useGameStore(s=>s.a)`) — 각 필드는 스토어의 안정 참조라 루프 없음. 여러 필드 묶음 객체가 꼭 필요하면 `useShallow`(zustand/react/shallow)로 얕은 비교. **셀렉터 안에서 `({...})`·`[...]`·`.map`·`.filter` 새 참조 생성 금지**. 조립이 필요하면 콜백/`useMemo`에서 | tsc 0 · 에뮬: 문의 등록 화면 진입 크래시 없음(수정 전 무한 루프 → 후 정상) · `grep -rE "useGameStore\(\(s\) => \(\{" app/`(0) |
| **UI-21** | **모달/다이얼로그는 앱 테마 커스텀 모달만 쓴다 — 네이티브 `Alert.alert` 금지** | RN `Alert.alert`는 **OS 기본 다이얼로그**라 다크 글래스 테마(UI-7/10)와 이질적 — 흰 시스템 창이 떠 "왜 이런 창?"(실기 발견 2026-07-03, 감독 건의 결과). 면담·타임아웃 등은 이미 커스텀 모달인데 **감독 건의만 네이티브 Alert**라 불일치. 헤드리스/코드리뷰로는 안 드러나는 표시 계층 사각(UI-20 동류) | 공용 `components/Popup.tsx` — **`Popup`**(배경막+글래스 카드) · **`ActionSheet`**(선택형 시트) + **전역 `components/AppDialog.tsx`** — 명령형 **`showAlert(title, message?, buttons?)`**(Alert.alert와 동일 시그니처) + 루트(`app/_layout.tsx`)에 **`<DialogHost/>` 1개** 마운트. 버튼 style: default=민트/cancel=중립/destructive=코랄, 2개=가로·그외=세로. **전수 스윕 완료(2026-07-03)**: 9개 파일 41곳 `Alert.alert`→`showAlert` 치환·`Alert` import 제거(mypage7·staff9·transactions6·contracts5·shop4·support3·coupon3·schedule2·training-camp2). 감독 건의/재계약 등 선택형은 `ActionSheet`·화면별 `talkResult` 유지. **새 확인/선택/알림 UI는 `showAlert`/`ActionSheet`로 — `Alert.alert` 새로 쓰지 말 것** | tsc 0 · `grep -R "Alert.alert" app/`(실호출 0 — 주석만) · 에뮬 캡처: 문의 접수·쿠폰 등 결과가 다크 글래스 모달(시스템 흰 창 아님) |
| **UI-20** | **`Row`(space-between)에 라벨 + *가변 길이* 배지/텍스트를 한 줄로 두지 않는다 — 길면 잘린다. 자기 줄로 내리거나 `flexShrink`+`numberOfLines`** | `일정` "다음 경기" 카드 헤더 `<Row>`가 "다음 경기·날짜"(IconLabel) + "⭐ 중요 · 🔥 빅매치 — N위 vs M위" 배지를 **한 줄**에 뒀는데, `Row`=`rowBetween`(space-between·**no-wrap**)이고 두 자식 다 `flexShrink` 없음 → 빅매치 텍스트가 순위 라벨까지 붙어 길어지면 **카드 폭을 넘어 우측이 잘림**(실기기 발견 2026-07-03). **헤드리스 E2E(`_e2e_twocycle`)는 로직만 봐서 이 렌더 오버플로를 못 잡음** — 실기 캡처에서만 드러나는 표시-계층 사각(UI-13·15와 동류) | `app/(tabs)/schedule.tsx`: 헤더 `<Row>` 해제 → 날짜 `IconLabel`과 `bigMatch` 배지를 Card의 **세로 자식으로 분리**(배지 `alignSelf:'flex-start'`+`marginTop:6`) → 배지가 항상 자기 줄에 온전히. **일반 원칙**: space-between Row의 자식이 가변 길이면 (a) 별도 줄로 내리거나 (b) `flexShrink:1`+`Text numberOfLines`로 축소 — 폭 합이 넘쳐도 Row는 줄바꿈/축소를 안 한다 | tsc 0 · 에뮬 캡처(2026-07-03): 빅매치 배지가 날짜 아래 자기 줄에 온전히 표시, 잘림 없음(수정 전 우측 클립 → 후 정상) |
| **UI-19** | **테마 색을 쓰는 모듈 `StyleSheet.create`는 `themedStyles(() => …)`로 감싼다 — 다크/라이트 토글(2026-07-01)** | 사용자 요청: 라이트 모드(밝은 코트본) ↔ 다크 모드(변경 전 원본)를 **설정에서 전환**. RN `StyleSheet.create`는 **모듈 로드 시 색을 박제**해 리마운트해도 안 바뀐다 → 라이트로 켜도 카드/패널이 다크로 남는 버그(이전 "팀 종합 전력·연봉 영역 검은색" 보고와 동일 원인). Expo Go는 **동기 스토리지가 없어** 리로드식(부팅 시 저장모드 읽기)은 콜드부팅 첫 프레임을 못 맞춤 → **인스턴트(렌더 시 재평가)** 로 결정 | `components/theme.ts`: DARK/LIGHT 팔레트 + 공통색(SHARED) + **`theme` 객체 identity 고정·값만 `Object.assign`**(인라인 `theme.x` 사용처는 리렌더로 자동 반영) + `themedStyles(make)`(프록시가 항상 "현재 테마로 만든" 스타일 반환, 모드 변경 시 rebuild) + `useThemeMode`/`setThemeMode`/`loadThemeMode`(AsyncStorage 저장). `Screen.tsx`가 재-export. **적용 순간 = 루트 리마운트**: `app/_layout.tsx` `<SafeAreaProvider key={mode}>` → 전 화면이 새 스타일로 다시 그려짐(사용자의 "적용하면 로딩하면서 처리" 요구를 리마운트로 충족). `StatusBar`·전역 Text 기본색도 모드 동기. **전 화면(약 44파일) 모듈 StyleSheet를 `themedStyles`로 래핑**. 시네마틱 하드코딩 색(코트·현수막 등)은 자체 색이라 무영향(UI-9) | tsc 0 · 에뮬 캡처: 설정 라이트 토글 → 대시보드/선수단/단장실/마이페이지 밝은 카드+검은 글씨로 전환, 다크 토글 → 원본 복귀. `grep` 모듈 `StyleSheet.create(`가 전부 `themedStyles(() =>` 뒤 |
| **UI-18** | **persist 쓰기는 디바운스로 합친다 — 매 `set()`마다 전체 세이브 직렬화+쓰기 금지** | zustand persist는 매 set()마다 `partialize`(=`captureSimCache()` 전 생산행 직렬화) + `JSON.stringify`(results·simCache·playerBase·archive…) + AsyncStorage 쓰기를 동기로 돌린다. 시즌이 쌓이면 이 한 번이 커져, 트라이아웃 위시 토글처럼 연속 set이 일어나는 화면에서 **매 탭 5~10초 멈춤**(실기기 A6, 2026-07-01). 측정: 오프시즌 재계산은 ~100ms로 평탄 → 범인은 영속 쓰기 | `store/persistStorage.ts debouncedAsyncStorage`(500ms 디바운스 — 직렬화+쓰기를 연타 멈춘 뒤 1회로 합침, AppState 비활성 시 즉시 flush). **저장 내용 불변**(무엇을 저장하는지 안 바뀜 → 세이브/결정론 무영향). createJSONStorage 교체 | 기존 세이브 정상 로드(실기 확인) · 토글 연타 시 멈춤 없음 · tsc 0 |
| **UI-17** | **쿨다운/대기 버튼은 남은 시간을 실시간 카운트다운으로 보여준다** | 광고 보상 재탭 시 "잠시 기다려 주세요"만 뜨면 얼마 남았는지 모른다. 엔진(`canWatchAd`)이 `msLeft`를 주는데 UI가 안 썼다(A4) | `app/(tabs)/mypage.tsx`: 1초 틱(`setInterval`) `now` + `canWatchAd(adState, now)` → 버튼에 "29분 59초 후"(쿨다운)·"오늘 광고 끝(하루 8회)"(cap)·"광고 보고 +50 💎"(가능) + 비활성. `Date.now()`는 UI 런타임(엔진/시드 무관) | 실기 확인(2026-07-01): 적립 후 +50·버튼 "29분 59초 후"로 전환·비활성 |
| **UI-16** | **선수 능력 가시성 = 소유×스카우터** — 내 팀=전부+포텐 공개, 타 구단·드래프트 유망주=스카우터 공개도만큼만 흐리게 | 포텐을 보여주되(육성 계획), 정보 우위는 *내 팀*에 한정. 타 구단까지 다 보이면 스카우터가 무의미·"안목" 재미 소실(2026-06-30 사용자 설계). 스카우터는 **제거 아님, 역할 확장**(드래프트 유망주만→타 구단 선수까지) | `engine/overall.ts fogOvr/fogStat`(공유 헬퍼) · `StatBar{potential,reveal}` · `RosterList{reveal}` · `app/player/[id]`(isMine→reveal 1+포텐 틱, else `teamScoutReveal(myTeam)`로 OVR·바 흐림+스카우팅 안내) · `app/team/[id]`(타 구단 RosterList reveal). 엔진 `scoutMult`(AI 픽 노이즈)·세이브·결정론 **무변**(표시 전용) | tsc 0 · 실기: 내 선수=포텐 "→NN" 틱, 타 구단 선수=흐린 OVR/바+안내, 드래프트 안개 유지 |
| **UI-15** | **새 푸시 스크린(app/*.tsx)을 추가하면 `app/_layout.tsx` Stack.Screen에 한국어 `title`(또는 headerShown:false)을 반드시 등록** | expo-router 스택 헤더는 등록이 없으면 **파일명(라우트명)을 그대로 헤더에 노출** — `awards-ceremony` 화면 상단바에 영문 "awards-ceremony"가 떴다(실기기 발견 2026-06-30). 큰 제목(`Screen` 컴포넌트)은 한글이라 놓치기 쉬움(헤더는 별도) | `app/_layout.tsx`: `<Stack.Screen name="awards-ceremony" options={{ title: '시상식' }} />` 추가. **형제 사냥**: app 루트 .tsx 전수 ↔ _layout 등록 대조 → `draft-live`도 미등록(라이브 드래프트 보기로 진입)이라 `title: '라이브 드래프트'` 추가. 나머지 전 화면은 등록 확인 | 실기 E2E: 시상식·드래프트 화면 상단바 한글 표시. `ls app/*.tsx` ↔ `grep name= _layout` 대조 0 미등록 |
| **UI-14** | **코트/고정높이 컨테이너 위 마커 = 라벨(이름·팀)이 컨테이너 밖으로 안 잘리게 여백 확보** | 시즌 결산 베스트7 코트(높이 300px)에서 리베로 마커를 맨 아래(top 84%)에 두니 마커 *아래* 붙는 이름·팀명이 코트 하단에 **잘렸다**(실기기 관찰 2026-06-30). %기반 절대배치는 마커 중심만 잡고 그 아래 텍스트(마커40+이름+팀 ≈50px)는 계산에서 누락되기 쉽다 | `components/Best7Court.tsx`: 리베로 슬롯 top 84%→**76%**(마커+2줄 라벨이 300px 안에 ≈13px 여유로 들어옴). 후위 행(60%)과도 충돌 없음. 일반 원칙: 마커가 하단 가장자리 근처면 라벨 높이만큼 위로 당기거나 라벨을 마커 위로 | 실기 시각 — 베스트7 7마커 전원 이름·팀명 안 잘림 |
| **UI-13** | **화면 전환 직후 무거운 동기 작업 = 전환 완료 + 첫 페인트를 보장한 뒤 실행(`runAfterInteractions` 재범 금지)** | 드래프트 "시즌 시작하기" → `season-start`로 이동 후 `endSeason`(오프시즌 합성, 실기기 ~15s 동기 블록)을 `InteractionManager.runAfterInteractions`로 미뤘더니 **전환/페인트보다 일찍 발화** → 블록이 **직전 화면(드래프트)을 그대로 얼린 채** 돌아 브랜드 로딩이 끝까지 안 보였다(실기기 45프레임 ≈18s 전수 드래프트 동결, 2026-06-30). **UI-4가 이미 "runAfterInteractions는 페인트 보장이 약하다"고 박았는데 신규 화면에서 재범**(형제 재발). 여기에 **화면 전환(≈350ms)** 변수까지 겹쳐 더 악화 | `app/season-start.tsx`: `setTimeout(500ms — 전환 ≈350ms 초과) + 2×requestAnimationFrame`으로 전환 완료 + 로딩 첫 페인트 보장 후 `endSeason`. 그러면 로딩이 최상단으로 그려진 상태에서 블록 시작 → 사용자가 본다. **정정(2026-06-30): 네이티브 애니(useNativeDriver)도 에뮬 블록 중엔 멈춘다**(MD5 8프레임 실측 — 블록 전 프레임만 움직임). 옛 "여러 공 통통/서브연습" 안은 공이 바닥에 정지해 보여 사용자가 거부 → **단순 원형 스피너**로 교체(멈춰도 그냥 정지한 동그라미라 거슬리지 않음, 사용자 요청). 진짜 순차 메시지/연속 회전은 `endSeason` 청크화(yield) 필요 — 결정론·더블탭 게이트 리스크로 보류. 형제(`useDeferredReady`·`staff` busy)는 **블록이 짧고(≤2s) 이미 로딩을 먼저 그려** 저위험(전환 없음/짧음) — 현 동작 유지, 동급 재발 시 동일 수술 | tsc 0 · 실기 E2E: 광고 확인 직후 ~수초 캡처 시 **브랜드 로딩(드래프트 아님)** 표시 + 스피너 회전(sp1~sp5 5프레임 상이). SEASON_SYSTEM §5.5 D |
| **UI-12** | **카테고리 장식 색 — 다크 베이스 유지 + 카드/메뉴마다 다른 액센트(2026-06-28)** · **클릭/비클릭 카드 어포던스 = 좌측 accent 줄무늬+그림자 vs `flat`(2026-07-12)** | 시네마틱 글래스(UI-7) 다크 전환 후 민트 단색이라 "전부 어둡고 단조롭다"(사용자, 타 게임 구단관리 화면 — 카드마다 보라/초록/빨강/골드/파랑 색띠 참조). 베이스는 다크 유지하되 카테고리를 **색으로 구분**해 활기. **또(2026-07-12 테스터)**: 좌측 accent 줄무늬가 **클릭 어포던스로 오인** — "클릭 안 되는데 좌측 보더가 있어 클릭돼 보인다"(정보 표시용 카드에도 줄무늬가 붙어 탭 가능처럼 보임) | 테마에 **장식 색 토큰** 추가(`components/Screen.tsx`): `violet #9B7BFF`·`sky #46C8FF`·`rose #FF7BA6`(+기존 accent/elite/good/warn/bad). 의미색(good=승·bad=위험)과 별개의 **순수 장식**. 공용 `Card`에 `accent?` prop → **좌측 4px 컬러 바**(borderLeftWidth, 라운드 자동 준수). 공용 `IconLabel`(아이콘+보조라벨, 단일 소스 — UI-3 재구현 금지). 1차: 대시보드 4카드(전력=elite·재정=warn·순위=accent·뉴스=violet) 색띠+컬러 아이콘. **전 화면 확장 완료(2026-06-28)**: 단장실·일정·선수단·기록·구단정보·선수정보·감독·순위·계약·스태프·드래프트·FA·트라이아웃·이동·업적·포스트시즌·결과(20화면). 컨벤션(카테고리→색): 전력=elite·재정=warn·팬=rose·순위/선수=accent·뉴스/감독스태프/특성=violet·일정/영입=sky·외국인/부상/방출=bad·훈련=good·트로피/명예전당/통산/업적=gold(한정). 개발도구·이미 스타일된 화면(match보드·온보딩·select-team·settings)은 제외. **클릭/비클릭 어포던스 규칙(2026-07-12)**: `onPress` **있는** Card = **좌측 accent 줄무늬 + 그림자(입체감) = 탭 어포던스**(`styles.card`) / `onPress` **없는** 정보 카드 = **`flat` 변형**(그림자 없음 + 상하좌우 얇은 accent 보더 = "버튼 아님" 신호, `styles.cardFlat`). **규칙: onPress 없는 Card는 flat.** 비클릭 카드 **126개를 flat으로 전수 교정**(app/ 32파일 + `components/Screen.tsx` Card `flat` prop 신설) | tsc 0 · 실기 시각 — 홈 화면 카드별 색 구분·아이콘. 골드는 트로피 한정(UI-7) 유지. **어포던스(2026-07-12)**: 에뮬 — 감독정보 전부 flat / 단장실 정보카드=flat·메뉴카드=줄무늬+그림자+화살표 대비 또렷 |
| **UI-11** | **앱 인트로(스플래시) + 실연동 로딩 게이지(2026-06-28)** | 첫 진입 임팩트 + 준비(폰트 로드·세이브 복원) 동안 빈 화면 대신 브랜드 연출. 게이지는 **가짜 진행 금지** — 실제 준비에 연동(관전형 품질·정직) | `components/IntroSplash.tsx`: 풀스크린 일러스트(`assets/bg/intro.jpg` — 뒷모습 스파이크 + 골드 "배구명가" 로고, 이름 없는 등판) + 하단 민트 게이지. 준비 전 ~85%까지 차오르며 대기, **`ready=fontsLoaded && hydrated`** 되면 **무거운 워밍(시즌 순위·생산·dyn 재계산)을 인트로 단계에서 실행한 뒤** 100%로 채우고 진입. `app/_layout.tsx`가 `introDone` 전까지 게이트 + `warmCachesForIntro`(운영 구단 있으면 `computeStandings/leagueProduction/availableTeamPlayers` MAX 워밍) → 진입 후 대시보드 즉시(중복 로딩 0). **왜 워밍을 인트로에서**: `ENGINE_VERSION` 범프(예: 체력 튜닝) 후 첫 진입은 저장 캐시 무효→1회 재계산(~수초). 이를 대시보드 첫 렌더로 미루면 "**100%인데 멈춤**"으로 보였다(사용자 보고) → 100%=진짜 준비완료가 되도록 워밍을 바 완성 전에 끝낸다 | tsc 0 · 앱 첫 실행 시 게이지 0→100%, 100%에서 즉시 진입(엔진 범프 후 첫 회는 ~85%에서 잠시 대기) |
| **UI-10** | **팝업은 다크 배경 위에서도 경계가 또렷해야 — 진한 배경막 + 불투명 카드 + 보더/그림자** | 다크 테마(UI-7) 후 팝업 배경막이 `#15202B80`(다크 슬레이트 50%)라 **이미 다크인 경기 보드 위에선 거의 안 어두워져** 뒤가 비치고, 반투명 카드(theme.card)가 보드와 섞여 "어디부터 어디까지 팝업인지" 안 보였다(사용자 보고 — 실시간 기록 팝업, 2026-06-28) | 공용 `components/Popup.tsx`: 배경막 `rgba(7,10,16,0.82)`(뒤 가라앉힘) + 카드 **불투명 `#161E2E`**(배경보다 한 톤 밝게) + `borderWidth:1`(헤어라인) + 큰 그림자(elevation14) → "떠 있는 패널". 전 팝업 공용이라 일괄 적용. **`statusBarTranslucent`(2026-06-28)**: 안드로이드 Modal은 기본이 상태바 영역을 안 덮어 **배경막 상단(스코어보드 등)이 새어 안 어두워졌다**(사용자 보고 — 타임아웃 모달). Modal에 `statusBarTranslucent`로 전체 화면 덮음. raw `<Modal>`도 동일(settings 초기화·player 면담). **단 `Spotlight`는 하이라이트 좌표가 윈도우 기준이라 제외**(좌표 틀어짐) | 다크 화면 위에서 팝업 진입 시 배경이 **상단까지** 확실히 어두워지고 카드 경계 또렷 |
| **UI-9** | **다크 배경 = 텍스트 기본값 밝은색 + 중요 정보는 포인트색(빨강 등) — 어두운/색없는 글씨 금지** | RN `Text`는 색 미지정 시 **검정** → 다크 배경(UI-7)에서 묻힌다. 또 중요 정보(경고·위험·강조)는 한눈에 띄게 포인트색이어야 한다(사용자: "텍스트는 거의 다 밝은 계열, 중요한 건 빨강 등 포인트", 2026-06-28 전 화면 점검) | **전역 기본 색**: `app/_layout.tsx` `Text.defaultProps.style`에 `color: theme.text`(밝은 잉크) 추가 → 색 빠뜨린 텍스트가 전부 밝게(명시 색은 우선 — 라이트 표면[코트·중계 현수막·헌액 골드버튼]은 자체 색 보유라 무영향, 확인됨). **포인트색 시맨틱**: `theme.bad`(빨강=패/위험/외국인)·`good`(초록=승/긍정)·`warn`(앰버=주의)·`accent`(민트=프라이머리/링크)·`gold`(우승/트로피만). **하드코딩 색 금지**(테마 우회 시 다크에서 깨짐 — 예: hsl 팀컬러에 `+'22'` 알파append=불투명 버그, hsla()로). 정상 화면은 전부 theme 토큰 사용 | 전역 grep: `color:\s*['"]#[0-4]`(다크 글씨)·`backgroundColor:\s*['"]#[B-F]`(라이트 배경)이 **개발도구/세리머니/코트/현수막 외 0건** · 새 화면 텍스트는 theme.text/muted, 중요=포인트색 |
| **UI-8** | **화면 전환 = 가로 슬라이드 + 네이티브 루트 배경 다크(2026-06-28) — 뒤로가기 흰 화면 금지** | 스택 화면 이동에 애니메이션이 없고(사용자: "옆으로 이동하는거 필요"), 뒤로가기 시 드러나는 이전 화면이 **흰색**(사용자 보고). **근본원인(코드 추적)**: ① expo-router `NavigationContainerInner`가 `theme=DefaultTheme`(흰 배경)를 기본으로 native-stack에 줌 ② `app.json` `backgroundColor` 미설정(=흰색 윈도) + `userInterfaceStyle: automatic`(기기 라이트모드 추종). 전환 중 native 화면 배경이 흰색으로 드러남. **JS `<ThemeProvider>`는 `useTheme`만 바꿔 native 배경엔 무효** — app.json/네이티브 레이어를 고쳐야 함 | ① `app.json`: `backgroundColor: "#0B1018"` + `android.backgroundColor` + `userInterfaceStyle: "dark"`(항상 다크 앱 — 우리 테마는 자체 `theme`라 OS모드 무관) → **네이티브 루트/윈도 배경 다크**(전환 reveal도 다크). ② `app/_layout.tsx`: `Stack animation: 'slide_from_right'`(가로 슬라이드) + `<ThemeProvider value=NAV_THEME(DarkTheme 기반)>`(JS 레이어 다크) + `contentStyle.bg=theme.bg`. **app.json 변경은 Metro 재시작 + 앱 완전 재시작 필요**(설정은 번들러 시작 시 읽음) | tsc 0 · 실기: 슬라이드 전환·뒤로가기 시 **흰 화면 없음**(다크 유지). app.json 반영은 앱 완전 재시작 후 |
| **UI-7** | **테마 = 시네마틱 글래스(2026-06-27 결정) — 골드 절제·다크 경기장·글래스 카드·팀컬러 강조 1개** | 기존 라이트/골드 과장 테마가 "촌스럽다"(사용자) — 가챠/농사게임 톤. 최신 정장르(FM26 Tile&Card·EA FC)는 *절제·여백·정보 카드*. 첫 화면 첫인상 = 게임 아이덴티티 | **구단 선택 화면 1차 적용**: `app/select-team.tsx` 전면 재구현 — 다크 그라데이션+코트 SVG 배경, 반투명 글래스 카드(rgba+보더+그림자), **팀컬러=clubIdentity.hue→`hsl()`**(좌측 액센트 바·칩·순위 그래프), 엠블럼 7+로고(`assets/clubs/`, GPT 생성→Pillow 누끼→320px 경량화), 최근순위 SVG 그래프. 새 의존성 0(react-native-svg). 로고만 골드 허용. **순위는 그래프→숫자 셀로 교정**(2026-06-27, 사용자: "그래프는 등수가 안 보인다" — 시즌별 N위 숫자, 1위=골드·2~3위=팀컬러). **배경 이미지**: `assets/bg/court.png`(GPT 생성 다크 아레나, ImageBackground+스크림). **전역 적용(2026-06-27)**: 단일 소스 `components/Screen.tsx`의 `theme`를 **라이트→다크 글래스로 전환**(키 그대로·값만: `bg #0B1018`·`card` 반투명 글래스·`text #F2F5FA`·`muted`·`border` 등) + `Screen` 래퍼에 `ImageBackground`(다크 아레나)+스크림(0.5) → **39개 화면 자동 재스킨**. `app/_layout`·`(tabs)/_layout` 헤더·탭바·`StatusBar` 다크화. 하드코딩 색 화면 스윕(enshrine·supporter·settings·match 등). select-team은 로컬 팔레트 유지(값 동기). 로고만 골드. **가독성 교정(2026-06-28)**: 흰색 반투명 카드(`rgba(255,255,255,0.06)`)는 뒤 코트·네트가 비쳐 내용 집중이 어렵다는 사용자 보고 → **카드를 다크 반투명**(`card rgba(16,22,34,0.86)`·`cardAlt rgba(40,50,68,0.92)`)으로 배경 차폐, 보더 `0.14`로 엣지 강화, 스크림 `0.5→0.62`(records·onboarding·select-team 동기). **버튼 글래스화(2026-06-28, 사용자 선택)**: 공용 `Button`이 옛 톤(알약·납작 솔리드)이라 겉돈다는 보고 → 솔리드+글로우 1차안은 변화가 미미("그대로")라 사용자가 **글래스 버튼** 채택. primary = 카드와 같은 **14R + 액센트 글래스(`accentGlass rgba(25,194,174,0.16)` 민트 틴트 반투명) + 민트 보더 1.5 + 민트 글씨 + 액센트 글로우**(유리판처럼 얹힌 CTA), ghost = 중립 다크 글래스(`card`)+헤어라인. `btnText` 색 흰색→민트(accent). 자체 CTA(player 다이얼로그·onboarding)도 동일 톤 동기. (주의: 색값은 Fast Refresh로 즉시, **버튼 라운드/그림자 StyleSheet 변경은 풀 리로드 필요** — 1차안이 안 보였던 원인) | tsc 0 · `expo export` 번들 OK · 실기 시각 확인(전 탭·주요 화면 가독성·버튼) |
| **UI-6** | **로딩 표시는 맥락에 맞게 — 콘텐츠 화면은 그 레이아웃을 닮은 스켈레톤, 앱/워밍 게이트는 브랜드 연출** | 맨 스피너는 "내용이 온다"는 정보를 안 준다(관전형 1순위 — 보는 경험 품질). 리스트/카드 화면은 **스켈레톤**(카드 골격 시머)이 곧 올 내용을 예고해 체감 대기를 줄이고, 앱 첫 진입·무거운 재계산처럼 *콘텐츠 모양이 아직 없는* 긴 대기는 **브랜드 연출**(워드마크+코트 모션)이 적합(2026-06-27) | **단일 소스 `components/Screen.tsx`**: `Skeleton`(Animated opacity 루프 시머, `useNativeDriver` — Expo Go 안전, 새 의존성 0) + `Loading`에 `variant?: 'spinner'\|'list'\|'brand'`. **list**(스켈레톤 카드 5줄)=콘텐츠 화면 8개(news·history·records·draft·draft-live·fa·tryout·asian-tryout). **brand**(워드마크 "배구명가"+SVG 코트 위 **원형 스피너**(회전 링) — 2026-06-30 정정: 옛 통통 공/여러 공 안은 무거운 블록 중 네이티브 애니가 멈춰 바닥에 정지해 보여 거부, UI-13)=`(tabs)/_layout` 복원 게이트·`team/[id]` 확정·`staff` 재계산. spinner=기본(미지정 폴백). **로딩 게이트 로직(UI-1·UI-4)은 불변** — 표시만 교체 | tsc 0 · `npx expo export` 번들 OK · `grep -rn "variant=\"list\"\|variant=\"brand\"" app/`(콘텐츠 8·게이트 3) · 무거운 화면 진입 시 스켈레톤, 앱 시작/구단 확정 시 브랜드 |
| **UI-5** | **전체화면 빈 상태(데이터 없음)는 공용 `EmptyState`로 화면 가운데 정렬 — 상단 좌측 박스 금지** | 데이터 없을 때 안내문이 상단에 좌측 정렬되면 휑하고 어색(사용자 보고 2026-06-24, 경기 결과 화면). 화면마다 박스/카드/맨텍스트 제각각이라 디자인도 안 모임 | **`components/Screen.tsx EmptyState`**(flex:1 가운데 정렬) — `<Screen scroll={false}>` 안에서 써서 세로 중앙. 적용: `results`·`news`(전체화면 빈 상태). **섹션 단위 "없음"**(다른 내용과 함께 뜨는 — draft 풀·records 카테고리 아래 등)은 인라인 Card/Muted 유지(전체 중앙 금지) | 빈 상태 화면 진입 시 안내문이 화면 가운데. `grep -rn EmptyState app/` |
| **UI-4** | **무거운 결정론 캐시는 그걸 유발한 액션의 로딩 뒤에서 미리 데운다 — 도착 화면 첫 렌더에 떠넘기지 않는다** | 시즌 결과(`allResults`)·생산(`leagueProduction`)은 전 시즌 결정론 시뮬이라 **첫 호출 ~1.8s**(이후 baseVersion 캐시로 0ms). 구단 확정 후 그냥 이동하면 스케줄/대시보드 **첫 렌더가 그만큼 멈춤**(도착 화면엔 로딩 게이트 없음) — "운영하기 누르니 오래 대기·로딩 없음"(2026-06-24 사용자 보고) | `app/team/[id].tsx` 구단 확정 effect: `setStarting(true)`로 `<Loading>`를 띄우고 **`requestAnimationFrame` 2프레임(UI-1 rAF×2) 뒤에서** `selectTeam`+`computeStandings(MAX)`+`leagueProduction(MAX)` 워밍 → 이동 후 스케줄·대시보드는 캐시라 즉시. (구 `InteractionManager.runAfterInteractions`는 페인트 보장이 약해 로딩이 안 뜨고 멈춘 듯 보였다 — 2026-06-24 rAF×2로 교정.) 로딩 메시지가 곧 그 작업. **스태프(`app/staff.tsx`)**: 감독·코치 영입/방출/경질은 `baseVersion`을 무효화해 화면의 부진경고용 `computeStandings`가 전 시즌을 재시뮬(폰 체감 ~1분, 2026-06-24 사용자 보고) → `busy` 게이트로 `<Loading "시즌 전력 다시 계산 중…">`를 먼저 그리고 `InteractionManager` 뒤에서 영입 실행+`computeStandings` 워밍(네이티브 스피너라 JS가 막혀도 회전) 후 본문은 워밍 캐시로 즉시. **모든 영입/방출은 confirm**. 스카우터·재계약은 무효화 없음(STAFF_SYSTEM 교정) → busy 없이 즉시 | 워밍 후 `computeStandings`/`leagueProduction` 재호출 0ms(캐시). 구단 선택 시 "시즌 일정 구성 중" 로딩 뜨고, 스케줄 진입 즉시. 스태프 코치 영입 시 로딩 뜨고 confirm 묻고, 스카우터는 즉시 |
| **UI-3** | **포지션 배지/색은 공용 컴포넌트·단일 토큰만 쓴다 — 화면마다 재구현 금지** | 같은 디자인을 화면마다 따로 그리면 디자인 변경이 한 곳에 안 모이고 **복붙 드리프트**가 생긴다(실제: `POS_COLOR`가 5곳에 복사돼 BoxScoreTable의 S색이 `#2FB48E`로 어긋남, PosTag는 고정폭이 없어 S·L(1자)/OH·OP·MB(2자) 배지 너비가 들쭉날쭉, 2026-06-24 사용자 보고) | **단일 소스** `components/posTokens.ts`(`POS_COLOR`·`POS_LABEL`·`POS_ORDER`). **배지는 공용 `PosTag`**(`components/Screen.tsx`) 하나 — 약어는 **고정 minWidth 34**로 정렬, `solid`/`compact` 변형(테이블=박스스코어), `full`=한글 풀라벨. BoxScoreTable·RosterList·MatchCourt·board-lab·debug-court 전부 토큰/PosTag로 통일(로컬 POS_COLOR 0) | `grep -rn "const POS_COLOR\|const POS_LABEL\|const POS_ORDER" app/ components/` → **posTokens.ts 외 0건**. 새 화면이 포지션 표시하면 PosTag 사용(인라인 배지 재구현 금지) |
| **UI-1** | **무거운 동기 작업은 로딩 표시 + 실행 버튼 비활성** | N회 반복 시뮬·무거운 셀렉터는 JS 단일 스레드를 막아 화면이 멈춤. 사용자가 "멈췄나?" 헷갈리고 중복 클릭 위험 | **sim-web**: `runHeavy`/`maybeHeavy`(`sim-web/main.ts`) — 버튼 `disabled`+"실행 중…"+스피너 표시 후 **rAF×2로 페인트 양보**하고 루프 실행, 완료 시 복구. 임계 `HEAVY_AT=100`. **앱**: `Loading`·`useDeferredReady`(`components/Screen.tsx`) — 무거운 화면(news·history·records·draft·fa·tryout 등) 첫 프레임 로딩 후 다음 틱 마운트 | sim-web: N=5000 실행 시 버튼 disabled·로딩 보임·완료 후 결과(브라우저). 앱: 무거운 화면 진입 시 로딩 게이트 |
| **UI-2** | **스크롤 영역(ScrollView/FlatList)을 Pressable·Touchable로 감싸지 않는다** | 모달 카드/배경을 Pressable로 두면(밖 탭 닫기용) 그 위의 가로 ScrollView 드래그를 **Pressable이 제스처로 가로채** 스크롤이 아예 안 먹는다. 레이아웃상 내용폭>뷰포트라 스크롤 가능한데도 손가락이 안 통한다(스코어박스 가로 스크롤 먹통의 진짜 원인, 2026-06-23) | 공용 `components/Popup.tsx` — 밖 탭 비활성(dismissable=false, 우리 팝업 전부)이면 배경·카드를 **일반 View**로(배경 터치는 먹어 뒤 화면 오작동은 막되 자식 ScrollView pan은 안 가로챔). dismissable일 때만 Pressable. 표 가로 스크롤은 **세로 중첩 없는 단일 가로 ScrollView + 내용에 명시적 폭**(`LiveBoxModal` `TABLE_W`) | 디바이스에서 표를 좌우로 밀어 리시브·범실까지 보임. **구조 변경(중첩·Modal→Popup·Pressable→View)은 Fast Refresh로 안 먹어 풀 리로드 필요** |

> **UI-28 (2026-07-08 사후 등재 — 내비 커밋 34eb5b9 규칙 명문화)**: **오프시즌 체인(정산 이후 ~~season-start→training-camp→enshrine~~ → **정정 2026-07-08: season-start→enshrine→training-camp→season-opening**, 드래프트 라이브 포함)은 뒤로가기 불가가 정본** — 소비된 결정 화면(드래프트/FA)으로 되돌아가면 다음 오프시즌으로 상태가 누수된다. 체인 화면은 ①헤더백 숨김+제스처 off ②beforeRemove GO_BACK/POP 차단 ③종료는 dismissAll()+replace()(스택 잔재 0)로 잠근다. draft-live도 같은 규칙(오프시즌 게이트+완료 후 재진입 불가). 체인 마지막 dismissAll+replace는 이제 **season-opening(개막 브리지)** 가 수행(구: enshrine).

> **UI-29 (2026-07-08 — 에뮬레이터 세리머니 흐름 육안 발견)**: 세리머니/헤더 두 건 수정. **(A) 라우트 등록**: `champion-ceremony`(우승 시상식)가 `app/_layout.tsx` Stack에 미등록이라 네이티브 헤더가 파일/라우트명 "champion-ceremony"(영문)를 축하 화면에 노출 — UI-15 형제 재발. `<Stack.Screen name="champion-ceremony" options={{ title: '시상식' }} />` 등록으로 교정(awards-ceremony 인근). **(B) 타이틀↔상태바 겹침**: `headerShown:false` 화면(enshrine·season-opening·champion 등 세리머니)은 네이티브 헤더가 없어 `components/Screen.tsx` 타이틀이 top:0에 렌더돼 상태바(시계)와 겹쳤다 — 원인은 Screen의 SafeAreaView가 `edges` top을 제외해 top inset이 안 붙음. **SafeAreaView edges에 `'top'` 추가**로 교정. ~~**회귀 0 근거**: `react-native-safe-area-context`의 SafeAreaView는 **헤더-인지적** — 네이티브 헤더 화면(전 Tabs/대부분 Stack)은 안전영역 프레임이 헤더 아래에서 시작해 top inset이 0에 수렴하므로 이중 여백이 안 생기고, 헤더 없는 화면만 top inset=상태바 높이가 붙어 타이틀이 내려온다. `useSafeAreaInsets().top`(raw)은 헤더를 몰라 이중 패딩을 만드니 금지 — 반드시 SafeAreaView(edges) 사용.~~ **← 정정(2026-07-12, UI-41): 이 "헤더-인지 → top 0 수렴" 근거는 실기기에서 안 먹었다** — SafeAreaView는 헤더를 몰라 헤더 화면에도 top inset을 붙여 헤더 아래 ~28dp 빈 band가 고정으로 남았다. 실제 교정은 UI-41(HeaderShownContext로 헤더 유무를 직접 판정) 참조.

> **UI-30 (2026-07-10 — 비차단 하단 토스트 규칙)**: 관전형 흐름을 **끊지 않고** "방금 무슨 일이 일어났나"만 스쳐 알릴 땐 **하단 토스트**를 쓴다(모달 아님). 공용 `components/Toast.tsx`: `useToastQueue()`(`{toasts, push}`) + `<ToastHost toasts/>`를 `Screen`의 **`overlay` 슬롯**(ScrollView 밖 = 뷰포트 하단 고정)에 건다. **규칙**: ① **모달 금지**(`pointerEvents:none`으로 터치 통과 — 사용자를 막지 않는다) ② **2~3초 자동 소멸**(현 2.6초) ③ 연속 발생은 **큐**로 쌓되 화면엔 **최대 최근 3건** ④ 문구는 **실제 데이터에서만 파생**(가짜 드라마 금지). BusyOverlay(UI-27, 차단형 Modal)와 반대 축 — 무거운 작업 대기는 오버레이, 결과 변화 알림은 토스트. 첫 적용: FA 시장 변화 피드백(FA_SYSTEM §2.8.7).

> **UI-31 (2026-07-11 — 비동기 트리거(광고) 버튼 재진입 가드)**: 광고를 띄우는 버튼("시즌 시작하기"의 전면광고 · "광고 보고 +💎"의 보상형)은 광고 모달이 뜨기까지 수백ms~수초의 **비동기 공백**이 있어 그 사이 연타되면 광고가 **중복 발동**한다(사용자 보고 2026-07-11 — "광고가 뜨기 전 연속으로 눌린다"). BusyOverlay(UI-27, 무거운 **동기** 블록)와 달리 여기선 JS가 안 막혀 사전 페인트 스피너로는 못 막는다 → **동기 재진입 가드**가 필요: ① 탭 즉시 **`useRef` 래치**(state 갱신은 비동기라 같은 프레임의 두 번째 탭이 stale 값을 봐 통과 — **ref만이 동기 차단**) ② 버튼 `disabled`+로딩 라벨(체감 피드백) ③ **`finally`로 반드시 해제**(광고 실패·미로드·오프라인·빈도캡이어도 버튼 영구 잠김 금지 — `showSeasonStartAd`는 항상 resolve라 정상 경로는 네비게이션으로 언마운트). 적용 버튼:
> | 화면 · 버튼 | 광고 종류 | 가드 구현 |
> |---|---|---|
> | `draft` · `draft-live` — 시즌 시작하기 | 전면 `showSeasonStartAd()` | `startingRef`(동기 래치) + `starting` state → 라벨 "시즌 준비 중…"·disabled, `try/finally` 해제 |
> | `mypage` — 광고 보고 +💎 | 보상형 `showRewardedForDiamonds()` | store `walletBusy` 래치(watchAdForDiamonds가 **첫 await 전 동기 `set`**) + 버튼 `disabled` + "적립 중…" 라벨 |

> **UI-32 (2026-07-11 — 성공 무피드백 금지)**: 사용자 액션의 **성공 경로**는 반드시 눈에 보이는 반응을 남긴다 —
> ⓐ showAlert ⓑ 토스트 ⓒ 화면 전환 ⓓ 즉시 보이는 상태 변화(행 이동·뱃지·숫자) 중 최소 1개. "실패만 알림,
> 성공은 침묵" 패턴 금지(사용자 보고 2026-07-11 — "행동을 했는데 피드백이 없다"). 전수 스윕에서 걸린 4곳:
> 재계약 제안(contracts — 별도 격상 트랙) · FA 오퍼 갱신(fa — 토스트 추가) · 스태프 영입(staff — 완료 알림 추가) ·
> 시즌 중 영입(transactions — 완료 알림 추가). 새 액션을 추가할 때 이 체크리스트로 자가 검사.

> **UI-33 (2026-07-11 — 공용 Button 내비게이션 래치)**: 공용 `components/Screen.tsx Button`은 onPress 발화 후 **`BUTTON_LATCH_MS`(600ms) 동안 재발화를 무시**한다 — 연타로 같은 화면이 두 번 push 되거나 액션이 이중 실행되는 것을 막는다(테스터 보고 2026-07-11). **동기 `useRef` 래치**여야 한다: state 갱신은 비동기라 같은 프레임의 두 번째 탭이 stale 값을 봐 통과하므로(UI-31 광고 래치와 같은 원리) ref만이 확실히 차단. UI-31(광고 트리거 전용)과 **구분되는 일반 규칙** — 모든 Button에 무조건 적용. 시간 경과로 자동 해제(영구 잠금 없음). **영향 범위**: `Button` 컴포넌트만 — 스텝퍼/토글 등 고빈도 Pressable 직접 구현은 Button을 안 써서 무영향(확인). disabled Button은 Pressable이 이미 차단.

> **UI-34 (2026-07-11 — 탭바 하단 safe-area 여백)**: `app/(tabs)/_layout.tsx` `tabBarStyle`은 **safe-area inset**(홈 인디케이터/제스처 바)을 반영한다 — `height: 60 + insets.bottom` · `paddingTop: 8` · `paddingBottom: insets.bottom + 8`(`useSafeAreaInsets`). inset이 0인 기기에도 상·하 최소 여백(8)을 둬 라벨이 바 하단에 붙어 잘려 보이던 문제를 없앤다(테스터 보고). 콘텐츠 높이 = height − padTop − padBottom ≈ 44(아이콘 size≈24 + 라벨 11px 여유).

> **UI-35 (2026-07-11 — 뒤로가기 앱 종료 확인, Android)**: 탭 루트에서 **더 갈 곳이 없는 하드웨어 뒤로가기**는 곧장 앱을 죽이지 않고 다크 글래스 다이얼로그 "게임을 종료할까요?" [계속하기/종료]를 띄운다(`showAlert`, `BackHandler.exitApp()`으로 종료). `app/(tabs)/_layout.tsx`에서 `BackHandler.addEventListener('hardwareBackPress')` — **`router.canGoBack()`이 true면(스택 화면이 위에 있음) `return false`로 기본 pop을 유지**(정상 뒤로가기 불변), false일 때만 종료 다이얼로그+`return true`. 훅은 조기 return 전에 호출(hooks 규칙). **iOS 무영향**(hardwareBackPress 없음).

> **UI-36 (2026-07-11 — 경기 관전 화면 켜짐 유지)**: 경기 보드(`app/match/[id].tsx`)는 `useKeepAwake()`(`expo-keep-awake`)로 관전 중 화면 자동 꺼짐을 막는다(관전형 1순위 = 보는 경험). 훅이라 **화면 이탈(언마운트) 시 자동 해제** — 별도 정리 코드 불필요. `expo-keep-awake`는 `expo`의 전이 의존이라 package.json에 직접 명시(top-level 해석).

> **UI-37 (2026-07-11 — 재계산 트리거 전수조사 #62 누락분: 로딩 게이트·워밍 마감)**: UI-4(무거운 캐시는 유발 액션의 로딩 뒤에서 데운다)·UI-1(무거운 화면은 진입 로딩 게이트)의 **누락 화면 4곳**을 마감했다(테스터 보고 2026-07-11 — 훈련방침 저장/감독영입 후 20~30초 프리즈). 세션 중 `baseVersion` 범프(훈련방침·스태프 계약)는 순위(`computeStandings`)·생산(`leagueProduction`)·dyn(부상·이동) 캐시를 통째 무효화하는데, 그 재계산 비용이 **로딩 게이트 없는 도착 화면**으로 떠넘겨져 진짜 동결이 됐다. **①`app/training-policy.tsx`(근본 — 떠넘김 제거)**: `setTrainingFocus`(=`setFocusTimeline` `_baseVersion++`) 직후 `busy.run` 오버레이 **안에서** `warmAfterPolicyChange`(computeStandings/leagueProduction MAX + `availableTeamPlayers`로 dyn) 워밍 → transactions·대시보드가 캐시히트로 즉시. 문구도 실제 일 반영("새 훈련 방침을 반영해\n전력을 다시 계산하는 중…", copylint 통과). **②`app/transactions.tsx`(시즌 중 FA)**: 로딩 게이트 전무 → `useDeferredReady(SCREEN_LOADING_MIN_MS)`+`<Loading variant="list">` 추가(inner 분리), `rosterIdsOnDay`·`availableFAsOnDay`(dyn) 콜드 재계산이 로딩 뒤로. **③`app/(tabs)/index.tsx`(대시보드)·`app/exhibition.tsx`**: 동일 게이트 — 인트로 워밍은 첫 진입만 커버, 세션 중 재범프는 미커버라 잠재 노출 방지. **④`app/staff.tsx`**: 재계산 워밍을 `InteractionManager.runAfterInteractions`→**rAF×2**(UI-13 권고)로 교체 — 20~30초 동기 블록의 첫 프레임에 `<Loading>`이 확실히 페인트된 뒤 블록 시작(InteractionManager는 커밋 전 발화 위험). **범위 밖(별도 티켓 후보)**: 이건 재계산을 **가리는** 것이지 **없애는** 게 아니다 — 감독 영입이 과거 시즌 전체를 재시뮬해야 하는가(minAffectedDay 스플라이스로 부분화 가능?)는 엔진 비용 축소로 별건. 검증: tsc 0(신규 delta 0) · `_dv_copylint` PASS · 워밍 후 같은 캐시키 히트(콜드 기준 [[cold-measure-perf-fixes]]).

> **UI-38 (2026-07-11 — 텍스트 입력 키보드 회피)**: 텍스트 입력이 있는 화면은 공용 `Screen`에 **`keyboard` prop**을 준다 — 포커스 시 소프트 키보드가 입력창/전송 버튼을 가리지 않게(테스터 보고 — 문의 textarea가 키보드에 가림). `components/Screen.tsx`가 `keyboard`일 때 ScrollView를 **`KeyboardAvoidingView`**로 감싸고(`behavior` = iOS `padding` / Android는 앱 기본 softInputMode=resize라 `undefined`) `keyboardShouldPersistTaps="handled"`(키보드 떠 있을 때 버튼 첫 탭이 먹히게)를 건다. **opt-in**(기본 false)이라 입력 없는 화면 무영향. **적용**: 자유 입력 2곳(UI-23) — `app/support.tsx`(문의 Compose)·`app/coupon.tsx`(쿠폰 코드). 새 `TextInput` 화면 추가 시 `Screen keyboard`도 세트로.

> **UI-39 (2026-07-11 — 아코디언/리스트 항목 구분선은 하단에)**: 카드 안에 세로로 쌓이는 항목(게임 가이드 아코디언 등)의 구분선은 **top이 아니라 bottom**에 둔다 — top-only면 카드 내 **마지막 항목 아래가 비어** 보인다(테스터 보고 — `app/guide.tsx`). `borderBottomWidth`로 마지막 항목도 닫히고, 첫 항목 상단은 카드 자체 보더가 감싸 위아래 균형이 맞는다(시각 전용·로직 무관).

> **UI-40 (2026-07-11 — 안드로이드 몰입 모드)**: 게임 전 화면에서 안드로이드 시스템 내비게이션 바(하단 3버튼)를
> `expo-navigation-bar` sticky-immersive(`overlay-swipe`+`hidden`)로 숨긴다(다른 모바일 게임 관례·사용자 요청). 화면 하단을
> 쓸어올리면 잠깐 나타났다 다시 숨음. AppState 'active' 복귀 시 시스템이 바를 되살리므로 재적용(`lib/immersive.ts` reassert).
> 루트(`app/_layout.tsx`)에서 1회 install. iOS·web no-op. **네이티브 추가라 OTA 불가 — versionCode 범프+재빌드 필요**(v10).

> **UI-41 (2026-07-12 — SafeArea 이중 top-인셋 제거: 헤더 유무를 HeaderShownContext로 판정)**: UI-29(B)의 ~~"SafeAreaView가 헤더-인지적이라 헤더 화면에선 top inset이 0에 수렴"(2026-07-08)~~ 근거는 **실기기에서 안 먹었다**(테스터 2026-07-12) — 헤더 아래 **~28dp 빈 band**(경기장 배경이 비침)가 고정으로 남아 첫 카드가 그 밑으로 잘려 보였다(스크롤해도 남음 = 스크롤 패딩 문제 아님 = 이중 인셋). SafeAreaView는 네이티브 헤더 존재를 모르고 `edges`에 `'top'`이 있으면 헤더 화면에도 상태바 높이를 덧대 헤더(이미 상태바를 담당)와 **이중 여백**을 만든다. **해결**: `components/Screen.tsx`가 `@react-navigation/elements`의 **`HeaderShownContext`로 헤더 유무를 직접 판정** → 헤더 있는 화면(전 Tabs·대부분 Stack)은 SafeAreaView `top` 엣지를 **제외**(헤더가 상태바 담당), `headerShown:false` 세리머니(champion·season-opening·enshrine 등)만 `top`을 **유지**(UI-29 B가 고친 타이틀↔상태바 겹침은 이 분기로 그대로 보존). 이중 인셋 제거. **관련(별개 축)**: 헤더 툴바 높이는 **44dp 유지**(36dp는 실기기 제목 잘림으로 복원) — 빈 band=SafeArea 엣지 / 툴바=헤더 높이로 서로 무관. 검증: 에뮬 — 선수단·일정·구단정보 헤더↔콘텐츠 16dp 정상, 빈 band 소멸.

> **UI-42 (2026-07-12 — 공용 컴포넌트 인벤토리: 감사 후 DRY 추출)**: UI-3의 "단일 소스 컴포넌트만 쓰고 화면마다 재구현 금지" 원칙을 **인라인 반복 패턴**까지 확장 — 감사에서 계약·시즌중FA·트라이아웃·드래프트·단장실 등 **~9화면의 중복 UI**를 공용 컴포넌트로 추출했다. **새 화면은 이들을 재사용**(인라인 재구현 금지):
> | 컴포넌트 | 용도 |
> |---|---|
> | `Button`(`tone/outline/fill/off` prop 추가) | 인라인 액션 버튼 통일 |
> | `components/Stepper.tsx`(신규) | −/＋ 수치 스텝퍼 |
> | `components/StatTriad.tsx`(신규) | 3열 구분 헤더 |
> | `components/MeterBar.tsx`(신규) | 트랙+% 막대 |
> | `components/PlayerRow.tsx`(신규) | 영입/명단 행(`leading`/`title`/`sub`/`trailing`/`onPress`) |
> | `components/ExpandableRow.tsx`(신규) | 펼침 선택행 + 측면 액션 |
> | `components/SummaryCard.tsx`(신규) | 현황 요약 헤더 |
> **주의**: 고빈도 Pressable 직접 구현(Stepper의 −/＋ 등)은 Button 네비 래치(UI-33)와 무관 — Button을 안 쓰므로 무영향(UI-33과 동일 확인).

> **UI-45 (2026-07-21 — 아바타 시트 첫 디코드 지연 = 프리워밍)**: 아바타 목록 화면(아시아쿼터 FA·외국인 트라이아웃·선수단 등)에서 선수 얼굴(`PlayerAvatar` — `assets/players/facesN.png` 1254×1254 시트를 크롭)이 **첫 표시 시 2~7초간 배경 틴트(플레이스홀더)만** 보였다(에뮬 실측: t=0 스켈레톤 → t=2s 상위 2명 잔존 → t=7s 전원 정상). **원인**: 시트 PNG를 RN `Image`가 **처음 마운트할 때** 비트맵 디코드가 무거운 리스트 렌더(ExpandableRow·ResumeDetail 등) 뒤로 밀려 늦게 끝난다. **한 번 디코드된 시트는 캐시**돼 이후(같은/다른 화면) 즉시 표시(같은 화면 3번째 후보가 바로 뜬 건 다른 화면서 이미 쓴 시트라 캐시 히트). **처방**: 화면 마운트와 함께 **이 화면에 뜨는 선수들의 시트만** 오프스크린(`left:-10000`·opacity0·`collapsable=false`)으로 크롭과 **동일한 디코드 크기**(`size*cols × size*rows`, 같은 요청 → 캐시 히트)로 미리 렌더해 디코드를 선점(`components/FaceSheetWarmup.tsx` `<FaceSheetWarmup ids size/>`, 리스트보다 **먼저** 렌더). **`expo-asset` 아님**: 번들 자산은 Expo Go서 이미 로컬이라 `downloadAsync`는 파일 확보만·비트맵 디코드는 안 데운다 → 디코드 워밍은 Image 마운트뿐(새 네이티브 모듈 0). **전체 34시트 부트 프리로드 금지**(발열 #122·메모리) — 화면별 필요 시트만. 수집 산식은 node-safe `data/faceSheetMeta.ts`(`uniqueFaceSheetIndices`)로 분리해 `faceCell`과 단일 소스화(결정론·시트 배정 불변). **형제 사냥**(`grep PlayerAvatar` 전수): `app/asian-tryout.tsx`(size60)·`app/tryout.tsx`(size60)·`components/RosterList.tsx`(size40 — `squad`·`team/[id]` 커버)·`components/GrowthReportModal.tsx`(size40, 상위10 카드) **4곳 적용**. `app/player/[id].tsx`(히어로 size84)는 **단일 아바타**라 워밍=그 렌더 자체(이득 0)로 제외. `app/fa.tsx`·`draft`는 아바타 미사용(텍스트 행)이라 대상 아님. 검증: 가드 `tools/_dv_facewarm.ts`(faceSheetSlot=구 인라인 공식 20000 id 불일치0·워밍 수집 완전성+최소성·A/B 누락/전체34 민감도) · tsc0 · npm test 217 · 시각은 에뮬(메인 세션). **정정(2026-07-21 에뮬 재실측): 같은 화면 워밍만으론 부족** — 워머와 실제 크롭이 같은 커밋에 마운트돼 디코드 시작이 안 앞당겨진다(아시아쿼터 t=2s 잔존 재현). **한 화면 앞(lookahead) 워밍이 정본**: 직전 화면이 다음 화면 풀의 시트까지 워밍(`app/tryout.tsx`가 `ctx.asianTryout.poolIds` 합산 워밍 → 재실측 t=2s 전원 표시). 새 아바타 목록 화면을 추가하면 그 화면 자체 워밍 + 진입 경로의 직전 화면 lookahead를 함께 단다.

> **UI-46 (2026-07-21 — 경기 수 float 노출 = fmtMatches 포맷 필수)**: 결산 "우리 선수 활약"에서 경기 수가 **"35.79999999999999경기"** 로 노출(에뮬 실측). **원인**: 피로 교체(#61 kind:rest)로 부분 출전이 소수로 합산되는데(`ProdLine.matches` float) 표시 지점들이 raw 보간. **처방**: `data/recordLine.ts` `fmtMatches`(정수=그대로·소수=1자리) 공용화, 형제 사냥(grep `matches}경기`) 6곳 적용 — `repRecordLine`(리스트 대표 기록)·`season-recap-detail`(prodLine)·`player/[id]`(시즌 기록·통산·시즌별 라인)·`contracts`. **원칙**: 경기 수를 새로 표시하는 화면은 반드시 `fmtMatches` 경유(raw `${matches}` 보간 금지).

> **UI-47 (2026-07-21 — 공지 모달 × 스포트라이트 온보딩 겹침 금지)**: 첫 실행 스포트라이트 온보딩 중에 부팅 공지 모달이 같이 떠 오버레이가 깨짐(사용자 실기기 보고). **처방**: BootGate가 `useSpotlightActive()`(현재 화면 미본 팁 존재)와 온보딩 경로(`/onboarding`·`/select-team`)를 구독해 **공지 모달을 보류** — 읽음 처리 전이라 유실 없음, 튜토리얼 종료 즉시 같은 실행에서 표시(에뮬 검증: 스포트라이트 4스텝 중 미표시 → 종료 직후 표시). **원칙**: 전역 오버레이(공지·강제 모달류)를 새로 추가하면 스포트라이트/온보딩과의 동시 표시를 반드시 게이트한다.

> **UI-48 (2026-07-21 — 아트 고정 오버레이는 OS 글꼴 배율 잠금)**: 시상식 포스터(AwardPoster)의 오버레이 텍스트가 **휴대폰 시스템 글꼴 크기 설정**을 따라 커져 그림에 그려진 패널 밖으로 넘침(사용자 실기기 보고 — 배경 그림은 배율 무관, 텍스트만 커짐). **처방**: 그림 좌표에 박아 그리는 장식성 오버레이 텍스트는 `allowFontScaling={false}`(포스터 9개 텍스트 적용, 에뮬 font_scale 1.3 재현→수정 후 1.0과 동일 렌더 확인). **원칙**: 배경 아트의 특정 영역에 맞춰 절대/퍼센트 배치하는 텍스트는 전부 글꼴 배율 잠금 + 폭 파생 폰트만 사용(일반 UI 텍스트는 접근성 존중 — 잠그지 않는다).

> **UI-49 (2026-07-21 — "리그 기록" 진입점 마이페이지 → 홈 이동)**: 기록 아카이브(`/records-archive` — 시즌·통산·명예의전당·연표)의 진입 카드를 **마이페이지 허브에서 홈 탭(대시보드)의 "리그 순위" 카드 바로 아래로** 옮겼다(사용자 지시 — 접근성: 마이페이지 깊이(5번째 탭 안)가 불편, 기록은 자주 보는 화면이라 홈에서 한 번에). **홈 카드**: `app/(tabs)/index.tsx` — 기존 홈 카드 시각 문법(`Card accent` + `Row` + `IconLabel`)에 설명 sub(`Muted`)를 더한 형태, tint=`gold`·icon=`trophy-outline`(구 마이페이지 기록 카드와 동일 색 언어 — 트로피=골드 UI-12 컨벤션 유지). 탭 시 `/records-archive?tab=season`으로 **현재 시즌 기록 탭**에 바로 진입. **탭 파라미터**: `records-archive.tsx`에 `useLocalSearchParams<{tab}>` + `TAB_PARAM`(season/career/hof/chronicle→0~3, 미전달·미지원=시즌0) 추가 → `useState(initialTab)`. 유일 기존 진입(마이페이지 push)은 제거됐고 파라미터 미전달 시 기본 0이라 회귀 없음. **마이페이지**: `app/(tabs)/mypage.tsx` 기록 LinkCard 제거(홈으로 이관해 중복 정리). **앵커/가이드 정리**: 기록 카드엔 스포트라이트 앵커·튜토리얼 스텝이 없어(tab-mypage 스포트라이트 2026-07-05 제거·history-top/ach 2026-07-14 제거) 고아 앵커 생성 없음. guide.tsx엔 "기록은 마이페이지" 류 문구 없음(위치 무관 "기록 > 명예의전당 탭" 표현만 — 변경 불필요).

> **UI-44 (2026-07-17 — SafeArea 이중 bottom-인셋 제거: 탭 내 화면은 하단 인셋 미적용)**: UI-41(top 이중 인셋)의 **하단 형제**. **탭 안의 화면(전 Tabs 콘텐츠)은 하단 safe-area 인셋을 적용하지 않는다 — 탭바가 이미 소비**한다. `app/(tabs)/_layout.tsx` `tabBarStyle`이 `height: 60 + Math.max(insets.bottom,16)`·`paddingBottom: Math.max(insets.bottom,16)+6`으로 시스템 내비바 인셋을 **탭바 안에서 소비**하는데, 탭 콘텐츠의 `components/Screen.tsx` SafeAreaView가 `edges`에 `'bottom'`을 또 넣으면 **같은 인셋이 이중 적용** → 리스트 뷰포트가 탭바 한참 위에서 끝나고 사이에 **죽은 공백**이 생긴다(3버튼 내비 실기기 인셋 ~48dp에서 실증, 2026-07-17 스크린샷). **제스처 내비 기기/에뮬은 인셋이 소형이라 잠복**(기기 다양성 사각 — TEST_METHODOLOGY §4). **해결**: `Screen`에 `insetBottom` prop(기본 `true`) 추가 — `false`면 SafeAreaView `edges`에서 `'bottom'`을 제외. 탭 5화면(`index`·`schedule`·`squad`·`office`·`mypage`)만 `insetBottom={false}`로 opt-out(탭바가 하단 담당). **탭 밖 스택 화면·세리머니는 기본값 유지**(탭바가 없어 하단 인셋이 필요). `contentScroll`의 고정 `paddingBottom: 32`는 시각 여유라 유지(인셋과 무관). top 이중 인셋(UI-41, HeaderShownContext)과 정확히 대칭 — top=헤더가 소비 / bottom=탭바가 소비.

## UI-43 — 화면 수치·날짜 정합 검수 레지스트리 (2026-07-15, 6그룹 스웜 — 사용자 요청 "수치가 정확하게 나오는지, 날짜가 맞는지")

**일반 규칙 2개 (신규 원칙 — 새 화면·새 표시에 항상 적용)**:
- **UI-43a 명단 표시 정본 = 날짜 인지 명단**: 화면이 "현재 소속 선수"(목록·인원수·총연봉·소속 판정)를 그릴 땐
  base 명단(`teamPlayerIds`/`currentRosters`/`getEvolvedTeamPlayers` 직독)이 아니라 **날짜 인지 명단**
  (`rosterIdsOnDay` 기반 공용 셀렉터 `activeRosterOnDay`)을 쓴다 — base는 시즌 중 영입을 모른다(SEASON §7).
  `displayCutoff`가 시간축을 통일했듯 멤버십축도 통일(TEST_METHODOLOGY §4 "표시 명단 정본 미상속").
- **UI-43b 표시 금액 = 차감 산식**: UI가 보여주는 돈(위약금·잔류 연봉·오퍼 제시액·총연봉/캡 잔여)은 store/엔진이
  실제 차감·게이트에 쓰는 **동일 함수·동일 입력**으로 계산한다. 표시≠차감은 재화 split-brain의 UI판.

**발견 레지스트리** (UV-N · 수정 대상 → 완료 시 ✅ 날짜):

| # | 심각도 | 화면/파일 | 문제 | 수정 방침 |
|---|---|---|---|---|
| UV-1 | 중 | squad·office·contracts·team/[id]·player/[id](role) | **시즌 중 FA 영입 선수 누락 패밀리** — base 명단 직독이라 목록·인원·총연봉에서 빠지고 방출 진입점 없음. team/[id]는 방출 잔존+override 미반영+AI 영입 미반영. player/[id] `teamOfP`가 base 순회라 영입 선수 role=null→"부상·정지·명단 외" 오안내 | UI-43a 공용 셀렉터 `activeRosterOnDay(teamId, day)`(rosterIdsOnDay+evolve+override 합성) 도입·5화면 재배선. 총연봉 헤더는 store 게이트와 동일한 `capPayroll`(시즌 영입=inSeasonCost). 가드 `_dv_rosterui`(시즌중 영입 포함 A/B) |
| UV-2 | 중 | contracts.tsx doRelease | 위약금 표시·사전 게이트가 **override(대기 재계약) 계약** 기준인데 store `release`는 **base 계약**으로 차감 — 표시≠차감 | UI-43b: 표시·게이트를 base 계약(`getPlayer(p.id).contract`)으로(store와 동일) |
| UV-3 | 중 | contracts.tsx FA 예정 카드 | "잔류 연봉 (시장가)"이 `marketVal(p, prod)`(perfFactor 0.8~1.3+수상 프리미엄 ≤+25%)인데 실제 잔류 확정은 `renewedContract`=`marketValue(p, medOvr)`(prod·award 미포함) — MVP급은 체계적 과대 표시. 코드 주석의 rollover.ts:49 자기 인용도 산식 불일치 | UI-43b: 표시를 renewal 산식 미러(`marketValue(p, era, undefined, 0)` 헬퍼)로. 미래 진화·나이+1 오차는 "예상" 캡션으로 수용 |
| UV-4 | 중 | fa.tsx 오퍼 스테퍼 | salary `'auto'`+공격적 ON이면 실제 제시액=ask×1.2(`resolveMyOfferSalary`)인데 스테퍼 표시만 ask×1.0 — 같은 화면 "현재 제안 요약"과 숫자 불일치 | 스테퍼 표시값을 `resolveMyOfferSalary(draft, ask)`로 통일 |
| UV-5 | **높** | guide.tsx·onboarding.tsx(+shop·mypage) | **구단주 권한 서술이 2026-07-12 MATCH_INTERVENTION 격상 이전**에 멈춤("선발은 건의만·타임아웃/교체 직접 못 함·카리스마가 수락 좌우") — 현행은 선발/벤치 직접 확정+내 팀 경기 opt-in 직접 개입. 가이드 "외국인 팀당 1명"(아시아쿼터 누락), 다이아 "두 가지 방법"(쿠폰·환영 누락), shop "모든 광고 제거"(보상형 유지), mypage 광고 cap 다이얼로그 제목/본문 불일치 | CLAUDE.md 권한표·MATCH_INTERVENTION §5 기준으로 카피 현행화. 광고 제거는 "시즌 시작 전면광고 제거(보상형 광고는 선택 시청)"로 정확화 |
| UV-6 | 중 | lib/calendar.ts(+results·calendar·schedule) | **경기 날짜·요일이 전 시즌 2025-10-18 고정** — 시즌 라벨(2030-31…)은 전진하는데 달력은 매 시즌 반복(요일 불일치) | `dateForDay(dayIndex, season)`로 시즌 반영(`SEASON_START_Y+season` — seasonYear idx0=2025와 정합). 호출 3화면 season 전달 |
| UV-7 | 중 | match/[id].tsx 개입 시트 | ①`usedIn`이 세트 **미래** 투입까지 제외(엔진은 개입 좌표 이전만 누적) ②`injuredIn`이 전 세트·미래 부상까지 제외 ③드라이런 applied 판정이 개수 비교라 AI 이벤트와 충돌 시 오판(같은 선수 AI 핀치 소멸 시 커밋 거부) ④문서 §4 요구 "잔여 예산(교체 6·타임아웃 2) 표시+소진 시 비활성" 미구현 ⑤체력 %가 마지막 타임아웃 스냅샷인데 시점 단서 없음 ⑥pickOut에 엔진이 반드시 거부하는 슬롯(부상 교체 슬롯·1왕복 마친 복귀 선발) 노출 | ①② point 컷오프(개입 좌표 이전 이벤트만) ③ applied를 좌표 정밀 매칭(SubEvent.point==ptIdx+1)으로 ④ 잔여 예산 카운트 표시+비활성(SUBS_PER_SET·TIMEOUTS_PER_SET 상수 보간) ⑤ "타임아웃 시점 기준" 캡션 ⑥ 사전 제외 |
| UV-8 | 중 | engine/achievements.ts·app/achievements.tsx | ①`TITLE_KEYS`에 `receive` 누락(2026-06-18 리시브왕 추가 미추종) — 타이틀 컬렉터류 진행도 과소 ②자금 업적 포맷이 `cash_200k`만 금액 포맷, 500k/1m은 원시 숫자 | ① receive 추가(파생 재계산이라 세이브 무영향) ② 자금 업적 3종 공통 분기 |
| UV-9 | 중 | data/news.ts·news/[id].tsx | 우승 방식(3-0 스윕/리버스 스윕) 판정 `series.find(len>=3)`이 비-1시드 챔피언의 PO(3전2선승) 2-1 시리즈를 먼저 매칭 — 실제 챔프전 스윕/리버스 스윕 태그 누락(허위 양성은 없음) | 챔피언의 **마지막 시리즈**(=결승, seriesByTeam push 순서)로 매칭. 목록+상세 2곳 |
| UV-10 | 낮 | awards-ceremony.tsx | 시즌 중 딥링크 진입 시 풀시즌 시상(MAX) 노출 — 자체 스포일러 게이트 없음(recap-detail은 이중 가드 보유) | recap-detail과 같은 결의 게이트(챔피언 공개 전 차단) |
| UV-11 | 낮 | fa.tsx·staff.tsx | 리터럴 하드코딩: "보호선수 명단(6명)"(PROTECT_COUNT)·"A 300%·B 200%"×3(compensationMoneyOnly)·"3년 계약"(contractYears) | 상수 보간 |
| UV-12 | 중 | player/[id].tsx | ①타 구단 선수 **레이더 차트가 스카우팅 안개 우회**(옆 StatBar·OVR은 흐림) ②인기(popularityNow)가 raw `currentDay`라 미관전 당일 생산 반영+뉴스 상세(displayCutoff)와 불일치 ③출장 정지 사유가 시즌 첫 스캔들 first-match(활성 건 아닐 수 있음) | ① 레이더에 fog 적용(reveal<정밀이면 흐림/범위) ② 표시용 인기만 displayCutoff(면담·store 판정 경로는 currentDay 유지 — WAI) ③ 활성 span(from≤day≤to) 매칭 |

> **✅ UV-1~UV-12 전건 수정 완료(2026-07-15)** — 검증: `tsc`(app+test) 0 · `npm test` 214 · 신규 가드 `_dv_rosterui`(A/B: 구 base 셀렉터는 시즌 중 영입 누락 실증) · `_dv_severance`·`_dv_capprecheck`·개입 3종(`_dv_intervention_empty/consistency`·`_dv_prefix_smoke`)·`checkSubs`·뉴스 3종·업적 가드·`_dv_copylint`·`_dv_fa_relations`·`_dv_faofferui` 전부 PASS.
> 메인 재검증서 형제 1건 추가 발견·수정: **UV-1c** — `contracts.tsx` FA 등급 풀(`leagueFaGrades`)만 base 명단 잔존 → 시즌 중 영입 FA 예정자가 풀에서 빠져 `faGrades.get(...)!` undefined("undefined등급") 가능. 풀도 `activeRosterOnDay`로 통일(+overrides·inSeasonTx deps).

> **✅ UV-7 후속 — 개입 교체 FIVB 대칭 사전차단(2026-07-15, F1·F2)**: UV-7 ⑥은 *pickOut*(뺄 선수)에서 엔진이 반드시
> 거부하는 슬롯(부상 교체 슬롯·1왕복 복귀 선발)을 사전 제외했다. 이번엔 **IN 후보와 서브 교체(핀치)** 두 대칭 구멍을 마저 막는다.
> 원칙: **표시 후보·활성 버튼 = 엔진 subIn이 실제로 허용하는 것만**(엔진 거부를 확정 후 부정확 문구로만 처리 금지). 서버 슬롯
> 도출은 **로테이션 재생(`reconstructRallies`, engine/match 규칙과 동일)** → `serverIndex(rot)`, 신규 가드 `tools/_dv_rotation_replay`가
> 엔진 트레이스 `[h:a] 서브권 X (로테이션 Hn/An)`와 **전 랠리 대조(N≥300, 100% 일치 + 오프바이원 변이 민감도)** 로 박제(추정 금지).
>
> | 엔진 거부 사유 (`engine/match.ts subIn`) | UI 차단 지점 | 문구/동작 |
> |---|---|---|
> | **F2** IN 후보가 이번 세트 교체로 나간 선발(`usedStarterOut.has(inP.id)`) | `benchCands` 필터에서 제외(`outThisSet` = tactical enter `outId`, point ≤ ptIdx) — 일반·서브 교체 공유 | 후보 목록에서 미노출(나갔던 선발을 다른 자리 IN으로 안 보임) |
> | **F1 ①** 현재 서버 슬롯이 세터(`six[slot].position==='S'`) | 메뉴 "서브 교체" 버튼 `disabled`(`pinchBlock`) | "지금 서브 차례가 세터예요 — 세터는 빼지 않아요" |
> | **F1 ③** 서버 슬롯이 부상 교체 슬롯(`injuryReplaced.has(slot)`) | 동 | "부상 교체가 들어간 자리예요" |
> | **F1 ②** 서버 슬롯이 활성 교체 슬롯(`activeSubs.has(slot)`) | 동 | "이미 교체가 들어간 자리예요" |
> | **F1 ④** 서버가 1왕복 복귀 선발(`usedStarterOut.has(occupant.id)`) | 동 | "한 번 나갔다 돌아온 선수 자리라 다시 못 빼요" |
>
> 사유 우선순위(버튼 부제)=한도 소진 → 서브권 없음 → 서버 슬롯 거부(위 4사유, 엔진 subIn 순서 ①→③→②→④) → 정상. **최종 진실은
> `commitIntervention` 드라이런** — 사전차단이 못 잡은 잔여 케이스는 `onConfirmSub` 폴백이 같은 사유(`pinchBlock.reason`)로 처리.
> 검증: `tsc` 0 · `_dv_rotation_replay` PASS(400경기 68,803랠리 100% 일치·변이 400/400 검출).

**보고만 (WAI/설계 문서화/저가치 — 수정 안 함, 근거)**: 개막 전 순위표=전팀 0승 동률의 시드 순서(설계 여지, 저가치) · 순위표 "세트±" 컬럼 vs 실제 타이브레이크=세트득실률(standings.ts에 의도 문서화) · clinch=playedThroughDay(BROADCAST 스포일러 정책의 문서화된 예외) · 정규종료~첫 PO 사이 playoffs/calendar "대기"(스포일러-보수 방향, 누수 없음) · 대시보드 자금 경고 임계 2억(순수 UI 판단값, 대응 엔진 상수 없음) · "3전2선승" 라벨(현재 정합, PO_TARGET 변경 시 보간 후보) · 부문 기록왕 라벨 3표기(공격왕/공격상·세트왕/어시스트왕 — 정본 표기 사용자 결정 대기, season-recap.tsx OPEN Q) · HOF 헤더 "은퇴 레전드 N"이 일반 헌액 포함(라벨 해석 여지) · first_concede=첫 경기 프록시(무실점 경기 사실상 불가) · 광고 일일 리셋=UTC 자정(클라·서버 일치, 문구만 "오늘/내일" — 동작 버그 아님) · supporter IAP 스텁(#43 트랙) · 구단 정체성 "최근 5시즌"·창단 연차 고정(백스토리=시작 조건 설계, 100년 후 워딩 이슈만) · recordChampion 부분 archive로 시상식~오프시즌 창에서 시즌 카운트류 업적 +1 선표시(과도기 창) · season-recap 미사용 구독(maxWinStreak 스캔 낭비 — 성능 소소, 표시 무영향).

## UI-27 세계관 사유 문구 예시 (BusyOverlay message — 2026-07-08 사용자 결정)

> 문구는 **그 작업이 실제 하는 일**을 게임 언어로 옮긴다(가짜 사유 금지). 코치·감독·스카우트·프런트가
> 무대 뒤에서 하는 일로 로딩을 서사화 — 관전형(보는 게임)에서 대기도 "장면"이다. copylint(여자부·배구 용어) 통과 필수.

| 화면 · 버튼 | 실제 하는 일(무거운 이유) | 사유 문구 |
|---|---|---|
| training-camp · 코스 구매(전지훈련 보내기) | 서버 다이아 차감 후 선수 스탯/포텐 반영(비동기) | `코치진이 훈련 프로그램을 준비하는 중…` |
| training-camp · 전지훈련 마치고 개막전으로 | 오프시즌 종료·개막전 노출(base 재계산 워밍) | `선수들이 전지훈련에서 구슬땀을 흘리고 있습니다…` |
| training-policy · 방침 저장 | 팀 훈련 포커스 갱신(base++) + **무효화 캐시 워밍**(순위·생산·dyn, UI-37) | `새 훈련 방침을 반영해\n전력을 다시 계산하는 중…` |
| player/[id] · 선발/벤치 건의 · 복귀 지시 | 벤치 지시 갱신 → 출전 라인업(buildLineup) 재도출 | `감독이 라인업을 다시 그리는 중…` |
| tryout · asian-tryout · 위시/보유 토글 | buildDraftContext(리그 전체 진화 스냅샷) 재빌드 | `스카우트 리포트를 정리하는 중…` |
| fa · 영입 시도/취소·보호·돈만·공격적 | faMarketPreview(FA 경쟁 결정론 재해결) | `협상 테이블을 차리는 중…` |
| draft · 담기/빼기 | resolveDraft(지명 시뮬 재실행) | `지명 결과를 정리하는 중…` |

## 대원칙
- **렌더 경로는 절대 throw하지 않는다(2026-07-24, EC-UI-04 / FA_SYSTEM §2.8.10)**: 화면 렌더 중의 예외는 그 화면이 아니라
  **앱 프로세스를 죽인다**(Render Error + SIGSEGV). 게다가 원인이 세이브에 남으면 **재진입마다 재크래시 = 소프트락**.
  세 가지를 지킨다. ① **옵셔널 값은 그 값을 보장하는 분기 안에서만 평가**한다 — `const name = getTeam(x)?.name ?? short(x)`를
  분기 밖에서 미리 계산하지 말 것(`x`가 sparse Record 조회값이면 `undefined`가 샌다. 타입은 `Record<string,string>` 인덱스라
  거짓말을 한다 — `noUncheckedIndexedAccess` 미사용). ② **표시용 원시 함수는 입력이 오염돼도 죽지 않게** 하드닝하되
  **정상 입력의 반환값은 바이트 동일**로 유지(예 `shortTeamName`). ③ 조건이 붙는 표시 계산은 **`data/` 셀렉터로 내려**
  가드가 전 코드 경로를 태울 수 있게 한다(화면은 톤→색 매핑만).
- **실패를 빈 상태로 위장하지 않는다(2026-07-24, EC-UI-05)**: 서버 실패(500·401)를 빈 배열로 뭉개면 "없어요"로 읽혀
  장애가 은폐된다. **오류 / 오프라인 / 진짜 빈 목록**을 각각 다른 문구·아이콘으로 구분하고 오류엔 **재시도**를 준다
  (패턴 정본 `app/support.tsx`·`app/mailbox.tsx` — 새 디자인 발명 금지).
- **수를 세는 라벨은 "무엇을" 세는지 밝힌다(2026-07-24, BUG-03)**: 같은 문구면 같은 수를 기대한다. 단장실 "선수 16명"(전체)
  ↔ 계약 관리 "**국내** 14명"(국내 전용 목록)처럼 세는 집합이 다르면 라벨에 집합을 넣는다(숫자를 맞추는 게 아니라 라벨을 고친다).
- **문구가 색을 지칭하면 실제 토큰과 일치해야 한다(2026-07-24, BUG-09)**: 강조색은 전역 규칙(`theme.accent`)이므로
  색을 바꾸지 말고 **문구를 고친다**. 같은 화면에 유사 색이 더 있으면 색 이름만 말하지 말고 **다른 단서(굵기·위치)** 를 함께 준다
  (예 "우리 구단 선수는 민트색 굵은 글씨로 강조됩니다").
- **선택지는 서로 구별돼야 한다(2026-07-24, BUG-07)**: 프리셋 목록에서 **두 선택지의 설명이 동일해지면** 고를 수가 없다.
  데이터의 일부만 라벨에 넣기 전에 "이 필드만으로 전 항목이 유일한가"를 확인한다(훈련 방침 = 핵심이 겹쳐 보조까지 노출).
- **실존 인물 실명 금지(출시 원칙, 2026-07-21)**: 화면·데이터에 노출되는 이름(선수·감독·코치·스카우터·구단)은 **전부 가상**이어야 한다 — 실존 V리그 감독/선수/구단의 실명(또는 명백한 연상)을 쓰지 않는다(퍼블리시티권·상표 리스크). 이름은 절차적 음절 생성기(`data/names.ts` `genKoreanName`/`genForeignName`/`genAsianIdentity`/지도자용 `genStaffName`)로만 만든다. 계기: 감독 이름이 고정 12개 실명 리스트(`COACH_NAMES` — 서남원·강성형·아본단자 등)였고 13+명을 12개에서 뽑아 동명이인까지 구조적으로 났다 → 2026-07-21 리스트 폐기·생성기 공통화(STAFF §9.6-A). 새 콘텐츠에 이름을 넣을 땐 실명 하드코딩 금지 — 생성기 경유. 가드: `_dv_coach3axis (e)`(지도자 이름 실명 미포함·무중복).
- **동기 작업은 페인트를 먼저 시킨다**: 로딩/비활성 DOM을 그린 뒤 `requestAnimationFrame`(또는 `InteractionManager`/`setTimeout 0`)으로 한 틱 양보하고 무거운 일을 한다. 안 그러면 로딩이 화면에 안 뜨고 그냥 멈춘 것처럼 보인다.
- **빠른 작업엔 로딩 금지**: 즉시 끝나는 건(임계 미만) 로딩을 띄우지 않는다 — 1프레임 깜빡임이 오히려 거슬린다.
- **느슨하게 풀지 않는다**: 무거운데 로딩이 없으면 화면을 고친다(임계·로딩 추가). 룰을 끄지 않는다.
- **스크롤은 제스처를 받아야 한다(UI-2)**: 가로/세로 ScrollView를 Pressable·Touchable로 감싸면 드래그를 부모가 가로채 안 밀린다. 밖 탭 닫기가 필요 없으면 부모를 View로 둔다. 또 **가로 ScrollView 안에 세로 ScrollView를 중첩하지 않는다**(내부 폭 측정이 무너져 스크롤 불가) — 한 방향만, 와이드 표는 컨텐츠에 **명시적 폭**을 준다.

## 진단 이력 — 스코어박스 가로 스크롤 (2026-06-23)

사용자가 "가로 스크롤이 안 된다"를 3회 반복 보고. **틀린 가설을 순서대로 버린 기록**(추정 금지·재현으로 확인):

1. **(가설1, 부분기여) 중첩 스크롤** — 가로 ScrollView 안에 세로 ScrollView(H>V) → 내부 폭 측정 붕괴. 세로 중첩 제거 + 명시적 폭(`TABLE_W`)으로 *레이아웃은* 정상화. 그래도 안 밀림.
2. **(가설2, 결정적 원인) Pressable 제스처 가로채기** — 모달 카드/배경이 `Pressable`(밖 탭 닫기용)이라 그 위 가로 드래그를 Pressable이 먹어 ScrollView로 안 넘어감. → 비-dismissable 팝업은 배경·카드를 **View로** 교체하니 **즉시 스크롤됨**.
3. **교훈**: ① 레이아웃상 "스크롤 가능"(내용>뷰포트)인데도 안 밀리면 **제스처 가로채기**를 의심(부모 Pressable/Touchable). ② 시각 검증을 못 하는 환경(이 앱은 네이티브 전용 — 웹 미부팅)에선 레이아웃만 보지 말고 **제스처 책임 사슬**까지 추론. ③ **구조 변경은 Fast Refresh로 안 먹어** 사용자가 옛 화면을 보고 "여전히 안 됨"이라 할 수 있음 → 풀 리로드 안내.

---

## 드래프트 라이브 연출 — "진짜 드래프트룸에 앉은 감각" (📋 설계 확정·미구현 2026-07-09)

> **표준 작업 순서 1단계(플랜)**: 사용자 확정 + 독립 리뷰 최종. **상태 = 설계 확정·코드 미착수**.
> KOVO식 드래프트 재설계(FA_SYSTEM §3.0·§3.2.1)의 **연출/감정 레이어**. 기능(멈춤·지명·재개)은 FA_SYSTEM §3.2.1이,
> **"어떻게 보이고 느껴지는가"** 는 본 절이 정본. 관전형 1순위 = 보는 경험이라 **디테일이 호감/비호감을 가른다**(사용자 강조).
> 이 연출들은 육안(에뮬레이터) 확인 항목 — 헤드리스 감사로는 감각을 못 잡는다(emulator-test 스킬).
>
> **DL-4~DL-8 = UX 개선 즉시 5건(②~⑥) 스펙(📋 Phase 2 UI 스펙 2026-07-09)**: DL-1~DL-3의 감정 설계를
> 구체 데이터·매핑 규칙까지 확정. **가짜 드라마 금지(실데이터 근거만)** 가 관통 원칙 — 모든 라벨·문장·순위는
> **엔진 출력 + 공개 로스터 상태 + reveal 안개**에서만 나온다(FA_SYSTEM §3.3 `prospectReport` 두 하드룰의 확장 적용).

### DL-1 준비 화면 (`app/draft.tsx` = 스카우팅 + 찜) — ✅ 배지·정렬·라벨·카피 구현(2026-07-10)
- 상단 **"우리 필요 포지션" 배지**(floor 대비 부족 포지션 힌트 — `neededPositions(내 로스터)`; 없으면 "구성 균형").
> **★ 라벨 불일치 케이스(EC-DR-04, 에뮬 발견 2026-07-09 → 수정 2026-07-10)**: draft.tsx가 `지명권 {ctx.myHoles}장`을 표시했는데
> `myHoles`는 **포지션 발굴 여지**(positionGap 합, ROSTER_IDEAL 대비)라 실제 지명 슬롯 수와 다르다 → "지명권 2장"인데 "지명 순번 7·14·21·28"(4슬롯)처럼 **모순**.
> 지명권 정의는 FA_SYSTEM §3.2.1·§3.0 = **4라운드 고정(로스터 무관, 발굴 모델)**. 수정: `지명권 {ctx.myPickSlots.length}장`(실제 지명 가능 슬롯 수)로 통일. `myHoles`는 "필요 포지션" 힌트로만 남김.
> **★ 문구 케이스(EC-DR-05, 에뮬 발견 2026-07-10 — 즉시 수정)**: ① draft-live reason 배지 `best`가 내부 용어 **"최고 + 성격"** 그대로 노출 → **"미래 자원"**(DL-6 best 문장 톤과 일치, 내부 설계 용어 화면 노출 금지). ② DL-6 "얇다" 문장이 조사 고정(`${posKo}이`) → **"아웃사이드이 얇다"** 비문. `lib/josa iGa`로 받침 분기("아웃사이드가/미들이"). 가드 `_dv_pickreason` 기대 집합도 동기 갱신(가드가 문장 변경을 날조로 검출 — 오라클 이빨 실증). **교훈: 변수+조사 템플릿은 항상 josa 유틸**(news.ts resolveJosa와 같은 결).
> **★ 지명권 표기 v2 — 권리/행사 분리(사용자 결정 2026-07-10, EC-DR-04 연장) — ✅ 구현**: "지명권 4장"만으론 "왜 라이브에선 1명만 뽑나?"라는
> 의문이 남는다(지명권=**4라운드 권리**, 실제 지명 수는 `aiShouldPass`가 로스터로 판정 — 평균 **1.55명/시즌**, `_dv_draftplan` 실측 40시즌). 준비 화면 카드를 3줄로 분리:
> `보유 지명권 ~~{slotNos}순위~~` → **정정(2026-07-12): `보유 지명권 {N}장 ({slotNos}순번)`** (개수 N장을 앞에 노출 + 픽 번호를 팀 '순위'와 구분해 **'순번'** 으로 — "순위"는 리그 팀 순위와 혼동) / `예상 지명 {N}명` / `예상 PASS {M}회` + 설명("현재 선수단 상황을 기준으로 {r1~r2}라운드는 자동 PASS가 예상됩니다.
> 필요 시 라이브 드래프트에서 직접 지명할 수 있습니다." · 예상 PASS 0이면 "전 라운드 지명이 예상됩니다."). **라운드는 하드코딩 아니라 `passRounds`에서 파생**.
> 파생 = `data/draftPlan.ts myDraftPlan(ctx, my, draftPicks)` — resolveDraft를 **mySelections=[]** 로 돌린 자연 투영(찜만 반영)이라 라이브 초기 시퀀스와 동일
> 입력 → 준비↔라이브 예상 일치. **표시 전용·엔진/세이브 불침투**. `passRounds`는 prefix tail(지명=라운드 1..M, 나머지 PASS — draftSummary와 동일 불변식).
> 가드 `tools/_dv_draftplan.ts`(불변식 지명+PASS==보유 · prefix 교차검증 order↔sequence · 데이터구동 · 결정론 · passReason A/B).
- 유망주 목록을 **예상 지명순 정렬**(DL-5 프로젝션) + **단장 직관 등급 라벨**(DL-4 — 즉시 전력감/육성 가치 높음/장기 프로젝트) + **예상 순위 배지**(DL-5)로 표시. 찜(shortlist) 버튼.
  - **구 "1R급/2R급" 숫자 라운드 등급 폐기** — 단장 직관 라벨(DL-4)로 대체. 둘 다 **스카우터 공개도(reveal)만큼만** 노출(안개).
- 카피 전환: **"매 라운드 지명 or 패스 — 미래를 위한 어린 선수를 뽑습니다"**(빈자리 메우기 아님을 명확히).
- (기능은 FA_SYSTEM §3.2.1 — 결과 미리보기 삭제·찜만.)

### DL-2 라이브 진행 (`app/draft-live.tsx`)
> **★ 구현 정합(2026-07-14, #67 오프시즌 검수 reconcile)** — 아래 불릿은 원안(2026-07-09). §3.2.1(2026-07-08 인터랙티브 재설계)이 **패스를 AI 자동집행**(`aiShouldPass`·§3.0 결정2)으로 바꿔 원안 일부가 superseded됐고, 아래 v2 블록이 이를 반영. 항목별 현 상태:
> - ✅ **로스터 여유 "N/20"**: 내 지명 패널에 구현(2026-07-14) — `panel.rosterCount`/`ROSTER_CONTRACT_CAP`.
> - ~~1R~4R 진행바~~ → **텍스트 라운드 라벨**(`roundLabel` "{N}R 진행 중") + 헤더 `{revealed}/{total}픽`로 대체(관전형 미니멀).
> - ~~[이번 라운드 넘기기] 패스 버튼~~ → **패스=AI 자동집행**(구단주 랠리 밑 개입 없음, §3.0). 내 PASS 사유는 라이브 개별 카드가 아닌 **DL-8 종료 요약** 한 줄(v2 ③).
> - ~~카운트다운 텐션·첫 진입 온보딩(DL-3)~~ → **미구현 보류**(관전 텐션은 속도 토글 600/300ms로 충족, 온보딩 저우선).
- **진짜 라운드 표시**: **1R~4R 진행바**로 지금 몇 라운드 몇 순번인지 항상 보인다.
- **내 차례 = 하드스톱**: 자동진행이 내 픽에서 멈추고 **[지명] 또는 [이번 라운드 넘기기]**(패스) 두 버튼.
- **로스터 여유 상시 표시**: "18/20"처럼 계약 상한 대비 현재 인원을 늘 보여준다(지명/패스 판단 근거).
- **타팀 픽 = 사유 노출**: AI가 왜 그 선수를 뽑았는지 한 줄. **상세 스펙·값→문장 매핑·가짜드라마 하드룰 = DL-6**(엔진 reason + 그 팀 실제 로스터 상태에 근거해서만 생성).
- **패스 = 명확한 카드**: 넘기면 "대전, 3R 지명 포기 · 로스터가 두텁습니다"처럼 **명시적 카드**로 보여준다(조용히 스킵 금지).
  **패스를 "포기"가 아니라 전략으로** 느끼게 — 사유 힌트로 정당화. (**① AI 패스 *확률/판단*은 엔진 소관** — `aiShouldPass`, FA_SYSTEM §3.0 결정 2·§3.1. UI는 그 판단을 **전략 카드로 보이게만** 한다.)
- **찜 선수 강탈 강조**: 내가 찜한 선수를 타팀이 데려가면 강조. **상세 스펙 = DL-7**.
- **내 차례 다가오는 긴장**: 순번이 나에게 가까워지면 카운트다운 느낌(강조·텐션 빌드업).
- **한 장씩 텀 두고 공개**: 픽을 **좌르륵 쏟지 말고** 한 픽씩 간격을 두고 공개(속도 토글 600/300ms) — 긴장감이 연출의 핵심.

> **★ 헤더 지명권 분리 + 내 PASS 사유(v2, 사용자 결정 2026-07-10) — ✅ 구현** (DL-1 지명권 표기 v2의 라이브 짝):
> - **헤더**: `내 지명 {confirmed}/{분모}` + `· PASS 예정 {남은 예상 PASS}회`. ~~분모=**보유 지명권**(order 슬롯 수=4, `ctx.myPickSlots.length`)~~ →
>   **정정(2026-07-12): 분모=예상 지명(`myCount`)** — 패널 "직접 선택 n/myCount"와 분모를 **일치**시켜 "보유 4 vs 예상 2"의 혼동을 없앤다(넘긴 권리는
>   `PASS 예정 N회`가 설명한다: 지명 2 + 패스 2 = 보유 4). PASS 예정=`보유 − 예상 지명(myCount)`. **현재 `mySelections` 반영 seq에서 파생** → 내가 개입해 예상이 빗나가면(어떤 선수를 뽑느냐로 이후 need가
>   바뀌어 myCount 변동) 카운트가 **실제를 따라간다**. PASS 예정 0이면 문구 생략.
>   **로스터 만원 자동패스 문구 분기(2026-07-12)**: "지명권 없음" 문구가 헤더 `PASS 예정 N회`와 모순되던 케이스 —
>   `slots===0`(진짜 무지명권)일 때만 **"없음"**, 로스터가 가득 차 자동 패스가 예상되는 경우(slots>0)는 **"선수단 가득 차 지명 넘길 예정"** 으로 분기(넘길 권리는 있으므로 "없음" 금지).
> - **내 PASS 사유 한 줄(③)**: DL-8 종료 요약의 **내 첫 PASS 라운드**에 사유 한 줄 — "현재 선수단이 충분하여 이번 라운드 지명을 포기했습니다"
>   (로스터 충분/가득=deep/full) · 그 외 "로스터 상황을 고려해 이번 라운드는 지명을 진행하지 않았습니다"(neutral 폴백). **실데이터 근거만**:
>   `data/draftPlan.ts passReasonFor(ctx, my, 내지명ids)`가 최종 로스터(초기+내 지명 전부)로 계약상한(full)·목표도달/구멍0(deep)·그외(neutral) 판정
>   (PASS는 prefix tail이라 최종 로스터=PASS 시점 로스터=정확). **가짜 드라마 금지**(요인 확인 안 되면 중립). **라이브 피드의 개별 PASS 카드는 미구현** —
>   내 PASS 사유는 종료 요약에서 노출하고, 타팀 PASS는 조용히 스킵(현행 유지). 가드 `tools/_dv_draftplan.ts` (E) passReason A/B(neutral/deep/full 3분기).

### DL-3 결과 + 학습성
- **결과**: "우리 팀 지명 요약" 카드 + 입단 확인(선수단에 **신인 배지**).
- **지명권 0인 시즌(≈60%)**: "이번은 참관 — 다음 기약" 담담한 톤. 0명 뽑아도 초라하지 않게(보호할 결정이 없을 뿐).
- **첫 진입 1회 안내**: 드래프트 개념·순번이 왜 이렇게 정해지는지(순위 역순 추첨) 1회 온보딩(학습성).

### DL-4 ② 유망주 등급 = 단장 직관 라벨 (숫자 라운드 등급 폐기) — ✅ 구현(2026-07-10)
> "1라운드급/2라운드급" 같은 **정답을 흘리는 숫자 등급**을 버리고, 단장이 리포트를 보고 내리는 **직관 판단**을 라벨로 준다.
> 구현: `data/prospectGrade.ts prospectGradeLabel(p, reveal)`(순수·reveal-gated·무저장). `app/draft.tsx` 목록 각 행에 라벨 표시.
> 가드 `tools/_dv_prospectgrade.ts`(누출0·reveal 단조·라벨 분포·결정론).
- **라벨 3종(+안개 라벨)** — 유망주가 **어떤 종류의 자원인지**를 말한다(순위가 아니라 성격):
  | 라벨 | 의미(플레이어가 읽는 것) | 켜지는 신호(**공개 재료만**) |
  |---|---|---|
  | **즉시 전력감** | 지금 당장 1군에서 뛴다 | 공개 현재 OVR **높음**(상위 밴드) · 공개 상승여지 작음 |
  | **육성 가치 높음** | 키우면 주전감, 몇 시즌 투자 | 공개 상승여지 **큼**(공개 포텐 − 공개 현재 ≥ 밴드) · 현재 중간 |
  | **장기 프로젝트** | 원석 — 오래 걸리지만 천장 베팅 | 공개 현재 **낮음**(raw) · 상승여지 불확실 |
  | **평가 유보 / 원석 후보**(안개 라벨) | 판단 재료 부족 | **reveal 낮음** → 위 셋을 못 가림. 라벨을 모호하게(범위·"스카우트 리포트 부족") |
- **입력 = 오직 공개 재료**: `fogOvr(현재)` + `potentialEstimate`(reveal-gated, `data/prospectScout.ts`). **숨은 `maxPot`·미래 스탯 절대 미참조**
  (FA_SYSTEM §3.3 하드룰 ①스포일러 금지). reveal이 낮으면 `potentialEstimate ≈ 현재`라 상승여지가 안 새어 자동으로 "즉시 전력감/평가 유보"로 눌린다 — **안개가 라벨에 내장**.
- ~~**밴드는 placeholder — Phase 2에서 클래스 분포로 캘리브레이션**~~ → **✅ 캘리브레이션 완료(N=12,000명 · draftClass · 엔진 eed47f5 · 2026-07-10)**:
  유망주는 어리다 → 현재 `overall(p)` 43~62(median 52), 공개 상승여지(`potentialEstimate(reveal)−potentialEstimate(0)`, reveal1) median 18.7(전원 upside).
  절대 성장치가 아니라 **클래스 상대 밴드**로 컷: `CUR_HIGH=56`(현재 상위 ~11% → 즉시 전력감) · `GROW_BIG=22`(reveal1 상위 ~25% upside → 육성 가치) · `CUR_LOW=51`(하위 밴드 → 장기 프로젝트).
  **풀공개(reveal 1.0) 라벨 분포**: 즉시 전력감 **10.9%** · 육성 가치 높음 **19.0%** · 장기 프로젝트 **36.8%** · 평가 유보 **33.3%**(쏠림 없음).
  **안개 내장(reveal↓)**: 육성 가치 19.0%(1.0)→5.1%(0.6)→0%(0.3) — 상승여지가 안 보이면 육성 라벨이 평가 유보/장기 프로젝트로 눌림. 즉시 전력감은 reveal 무관 일정(현재 강함은 `fogOvr`로 늘 보임 — 숨은 포텐 아님).
- DL-5 예상 순위와 **한 세트**로 카드에 표시(등급=성격 / 순위=시장 평가).

### DL-5 ⑥ 예상 지명 순위(프로젝션) + 예상↔실제 괴리 드라마 — ✅ 구현(2026-07-10)
> 구현: `data/draftProjection.ts`(`consensusOrder`·`projectionBand`·`projectedPickBand`·`pickTimingBadge`). `app/draft.tsx` 목록을 예상 지명순 정렬+밴드 배지, `app/draft-live.tsx` 픽 카드에 "예상보다 이른/늦은 지명" 배지.
> 밴드 폭 = reveal에 단조 감소(reveal 0.05=순위 불명 / 0.7=예상 N라운드 / 0.92↑=예상 1~3순위). 컨센서스 정렬=`aiProspectValue`(reveal-gated). 가드 `tools/_dv_draftprojection.ts`(폭 단조·결정론·A/B).
- **유망주마다 예상 지명 순위**: "예상 1~3순위" · "예상 2라운드" · "예상 후반 라운드". **공개도만큼만**(안개):
  reveal 높음 → 좁은 범위("예상 1~3순위"), reveal 낮음 → 넓은 범위/모호("예상 중반 이후" · "순위 불명").
- **산출**: 클래스를 **공개 컨센서스 가치**(fog된 `aiProspectValue`/`prospectValue` view)로 정렬 → 순번을 라운드 밴드로 매핑(총 픽 ~19~21·7팀 4라운드 기준, DL-2 로스터 여유 표시와 같은 근거).
  **팀별 need를 시뮬하지 않는 리그 컨센서스**(전 팀 평균 시선) — 그래서 실제 픽과 **어긋난다**.
- **★ 괴리 = 진짜 드라마(가짜 아님)**: 실제 지명(`resolveDraft`의 `sequence` — 로터리 추첨 + 팀별 need + 패스가 섞인 결과)이 예상과 갈릴 때 연출한다.
  - 내가 노린 **"예상 1순위감"이 밀려 남아 있으면** → "아직 안 불렸다" 텐션(내 차례에 주울 기회).
  - **후반 예상이 일찍 불려가면** → "누가 벌써 데려갔다"(경쟁 압박).
  - 이 괴리는 **id 해시 우연이 아니라** 실제 팀 사정(로터리 순번·포지션 need)에서 나오므로 **서사로 정당**(하드룰 통과). 연출은 픽 카드에 "예상보다 이른/늦은 지명" 배지 정도로 담백하게.

### DL-6 ③ 타팀 지명 사유 = 값→문장 매핑 (★가짜 드라마 금지 핵심) — ✅ 구현(2026-07-10)
> 구현: `data/draftPickReason.ts pickReasonProse(input, drafterRoster, get, reveal)`. `app/draft-live.tsx` 타팀 픽 카드에 사유 표시.
> 매핑표 8문장 그대로(브랜치 타겟 8/8 검증) + 하드룰 3(누출0·날조0·reason 정합) — 가드 `tools/_dv_pickreason.ts`(자연 런 816픽 전수 날조0·reason 모순0).
> `AGE_VET=30`(MB=28). **"수비·리시브 보강" 오버레이는 스킵**(팀 리시브 신호=Phase 2 측정·정의, 새 측정 정의 금지 원칙 — 유보).
> "미들 보강" 같은 기계 문구를 **실제 단장 판단처럼** 자연어로. 단 **그 팀의 실제 로스터 상태에 근거해서만** 생성.
> `data/prospectReport.ts`의 두 하드룰(①스포일러 금지 ②날조 금지=값→표현 매핑)을 **드래프트 사유에 그대로 확장 적용**.

**입력(전부 공개·결정론)**: ① 엔진 `reason`(super/need/best, `engine/draft.ts pickWithReason`) ② **그 팀의 공개 로스터 상태**
(`positionGap(팀로스터)`[pos] · 그 포지션 주전의 **나이**[공개] · 외국인 여부[공개] · 인원[공개]) ③ 뽑힌 유망주의 **reveal-gated 등급**(DL-4).

**값 → 문장 매핑표** (조건 안 맞으면 그 문장 **안 씀** — 없는 이유 지어내기 금지):

| 사유 문장(자연어) | 켜지는 조건 (reason + 그 팀 공개 로스터 상태) | 근거 데이터 |
|---|---|---|
| **"특급 유망주는 놓칠 수 없다 — 자리와 무관하게"** | `reason=super` | 엔진 BPA(`pickWithReason` super). **포지션 need 주장 금지**(자리 무관이 핵심) |
| **"주전 {포지션}의 노쇠를 대비한 지명"** | `reason=need` **AND** 그 pos 주전(최고 OVR) 나이 ≥ `AGE_VET`(placeholder ~30, **MB는 ~28** — 노쇠 빠름 CLAUDE §5.3) | `positionGap[pos]>0` + 주전 age(공개) |
| **"{포지션} 백업(뎁스) 확보"** — S면 **"세터 백업 확보"** | `reason=need` **AND** 주전은 건재(젊음) **AND** `depthGap`가 작음(1명 부족 = `have ≥ ideal−1`) | 주전 age 낮음 + gap 소 |
| **"{포지션}이 얇다 — 즉시 채운다"** | `reason=need` **AND** `depthGap` 큼(`have ≤ ideal−2`) | `positionGap[pos]` 대 |
| **"외국인에 기댄 아포짓 — 국내 자원을 키운다"**(외국인 의존도 감소) | `reason=need` **AND** `pos=OP` **AND** 그 팀 주전 OP가 `isForeign` **AND** 뽑힌 유망주는 국내 | 주전 OP isForeign(공개) |
| **"수비·리시브 보강"**(선택 오버레이) | `reason=need` **AND** `pos∈{OH,L}` **AND** 그 팀 팀단위 리시브가 하위 티어 | 팀 집계 리시브 신호(Phase 2 측정·정의) |
| **"이상적 구성은 갖췄다 — 미래를 위한 최고 자원 확보"** | `reason=best`(부족 포지션 0) | 엔진 best(니즈 없음). **포지션 need 주장 금지** |
| **"{포지션} 자원 보강"**(폴백) | `reason=need`인데 위 세부 신호가 하나도 안 맞음 | gap>0만 확실할 때 안전 폴백 |

- **문장 뒤에 유망주 등급 첨언 가능**: "…— {이름}, 육성 가치 높음"(DL-4 라벨, reveal-gated). 숫자 등급/숨은 포텐 금지.
- 포지션 한글 표기: S=세터 · OH=아웃사이드 · OP=아포짓 · MB=미들 · L=리베로.

**★ 가짜 드라마 하드룰 (DL-6 전용 — 어기면 그 문장 폐기)**
1. **스포일러 금지**: 사유는 **공개 재료만** — 그 팀의 공개 로스터(인원·나이·포지션·외국인 여부) + 엔진 `reason` + 유망주의 reveal-gated 등급.
   숨은 `maxPot`·미래 스탯·`prospectArc`(대기만성/반짝) **절대 미참조**(그건 은퇴 회고 전용, FA_SYSTEM §3.3 4d).
2. **날조 금지 = 값→표현 매핑만**: 위 표의 조건이 참일 때만 그 문장. **조건 안 맞으면 그 문장 안 쓴다**(예: `reason=best`인데 "미들 노쇠 대비"처럼 없는 니즈를 붙이지 않는다 — best는 "이상 구성 충족" 계열만).
   **`id` 해시로 성격·사연·동기 창작 금지**(우연을 서사로 둔갑 금지). 엔진 `reason`과 로스터 상태가 유일한 진실.
3. **엔진 reason과 모순 금지**: `super`→자리 무관 BPA, `need`→해당 pos, `best`→니즈 없음. 문장이 이 셋과 어긋나면 버그.

### DL-7 ④ 관심 선수(찜) 타팀 지명 연출 — ✅ 구현(2026-07-10)
> 구현: `app/draft-live.tsx` — `draftPicks.includes(playerId) && !mine`면 픽 카드에 💔 한 줄 + 카드 강조(warn 테두리). 과한 효과 없음(store shortlist ∩ pick 실데이터만).
- 찜한 선수(`draftPicks`/`draftSelections` ∈ 내 shortlist)가 **타팀에 지명**되면(`sequence`의 그 픽 `teamId ≠ myTeam`):
  라이브 피드 그 픽 카드에 **💔 "{이름}가 {팀}의 지명을 받았습니다"** 한 줄(또는 **★ 관심 선수 지명됨** 배지) + 카드 강조.
- **과한 효과 지양** — 단순·기억에 남게(작은 하트/별 + 한 줄). "아 저거 노렸는데"의 담백한 아쉬움(DL-2 감정 설계).
- **실데이터만**: 내 shortlist ∩ 이 픽 — 우연/날조 없음.

### DL-8 ⑤ 드래프트 종료 요약 화면 — ✅ 구현(2026-07-10)
> 구현: `data/draftSummary.ts myDraftSummary(sequence, myTeam, get)`(라운드 1~4 완결 + PASS 채움). `app/draft-live.tsx` 종료(done) 화면에 요약 카드.
> **prefix 불변식**(엔진 aiShouldPass: round≤2 무조건 지명 + 로스터 단조 증가·후반 문턱 낮음 → 패스는 sticky·후반 라운드로 몰림)으로 내 지명=라운드 1..M, 나머지 PASS. sequence만으로 복원. 지명 0시즌은 "이번은 참관" 담담 톤. 등급=`prospectGradeLabel(p,1)`(내 선수 전부 공개 UI-16). 가드 `tools/_dv_draftsummary.ts`(라운드 완결성·PASS 정합·prefix 교차검증 80시즌·결정론).
- 드래프트 완료 시 **"우리 팀 지명 요약"** 카드 — 라운드별 한눈에(다음 시즌 선수단 구성 확인용):
  ```
  1R  김민수 (OH)  즉시 전력감
  2R  이하나 (MB)  장기 육성
  3R  PASS
  4R  박지은 (L)   수비형
  ```
  각 줄 = `{round}R  {이름} ({포지션})  {DL-4 등급 라벨}`. 내가 **패스한 라운드는 `PASS`**.
- **입단 확인과 연계**: 요약의 선수가 선수단에 **신인 배지**로 들어옴(DL-3 결과). 지명권 0/총 0픽(≈60% 시즌)이면 DL-3의 담담한 "참관" 톤(초라하지 않게).
- **데이터**: `sequence`에서 `teamId=myTeam` 픽을 라운드로 그룹핑 + 내가 지명 안 한 라운드는 PASS. 등급 라벨은 DL-4(reveal-gated) — 단, **입단 후 내 선수는 전부 공개**(UI-16: 내 팀=전부+포텐)라 요약에선 확정 등급 가능.

### DL-9 내 팀 지명 포스터 연출 (2026-07-22 사용자 시안 승인 진행)
> 관전형 1순위(보는 경험) 투자처 — **내가 직접 지명을 확정하는 순간**을 텍스트 카드가 아닌 **한 장의 포스터**로 못박는다.
> AWARDS_SYSTEM §8(MVP 포스터)의 **재사용 규약을 공유하되 드래프트 전용 자산·좌표**를 쓴다. 순수 표시(엔진·store 무의존, 결정론 무관).
> **DL-8 종료 요약과 중복 아님**: 요약(done 화면)은 라운드 1~4를 한눈에 보는 **표 회고**, 포스터는 지명 **그 순간의 연출**(비트). 역할이 다르다.

- **자산**: `assets/awards/draft_stage.webp`(1080×1440, 3:4, 딥 네이비/화이트). 배경에 상 타이틀 격의 **"DRAFT DAY"가 박혀 있고**(상단 `titleTopPct` 9.03% 실측), 그림의 **하단 빈 패널**에만 텍스트를 얹는다.
  - **하단 패널 아웃라인 실측**: top **74.0%** / bottom **94.4%**(내부 채움색 `#1c1f35`) — 시상 포스터(79.9~95.1%)와 좌표가 **다르다**(전용 좌표 필수, 눈대중 3연전 교훈).
- **상단 오버레이 없음**: 배경 "DRAFT DAY" 타이틀이 이미 9.03%에서 시작하므로 상단에 시즌 라벨을 얹으면 **충돌**한다 → 시즌 정보는 **하단 패널의 키커 문구에 포함**(상단 zone 미렌더). AWARDS_SYSTEM §8은 상단에 시즌 라벨을 얹지만 본 절은 얹지 않는다(자산 차이).
- **하단 패널 오버레이 좌표**: `top 74.5% ~ bottom 6.1%`(= 93.9%) — 아웃라인 74.0~94.4%의 안쪽 **0.5% 인셋**. 컨테이너 높이 = 100 − 74.5 − 6.1 = **19.4%h**. `left/right 8.5%`(패널 내부폭 = w×0.83).
- **패널 내용**(위→아래) — **개편(2026-07-22 사용자 피드백)**: ~~등급 칩~~ → **능력치 스탯**(아래 정정):
  - 상단행: `[구단 엠블럼(emblemFor(myTeam))]` + `[키커 + 이름]` + **`[OVR 칩]`**(AwardPoster headRow와 동일 배치)
    - 키커(옅은 블루-화이트 dim): `"{seasonYear(season+1)} 신인 드래프트 · {round}R {전체순번}순번"` — 예 "2026-27 신인 드래프트 · 1R 3순번". 시즌연도는 **입단 시즌**(드래프트 클래스가 합류하는 `season+1`, `buildOffseasonBase(…, season+1)`과 동일 기준).
    - 이름(큰 흰색 `#FFFFFF`): 지명 선수명.
    - **OVR 칩(구단 accent = `teamColors(myTeam).light`)**: `displayOvr(overallRaw(p))` — `OvrBadge`/AwardPoster와 **동일 표시 규약**(raw 연속 OVR을 넘기면 칩이 `displayOvr` 스트레치 적용). 내 지명 선수 = 풀공개(UI-16)라 안개 없음.
  - 하단: 포지션 **영문만**(예 "SETTER", 옅은 블루-화이트) — ~~`한글 · 영문` + **직관 등급 라벨 칩** `prospectGradeLabel(p, 1)`~~ **정정(2026-07-22)**: 포지션은 영문만, **등급 칩 제거**(사용자 피드백 — 직관 등급 대신 실제 능력치를 보여준다).
  - **대표 5능력(윗단 종합 능력치, AwardPoster statRow 문법)**: 시즌 생산이 아니라 **능력치**(`deriveRatings` 윗단, 원시 0~100). **표시값·라벨은 선수 상세 화면(`app/player/[id].tsx` StatBar)과 동일 규약**(displayOvr 스트레치는 OVR 단일값에만, 5능력은 원시치 그대로). 포지션별 5칸은 `data/awardPoster.ts` `posterAbilityStats(p)`가 조립 — `posterStats`(시즌 생산)의 포지션 철학을 능력치로 매핑(득점→스파이크, 세트→세팅):

    | 포지션 | 대표 5능력 | 근거(posterStats 매핑) |
    |---|---|---|
    | S 세터 | 세팅·서브·디그·블로킹·스파이크 | posterStats S(得점→스파이크 후미, 세트→세팅 선두), 리시브(가중1) 제외 |
    | OH 아웃사이드 | 스파이크·서브·리시브·디그·블로킹 | posterStats 기본(得점+공격→스파이크 병합) + 5번째 블로킹(전위 가중2) |
    | OP 아포짓 | 스파이크·블로킹·서브·디그·리시브 | posterStats OP(得점+공격→스파이크 병합) + 5번째 리시브 |
    | MB 미들 | 블로킹·스파이크·서브·디그·리시브 | posterStats MB(병합), 미들 대표=블로킹 선두 + 5번째 리시브 |
    | L 리베로 | 디그·리시브·세팅·서브·블로킹 | posterStats L(세트→세팅), 리베로는 스파이크 무의미 제외 |
- **톤(로컬 상수, 화이트/네이비)**: 이름·수치는 흰색, **키커/포지션/스탯 라벨은 옅은 블루-화이트 dim 계열**(bright #FFFFFF는 이름과 충돌하므로 회피), OVR 칩만 구단 accent. AWARDS_SYSTEM §8의 `PosterTone`(자산 네온 샘플링)과 달리 드래프트 자산은 네이비 단색이라 **컴포넌트 로컬 상수**로 고정(상별 톤 주입 불필요 — 자산 1종).
- **포스터 규약 공유(AWARDS_SYSTEM §8)**: 3:4 · 폭 = `min(win.width−32, 460)` · **폭 파생 폰트**(퍼센트 불가) · `allowFontScaling={false}`(OS 글꼴 배율 잠금 UI-48) · 모든 Text `lineHeight` 명시 + `includeFontPadding:false`(폰트 패딩 넘침 제거) · 배경 위 **픽셀 고정색**(앱 라이트/다크 테마 무관) · **세로 예산 산식으로 넘침 봉인**(넘침 3연전 교훈).
  - **세로 예산 증명**(%h; 폭 파생 폰트 s→%h=s×lh×75, px p→75p/428, 패널폭 %마진 m→0.6225m) — **개편 갱신(2026-07-22, 스탯 행 추가)**: ~~headRow(kicker·name) 7.81%h + posRow(등급 칩) 4.75%h ≈ 12.56%h~~ → headRow(max[nameCol 7.81, **ovrChip 6.23**, emblem 5.2]) = **7.81%h** + posEnRow(mt 2.0% + posEn 0.024) = **3.32%h** + statRow(mt 1.8% + statVal 0.034 + statLab 0.021) = **5.96%h** → 콘텐츠 총높이 **≈17.08%h** ≤ 예산(19.4 − 안전 0.5 = **18.9%h**), 여유 1.82%h. 산식은 `components/DraftPoster.tsx` `styles.panel` 주석 + 가드 `tools/_dv_draft_poster.ts`와 값 동기.
- **노출 시점**: 내가 지명을 **확정한 직후**(`mySelections`에 추가되는 순간) 그 픽을 **한 박자 비트**로 표시 — `Screen`의 `overlay` 슬롯(뷰포트 고정, ScrollView 밖)에 스크림 + 포스터. **탭하면 닫히고 라이브 계속**(시상식 비트 패턴). 표시 중 **자동진행 일시정지**(기존 하드스톱 패턴 재사용 — `posterPick != null`을 자동진행 정지 조건에 추가), 탭으로 재개.
- **미노출 케이스**: **지명 0시즌(참관)**·**타팀 픽**은 포스터 없음(내 확정 픽만). 마지막 내 픽 확정 시엔 포스터 → 탭 → 기존 "나머지 자동 진행 ▶" 게이트로 이어진다.
- **배선**: `app/draft-live.tsx` `confirm(playerId)`에서 `{ player, round: seq[stopAt].round, overallNo: stopAt+1 }`를 캡처해 `posterPick` state 설정(자동진행 정지 조건에 포함). 포스터 props는 `ovr={overallRaw(p)}`·`stats={posterAbilityStats(p)}`·`accent={teamColors(my).light}`(개편 2026-07-22). 컴포넌트 `components/DraftPoster.tsx`(순수 표시). 가드 `tools/_dv_draft_poster.ts`(세로 예산 산식 미러링 + 패널 좌표 아웃라인 내포 어서션 + A/B 민감도).

### Phase 2 구현 인계 노트 (데이터 계층 배치 — UI→data 셀렉터→engine)
> **의존 방향(CLAUDE §11 SOLID)**: UI(`app/draft*.tsx`)는 **data 셀렉터**만 호출. 아래 파생은 전부 **`data/`의 순수·결정론·reveal-gated·무저장** 함수(FA_SYSTEM §3.3 §7 "엔진 격리·무저장"과 동일 패턴 — 시드/리플레이/세이브 불침투). engine(`engine/draft.ts`)은 Phase 1 에이전트 소관이라 **읽기만**(reason·sequence·positionGap·prospectValue 소비).

| 개선 | 새 data 셀렉터(제안) | 입력(엔진/공개) | 가드(신설 `tools/_dv_*`) |
|---|---|---|---|
| ② 등급 라벨(DL-4) | `data/prospectGrade.ts` → `prospectGradeLabel(player, reveal)` | `fogOvr` + `potentialEstimate`(`data/prospectScout.ts`) | 누출0(숨은 pot 미참조)·reveal 단조·라벨 분포·결정론·A/B |
| ⑥ 예상 순위(DL-5) | `data/draftProjection.ts` → `projectedPickBand(player, class, reveal)` | fog된 컨센서스 가치 정렬 → 라운드 밴드 | reveal→밴드 폭 단조·결정론·A/B(reveal↑=범위 좁아짐) |
| ③ 타팀 사유(DL-6) | `data/draftPickReason.ts`(또는 `prospectReport.ts` 확장) → `pickReasonProse(pick, drafterRoster, get, reveal)` | 엔진 `reason` + `positionGap(팀)` + 주전 age/isForeign(공개) + DL-4 등급 | **누출0**·**날조0**(값→문장 표 외 문장 0)·reason 정합·결정론·A/B(`_dv_report`·`_dv_draftpreview` 계열) |
| ④ 찜 강탈(DL-7) | 컴포넌트 로직(store `draftPicks`/`draftSelections` ∩ pick) — 필요 시 `data`에 `isMyShortlist(pickId, shortlist)` 헬퍼 | store shortlist + `sequence` | (경량 — 셋 교집합) |
| ⑤ 종료 요약(DL-8) | `data/draftSummary.ts` → `myDraftSummary(sequence, myTeam, get)` | `sequence`(teamId=myTeam) 라운드 그룹핑 + PASS 채움 + DL-4 라벨 | 라운드 완결성(1~4R)·PASS 정합·결정론 |

- **①(AI 패스 확률)은 여기서 안 만든다** — `aiShouldPass`(engine, FA_SYSTEM §3.0 결정 2)가 진실. UI(DL-2)는 그 판단을 **전략 카드**로 보이게만.
- 모든 셀렉터는 **`reveal = teamScoutReveal(myTeam)`**(`data/league.ts`)로 안개 게이트 — 내 팀 시선 기준(UI-16). 세이브 저장·결정론 무영향(표시 파생만).

### 왜 별도 절인가
FA_SYSTEM §3.2.1은 **엔진/저장/게이트**(mySelections·재개 등가·오프시즌 게이트)를 확정한다. 본 절은 그 위의
**감정 설계** — 같은 기능이라도 "타팀이 내 찜을 뺏는 ★", "패스를 전략 카드로", "한 장씩 텀"이 있고 없고가
관전 품질(기둥 1)을 가른다. 구현 시 두 문서를 함께 읽는다.
