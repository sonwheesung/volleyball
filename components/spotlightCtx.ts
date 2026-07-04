// 스포트라이트↔Screen 공유 컨텍스트(leaf 모듈 — Spotlight.tsx↔Screen.tsx 순환 import 방지).
// Screen이 "대상 노드를 화면 안으로 스크롤" 컨트롤러를 여기 실어 자손 SpotlightTarget이 쓴다.
// ⚠ measureLayout(숫자 노드핸들)은 New Architecture(Fabric)에서 "ref to a native component" 에러 → 폐기.
//    대신 콘텐츠 최상단 센티넬 View + measureInWindow(양 아키텍처 안전)로 스크롤 오프셋을 계산한다.
import { createContext } from 'react';

export const SPOTLIGHT_SCROLL_MARGIN = 90; // 대상을 ScrollView 상단에서 이만큼 아래에 두도록 스크롤(카드 여백 확보)

export interface SpotlightScrollController {
  // 대상 View(measureInWindow 가능)를 화면 안으로 끌어온다. 대상이 이 ScrollView 밖이면 무해하게 무시.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scrollIntoView: (node: any) => void;
}
export const ScrollCtrlCtx = createContext<SpotlightScrollController | null>(null);
