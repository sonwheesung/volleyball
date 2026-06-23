// 중계 텍스트 — 공 경로(WP)가 아는 사실(누가 서브/리시브/토스/스파이크)을 문장으로.
// 보드가 그리는 것과 같은 소스(세그먼트)에서 파생 → 화면과 중계가 어긋날 수 없다.
// React 무의존 순수 모듈(헤드리스 감사 가능).

import type { Side } from '../types';
import type { WP, Atk, Lineups } from './courtPath';
import type { PointHow } from '../engine/rally';
import { zoneOfIdx } from './courtLayout';

export interface CommentStage { serving: Side; homeRot: number; awayRot: number }
export interface CommentSeg { from: WP; to: WP }

const ATK_KO: Record<Atk, string> = { quick: '속공', tempo: '시간차', open: '오픈', back: '백어택' };

const isBackZone = (z: number) => z === 1 || z === 5 || z === 6;

/** idx 위치의 "표시 선수" 이름 — 후위 MB 슬롯은 리베로(보드 마커와 동일 규칙) */
function nameAt(L: Lineups, side: Side, rot: number, idx: number): string | null {
  if (idx < 0 || idx > 5) return null;
  const lu = side === 'home' ? L.home : L.away;
  const p = lu.six[idx];
  if (!p) return null;
  if (lu.libero && p.position === 'MB' && isBackZone(zoneOfIdx(rot, idx))) return lu.libero.name;
  return p.name;
}

/** id로 선수 이름 — 슬롯이 아닌 엔진 귀속 id로 지목된 선수(스터프 블로커 byId 등) */
function nameById(L: Lineups, id?: string): string | null {
  if (!id) return null;
  for (const lu of [L.home, L.away]) {
    const p = lu.six.find((x) => x.id === id);
    if (p) return p.name;
    if (lu.libero?.id === id) return lu.libero.name;
  }
  return null;
}

/**
 * 구간 시작 시점의 중계 한 줄. 사실이 없는 구간(이동·바운드)은 null.
 * 종결의 "무엇으로 끝났나"는 자막(HOW_CAPTION)이 말하므로, 여기선 행위와 행위자를 말한다.
 */
export function commentLine(seg: CommentSeg, how: PointHow | undefined, L: Lineups, stage: CommentStage, byId?: string): string | null {
  const { from, to } = seg;
  const rotOf = (s: Side) => (s === 'home' ? stage.homeRot : stage.awayRot);

  // 포지션 폴트 랠리는 서브 전에 휘슬 — 경로가 walk에서 끝나므로 여기서 외친다
  if (to.kind === 'walk' && how === 'fault') return '휘슬! 포지션 폴트';

  if (to.kind === 'serve') {
    // 서버 = 서브 팀 1번 존(리베로 서브 불가 — 실제 six 선수)
    const sLu = stage.serving === 'home' ? L.home : L.away;
    const sIdx = (rotOf(stage.serving) + 1 - 1) % 6;
    const server = sLu.six[sIdx]?.name;
    return server ? `${server} 서브!` : '서브!';
  }

  if (to.kind === 'pass') {
    if (from.kind === 'serve') {
      // from = 서브 도착점(리시버), to = 연결 도착점(토서)
      const recv = nameAt(L, from.side, rotOf(from.side), from.idx);
      const tosser = nameAt(L, to.side, rotOf(to.side), to.idx);
      if (recv && tosser) return `${recv} 리시브 — ${tosser} 연결`;
      return recv ? `${recv} 리시브` : null;
    }
    if (from.kind === 'spike') {
      // 강타를 받아낸 순간 — 디거는 movers[0]
      const dig = to.movers?.[0];
      const digger = dig ? nameAt(L, dig.side, rotOf(dig.side), dig.idx) : null;
      // 블록 커버: 공격팀이 자기 블로킹 맞은 공을 자기 코트에서 살려 재공격(블록터치 side=수비 ≠ 살린
      // side=공격). 일반 디그(공수 전환)와 구분해 "블로킹을 살려냈다"를 명시 — 사용자 보고: 블록 당한
      // 공을 살리는 장면을 본 적이 없다(실제론 랠리의 16%에서 일어나지만 '디그'로만 불려 안 보였다).
      if (from.side !== to.side) return digger ? `🛡 블로킹 커버! ${digger}가 살려낸다` : '🛡 블로킹 커버! 살려낸다';
      return digger ? `${digger} 디그! 랠리 이어진다` : '디그! 랠리 이어진다';
    }
    // 디그 후 토서에게 잇는 연결 패스 — 디그와 중복 표시 금지
    const tosser = nameAt(L, to.side, rotOf(to.side), to.idx);
    return tosser ? `${tosser}에게 연결` : null;
  }

  if (to.kind === 'toss') {
    // to.idx = 공격수, from.idx = 토서, to.atk = 공격 종류
    const attacker = nameAt(L, to.side, rotOf(to.side), to.idx);
    const kind = to.atk ? ATK_KO[to.atk] : null;
    if (attacker && kind) return `토스 — ${attacker} ${kind}!`;
    return attacker ? `토스 — ${attacker}!` : null;
  }

  if (to.kind === 'spike' && from.kind === 'toss') {
    // 진짜 공격 구간만(에이스 관통 등 비공격 spike 제외). 공격수 = from.idx(토스 도착점)
    const attacker = nameAt(L, from.side, rotOf(from.side), from.idx);
    if (to.soft) return attacker ? `${attacker}, 살짝 페인트!` : '페인트!';
    return attacker ? `${attacker} 스파이크!` : null;
  }

  if (to.kind === 'fault') {
    // 데드볼 비행 — 종결 종류별 색깔만 더한다(상세는 자막)
    if (how === 'ace') return '네트를 맞고 뚝! 손쓸 새가 없다'; // 네트인 에이스(일반 에이스는 fault 구간이 없다)
    if (how === 'blockout') return '코트 밖으로 — 끝까지 쫓아가 보지만!';
    if (how === 'stuff') { const blk = nameById(L, byId); return blk ? `${blk}, 블로킹 차단!` : '벽에 막혀 그대로 꽂힌다!'; }
    if (how === 'recvErr') return '날카로운 서브! 리시브가 그대로 튕겨 아웃 — 에이스!';
    if (how === 'miscErr') return '연결이 어긋났다!';
    if (how === 'fault') return '휘슬 — 포지션 폴트';
    return null; // serveErr 등은 자막으로 충분
  }

  return null; // start/return/walk/bounce — 사실 없음
}
