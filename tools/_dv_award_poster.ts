// A/B 자가검증 가드 — 시상식 포스터 (AWARDS_SYSTEM §8). 표시 전용(엔진·store 무관)이라 시뮬 N 불필요:
//   결정적 구조 검사 + 라벨→필드 시맨틱 오라클로 (1) posterStats 스탯 오귀속, (2) 상별 톤 무결을 잡는다.
// A/B: 오귀속 변이(필드 스왑)를 주입해 같은 오라클이 FAIL로 뒤집힘을 증명(허위 오라클 방지). 프로덕션엔 시임 무주입.
//
// data/awardPoster는 emblems·teamColor를 통해 PNG/webp를 require한다 — node/tsx는 이미지 파싱 불가라
// 이미지 확장자 require를 더미(1)로 스텁한 뒤 동적 import한다(표시 색·귀속 로직만 필요, 실제 자산 불필요).
import type { PosterTone, PosterStat, PosterSeasonMode } from '../data/awardPoster';
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
type TemplateMap = Record<string, { src: unknown; tone: PosterTone; titleTopPct: number; seasonMode?: PosterSeasonMode }>;
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

// ── 오버레이-타이틀 충돌 검사(AWARDS_SYSTEM §8 겹침 정정) ──
// components/AwardPoster.tsx의 시즌 라벨 폰트 산식을 미러링해 시즌 블록 렌더 하단%(포스터 높이 기준)를 계산하고,
// 각 템플릿의 배경 타이틀 상단%(titleTopPct, sharp 실측)와 안전마진으로 대조한다. 값은 컴포넌트와 동기(주석 참조).
//   [컴포넌트 값 동기] f.kicker=w*0.030 · f.season=w*0.052 · topZone top 3.2% · season marginTop 2px(full만) · h=w*(4/3).
//   퍼센트(포스터 높이 h 기준) 환산: px%ofH = px/h*100 = (px/w)*75 (∵ w/h=3/4). 폰트엔 명시 lineHeight 없음 → RN 기본 ≈ fontSize*1.2.
//   검증 앵커: 이 산식의 full 하단 ≈11.0% 는 실기기 연도 글리프 하단 실측(8.1~11.0%)과 일치(§8), yearOnly 하단 ≈7.9%.
const LH_FACTOR = 1.2;      // RN 기본 라인하이트 ≈ fontSize×1.2 (full 하단 11.0% 실측 정합으로 검증)
const KICKER_SCALE = 0.030; // AwardPoster f.kicker = w×0.030
const SEASON_SCALE = 0.052; // AwardPoster f.season = w×0.052
const PCT_OF_H = 75;        // (px/w)→(px/h %) 환산 계수 = (w/h)*100 = 75
const TOP_PCT = 3.2;        // topZone top
const SEASON_MARGIN_PX = 2; // season marginTop(full 모드만; yearOnly=0)
const REF_W = 428;          // marginTop px→% 환산 기준 폭(대표 폰 렌더폭; 0.35%로 미미 — 밴드 무영향)
const SAFETY_PCT = 0.5;     // 안전마진 — 시즌 블록 하단 + 이 값이 titleTopPct보다 작아야 함

/** 시즌 라벨 블록의 렌더 하단%(포스터 높이 기준). full=키커+마진+연도, yearOnly=연도만(키커·마진 없음). */
function seasonBlockBottomPct(mode: PosterSeasonMode): number {
  const seasonLine = SEASON_SCALE * LH_FACTOR * PCT_OF_H;          // ≈4.68
  if (mode === 'yearOnly') return TOP_PCT + seasonLine;           // ≈7.88
  const kickerLine = KICKER_SCALE * LH_FACTOR * PCT_OF_H;         // ≈2.70
  const marginPct = (SEASON_MARGIN_PX / REF_W) * PCT_OF_H;        // ≈0.35
  return TOP_PCT + kickerLine + marginPct + seasonLine;           // ≈10.93
}

/** 각 템플릿: 시즌 블록 하단 + 안전마진 < titleTopPct 여야 정상. modeOf로 모드 주입(A/B 변이용). 위반 목록 반환. */
function collisionErrors(templates: TemplateMap, modeOf: (key: string, tpl: TemplateMap[string]) => PosterSeasonMode): string[] {
  const errs: string[] = [];
  for (const [key, tpl] of Object.entries(templates)) {
    if (typeof tpl.titleTopPct !== 'number') { errs.push(`${key}: titleTopPct 없음/비수치`); continue; }
    const mode = modeOf(key, tpl);
    const bottom = seasonBlockBottomPct(mode);
    if (bottom + SAFETY_PCT >= tpl.titleTopPct) {
      errs.push(`${key}(${mode}): 시즌 블록 하단 ${bottom.toFixed(2)}% + 마진 ${SAFETY_PCT}% = ${(bottom + SAFETY_PCT).toFixed(2)}% ≥ 타이틀 상단 ${tpl.titleTopPct}% (겹침)`);
    }
  }
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
  const broken: TemplateMap = { ...templates, rookie: { ...templates.rookie, src: 1, tone: { ...templates.rookie.tone, bright: 'not-a-hex' } } };
  const bErrs = toneErrors(broken);
  if (bErrs.some((e) => e.includes('bright'))) console.log('PASS tone-sensitivity :: 깨진 bright 주입 시 톤 검사가 검출 — 검사 유효');
  else { fail++; console.log('FAIL tone-sensitivity :: 깨진 톤을 검출 못 함'); }

  // (A) 오버레이-타이틀 충돌 — 프로덕션 seasonMode 대로면 5종 모두 클리어여야 PASS
  const prodMode = (_k: string, t: TemplateMap[string]): PosterSeasonMode => t.seasonMode ?? 'full';
  const cErrs = collisionErrors(templates, prodMode);
  console.log(`  · 시즌 블록 하단: full ${seasonBlockBottomPct('full').toFixed(2)}% / yearOnly ${seasonBlockBottomPct('yearOnly').toFixed(2)}% (안전마진 ${SAFETY_PCT}%)`);
  for (const [k, t] of Object.entries(templates)) {
    const m = prodMode(k, t);
    console.log(`  · ${k}: seasonMode=${m}, 하단 ${(seasonBlockBottomPct(m) + SAFETY_PCT).toFixed(2)}% vs 타이틀 ${t.titleTopPct}% → 여유 ${(t.titleTopPct - seasonBlockBottomPct(m) - SAFETY_PCT).toFixed(2)}%`);
  }
  if (cErrs.length === 0) console.log('PASS collision :: 시즌 라벨 오버레이가 배경 타이틀과 안전마진 이상 이격(5종)');
  else { fail++; console.log('FAIL collision ::\n  ' + cErrs.join('\n  ')); }

  // (B) 충돌 민감도 A/B — mip(mostImproved)을 'full'로 가정하면 겹침이 재현(FAIL), 프로덕션 'yearOnly'면 PASS임을 증명(허위 오라클 방지).
  const forceFull = (_k: string, _t: TemplateMap[string]): PosterSeasonMode => 'full';
  const mipFull = collisionErrors(templates, forceFull).filter((e) => e.startsWith('mostImproved'));
  if (mipFull.length > 0) console.log(`PASS collision-sensitivity :: mip 'full' 가정 시 겹침 검출 — 검사 유효\n    (재현: ${mipFull[0]})`);
  else { fail++; console.log("FAIL collision-sensitivity :: mip을 'full'로 강제해도 겹침 미검출 — 오라클이 허위(무의미)"); }

  console.log(fail === 0 ? '\nALL PASS — award poster 오귀속·톤·오버레이 충돌 무결' : `\n${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
