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
| **UI-12** | **카테고리 장식 색 — 다크 베이스 유지 + 카드/메뉴마다 다른 액센트(2026-06-28)** | 시네마틱 글래스(UI-7) 다크 전환 후 민트 단색이라 "전부 어둡고 단조롭다"(사용자, 타 게임 구단관리 화면 — 카드마다 보라/초록/빨강/골드/파랑 색띠 참조). 베이스는 다크 유지하되 카테고리를 **색으로 구분**해 활기 | 테마에 **장식 색 토큰** 추가(`components/Screen.tsx`): `violet #9B7BFF`·`sky #46C8FF`·`rose #FF7BA6`(+기존 accent/elite/good/warn/bad). 의미색(good=승·bad=위험)과 별개의 **순수 장식**. 공용 `Card`에 `accent?` prop → **좌측 4px 컬러 바**(borderLeftWidth, 라운드 자동 준수). 공용 `IconLabel`(아이콘+보조라벨, 단일 소스 — UI-3 재구현 금지). 1차: 대시보드 4카드(전력=elite·재정=warn·순위=accent·뉴스=violet) 색띠+컬러 아이콘. **전 화면 확장 완료(2026-06-28)**: 단장실·일정·선수단·기록·구단정보·선수정보·감독·순위·계약·스태프·드래프트·FA·트라이아웃·이동·업적·포스트시즌·결과(20화면). 컨벤션(카테고리→색): 전력=elite·재정=warn·팬=rose·순위/선수=accent·뉴스/감독스태프/특성=violet·일정/영입=sky·외국인/부상/방출=bad·훈련=good·트로피/명예전당/통산/업적=gold(한정). 개발도구·이미 스타일된 화면(match보드·온보딩·select-team·settings)은 제외 | tsc 0 · 실기 시각 — 홈 화면 카드별 색 구분·아이콘. 골드는 트로피 한정(UI-7) 유지 |
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

> **UI-29 (2026-07-08 — 에뮬레이터 세리머니 흐름 육안 발견)**: 세리머니/헤더 두 건 수정. **(A) 라우트 등록**: `champion-ceremony`(우승 시상식)가 `app/_layout.tsx` Stack에 미등록이라 네이티브 헤더가 파일/라우트명 "champion-ceremony"(영문)를 축하 화면에 노출 — UI-15 형제 재발. `<Stack.Screen name="champion-ceremony" options={{ title: '시상식' }} />` 등록으로 교정(awards-ceremony 인근). **(B) 타이틀↔상태바 겹침**: `headerShown:false` 화면(enshrine·season-opening·champion 등 세리머니)은 네이티브 헤더가 없어 `components/Screen.tsx` 타이틀이 top:0에 렌더돼 상태바(시계)와 겹쳤다 — 원인은 Screen의 SafeAreaView가 `edges` top을 제외해 top inset이 안 붙음. **SafeAreaView edges에 `'top'` 추가**로 교정. **회귀 0 근거**: `react-native-safe-area-context`의 SafeAreaView는 **헤더-인지적** — 네이티브 헤더 화면(전 Tabs/대부분 Stack)은 안전영역 프레임이 헤더 아래에서 시작해 top inset이 0에 수렴하므로 이중 여백이 안 생기고, 헤더 없는 화면만 top inset=상태바 높이가 붙어 타이틀이 내려온다. `useSafeAreaInsets().top`(raw)은 헤더를 몰라 이중 패딩을 만드니 금지 — 반드시 SafeAreaView(edges) 사용.

## UI-27 세계관 사유 문구 예시 (BusyOverlay message — 2026-07-08 사용자 결정)

> 문구는 **그 작업이 실제 하는 일**을 게임 언어로 옮긴다(가짜 사유 금지). 코치·감독·스카우트·프런트가
> 무대 뒤에서 하는 일로 로딩을 서사화 — 관전형(보는 게임)에서 대기도 "장면"이다. copylint(여자부·배구 용어) 통과 필수.

