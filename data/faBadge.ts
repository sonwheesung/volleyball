// FA 센터 미리보기 배지 — 화면(app/fa.tsx)이 그리는 "현재 예상" 문자열·톤을 계산하는 순수 셀렉터.
//
// UI에서 분리한 이유(BUG-01, 2026-07-24 에뮬 1시즌 E2E):
//   fa.tsx가 `getTeam(lost)?.name ?? shortTeam(lost)`를 **LOST 분기 밖에서 무조건** 평가했다.
//   lostTo는 타 팀이 실제 계약했을 때만 채워지므로(data/offseason.ts:342·372) CASH/CAP/ROSTER/SIT_OUT
//   경로에선 undefined → shortTeamName이 `undefined.split(' ')`로 throw → **렌더 중 throw = 앱 프로세스 종료**.
//   오퍼는 세이브에 남아 재진입마다 재크래시(오프시즌 소프트락)였다.
//   → 배지 계산을 셀렉터로 끌어내 가드(tools/_dv_fabadge.ts)가 **전 코드 경로를 실제로 태울 수 있게** 한다.
//     UI는 톤(tone)→색만 매핑한다(data/가 컴포넌트 테마를 모르게 — 의존 방향 UI→셀렉터→엔진 보존).
import { formatMoney } from '../engine/salary';
import { getTeam, shortTeamName } from './league';
import type { FAFailCode } from './offseason';

export type FABadgeTone = 'good' | 'warn' | 'muted' | 'sky';
export interface FABadge { t: string; tone: FABadgeTone }

/** 팀 표시명 — id가 비었거나(undefined/'') 미등록이어도 절대 throw하지 않는다.
 *  정상 id에서는 기존 `getTeam(id)?.name ?? shortTeamName(id)`와 바이트 동일. */
export function teamLabel(id: string | undefined | null): string {
  if (!id) return '다른 구단';
  return getTeam(id)?.name ?? shortTeamName(id);
}

/** FA 카드 상태 배지(FA_SYSTEM §2.8.9 #2·#3) — null이면 배지 없음.
 *  won/targeted/code는 faMarketPreview 관측값 그대로. lostTo는 code==='LOST'에서만 쓰인다. */
export function faPreviewBadge(a: {
  won: boolean;                 // pv.signedByMe.has(id)
  targeted: boolean;            // faOffers에 지명됨
  code?: FAFailCode;            // pv.faFail[id]
  lostTo?: string;              // pv.lostTo[id] — LOST 외 경로에선 undefined가 정상
  counteredTo?: number;         // pv.counterFired[id]?.to (§2.8.6)
}): FABadge | null {
  if (a.won) {
    return a.counteredTo !== undefined
      ? { t: `현재 예상. 요구를 수용해 ${formatMoney(a.counteredTo)}에 계약이 유력합니다`, tone: 'good' }
      : { t: '현재 예상. 우리 팀 계약이 유력합니다', tone: 'good' };
  }
  if (!a.targeted) return null;
  switch (a.code) {
    // lostTo는 이 분기 안에서만 평가한다(형제 구멍 봉인 — 분기 밖 평가가 BUG-01의 원인).
    case 'LOST': return { t: `현재 예상. ${teamLabel(a.lostTo)}와 계약 가능성이 가장 높습니다`, tone: 'warn' };
    case 'CASH': return { t: '운영 자금이 부족해 아직 제안하지 못했습니다', tone: 'warn' };
    case 'CAP': return { t: '샐러리캡이 부족해 아직 제안하지 못했습니다', tone: 'warn' };
    case 'ROSTER': return { t: '정원이 가득 차 아직 제안하지 못했습니다', tone: 'warn' };
    case 'SIT_OUT': return { t: '현재 예상. 어느 구단과도 계약하지 않을 것으로 보입니다', tone: 'muted' };
    default: return { t: '제안 전달됨. 시즌 시작 때 결과가 확정됩니다', tone: 'sky' };
  }
}
