// 시상식 포스터 데이터 셀렉터 (AWARDS_SYSTEM §8). 순수 표시 — 엔진/store 무의존, 결정론 무관.
// AwardWinner(playerId/teamId/value) + 시즌 생산(ProdLine)을 모아 AwardPoster props로 조립한다.
// 현재는 정규리그 MVP만 채운다. 다른 1인 개인상(신인상·기량발전상 등)은 같은 buildAwardPosterData로
// 확장 가능(자산 template만 상별 매핑에 추가하면 됨 — awards-ceremony의 AWARD_TEMPLATE 참조).
//
// 스탯 5칸은 **시즌 실카운트만** 쓴다. 시안의 "공격 성공률"·"리시브 효율"은 *비율* 지표인데, 시즌 집계
// (leagueProduction→ProdLine)는 성공/시도 분모(atkAtt·recvGood/Err)를 보존하지 않아(경기 박스는 롤오버로 소멸)
// 시즌 단위 비율을 낼 수 없다 → 지어내지 않고 **실존 카운트로 대체**: 공격 성공률→공격(킬 spikes), 리시브 효율→리시브(recvAtt receives).
// 포지션 특성(세터=득점 무의미 등)은 repRecordLine 철학으로 대표 스탯을 앞세운다(posterStats).

import type { AwardWinner, Player, Position } from '../types';
import type { ProdLine } from '../engine/production';
import { getPlayer, reconstructForeignName, getTeam } from './league';
import { overall } from '../engine/overall';
import { deriveRatings, type Ratings } from '../engine/ratings';
import { leagueProduction } from './production';
import { currentSeasonAwards } from './awards';
import { seasonYear } from './seasonLabel';
import { emblemFor } from './emblems';
import { teamColors } from '../lib/teamColor';
import { SEASON_DAYS } from '../engine/calendar';

/**
 * 포스터 톤(상별 색 계열) — AWARDS_SYSTEM §8. 배경 자산의 네온 색을 sharp로 샘플링해 조화롭게 확정(근거는 §8 표).
 *   bright = 시즌 키커·포지션 영문 라벨·시즌 글로우   dim = 스탯 라벨·OVR 태그·풋노트   line = 스탯 칸 구분선   glow = 시즌 라벨 섀도
 * 이름·수치·시즌값은 흰색 유지, OVR 칩 테두리/숫자는 accent(구단색) — 톤은 "구조 색"만 담당.
 */
export interface PosterTone { bright: string; dim: string; line: string; glow: string }

// 상별 톤(sharp 상위 2% 네온 평균 샘플 근거는 주석의 #hex). 민트 기본은 AwardPoster.DEFAULT_TONE과 값 동기(무회귀).
const TONE_MINT: PosterTone   = { bright: '#5FEAD8', dim: 'rgba(150,238,224,0.72)', line: 'rgba(120,230,215,0.28)', glow: 'rgba(95,234,216,0.5)' };  // 샘플 #24A096 (mvp — finals는 골드로 분리, TONE_GOLD)
const TONE_BLUE: PosterTone   = { bright: '#5FB8EA', dim: 'rgba(158,206,240,0.74)', line: 'rgba(120,188,235,0.30)', glow: 'rgba(95,184,234,0.5)' };  // 샘플 #19B8E2 (rookie)
const TONE_ORANGE: PosterTone = { bright: '#FF9A3D', dim: 'rgba(255,190,150,0.74)', line: 'rgba(250,150,60,0.30)', glow: 'rgba(255,154,61,0.5)' };  // 샘플 #FCB32A (상위2% 밝은·채도 평균, 오렌지 네온) — bright는 finalsMvp 골드와 구분되게 선라이즈 오렌지로 보정 (mip, 2026-07-22 kling 2462_1)
const TONE_SILVER: PosterTone = { bright: '#D8DEEA', dim: 'rgba(206,214,228,0.74)', line: 'rgba(176,186,205,0.30)', glow: 'rgba(216,222,234,0.5)' };  // 샘플 #FEFEFE 순백 네온 → 순백과 구분되게 쿨 플래티넘 실버로 보정 (statleader, 2026-07-22 kling Remove 2724_0)
const TONE_GOLD: PosterTone   = { bright: '#F2C24A', dim: 'rgba(244,214,150,0.74)', line: 'rgba(240,194,74,0.30)', glow: 'rgba(242,194,74,0.5)' };   // 샘플 #D59823 골드 (finalsMvp) — bright는 샘플 hue를 밝게 보정