| 화면 · 버튼 | 실제 하는 일(무거운 이유) | 사유 문구 |
|---|---|---|
| training-camp · 코스 구매(전지훈련 보내기) | 서버 다이아 차감 후 선수 스탯/포텐 반영(비동기) | `코치진이 훈련 프로그램을 준비하는 중…` |
| training-camp · 전지훈련 마치고 개막전으로 | 오프시즌 종료·개막전 노출(base 재계산 워밍) | `선수들이 전지훈련에서 구슬땀을 흘리고 있습니다…` |
| training-policy · 방침 저장 | 팀 훈련 포커스 갱신(성장 파이프라인 반영) | `코칭스태프가 새 훈련 일정을 짜는 중…` |
| player/[id] · 선발/벤치 건의 · 복귀 지시 | 벤치 지시 갱신 → 출전 라인업(buildLineup) 재도출 | `감독이 라인업을 다시 그리는 중…` |
| tryout · asian-tryout · 위시/보유 토글 | buildDraftContext(리그 전체 진화 스냅샷) 재빌드 | `스카우트 리포트를 정리하는 중…` |
| fa · 영입 시도/취소·보호·돈만·공격적 | faMarketPreview(FA 경쟁 결정론 재해결) | `협상 테이블을 차리는 중…` |
| draft · 담기/빼기 | resolveDraft(지명 시뮬 재실행) | `지명 결과를 정리하는 중…` |

## 대원칙
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

### DL-1 준비 화면 (`app/draft.tsx` = 스카우팅 + 찜)
- 상단 **"우리 필요 포지션" 배지**(floor 대비 부족 포지션 힌트).
- 유망주 목록을 **예상 지명순 정렬**(DL-5 프로젝션) + **단장 직관 등급 라벨**(DL-4 — 즉시 전력감/육성 가치 높음/장기 프로젝트) + **예상 순위 배지**(DL-5)로 표시. 찜(shortlist) 버튼.
  - **구 "1R급/2R급" 숫자 라운드 등급 폐기** — 단장 직관 라벨(DL-4)로 대체. 둘 다 **스카우터 공개도(reveal)만큼만** 노출(안개).
- 카피 전환: **"매 라운드 지명 or 패스 — 미래를 위한 어린 선수를 뽑습니다"**(빈자리 메우기 아님을 명확히).
- (기능은 FA_SYSTEM §3.2.1 — 결과 미리보기 삭제·찜만.)

### DL-2 라이브 진행 (`app/draft-live.tsx`)
- **진짜 라운드 표시**: **1R~4R 진행바**로 지금 몇 라운드 몇 순번인지 항상 보인다.
- **내 차례 = 하드스톱**: 자동진행이 내 픽에서 멈추고 **[지명] 또는 [이번 라운드 넘기기]**(패스) 두 버튼.
- **로스터 여유 상시 표시**: "18/20"처럼 계약 상한 대비 현재 인원을 늘 보여준다(지명/패스 판단 근거).
- **타팀 픽 = 사유 노출**: AI가 왜 그 선수를 뽑았는지 한 줄. **상세 스펙·값→문장 매핑·가짜드라마 하드룰 = DL-6**(엔진 reason + 그 팀 실제 로스터 상태에 근거해서만 생성).
- **패스 = 명확한 카드**: 넘기면 "대전, 3R 지명 포기 · 로스터가 두텁습니다"처럼 **명시적 카드**로 보여준다(조용히 스킵 금지).
  **패스를 "포기"가 아니라 전략으로** 느끼게 — 사유 힌트로 정당화. (**① AI 패스 *확률/판단*은 엔진 소관** — `aiShouldPass`, FA_SYSTEM §3.0 결정 2·§3.1. UI는 그 판단을 **전략 카드로 보이게만** 한다.)
- **찜 선수 강탈 강조**: 내가 찜한 선수를 타팀이 데려가면 강조. **상세 스펙 = DL-7**.
- **내 차례 다가오는 긴장**: 순번이 나에게 가까워지면 카운트다운 느낌(강조·텐션 빌드업).
- **한 장씩 텀 두고 공개**: 픽을 **좌르륵 쏟지 말고** 한 픽씩 간격을 두고 공개(속도 토글 600/300ms) — 긴장감이 연출의 핵심.

### DL-3 결과 + 학습성
- **결과**: "우리 팀 지명 요약" 카드 + 입단 확인(선수단에 **신인 배지**).
- **지명권 0인 시즌(≈60%)**: "이번은 참관 — 다음 기약" 담담한 톤. 0명 뽑아도 초라하지 않게(보호할 결정이 없을 뿐).
- **첫 진입 1회 안내**: 드래프트 개념·순번이 왜 이렇게 정해지는지(순위 역순 추첨) 1회 온보딩(학습성).

