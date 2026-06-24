// 스포트라이트 튜토리얼 스텝 레지스트리(ONBOARDING_SYSTEM).
// 단위 = 설명 한 조각(팁). 각 팁은 영구 추적되는 고유 id를 갖는다.
// 확장: 새 기능엔 새 id의 팁을 여기 한 줄 추가만 하면 — 기존 유저는 신규 id만, 신규 유저는 전부 본다.
// ⚠ 출시된 id는 절대 바꾸지 않는다(바꾸면 기존 유저가 다시 봄). 대상이 바뀌면 새 id를 만든다. 문구만 고치는 건 자유.

export interface Tip {
  id: string;        // 영구 추적 키
  screen: string;    // 어느 화면에서 뜨나(SpotlightOverlay 의 screen 키와 일치)
  order: number;     // 그 화면 안 순서
  anchor?: string;   // 밝게 띄울 SpotlightTarget id. 없으면 전체 어둡게 + 가운데 카드
  title: string;
  body: string;
}

export const TIPS: Tip[] = [
  // ── 구단 선택 ──
  { id: 'select.pick', screen: 'select-team', order: 0, anchor: 'team-card-0',
    title: '구단을 고르세요', body: '구단마다 역사와 색깔이 다릅니다. 카드를 누르면 선수단과 감독을 미리 볼 수 있어요. 마음에 드는 구단을 골라 시작합니다.' },

  // ── 구단 정보(상세) ──
  { id: 'team.ovr', screen: 'team-detail', order: 0, anchor: 'team-ovr',
    title: '팀 종합 전력', body: '선수단 전체의 평균 전력입니다. 숫자가 높을수록 강팀 — 하지만 이야기는 지금부터 쌓입니다.' },
  { id: 'team.start', screen: 'team-detail', order: 1, anchor: 'team-operate',
    title: '이 구단으로 시작', body: '여기를 누르면 당신이 이 구단의 구단주가 됩니다. 시즌 일정과 선수단이 준비됩니다.' },

  // ── 일정 탭(첫 진입 화면) ──
  { id: 'sched.next', screen: 'tab-schedule', order: 0, anchor: 'sched-next',
    title: '다음 경기', body: '여기서 경기를 진행합니다. ⭐ 빅매치는 직접 관전을 권해요 — 현장 운영(교체·작전)은 감독 몫, 당신은 보는 게임입니다.' },

  // ── 대시보드(구단) 탭 ──
  { id: 'dash.overview', screen: 'tab-dashboard', order: 0, anchor: 'dash-top',
    title: '구단 현황', body: '구단의 한눈 요약입니다. 순위·재정·소식이 모여요. 시즌이 흐르며 이 화면이 당신의 연대기가 됩니다.' },

  // ── 선수단 탭 ──
  { id: 'squad.intro', screen: 'tab-squad', order: 0, anchor: 'squad-top',
    title: '선수단', body: '선수마다 2층 스탯(보이는 종합 + 밑단 세부)과 특성이 있습니다. 카드를 눌러 자세히 보세요. 선수는 성장하고, 또 노쇠합니다.' },

  // ── 단장실 탭 ──
  { id: 'office.intro', screen: 'tab-office', order: 0, anchor: 'office-top',
    title: '단장의 레버', body: '드래프트·FA·외국인·스태프 — 전력을 좌우하는 결정이 여기 있습니다. 단장의 선택이 수 시즌 뒤 구단의 운명을 가릅니다.' },

  // ── 기록 탭 ──
  { id: 'history.intro', screen: 'tab-history', order: 0, anchor: 'history-top',
    title: '기록과 명예', body: '통산 기록·시상·명예의전당이 쌓이는 곳. 세월이 흘러야 채워집니다 — 백년배구의 진짜 재미입니다.' },
];

/** 그 화면의 팁을 순서대로 */
export const tipsForScreen = (screen: string): Tip[] =>
  TIPS.filter((t) => t.screen === screen).sort((a, b) => a.order - b.order);
