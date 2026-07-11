// 타팀 지명 사유 = 값→문장 매핑 (UI_RULES DL-6 / ③ UX 개선) — 순수·결정론·reveal-gated·무저장.
//
// "미들 보강" 같은 기계 문구를 실제 단장 판단처럼 자연어로. 단 **그 팀의 실제 공개 로스터 상태에 근거해서만**.
// prospectReport의 두 하드룰을 드래프트 사유에 그대로 확장 적용:
//   ① 스포일러 금지 — 공개 재료만(그 팀 공개 로스터: 인원·나이·포지션·외국인 + 엔진 reason + 유망주 reveal-gated 등급).
//      숨은 maxPot·미래 스탯·prospectArc 절대 미참조.
//   ② 날조 금지 — 아래 매핑표의 조건이 참일 때만 그 문장. 조건 안 맞으면 그 문장을 안 쓴다(없는 이유 창작 금지).
//   ③ 엔진 reason 모순 금지 — super=자리 무관 BPA · need=해당 pos · best=니즈 없음.
import type { Player, Position } from '../types';
import { overall } from '../engine/overall';
import { positionGap, ROSTER_IDEAL } from '../engine/aiGM';
import type { PickReason } from '../engine/draft';
import { prospectGradeLabel } from './prospectGrade';
import { iGa } from '../lib/josa';

type Lookup = (id: string) => Player | undefined;

const POS_KO: Record<Position, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };

// 주전 노쇠 임계(placeholder) — MB는 신체 의존도 최고라 노쇠 빠름(CLAUDE §5.3) → 더 낮게.
const AGE_VET = 30;
const AGE_VET_MB = 28;
const ageVet = (pos: Position): number => (pos === 'MB' ? AGE_VET_MB : AGE_VET);

export interface PickReasonInput { player: Player; reason: PickReason }

/** 그 포지션의 공개 주전(최고 OVR) — 없으면 null. */
function starterOf(rosterIds: string[], get: Lookup, pos: Position): Player | null {
  let best: Player | null = null;
  for (const id of rosterIds) {
    const p = get(id);
    if (p && p.position === pos && (!best || overall(p) > overall(best))) best = p;
  }
  return best;
}

/**
 * 타팀(또는 임의 팀) 지명 사유 자연어 1문장 — 값→문장 매핑표(DL-6)만.
 * @param input  뽑힌 유망주 + 엔진 reason(super/need/best/wish).
 * @param drafterRoster 지명 직전 그 팀의 공개 로스터 id(누적 픽 포함).
 * @param get   로스터/클래스 lookup.
 * @param reveal 보는 팀(내 팀) 스카우팅 공개도 — 등급 첨언에만 사용(UI-16 내 시선).
 */
export function pickReasonProse(input: PickReasonInput, drafterRoster: string[], get: Lookup, reveal: number): string {
  const { player, reason } = input;
  const pos = player.position;
  const posKo = POS_KO[pos];
  const grade = prospectGradeLabel(player, reveal); // reveal-gated 등급 첨언(숫자 등급/숨은 포텐 금지)
  const tail = ` — ${player.name}, ${grade}`;

  // super: 자리 무관 BPA — 포지션 need 주장 금지
  if (reason === 'super') return `특급 유망주는 놓칠 수 없다 — 자리와 무관하게${tail}`;
  // best: 니즈 없음(이상 구성 충족) — 포지션 need 주장 금지
  if (reason === 'best') return `이상적 구성은 갖췄다 — 미래를 위한 최고 자원 확보${tail}`;
  // wish는 내 팀 전용(라이브에선 ★로 따로 표시) — 안전 폴백
  if (reason === 'wish') return `구단이 점찍은 지명${tail}`;

  // ── need: 그 팀 공개 로스터 상태로 세부 사유 결정 ──
  const gap = positionGap(drafterRoster, get)[pos]; // vs ROSTER_IDEAL — 공개 부족도
  const starter = starterOf(drafterRoster, get, pos);
  const vet = ageVet(pos);

  // 1) 외국인 의존 아포짓 — 국내 자원 육성(가장 구체)
  if (pos === 'OP' && starter && starter.isForeign && !player.isForeign) {
    return `외국인에 기댄 아포짓 — 국내 자원을 키운다${tail}`;
  }
  // 2) 주전 노쇠 대비
  if (starter && starter.age >= vet) {
    return `주전 ${posKo}의 세대교체를 대비한 지명${tail}`;
  }
  // 3) 포지션이 얇다(공개 부족 큼: have ≤ ideal−2) — 조사는 받침 기준(josa: "아웃사이드가/미들이", EC-DR-05)
  if (gap >= 2) {
    return `${iGa(posKo)} 얇다 — 즉시 채운다${tail}`;
  }
  // 4) 백업(뎁스) 확보(주전 건재·젊음 + 1명 부족: have ≥ ideal−1)
  if (starter && starter.age < vet && gap === 1) {
    return pos === 'S' ? `세터 백업 확보${tail}` : `${posKo} 백업(뎁스) 확보${tail}`;
  }
  // (수비·리시브 보강 오버레이 = Phase 2 팀 리시브 신호 정의 필요 → 이번엔 스킵, UI_RULES DL-6)
  // 5) 폴백 — gap>0만 확실할 때
  return `${posKo} 자원 보강${tail}`;
}

export { ROSTER_IDEAL };