### DL-4 ② 유망주 등급 = 단장 직관 라벨 (숫자 라운드 등급 폐기)
> "1라운드급/2라운드급" 같은 **정답을 흘리는 숫자 등급**을 버리고, 단장이 리포트를 보고 내리는 **직관 판단**을 라벨로 준다.
- **라벨 3종(+안개 라벨)** — 유망주가 **어떤 종류의 자원인지**를 말한다(순위가 아니라 성격):
  | 라벨 | 의미(플레이어가 읽는 것) | 켜지는 신호(**공개 재료만**) |
  |---|---|---|
  | **즉시 전력감** | 지금 당장 1군에서 뛴다 | 공개 현재 OVR **높음**(상위 밴드) · 공개 상승여지 작음 |
  | **육성 가치 높음** | 키우면 주전감, 몇 시즌 투자 | 공개 상승여지 **큼**(공개 포텐 − 공개 현재 ≥ 밴드) · 현재 중간 |
  | **장기 프로젝트** | 원석 — 오래 걸리지만 천장 베팅 | 공개 현재 **낮음**(raw) · 상승여지 불확실 |
  | **평가 유보 / 원석 후보**(안개 라벨) | 판단 재료 부족 | **reveal 낮음** → 위 셋을 못 가림. 라벨을 모호하게(범위·"스카우트 리포트 부족") |
- **입력 = 오직 공개 재료**: `fogOvr(현재)` + `potentialEstimate`(reveal-gated, `data/prospectScout.ts`). **숨은 `maxPot`·미래 스탯 절대 미참조**
  (FA_SYSTEM §3.3 하드룰 ①스포일러 금지). reveal이 낮으면 `potentialEstimate ≈ 현재`라 상승여지가 안 새어 자동으로 "즉시 전력감/평가 유보"로 눌린다 — **안개가 라벨에 내장**.
- **밴드는 placeholder — Phase 2에서 클래스 분포로 캘리브레이션**(N≥10,000, 라벨이 한쪽으로 쏠리지 않게. 절대 컷보다 **클래스 백분위**로 두는 걸 권장 — `prospectStars` 상위%~ 방식과 동일 정신). 추정 금지(CLAUDE §11).
- DL-5 예상 순위와 **한 세트**로 카드에 표시(등급=성격 / 순위=시장 평가).

### DL-5 ⑥ 예상 지명 순위(프로젝션) + 예상↔실제 괴리 드라마
- **유망주마다 예상 지명 순위**: "예상 1~3순위" · "예상 2라운드" · "예상 후반 라운드". **공개도만큼만**(안개):
  reveal 높음 → 좁은 범위("예상 1~3순위"), reveal 낮음 → 넓은 범위/모호("예상 중반 이후" · "순위 불명").
- **산출**: 클래스를 **공개 컨센서스 가치**(fog된 `aiProspectValue`/`prospectValue` view)로 정렬 → 순번을 라운드 밴드로 매핑(총 픽 ~19~21·7팀 4라운드 기준, DL-2 로스터 여유 표시와 같은 근거).
  **팀별 need를 시뮬하지 않는 리그 컨센서스**(전 팀 평균 시선) — 그래서 실제 픽과 **어긋난다**.
- **★ 괴리 = 진짜 드라마(가짜 아님)**: 실제 지명(`resolveDraft`의 `sequence` — 로터리 추첨 + 팀별 need + 패스가 섞인 결과)이 예상과 갈릴 때 연출한다.
  - 내가 노린 **"예상 1순위감"이 밀려 남아 있으면** → "아직 안 불렸다" 텐션(내 차례에 주울 기회).
  - **후반 예상이 일찍 불려가면** → "누가 벌써 데려갔다"(경쟁 압박).
  - 이 괴리는 **id 해시 우연이 아니라** 실제 팀 사정(로터리 순번·포지션 need)에서 나오므로 **서사로 정당**(하드룰 통과). 연출은 픽 카드에 "예상보다 이른/늦은 지명" 배지 정도로 담백하게.

### DL-6 ③ 타팀 지명 사유 = 값→문장 매핑 (★가짜 드라마 금지 핵심)
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

### DL-7 ④ 관심 선수(찜) 타팀 지명 연출
- 찜한 선수(`draftPicks`/`draftSelections` ∈ 내 shortlist)가 **타팀에 지명**되면(`sequence`의 그 픽 `teamId ≠ myTeam`):
  라이브 피드 그 픽 카드에 **💔 "{이름}가 {팀}의 지명을 받았습니다"** 한 줄(또는 **★ 관심 선수 지명됨** 배지) + 카드 강조.
- **과한 효과 지양** — 단순·기억에 남게(작은 하트/별 + 한 줄). "아 저거 노렸는데"의 담백한 아쉬움(DL-2 감정 설계).
- **실데이터만**: 내 shortlist ∩ 이 픽 — 우연/날조 없음.

### DL-8 ⑤ 드래프트 종료 요약 화면
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
