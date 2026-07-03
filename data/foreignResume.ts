// 외국인 트라이아웃 이력 (FOREIGN_SYSTEM §9 — 스카우팅 2.0 "검증된 커리어"). 순수·결정론 파생.
//
// 용병=22~31세 완성형 1년 렌탈 → **포텐 공개 없음**(드래프트와 차별). 대신 "지금 실력 + 검증된 이력".
// 표시 전용: id 시드 + 현재 윗단(deriveRatings)에서 파생. **저장 0·엔진/밸런스/시드 불침투.**
// 하드룰: 날조 금지(값→표현 결정론 매핑, 고정 어휘). 스포일러는 N/A(숨은 포텐 미참조).
// 스카우터(reveal)는 **정보량 티어**만 늘린다(포텐 아님): C=성적 / A=+폼·출장·국대 / S=+수상·부상·적응·리포트.
import type { Player, Position } from '../types';
import { deriveRatings, type Ratings } from '../engine/ratings';
import { strSeed } from '../engine/rng';

const h01 = (id: string, salt: string): number => (strSeed(`${id}::fr::${salt}`) % 100000) / 100000;
const pickN = <T,>(id: string, salt: string, arr: T[]): T => arr[strSeed(`${id}::fr::${salt}`) % arr.length];
const r1 = (v: number): number => Math.round(v * 10) / 10;

// 홈 리그 + 수준(향미 — id 결정론, 숨은 신호 아님).
const HOME_LEAGUES: { name: string; level: string }[] = [
  { name: '튀르키예 술탄라르 리기', level: '최상위' },
  { name: '이탈리아 세리에 A1', level: '최상위' },
  { name: '브라질 수페르리가', level: '최상위' },
  { name: '중국 슈퍼리그', level: '상위' },
  { name: '일본 SV리그', level: '상위' },
  { name: '폴란드 타우론 리가', level: '상위' },
  { name: '미국 프로 리그', level: '중상위' },
  { name: '태국 프로리그', level: '중위' },
];
// 아시아쿼터용 홈 리그(AVC 권역 — 유럽 리그 오배정 방지).
const ASIAN_LEAGUES: { name: string; level: string }[] = [
  { name: '일본 SV리그', level: '상위' },
  { name: '중국 슈퍼리그', level: '상위' },
  { name: '태국 프로리그', level: '중상위' },
  { name: '대만 기업리그', level: '중위' },
  { name: '베트남 프로리그', level: '중위' },
  { name: '인도네시아 프로리가', level: '중위' },
];

export interface ResumeStat { key: string; label: string; value: number; unit: '%' | '/세트' }

// 프로 레벨 지표 앵커(아마추어보다 높음) — 현재 rating에서 선형.
const lin = (rating: number, at55: number, at85: number): number => at55 + (rating - 55) * ((at85 - at55) / 30);
const pct = (v: number): number => Math.max(35, Math.min(92, v));
type Cat = { key: string; label: string; unit: '%' | '/세트'; calc: (r: Ratings) => number };
const FCATS: Record<Position, Cat[]> = {
  OP: [
    { key: 'pts', label: '세트당 득점', unit: '/세트', calc: (r) => Math.max(0, lin(r.spike * 0.8 + r.serve * 0.2, 3.4, 5.6)) },
    { key: 'atk', label: '공격 성공률', unit: '%', calc: (r) => pct(lin(r.spike, 44, 54)) },
    { key: 'ace', label: '세트당 에이스', unit: '/세트', calc: (r) => Math.max(0, lin(r.serve, 0.3, 0.95)) },
  ],
  OH: [
    { key: 'pts', label: '세트당 득점', unit: '/세트', calc: (r) => Math.max(0, lin(r.spike * 0.7 + r.serve * 0.3, 2.8, 4.9)) },
    { key: 'atk', label: '공격 성공률', unit: '%', calc: (r) => pct(lin(r.spike, 42, 52)) },
    { key: 'rcv', label: '리시브 효율', unit: '%', calc: (r) => pct(lin(r.receive, 48, 66)) },
  ],
  MB: [
    { key: 'blk', label: '세트당 블로킹', unit: '/세트', calc: (r) => Math.max(0, lin(r.block, 0.55, 1.15)) },
    { key: 'qk', label: '속공 성공률', unit: '%', calc: (r) => pct(lin(r.spike, 52, 66)) },
  ],
  S: [
    { key: 'ast', label: '세트당 어시스트', unit: '/세트', calc: (r) => Math.max(0, lin(r.set, 8.5, 12.5)) },
    { key: 'dig', label: '세트당 디그', unit: '/세트', calc: (r) => Math.max(0, lin(r.dig, 2.0, 4.0)) },
  ],
  L: [
    { key: 'rcv', label: '리시브 효율', unit: '%', calc: (r) => pct(lin(r.receive, 50, 70)) },
    { key: 'dig', label: '세트당 디그', unit: '/세트', calc: (r) => Math.max(0, lin(r.dig, 3.0, 5.2)) },
  ],
};