/** 시즌 라벨 표시 모드 — 'full'(키커 "SEASON" + 연도 2줄, 기본) / 'yearOnly'(연도 1줄만). AwardPoster·가드와 값 동기. */
export type PosterSeasonMode = 'full' | 'yearOnly';

/** 상별 포스터 배경 자산 + 톤(AWARDS_SYSTEM §8) — 화면들이 공용 import(중복 require 방지). */
// 신규 자산 추가 절차: kling/GPT로 레퍼런스 첨부 생성 → 1080×1440 webp 변환 → 민트 라인 스캔으로 패널 좌표가
// 기준(top 79.9%·bottom 95.1%)과 일치하는지 확인(불일치면 AwardPoster 좌표 확장 필요) → 톤 샘플링 →
// 배경 타이틀 상단%(sharp 행 스캔 white>=0.03 3연속, tools/_dv_award_poster.ts 충돌 검사가 오버레이와 대조) → 여기 등록.
//   titleTopPct = 배경에 박힌 상 타이틀("MVP/MOST/…")의 상단 y%(포스터 높이 기준). 시즌 라벨 오버레이 하단이 이 값보다
//   안전마진(0.5%) 위여야 겹치지 않는다(§8 겹침 정정). mip는 타이틀이 8.7%로 높아 'full'(하단 ~11%)이면 뚫려 seasonMode='yearOnly'(하단 ~7.9%).
export interface AwardTemplate { src: number; tone: PosterTone; titleTopPct: number; seasonMode?: PosterSeasonMode }
export const AWARD_TEMPLATES: Record<'mvp' | 'finalsMvp' | 'rookie' | 'mostImproved' | 'statLeader', AwardTemplate> = {
  mvp:          { src: require('../assets/awards/mvp_stage.webp'),        tone: TONE_MINT,   titleTopPct: 12.3 },  // 타이틀 "MOST VALUABLE PLAYER" 상단 실측 12.36%
  finalsMvp:    { src: require('../assets/awards/finals_mvp_stage.webp'), tone: TONE_GOLD,   titleTopPct: 12.2 },  // 골드 자산 (2026-07-22 kling 5586_1) 타이틀 상단 실측 12.29%
  rookie:       { src: require('../assets/awards/rookie_stage.webp'),     tone: TONE_BLUE,   titleTopPct: 12.0 },  // 신인상 타이틀 상단 실측 12.08%
  mostImproved: { src: require('../assets/awards/mip_stage.webp'),        tone: TONE_ORANGE, titleTopPct: 9.0, seasonMode: 'yearOnly' }, // 기량발전상 오렌지 자산(2026-07-22 kling 2462_1) 타이틀 "MOST" 상단 실측 9.10%(높음) → yearOnly로 시즌 라벨 축약, §8 겹침 정정
  statLeader:   { src: require('../assets/awards/statleader_stage.webp'), tone: TONE_SILVER, titleTopPct: 12.3 },  // 기록왕 실버 자산(2026-07-22 kling Remove 2724_0, 흰 "STAT LEADER") 타이틀 상단 실측 12.36% → full — 화면 배선은 후속(부문 다수, §8), 템플릿·프리뷰만
};

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
  teamName: string;      // 소속팀 표시명("인천 타이드") — 포스터 포지션 줄에 병기(§8, 2026-07-23)
  ovr: number;           // raw 연속 OVR(AwardPoster가 displayOvr 적용)
  stats: PosterStat[];   // 5칸
  emblem: number;        // require 자산 id
  accent: string;        // 구단 강조색(teamColors.light)
  isMine: boolean;
}

/** 팀 표시명("도시 팀명") — getTeam 단일 소스(전 화면 공용). 미지 팀은 id 폴백. */
const teamNameOf = (id: string): string => getTeam(id)?.name ?? id;

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

