// A/B 자가검증 가드 — 시상식 포스터 (AWARDS_SYSTEM §8). 표시 전용(엔진·store 무관)이라 시뮬 N 불필요:
//   결정적 구조 검사 + 라벨→필드 시맨틱 오라클로 (1) posterStats 스탯 오귀속, (2) 상별 톤 무결을 잡는다.
// A/B: 오귀속 변이(필드 스왑)를 주입해 같은 오라클이 FAIL로 뒤집힘을 증명(허위 오라클 방지). 프로덕션엔 시임 무주입.
//
// data/awardPoster는 emblems·teamColor를 통해 PNG/webp를 require한다 — node/tsx는 이미지 파싱 불가라
// 이미지 확장자 require를 더미(1)로 스텁한 뒤 동적 import한다(표시 색·귀속 로직만 필요, 실제 자산 불필요).
import type { PosterTone, PosterStat } from '../data/awardPoster';
import type { Position } from '../types';
import type { ProdLine } from '../engine/production';
const Module = require('module');
for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.m4a', '.ttf', '.otf']) {
  Module._extensions[ext] = (m: { exports: unknown }) => { m.exports = 1; };
}

// 라벨(한글) → ProdLine 필드 시맨틱 오라클(문서 §5·§8 정본). posterStats가 이 매핑대로 값을 넣어야 한다.
const LABEL_FIELD: Record<string, keyof ProdLine> = {
  '득점': 'points', '공격': 'spikes', '서브': 'aces', '디그': 'digs',
  '블로킹': 'blocks', '세트': 'assists', '리시브': 'receives',
};
const POSNS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

// 각 필드에 유일 값 — 라벨이 가리키는 필드값과 셀값이 일치해야 정상(오귀속 시 값이 겹치지 않음).
function distinctLine(): ProdLine {
  return { matches: 82, points: 101, spikes: 203, backSpikes: 51, blocks: 307, aces: 409, assists: 503, digs: 607, receives: 709 };
}

type StatsFn = (pos: Position, l: ProdLine) => PosterStat[];

/** 오라클: 모든 포지션 × 5칸에서 라벨→필드 매핑값과 셀 value가 일치하는지. 불일치(오귀속) 목록 반환. */
function attributionErrors(fn: StatsFn): string[] {
  const l = distinctLine();
  const errs: string[] = [];
  for (const pos of POSNS) {
    const cells = fn(pos, l);
    if (cells.length !== 5) errs.push(`${pos}: 칸 수 ${cells.length}≠5`);
    for (const c of cells) {
      const field = LABEL_FIELD[c.label];
      if (!field) { errs.push(`${pos}: 미지 라벨 '${c.label}'`); continue; }
      const expected = String(l[field]);
      if (c.value !== expected) errs.push(`${pos}: '${c.label}'→${field} 기대 ${expected}, 실제 ${c.value} (오귀속)`);
    }
  }
  return errs;
}

// ── 톤 무결 검사 ──
const HEX = /^#[0-9A-Fa-f]{6}$/;
const RGBA = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/;
type TemplateMap = Record<string, { src: unknown; tone: PosterTone }>;
function toneErrors(templates: TemplateMap): string[] {
  const errs: string[] = [];
  for (const [key, tpl] of Object.entries(templates)) {
    const t = tpl.tone;
    if (!t) { errs.push(`${key}: tone 없음`); continue; }
    if (!HEX.test(t.bright)) errs.push(`${key}: bright '${t.bright}' 는 #RRGGBB 아님(라벨 색은 선명 hex여야)`);
    for (const f of ['dim', 'line', 'glow'] as const) {
      if (!RGBA.test(t[f]) && !HEX.test(t[f])) errs.push(`${key}: ${f} '${t[f]}' 형식 불량`);
    }
    if (!tpl.src) errs.push(`${key}: src 자산 없음`);
  }
  // 상별 색이 실제로 달라야(신인=블루·기량발전=퍼플·기록왕=레드). 민트 계열(mvp/finals)은 의도적 동일 → 그 둘만 같음 허용.
  const arr = [templates.rookie?.tone.bright, templates.mostImproved?.tone.bright, templates.statLeader?.tone.bright];
  if (new Set(arr).size !== arr.length) errs.push(`톤 중복: rookie/mostImproved/statLeader 서로 달라야 (${arr.join(', ')})`);
  return errs;
}

(async () => {
  const { posterStats, AWARD_TEMPLATES } = await import('../data/awardPoster');
  const templates = AWARD_TEMPLATES as unknown as TemplateMap;
  let fail = 0;

  // (A) 프로덕션 posterStats — 오귀속 0이어야 PASS
  const aErrs = attributionErrors(posterStats);
  if (aErrs.length === 0) console.log('PASS attribution :: posterStats 5×5칸 라벨→필드 귀속 정확(오귀속 0)');
  else { fail++; console.log('FAIL attribution ::\n  ' + aErrs.join('\n  ')); }

  // (A) 톤 무결
  const tErrs = toneErrors(templates);
  if (tErrs.length === 0) console.log('PASS tone :: AWARD_TEMPLATES 5종 톤 형식·상별 색 구분 무결');
  else { fail++; console.log('FAIL tone ::\n  ' + tErrs.join('\n  ')); }

  // (B) A/B 민감도 — 오귀속 변이(공격'spikes'↔디그'digs' 스왑) 주입 시 같은 오라클이 FAIL이어야 검출력 있음
  const mutant: StatsFn = (pos, l) => posterStats(pos, l).map((c) =>
    c.label === '공격' ? { label: c.label, value: String(l.digs) }
    : c.label === '디그' ? { label: c.label, value: String(l.spikes) }
    : c);
  const mErrs = attributionErrors(mutant);
  if (mErrs.length > 0) console.log(`PASS sensitivity :: 변이(공격↔디그 스왑) 주입 시 오라클이 오귀속 ${mErrs.length}건 검출 — 검사 유효`);
  else { fail++; console.log('FAIL sensitivity :: 변이를 주입해도 검출 0 — 오라클이 허위(무의미)'); }

  // (B) 톤 민감도 — 잘못된 bright(hex 아님) 주입 시 형식 검사가 잡아야 함(원본 무변경 로컬 변이)
  const broken: TemplateMap = { ...templates, rookie: { src: 1, tone: { ...templates.rookie.tone, bright: 'not-a-hex' } } };
  const bErrs = toneErrors(broken);
  if (bErrs.some((e) => e.includes('bright'))) console.log('PASS tone-sensitivity :: 깨진 bright 주입 시 톤 검사가 검출 — 검사 유효');
  else { fail++; console.log('FAIL tone-sensitivity :: 깨진 톤을 검출 못 함'); }

  console.log(fail === 0 ? '\nALL PASS — award poster 오귀속·톤 무결' : `\n${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