export interface ForeignResume {
  league: string; level: string;
  stats: ResumeStat[];
  // A티어(reveal≥0.35)
  caps: number | null;         // 국가대표 A매치
  recentForm: string | null;   // 최근 폼
  matches: number | null;      // 지난 시즌 출장
  // S티어(reveal≥0.6)
  awards: string[] | null;     // 수상 이력([]=수상 없음)
  injury: string | null;       // 부상 이력
  adapt: string | null;        // 적응 전망
  report: string[] | null;     // 상세 리포트
}

const FORM = ['상승세', '꾸준한 편', '기복 있음', '하락세'];
const INJURY = ['특별한 부상 이력 없음', '경미한 발목 부상 이력', '과거 무릎 수술 이력(복귀 후 정상)', '시즌 막판 잔부상 잦음'];
const ADAPT = ['아시아 리그 경험이 있어 적응이 빠를 전망', '첫 아시아 무대 — 적응 변수 있음', '한국 배구 스타일에 잘 맞는 유형', '언어·문화 적응에 시간이 필요할 수 있음'];

/** 이전 리그 성적(항상 표시) — 프로 앵커, 현재 실력 기반. */
export function foreignRecordStats(p: Player): ResumeStat[] {
  const r = deriveRatings(p);
  const cats = FCATS[p.position] ?? FCATS.OP;
  return cats.map((c) => ({ key: c.key, label: c.label, unit: c.unit, value: r1(c.calc(r) * (1 + (h01(p.id, c.key) * 2 - 1) * 0.15)) }));
}

/** 능력 근사(0~1, 표시 금지·내부용) — 수상/국대 상관에만. */
function abilityNorm(p: Player): number {
  const r = deriveRatings(p);
  const key = p.position === 'MB' ? r.block : p.position === 'S' ? r.set : p.position === 'L' ? r.dig : r.spike;
  return Math.max(0, Math.min(1, (key - 45) / 45));
}

/**
 * 외국인 이력(가시 정보만, 스카우터 티어별). reveal↑ → 정보량↑(포텐 아님).
 */
export function foreignResume(p: Player, reveal: number): ForeignResume {
  const home = pickN(p.id, 'lg', p.isAsianQuota ? ASIAN_LEAGUES : HOME_LEAGUES);
  const stats = foreignRecordStats(p);
  const ability = abilityNorm(p);

  const tierA = reveal >= 0.35;
  const tierS = reveal >= 0.6;

  // A티어
  const caps = tierA ? Math.round((ability * 0.7 + h01(p.id, 'cap') * 0.3) * 130) : null; // 0~130 A매치
  const recentForm = tierA ? pickN(p.id, 'form', FORM) : null;
  const matches = tierA ? 18 + (strSeed(`${p.id}::fr::mch`) % 17) : null; // 18~34경기

  // S티어
  let awards: string[] | null = null;
  if (tierS) {
    awards = [];
    if (ability > 0.72 && h01(p.id, 'aw1') < 0.6) awards.push(`${home.name.split(' ')[0]} 리그 베스트 ${POS_AWARD[p.position] ?? '선수'}`);
    if (ability > 0.85 && h01(p.id, 'aw2') < 0.5) awards.push('리그 시즌 MVP');
  }
  const injury = tierS ? pickN(p.id, 'inj', INJURY) : null;
  const adapt = tierS ? pickN(p.id, 'adp', ADAPT) : null;
  const report = tierS ? buildReport(p, stats, recentForm, injury) : null;

  return { league: home.name, level: home.level, stats, caps, recentForm, matches, awards, injury, adapt, report };
}

const POS_AWARD: Record<Position, string> = { OP: '아포짓', OH: '아웃사이드', MB: '미들', S: '세터', L: '리베로' };

/** S티어 상세 리포트(프로즈, 가시 정보만·날조 금지). */
function buildReport(p: Player, stats: ResumeStat[], form: string | null, injury: string | null): string[] {
  const lines: string[] = [];
  const top = [...stats].sort((a, b) => b.value - a.value)[0];
  lines.push(`이전 리그에서 ${top.label} ${top.value}${top.unit === '%' ? '%' : top.unit}를 기록한 즉시전력 자원이다.`);
  if (form) lines.push(
    form === '상승세' ? '최근 폼이 올라오는 흐름이다.'
    : form === '하락세' ? '최근 폼은 다소 떨어져 있다.'
    : form === '기복 있음' ? '경기력 기복이 있는 편이다.'
    : '기복 없이 꾸준한 편이다.',
  );
  if (injury && !injury.includes('없음')) lines.push(`부상 이력이 있어 관리가 필요하다(${injury}).`);
  return lines;
}