// ── 종합 능력치(윗단) 대표 5스탯 — 내 팀 지명 포스터(UI_RULES DL-9) 전용. 시즌 생산이 아닌 **능력치**(deriveRatings 윗단). ──
// 라벨·표시값은 **선수 상세 화면(app/player/[id].tsx)과 동일 규약**: 라벨은 그 화면의 StatBar 라벨(스파이크·블로킹·…),
// 값은 deriveRatings 원시치(0~100, 스트레치 없음 — displayOvr는 OVR 단일값에만 적용). 새 산식 발명 없음(deriveRatings 재사용).
const ABILITY_LABEL: Record<keyof Ratings, string> = { spike: '스파이크', block: '블로킹', dig: '디그', receive: '리시브', set: '세팅', serve: '서브' };

// 포지션 대표 5능력 — posterStats(시즌 생산)의 포지션 철학을 **능력치로 매핑**(득점→스파이크, 세트→세팅으로 개념 치환).
// 생산엔 있으나 능력엔 대응 없는 항목(득점=스파이크 결과)을 병합하면 5번째 칸이 비므로 CLAUDE 5.3 가중치로 보강(주석 근거).
//   S : 세팅·서브·디그·블로킹·스파이크  ← posterStats S(得점→스파이크 후미로, 세트→세팅 선두). 세터 대표=세팅. 리시브(가중1) 제외
//   OH: 스파이크·서브·리시브·디그·블로킹 ← posterStats 기본(得점+공격→스파이크 병합) + 5번째 블로킹(전위 가중2)
//   OP: 스파이크·블로킹·서브·디그·리시브 ← posterStats OP(得점+공격→스파이크 병합) + 5번째 리시브(세팅 가중0보다 대표성↑)
//   MB: 블로킹·스파이크·서브·디그·리시브 ← posterStats MB(병합). 미들 대표=블로킹 선두 + 5번째 리시브
//   L : 디그·리시브·세팅·서브·블로킹    ← posterStats L(세트→세팅). 리베로는 스파이크 무의미 제외
const ABILITY_KEYS: Record<Position, (keyof Ratings)[]> = {
  S:  ['set', 'serve', 'dig', 'block', 'spike'],
  OH: ['spike', 'serve', 'receive', 'dig', 'block'],
  OP: ['spike', 'block', 'serve', 'dig', 'receive'],
  MB: ['block', 'spike', 'serve', 'dig', 'receive'],
  L:  ['dig', 'receive', 'set', 'serve', 'block'],
};

/** 지명 선수의 포지션 대표 5능력치(윗단, 원시 0~100) — DraftPoster 스탯 5칸. 내 팀 지명 = 풀공개(UI-16)라 안개 없음. */
export function posterAbilityStats(p: Player): PosterStat[] {
  const r = deriveRatings(p);
  return ABILITY_KEYS[p.position].map((k) => ({ label: ABILITY_LABEL[k], value: String(r[k]) }));
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
    teamName: teamNameOf(winner.teamId),
    ovr: p ? overall(p) : 0,
    stats: posterStats(pos, l),
    emblem: emblemFor(winner.teamId),
    accent: teamColors(winner.teamId).light,
    isMine: !!myTeamId && winner.teamId === myTeamId,
  };
}

// ── 부문 기록왕 포스터 (AWARDS_SYSTEM §8.1.1, 2026-07-23 1안 채택) ──────────────────────
// engine/awards.ts titles 7부문 = {scoring,spike,block,serve,dig,set,receive}. 각 부문의 한글 대제목·영문 키커·
// ProdLine 필드·footnote 단위를 단일 출처로 모은다(프리뷰 하드코딩 SL_KING/키커/단위를 셀렉터로 승격 — 프리뷰·화면·가드 공용).
export type StatLeaderCategory = 'scoring' | 'spike' | 'block' | 'serve' | 'dig' | 'set' | 'receive';

export interface StatLeaderMeta {
  catKo: string;        // 부문 한글 라벨(득점·공격·…) — posterStats 라벨·highlightLabels와 동일 표기
  catEn: string;        // 영문 키커("SCORING LEADER")
  king: string;         // 부문왕 한글 대제목("득점왕") — seasonLabel 자리에 전면 표시(§8.1)
  field: keyof ProdLine; // 부문 수치 소스 필드
  unit: string;         // footnote 단위(득점=점·공격=킬·블로킹=블록·나머지=개)
}

