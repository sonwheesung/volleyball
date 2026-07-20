// 스포트라이트 튜토리얼 스텝 레지스트리(ONBOARDING_SYSTEM).
// 단위 = 설명 한 조각(팁). 각 팁은 영구 추적되는 고유 id를 갖는다.
// 확장: 새 기능엔 새 id의 팁을 여기 한 줄 추가만 하면 — 기존 유저는 신규 id만, 신규 유저는 전부 본다.
// ⚠ 출시된 id는 절대 바꾸지 않는다(바꾸면 기존 유저가 다시 봄). 대상이 바뀌면 새 id를 만든다. 문구만 고치는 건 자유.
// order = 그 화면 안 순서(위→아래). anchor = 밝게 띄울 SpotlightTarget id(없으면 가운데 카드).

export interface Tip {
  id: string;
  screen: string;
  order: number;
  anchor?: string;
  title: string;
  body: string;
  radius?: number; // 구멍 모서리 반경(대상 카드의 borderRadius). 없으면 기본 카드값(18). 스포트라이트 링이 카드와 같은 곡률로 감싸게.
}

export const TIPS: Tip[] = [
  // ── 구단 선택 ──
  { id: 'select.pick', screen: 'select-team', order: 0, anchor: 'team-card-0',
    title: '구단을 고르세요', body: '구단마다 역사와 색깔이 다릅니다. 카드를 누르면 선수단과 감독을 미리 볼 수 있어요. 마음에 드는 구단을 골라 시작합니다.' },

  // ── 구단 정보(상세) ──
  { id: 'team.ovr', screen: 'team-detail', order: 0, anchor: 'team-ovr',
    title: '팀 종합 전력', body: '선수단 전체의 평균 전력입니다. 숫자가 높을수록 강팀 — 하지만 이야기는 지금부터 쌓입니다.' },
  { id: 'team.coach', screen: 'team-detail', order: 1, anchor: 'team-coach',
    title: '감독', body: '감독을 누르면 성향·능력(경기 운영·육성 철학·리더십)·명성을 자세히 봅니다. 감독 성향이 자동 경기 운영(작전·교체·타임아웃)을 좌우합니다.' },
  { id: 'team.roster', screen: 'team-detail', order: 2, anchor: 'team-roster',
    title: '선수단', body: '선수 이름을 누르면 2층 스탯·특성을 자세히 봅니다. 선수는 성장하고, 전성기가 지나면 기량이 하락합니다.' },
  { id: 'team.start', screen: 'team-detail', order: 3, anchor: 'team-operate',
    title: '이 구단으로 시작', body: '선수단을 둘러본 뒤, 맨 아래 "운영하기" 버튼을 누르면 당신이 이 구단의 구단주가 됩니다. (탭해서 닫고 자유롭게 살펴보세요.)' },

  // ── 일정 탭(첫 진입 화면) ──
  { id: 'sched.next', screen: 'tab-schedule', order: 0, anchor: 'sched-next',
    title: '여기서 시즌을 진행', body: '오프시즌엔 전지훈련으로 선수를 키우고, 개막하면 경기를 치릅니다. 기본은 감독이 자동 운영하는 관전이고, 내 팀 경기는 직접 관전하며 교체·타임아웃으로 개입할 수도 있어요. ⭐ 빅매치는 놓치지 마세요.' },
  { id: 'sched.calendar', screen: 'tab-schedule', order: 1, anchor: 'sched-calendar',
    title: '우리 팀 일정', body: '우리 팀 시즌 일정을 날짜·요일·홈/원정·상대로 봅니다. 치른 경기는 결과, 앞으로는 예정으로 표시돼요.' },
  { id: 'sched.results', screen: 'tab-schedule', order: 2, anchor: 'sched-results',
    title: '전 구단 경기 결과', body: '리그의 모든 경기 결과를 한눈에. 라이벌 구단들이 어떻게 하고 있는지 확인합니다.' },

  // ── 대시보드(구단) 탭 ──
  { id: 'dash.overview', screen: 'tab-dashboard', order: 0, anchor: 'dash-top',
    title: '구단 현황', body: '구단의 한눈 요약입니다. 전력과 이번 시즌 성적이 모여요. 시즌이 흐르며 이 화면이 당신의 연대기가 됩니다.' },
  { id: 'dash.finance', screen: 'tab-dashboard', order: 1, anchor: 'dash-finance',
    title: '재정', body: '총연봉·샐러리캡·운영 자금·팬심입니다. 캡을 넘기면 영입이 막히고, 자금이 마르면 운영이 빠듯해집니다.' },
  { id: 'dash.standings', screen: 'tab-dashboard', order: 2, anchor: 'dash-standings',
    title: '리그 순위', body: '누르면 전체 순위표를 봅니다. 승점·세트 득실로 순위가 갈리고, 상위권이 포스트시즌에 오릅니다.' },
  { id: 'dash.news', screen: 'tab-dashboard', order: 3, anchor: 'dash-news',
    title: '리그 뉴스', body: '누르면 리그의 소식·기록·사건을 연대기로 읽습니다. 세월이 쌓일수록 읽을거리가 풍성해집니다.' },

  // ── 선수단 탭 ──
  { id: 'squad.coach', screen: 'tab-squad', order: 0, anchor: 'squad-coach',
    title: '우리 감독', body: '감독을 누르면 성향·훈련 선호를 봅니다. 감독의 선호가 우리 팀이 어떤 스탯 위주로 성장할지를 가릅니다.' },
  { id: 'squad.intro', screen: 'tab-squad', order: 1, anchor: 'squad-top',
    title: '선수단', body: '선수마다 2층 스탯(보이는 종합 + 밑단 세부)과 특성이 있습니다. 이름을 누르면 상세·면담을 볼 수 있어요.' },

  // ── 단장실 탭 ──
  { id: 'office.intro', screen: 'tab-office', order: 0, anchor: 'office-top',
    title: '계약 관리', body: '선수 재계약·방출, 시즌 종료 FA 잔류/포기를 결정합니다. 단장의 핵심 권한이에요.' },
  { id: 'office.staff', screen: 'tab-office', order: 1, anchor: 'office-staff',
    title: '스태프 계약', body: '감독·전문 코치(훈련 부스트)·스카우터(드래프트 공개도)를 예산 안에서 영입합니다.' },
  { id: 'office.training', screen: 'tab-office', order: 2, anchor: 'office-training',
    title: '훈련 방침', body: '우리 팀이 어떤 스탯 위주로 성장할지 방향을 정합니다. 감독 기본값을 따를 수도, 단장이 직접(체력·공격·수비 등) 정할 수도 있어요.' },
  { id: 'office.tx', screen: 'tab-office', order: 3, anchor: 'office-tx',
    title: '시즌 중 FA 영입', body: '부상 등으로 포지션에 구멍이 나면, 미계약 FA를 시즌 중 즉시 수혈합니다(캡·정원 적용).' },

  // ── 외국인 트라이아웃(오프시즌 첫 진입 — 2026-06-30 신설) ──
  { id: 'tryout.intro', screen: 'tryout', order: 0, anchor: 'tryout-pick',
    title: '외국인 트라이아웃', body: '외국인 선수는 팀당 1명 — 아포짓(OP) 위주의 팀 공격 핵심입니다. 매 오프시즌, 추첨 순번대로 1명을 데려옵니다(1년 계약·연봉 고정·샐러리캡 제외, 운영 자금에서 지출). 누구를 잡느냐가 다음 시즌 전력을 크게 좌우해요.' },
  { id: 'tryout.wish', screen: 'tryout', order: 1, anchor: 'tryout-wish',
    title: '위시리스트로 노리기', body: '원하는 외인을 ★로 담아두면 순번에서 가능한 선수를 자동 지명합니다. 앞 순번 팀이 먼저 데려가면 다음 우선순위로 내려가요. 잘하던 현 외인은 "재계약 우선권"으로 드래프트 없이 갱신할 수 있습니다. 스카우터를 영입하면 능력치가 더 선명해져요.' },

  // ── 마이페이지 탭 스포트라이트 제거(2026-07-05 사용자 요청) — 온보딩 스텝 과다·어색. 화면 자체는 유지, 튜토리얼 팁만 뺌.

  // ── 경기 보드(첫 관전 — 2026-07-14 신설, 구 수동 관전 팝업을 스포트라이트로 승계) ──
  //   ① id는 기존 팝업의 'match-spectate'를 그대로 승계 — 이미 팝업을 본 기존 유저는 자동 skip. anchor 없음(가운데 카드).
  //   ⚠ body에 스코어·승패·세트 결과 등 스포일러 절대 금지(결정론 결과 누출 방지).
  { id: 'match-spectate', screen: 'match', order: 0,
    title: '📺 경기 보드', body: '경기는 감독과 선수가 치릅니다. 그대로 지켜봐도 되고, 내 팀 경기라면 흐름을 보다 직접 손댈 수도 있어요. 속도 조절·결과 스킵으로 편하게 보고, 영입·훈련·선발로 다음 경기를 준비하세요.' },
  { id: 'match.controls', screen: 'match', order: 1, anchor: 'match-controls',
    title: '경기 컨트롤', body: '아래 스코어박스로 지금까지의 기록을 봅니다. 내 팀 경기라면 ⚙ 개입으로 교체·타임아웃을 직접 넣을 수 있어요. 개입하지 않으면 감독이 알아서 운영합니다.' },
];

/** 그 화면의 팁을 순서대로 */
export const tipsForScreen = (screen: string): Tip[] =>
  TIPS.filter((t) => t.screen === screen).sort((a, b) => a.order - b.order);
