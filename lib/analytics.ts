// 분석 계측 래퍼 (ANALYTICS_PLAN §2) — 앱의 유일한 애널리틱스 연결점.
// `track(event, params)` 한 번 호출로 Firebase Analytics + GameAnalytics에 **동시 전송**(SDK 직접 호출 금지).
//
// 환경 분기(광고/IAP와 동일 패턴):
//   • 개발(__DEV__: Expo Go·dev) — 실제 전송 대신 콘솔 로그(logEvent)로 흐름 확인.
//   • 운영(production 빌드) — 실 SDK 지연 require. 미설치/오프라인/실패면 catch로 **조용히 no-op**.
//
// 운영 활성화(EAS): ① `@react-native-firebase/analytics` + `gameanalytics` 설치·설정
//   ② 아래 sendFirebase/sendGameAnalytics의 지연 require 블록만 실 SDK로 (호출부·이벤트명 불변).
// 원칙: **throw 없음** — 계측 실패가 게임을 멈추거나 크래시시키지 않는다(관전형 불가침). 시드/리플레이 무관(순수 메타).
//
// ※ 발화는 **UI/스토어의 유저 행동 지점**에서만. 엔진/리플레이(deterministic, 세션당 수천 회 재실행) 안에 넣지 말 것 —
//    스팸·왜곡. match_end·full_set·rookie_debut·retirement·injury·training(자동)은 서버측/파생으로 구현 시 처리(ANALYTICS_PLAN §3).
import { logEvent } from './log';

/** 수집 이벤트 taxonomy(ANALYTICS_PLAN §3). 새 이벤트는 여기 추가(가드가 등록 일치 검사). */
export type AnalyticsEvent =
  | 'app_open' | 'login' | 'logout'
  | 'season_start' | 'season_end' | 'playoffs' | 'champion'
  | 'match_start' | 'match_end' | 'full_set' | 'triple_crown'
  | 'draft_open' | 'draft_pick' | 'rookie_debut' | 'retirement' | 'injury'
  | 'fa_open' | 'fa_sign'
  | 'training' | 'special_training'
  | 'watch_ad' | 'diamond_earned' | 'diamond_spent' | 'purchase'
  | 'news_open' | 'news_read'
  | 'standings_open' | 'player_detail' | 'mvp_ceremony';

export const ANALYTICS_EVENTS: AnalyticsEvent[] = [
  'app_open', 'login', 'logout',
  'season_start', 'season_end', 'playoffs', 'champion',
  'match_start', 'match_end', 'full_set', 'triple_crown',
  'draft_open', 'draft_pick', 'rookie_debut', 'retirement', 'injury',
  'fa_open', 'fa_sign',
  'training', 'special_training',
  'watch_ad', 'diamond_earned', 'diamond_spent', 'purchase',
  'news_open', 'news_read',
  'standings_open', 'player_detail', 'mvp_ceremony',
];

export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

const isDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__; // node(가드)에서도 안전(ReferenceError 없음)

/** undefined 제거 + 문자열 클립(Firebase 파라미터 제약 대비). */
function sanitize(params?: AnalyticsParams): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 100) : v;
  }
  return out;
}

function sendFirebase(event: string, params: Record<string, string | number | boolean>): void {
  try {
    // @ts-ignore — 선택적 네이티브 모듈(EAS에서 설치). 미설치 시 throw → 상위 catch로 no-op.
    const analytics = require('@react-native-firebase/analytics').default;
    analytics().logEvent(event, params);
  } catch { /* 미설치·실패 → no-op */ }
}

function sendGameAnalytics(event: string, params: Record<string, string | number | boolean>): void {
  try {
    // @ts-ignore — 선택적 네이티브 모듈(EAS). 현재는 design 이벤트로 통일(구현 시 progression/resource/business로 정교화 가능).
    const { GameAnalytics } = require('gameanalytics');
    const amount = typeof params.amount === 'number' ? params.amount : undefined;
    if (amount !== undefined) GameAnalytics.addDesignEvent(event, amount);
    else GameAnalytics.addDesignEvent(event);
  } catch { /* 미설치·실패 → no-op */ }
}

/**
 * 이벤트 1건을 Firebase + GameAnalytics에 동시 전송(운영) / 콘솔 로그(개발).
 * 절대 throw 안 함. 호출부는 결과를 기다리지 않는다(fire-and-forget).
 */
export function track(event: AnalyticsEvent, params?: AnalyticsParams): void {
  try {
    const clean = sanitize(params);
    if (isDev()) { logEvent('track:' + event, clean); return; } // 개발: 콘솔로 흐름 확인
    sendFirebase(event, clean);
    sendGameAnalytics(event, clean);
  } catch { /* throw-none — 계측 실패가 게임을 멈추지 않음 */ }
}
