// 시상식 포스터 데이터 셀렉터 (AWARDS_SYSTEM §8). 순수 표시 — 엔진/store 무의존, 결정론 무관.
// AwardWinner(playerId/teamId/value) + 시즌 생산(ProdLine)을 모아 AwardPoster props로 조립한다.
// 현재는 정규리그 MVP만 채운다. 다른 1인 개인상(신인상·기량발전상 등)은 같은 buildAwardPosterData로
// 확장 가능(자산 template만 상별 매핑에 추가하면 됨 — awards-ceremony의 AWARD_TEMPLATE 참조).
//
// 스탯 5칸은 **시즌 실카운트만** 쓴다. 시안의 "공격 성공률"·"리시브 효율"은 *비율* 지표인데, 시즌 집계
// (leagueProduction→ProdLine)는 성공/시도 분모(atkAtt·recvGood/Err)를 보존하지 않아(경기 박스는 롤오버로 소멸)
// 시즌 단위 비율을 낼 수 없다 → 지어내지 않고 **실존 카운트로 대체**: 공격 성공률→공격(킬 spikes), 리시브 효율→리시브(recvAtt receives).
// 포지션 특성(세터=득점 무의미 등)은 repRecordLine 철학으로 대표 스탯을 앞세운다(posterStats).

import type { AwardWinner, Position } from '../types';
import type { ProdLine } from '../engine/production';
import { getPlayer, reconstructForeignName } from './league';
import { overall } from '../engine/overall';
import { leagueProduction } from './production';
import { currentSeasonAwards } from './awards';
import { seasonYear } from './seasonLabel';
import { emblemFor } from './emblems';
import { teamColors } from '../lib/teamColor';
import { SEASON_DAYS } from '../engine/calendar';

/** 포지션 영문 라벨(포스터 상단 소제목) */
export const POS_EN: Record<Position, string> = {
  S: 'SETTER', OH: 'OUTSIDE HITTER', OP: 'OPPOSITE', MB: 'MIDDLE BLOCKER', L: 'LIBERO',
};

export interface PosterStat { label: string; value: string }

export interface AwardPosterData {
  seasonLabel: string;   // "2025-26"
  name: string;
  posEn: string;         // "OUTSIDE HITTER"
  pos: Position;
  teamId: string;
  ovr: number;           // raw 연속 OVR(AwardPoster가 displayOvr 적용)
  stats: PosterStat[];   // 5칸
  emblem: number;        // require 자산 id
  accent: string;        // 구단 강조색(teamColors.light)
  isMine: boolean;
}

/**
 * 포지션 대표 5스탯 — 시즌 실카운트만(비율 지표 미보존). repRecordLine 철학 재사용:
 *   OH(시안 기본)    = 득점·공격·서브·리시브·디그   ← 시안 5칸(공격성공률→공격, 리시브효율→리시브)
 *   OP              = 득점·공격·블로킹·서브·디그    ← OP는 리시브 면제 포지션(CLAUDE 5.3 ·)이라 리시브 0 표시 회피 — 블로킹 대체(2026-07-21 에뮬 시안 검수)
 *   S               = 득점·세트·서브·디그·블로킹      ← 세터는 세트(어시) 대표
 *   MB              = 득점·공격·블로킹·서브·디그       ← 미들은 블로킹 대표
 *   L               = 디그·리시브·세트·서브·블로킹      ← 리베로는 디그·리시브 대표(득점 무의미)
 */
export function posterStats(pos: Position, l: ProdLine): PosterStat[] {
  const s = (label: string, v: number): PosterStat => ({ label, value: String(v) });
  switch (pos) {
    case 'S':  return [s('득점', l.points), s('세트', l.assists), s('서브', l.aces), s('디그', l.digs), s('블로킹', l.blocks)];
    case 'OP': return [s('득점', l.points), s('공격', l.spikes), s('블로킹', l.blocks), s('서브', l.aces), s('디그', l.digs)];
    case 'MB': return [s('득점', l.points), s('공격', l.spikes), s('블로킹', l.blocks), s('서브', l.aces), s('디그', l.digs)];
    case 'L':  return [s('디그', l.digs), s('리시브', l.receives), s('세트', l.assists), s('서브', l.aces), s('블로킹', l.blocks)];
    default:   return [s('득점', l.points), s('공격', l.spikes), s('서브', l.aces), s('리시브', l.receives), s('디그', l.digs)]; // OH·OP
  }
}

/** AwardWinner + 시즌 생산맵 → 포스터 데이터. 생산 라인이 없으면 null(미출전 등). */
export function buildAwardPosterData(
  winner: AwardWinner,
  season: number,
  myTeamId: string | null,
  prod: Map<string, ProdLine>,
): AwardPosterData | null {
  const l = prod.get(winner.playerId);
  if (!l) return null;
  const p = getPlayer(winner.playerId);
  const pos: Position = p?.position ?? 'OH';
  const name = p?.name ?? reconstructForeignName(winner.playerId) ?? winner.playerId;
  return {
    seasonLabel: seasonYear(season),
    name,
    posEn: POS_EN[pos],
    pos,
    teamId: winner.teamId,
    ovr: p ? overall(p) : 0,
    stats: posterStats(pos, l),
    emblem: emblemFor(winner.teamId),
    accent: teamColors(winner.teamId).light,
    isMine: !!myTeamId && winner.teamId === myTeamId,
  };
}

/** 현재 시즌 정규리그 MVP 포스터 데이터 — MVP 미정(경기 미진행)이면 null. */
export function mvpPosterData(season: number, myTeamId: string | null): AwardPosterData | null {
  const aw = currentSeasonAwards(season);
  if (!aw.mvp) return null;
  return buildAwardPosterData(aw.mvp, season, myTeamId, leagueProduction(SEASON_DAYS));
}