/** 부문 메타 단일 출처. field는 engine/awards.ts titles 매핑과 동일(scoring→points 등). */
export const STAT_LEADER_META: Record<StatLeaderCategory, StatLeaderMeta> = {
  scoring: { catKo: '득점',   catEn: 'SCORING LEADER', king: '득점왕',   field: 'points',   unit: '점' },
  spike:   { catKo: '공격',   catEn: 'SPIKE LEADER',   king: '공격왕',   field: 'spikes',   unit: '킬' },
  block:   { catKo: '블로킹', catEn: 'BLOCK LEADER',   king: '블로킹왕', field: 'blocks',   unit: '블록' },
  serve:   { catKo: '서브',   catEn: 'SERVE LEADER',   king: '서브왕',   field: 'aces',     unit: '개' },
  dig:     { catKo: '디그',   catEn: 'DIG LEADER',     king: '디그왕',   field: 'digs',     unit: '개' },
  set:     { catKo: '세트',   catEn: 'SET LEADER',     king: '세트왕',   field: 'assists',  unit: '개' },
  receive: { catKo: '리시브', catEn: 'RECEIVE LEADER', king: '리시브왕', field: 'receives', unit: '개' },
};

/** 시상식 비트 순서 — 위상 오름차순(리시브 → … → 득점). 개인상보다 먼저 수여(§8.1.1). */
export const STAT_LEADER_ORDER: StatLeaderCategory[] = ['receive', 'dig', 'set', 'serve', 'block', 'spike', 'scoring'];

/**
 * 부문 스탯이 포지션 대표 5칸(posterStats)에 없으면 **마지막 칸을 결정론 교체**해 highlightLabels가 항상 존재하게 한다.
 * 예: MB 대표 5칸=득점·공격·블로킹·서브·디그 → MB가 리시브왕이면 마지막 칸(디그)을 리시브로 교체. 이미 있으면 무변경.
 * 순수 함수(getPlayer/시즌 상태 무의존) — 프리뷰·가드 A/B 공용.
 */
export function statsWithCategory(pos: Position, l: ProdLine, catKo: string, field: keyof ProdLine): PosterStat[] {
  const base = posterStats(pos, l);
  if (base.some((c) => c.label === catKo)) return base;
  const replaced = base.slice();
  replaced[replaced.length - 1] = { label: catKo, value: String(l[field] as number) };
  return replaced;
}

export interface StatLeaderPosterData {
  seasonLabel: string;       // 부문왕 한글 대제목("득점왕") — AwardPoster seasonLabel 자리에 전면
  seasonKicker: string;      // "2025-26 · SCORING LEADER"
  name: string;
  posEn: string;
  pos: Position;
  teamId: string;
  teamName: string;          // 소속팀 표시명(포지션 줄 병기)
  ovr: number;
  stats: PosterStat[];       // 5칸(교체 규칙 적용 — 부문 스탯 항상 포함)
  highlightLabels: string[]; // [부문 한글] — 해당 칸 강조
  footnote: string;          // "시즌 842점 · 리그 1위"
  emblem: number;
  accent: string;
  isMine: boolean;
}

/**
 * 부문 기록왕 포스터 데이터 — `buildAwardPosterData`와 동형 파라미터(화면이 aw.titles[category]·공유 prod 주입).
 * winner가 null이거나 생산 라인이 없으면 null(비트 스킵). 순수 — getPlayer/getTeam만 조회(결정론).
 */
export function statLeaderPosterData(
  winner: AwardWinner | null,
  season: number,
  category: StatLeaderCategory,
  myTeamId: string | null,
  prod: Map<string, ProdLine>,
): StatLeaderPosterData | null {
  if (!winner) return null;
  const l = prod.get(winner.playerId);
  if (!l) return null;
  const meta = STAT_LEADER_META[category];
  const p = getPlayer(winner.playerId);
  const pos: Position = p?.position ?? 'OH';
  const name = p?.name ?? reconstructForeignName(winner.playerId) ?? winner.playerId;
  const value = l[meta.field] as number;
  return {
    seasonLabel: meta.king,
    seasonKicker: `${seasonYear(season)} · ${meta.catEn}`,
    name,
    posEn: POS_EN[pos],
    pos,
    teamId: winner.teamId,
    teamName: teamNameOf(winner.teamId),
    ovr: p ? overall(p) : 0,
    stats: statsWithCategory(pos, l, meta.catKo, meta.field),
    highlightLabels: [meta.catKo],
    footnote: `시즌 ${value}${meta.unit} · 리그 1위`,
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
