// 오프시즌 허브 모델 (SEASON_SYSTEM §5.6 · UI_RULES UI-50) — 일정 탭이 그리는 "권장 순서 번호 목록"의 정본.
// 순수 파생: 새 영속 필드 0, React 무의존. 화면은 이 목록을 그리기만 하고, 상비 가드(_dv_hub)가 같은 함수를 검사한다.
//
// 두 위상(§5.6.2):
//   pre  = endSeason 전(planNextAction===seasonOver, currentDay≈183, season=S) — 결산·외국인·아시아·FA·드래프트
//   post = endSeason 후(currentDay===0, season=S+1)                            — 헌액·전지훈련
// 완료 체크는 **데이터로 진짜 판정되는 것만**(UI-50 ②): 앞단 6단계는 전부 미리보기라 "완료"가 데이터에 없다.

export type HubPhase = 'pre' | 'post';

export interface HubStep {
  n: number;            // 권장 순서 번호(표시용 — 강제 아님)
  key: string;
  label: string;
  desc: string;
  route: string;        // router.push 대상
  icon: string;         // Ionicons 이름(화면이 그대로 사용)
  accent: 'gold' | 'bad' | 'sky' | 'accent' | 'good' | 'warn';
  done?: boolean;       // 데이터로 판정 가능한 단계만 true/false, 나머지는 undefined(체크 표시 없음)
}

/** 앞단(pre-rollover) 권장 순서 — 전부 "레버 미리보기"라 done 판정 없음(§5.6.3 ①). */
export function preOffseasonSteps(): HubStep[] {
  return [
    { n: 1, key: 'recap', label: '시즌 결산', desc: '방금 끝난 시즌의 성적·수상·다음 시즌 숙제', route: '/season-recap', icon: 'stats-chart-outline', accent: 'gold' },
    { n: 2, key: 'tryout', label: '외국인 트라이아웃', desc: '팀당 1명, 아포짓 위주의 공격 핵심을 지명', route: '/tryout', icon: 'globe-outline', accent: 'bad' },
    { n: 3, key: 'asian', label: '아시아쿼터', desc: 'AVC 국가 선수 1명과 직접 협상', route: '/asian-tryout', icon: 'airplane-outline', accent: 'bad' },
    { n: 4, key: 'fa', label: 'FA 센터', desc: '자유계약 선수 영입·보호명단·재계약 오퍼', route: '/fa', icon: 'people-outline', accent: 'accent' },
    { n: 5, key: 'draft', label: '신인 드래프트', desc: '유망주 스카우팅과 라이브 지명', route: '/draft', icon: 'person-add-outline', accent: 'sky' },
  ];
}

/** 뒷단(post-rollover) — 전지훈련만 데이터 완료 판정(campDoneSeason). 헌액은 열람 화면이라 판정 없음. */
export function postOffseasonSteps(campDone: boolean): HubStep[] {
  return [
    { n: 1, key: 'enshrine', label: '명예의전당 헌액', desc: '지난 시즌 은퇴한 레전드를 기립니다', route: '/enshrine?hub=1', icon: 'trophy-outline', accent: 'gold' },
    { n: 2, key: 'camp', label: '전지훈련', desc: '다이아로 선수를 해외 캠프에 보내 능력을 키웁니다', route: '/training-camp', icon: 'barbell-outline', accent: 'good', done: campDone },
  ];
}

export function offseasonHubSteps(phase: HubPhase, campDone = false): HubStep[] {
  return phase === 'pre' ? preOffseasonSteps() : postOffseasonSteps(campDone);
}

/** 앞단에서 "레버를 하나도 안 만졌다" — 방문 마커가 아니라 **결정 데이터**의 부재로 판정(UI-50 ②).
 *  true면 새 시즌 시작 버튼에 확인 다이얼로그(감독·스카우트 대행 안내). 하나라도 만졌으면 조용히 통과. */
export function offseasonUntouched(s: {
  faOffers: Record<string, unknown>;
  draftPicks: string[];
  draftSelections: string[];
  tryoutWish: string[];
  asianWish: string[];
  keepForeign: boolean | null;
  keepAsian: boolean | null;
  protectedIds: string[];
  resignDecisions: Record<string, unknown>;
}): boolean {
  return Object.keys(s.faOffers).length === 0
    && s.draftPicks.length === 0
    && s.draftSelections.length === 0
    && s.tryoutWish.length === 0
    && s.asianWish.length === 0
    && s.keepForeign == null
    && s.keepAsian == null
    && s.protectedIds.length === 0
    && Object.keys(s.resignDecisions).length === 0;
}

/** 확정 픽(draftSelections) 무효화 경고가 필요한가 — **0건이면 조용히 통과**(UI-50 ⑥, 소음 금지).
 *  UI(components/draftPickGuard)는 이 판정만 따른다 — 순수 함수라 상비 가드가 UI 없이 검사할 수 있다. */
export function needsDraftPickWarning(draftSelections: readonly string[]): boolean {
  return draftSelections.length > 0;
}
