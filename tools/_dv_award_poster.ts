// A/B 자가검증 가드 — 시상식 포스터 (AWARDS_SYSTEM §8). 표시 전용(엔진·store 무관)이라 시뮬 N 불필요:
//   결정적 구조 검사 + 라벨→필드 시맨틱 오라클로 (1) posterStats 스탯 오귀속, (2) 상별 톤 무결을 잡는다.
// A/B: 오귀속 변이(필드 스왑)를 주입해 같은 오라클이 FAIL로 뒤집힘을 증명(허위 오라클 방지). 프로덕션엔 시임 무주입.
//
// data/awardPoster는 emblems·teamColor를 통해 PNG/webp를 require한다 — node/tsx는 이미지 파싱 불가라
// 이미지 확장자 require를 더미(1)로 스텁한 뒤 동적 import한다(표시 색·귀속 로직만 필요, 실제 자산 불필요).
import { readFileSync } from 'fs';
import { join } from 'path';
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

// ── 패널 세로 예산 검사(AWARDS_SYSTEM §8 풋노트 넘침 근본수정 2026-07-22) ──
// components/AwardPoster.tsx 하단 패널의 폰트·마진 산식을 미러링해 콘텐츠 총높이(%h)를 계산하고,
// 패널 컨테이너 높이(13.7%h = top 80.5%~bottom 5.8%) - 안전마진 0.5% = 13.2%h 이하인지 어서션한다.
// panel은 justifyContent:'center'라 콘텐츠>컨테이너면 위·아래로 균등 넘침 → 풋노트가 하단 네온 레일에 걸침(실기기 버그).
// 값 동기[컴포넌트]: 폰트 스케일 posEn .022·name .056·ovrTag .020·ovrNum .044·statVal .034·statLab .021·foot .022,
//   명시 lineHeight 배수(무/유 구성), statRow marginTop %(1.8/0.3), name·statLab marginTop px(1/0), foot marginTop px, h=w×4/3.
//   %h 환산: 폭 파생 폰트 L=scale×w → %h=scale×75(∵ (w/h)×100=75). px p → %h=75p/REF. 패널폭 % 마진 m → %h=0.6225×m(패널 내부폭 0.83w).
const PANEL_H = 13.7;                          // 패널 컨테이너 높이 %h (top 80.5%~bottom 5.8%)
const BUDGET_SAFETY = 0.5;                     // 안전마진
const PANEL_BUDGET = PANEL_H - BUDGET_SAFETY;  // 13.2%h
const REF_W_BUDGET = 428;                      // px→%h 환산 기준 폭(대표 폰)
const PANEL_W_FRAC = 0.83;                     // 패널 내부폭 = w×(1 - 0.085×2)
const bpx = (p: number) => (75 * p) / REF_W_BUDGET;        // px → %h
const bfh = (scale: number, lh: number) => scale * lh * 75; // 폭 파생 폰트 라인박스 → %h
const bmpc = (m: number) => 0.01 * m * PANEL_W_FRAC * 75;  // 패널폭 % 마진 → %h (=0.6225×m)

interface PanelCfg {
  posEnLH: number; nameLH: number; nameMT: number;      // headRow(nameCol)
  statValLH: number; statLabLH: number; statLabMT: number; statRowMT: number; // statRow(%)
  hasFoot: boolean; footScale: number; footLH: number; footMT: number;        // foot
}
/** 하단 패널 콘텐츠 총높이(%h) — 컴포넌트 렌더 구조(headRow + statRow + foot?) 미러링. */
function panelContentPct(c: PanelCfg): number {
  const nameCol = bfh(0.022, c.posEnLH) + bpx(c.nameMT) + bfh(0.056, c.nameLH);
  // ovrChip: paddingVertical 2(×2) + border 1.5(×2) + ovrTag(lh1.15) + ovrTag marginBottom -2 + ovrNum(lh1.1)
  const ovrChip = bpx(4) + bpx(3) + bfh(0.020, 1.15) + bpx(-2) + bfh(0.044, 1.1);
  const emblem = 4.8;   // Image width/height = h×0.048 ⇒ 4.8%h
  const headRow = Math.max(nameCol, ovrChip, emblem);
  const statRow = bmpc(c.statRowMT) + bfh(0.034, c.statValLH) + bpx(c.statLabMT) + bfh(0.021, c.statLabLH);
  const foot = c.hasFoot ? bpx(c.footMT) + bfh(c.footScale, c.footLH) : 0;
  return headRow + statRow + foot;
}
// 프로덕션 값(컴포넌트 AwardPoster.tsx와 동기) — 풋노트 無(무회귀 4장) / 有(압축)
const CFG_NOFOOT: PanelCfg = { posEnLH: 1.15, nameLH: 1.12, nameMT: 1, statValLH: 1.12, statLabLH: 1.15, statLabMT: 1, statRowMT: 1.8, hasFoot: false, footScale: 0.022, footLH: 1.08, footMT: 0 };
const CFG_FOOT: PanelCfg   = { posEnLH: 1.10, nameLH: 1.10, nameMT: 0, statValLH: 1.08, statLabLH: 1.10, statLabMT: 0, statRowMT: 0.3, hasFoot: true,  footScale: 0.022, footLH: 1.08, footMT: 0 };
// A/B 버그 재현용 — 압축 前(구) 풋노트 구성: statRow 1.8%·foot marginTop 6·f.foot .026 lh1.15·라인하이트/마진 미압축
const CFG_FOOT_LEGACY: PanelCfg = { posEnLH: 1.15, nameLH: 1.12, nameMT: 1, statValLH: 1.12, statLabLH: 1.15, statLabMT: 1, statRowMT: 1.8, hasFoot: true, footScale: 0.026, footLH: 1.15, footMT: 6 };

// ── 모아보기(3안 StatLeadersPoster) 세로 예산 + 프레임 내포 검사 (AWARDS_SYSTEM §8.1, 2026-07-23) ──
// components/StatLeadersPoster.tsx 리스트 존(top 80.9%~bottom 5.3% = 13.8%h)에 7부문 리더를 한 줄씩 얹는다.
// 각 행 높이 = max(자식 라인박스) = name/value 폰트(scale 0.0235w·lh 1.05) 라인박스가 지배(부문 라벨·팀 0.021w보다 큼).
// 7행 총높이가 (존 13.8 − 안전 0.5) = 13.3%h 이하여야 넘침 없음. justifyContent:'space-between'라 총높이>존이면 균등 넘침.
// 값 동기[컴포넌트]: f.row=w×0.0235 · LH=1.05 · 리스트 존 top80.9%/bottom5.3% · 7행. %h 환산: bfh(scale,lh)=scale×lh×75.
const SL_ZONE_TOP = 80.9;                          // 컴포넌트 값 동기(StyleSheet.list top)
const SL_ZONE_BOTTOM = 5.3;                        // 컴포넌트 값 동기(StyleSheet.list bottom)
const SL_ZONE_H = (100 - SL_ZONE_BOTTOM) - SL_ZONE_TOP;  // 13.8%h (엣지 94.7% − top 80.9%)
const SL_SAFETY = 0.5;                             // 안전마진(미모델 hairline border ~0.53%h·paddingTop 흡수)
const SL_BUDGET = SL_ZONE_H - SL_SAFETY;           // 13.3%h
const SL_ROWS = 7;                                 // 기록왕 부문 수(engine/awards.ts titles = scoring/spike/block/serve/dig/set/receive)
const SL_ROW_SCALE = 0.0235;                       // StatLeadersPoster f.row (name/value 지배 폰트)
const SL_ROW_LH = 1.05;                            // StatLeadersPoster LH
/** 모아보기 7행 리스트 총높이(%h) — 행 높이(name/value 라인박스)×행수. bfh = scale×lh×75. */
function statLeadersListPct(rowScale: number, rowLH: number, rows: number): number {
  return rows * bfh(rowScale, rowLH);
}

// ── 리스트 존 ⊆ 네온 프레임 내부 검사 (sl-frame, 2026-07-23 에뮬 실사 결함 근본수정) ──
// statleader_stage.webp 네온 프레임 내부를 sharp 행/열 스캔으로 실측(scratchpad frame_scan): 상단 네온 테두리 79.93~80.56% ·
// 하단 네온 테두리 95.07% · 좌·우 5.2%/95.4%. 순-다크 내부 = [80.56%, 95.07%]. 구 존(top 78.5%)은 프레임 상단 테두리(79.93%)
// 위 포디움 반사 밴드에 1행이 얹혀 값 가독성 붕괴 → sl-budget(자체 선언 존 15.5%h 내 7행 수용만 검사)은 이 결함을 못 잡았다
// (자산 프레임과의 정합 미검사 — MIP 시즌라벨 겹침과 동형). sl-frame이 그 사각을 봉인(draft 가드 coord/drift와 같은 소스-좌표 검출).
const SL_FRAME_INNER_TOP = 80.56;     // 프레임 상단 네온 테두리 밴드 하단(내부 시작) — sharp 실측(내부 열 79.93·80.00·80.56%)
const SL_FRAME_INNER_BOTTOM = 95.07;  // 프레임 하단 네온 테두리(내부 끝) — sharp 실측(3열 일치)
const SL_FRAME_INSET = 0.3;           // 리스트 존이 프레임 내부로 이 이상 들어와야(넘침 방지)
/** 리스트 존[top%, bottomPct%]이 프레임 내부로 인셋 이상 들어있는지 — 위반 목록. */
function slFrameErrors(zoneTop: number, zoneBottomPct: number): string[] {
  const errs: string[] = [];
  const topInset = zoneTop - SL_FRAME_INNER_TOP;            // 존 상단이 프레임 내부 top보다 아래(안쪽)
  const bottomEdge = 100 - zoneBottomPct;                   // 존 하단 엣지 y%
  const bottomInset = SL_FRAME_INNER_BOTTOM - bottomEdge;   // 존 하단이 프레임 내부 bottom보다 위(안쪽)
  if (topInset < SL_FRAME_INSET) errs.push(`리스트 존 상단 ${zoneTop}% 인셋 ${topInset.toFixed(2)}% < 최소 ${SL_FRAME_INSET}% (프레임 내부 top ${SL_FRAME_INNER_TOP}% 이탈 — 포디움 반사 밴드 위)`);
  if (bottomInset < SL_FRAME_INSET) errs.push(`리스트 존 하단 엣지 ${bottomEdge.toFixed(1)}% 인셋 ${bottomInset.toFixed(2)}% < 최소 ${SL_FRAME_INSET}% (프레임 내부 bottom ${SL_FRAME_INNER_BOTTOM}% 이탈)`);
  return errs;
}
/** 컴포넌트 소스에서 실제 list 존 top/bottom% 추출(드리프트 검출; draft 가드 readPanelCoords와 동형). */
function readListZoneFromSource(): { top: number; bottom: number } | null {
  try {
    const src = readFileSync(join(__dirname, '..', 'components', 'StatLeadersPoster.tsx'), 'utf8');
    const m = src.match(/list:\s*\{[^}]*top:\s*'([\d.]+)%'[^}]*bottom:\s*'([\d.]+)%'/);
    if (!m) return null;
    return { top: parseFloat(m[1]), bottom: parseFloat(m[2]) };
  } catch { return null; }
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

  // (A) 패널 세로 예산 — 풋노트 無/有 두 구성 모두 예산(13.2%h) 이내여야 PASS(넘침 없음)
  const noFootPct = panelContentPct(CFG_NOFOOT);
  const footPct = panelContentPct(CFG_FOOT);
  console.log(`  · 패널 세로 예산: 컨테이너 ${PANEL_H}% - 안전 ${BUDGET_SAFETY}% = ${PANEL_BUDGET}% | 풋노트無 ${noFootPct.toFixed(2)}% · 풋노트有 ${footPct.toFixed(2)}%`);
  if (noFootPct <= PANEL_BUDGET && footPct <= PANEL_BUDGET) {
    console.log(`PASS budget :: 패널 콘텐츠 총높이 풋노트無 ${noFootPct.toFixed(2)}%·有 ${footPct.toFixed(2)}% ≤ ${PANEL_BUDGET}% — 넘침 없음`);
  } else { fail++; console.log(`FAIL budget :: 초과 (無 ${noFootPct.toFixed(2)} / 有 ${footPct.toFixed(2)} vs 예산 ${PANEL_BUDGET})`); }

  // (B) 세로 예산 민감도 A/B — 압축 前(구) 풋노트 구성을 주입하면 예산 초과가 검출돼야(현 버그 재현) 검사가 유효
  const legacyPct = panelContentPct(CFG_FOOT_LEGACY);
  if (legacyPct > PANEL_BUDGET) {
    console.log(`PASS budget-sensitivity :: 구 풋노트 구성 ${legacyPct.toFixed(2)}% > 예산 ${PANEL_BUDGET}% 초과 검출 — 검사 유효 (패널 ${PANEL_H}% 넘침 ${(legacyPct - PANEL_H).toFixed(2)}%p)`);
  } else { fail++; console.log(`FAIL budget-sensitivity :: 구 풋노트 구성 ${legacyPct.toFixed(2)}%도 예산 이내로 계산 — 오라클 허위(무의미)`); }

  // ── 기록왕 수여 UX 3안 프로토타입 (AWARDS_SYSTEM §8.1) ──
  // 1·2안(AwardPoster + footnote)은 위 'budget' 검사의 풋노트 有 구성(CFG_FOOT, footPct)이 그대로 커버(≤13.2%h) — 신규 검사 불요.
  // 3안(StatLeadersPoster, 7행 리스트)만 별도 세로 예산이 필요해 아래 sl-budget 신설.
  console.log(`  · [3안 프로토타입] 1·2안(AwardPoster+footnote)은 풋노트 有 budget(CFG_FOOT ${footPct.toFixed(2)}% ≤ ${PANEL_BUDGET}%)이 커버 — 3안만 sl-budget 신설`);

  // (A) 모아보기 세로 예산 — 프로덕션 값(0.0235w·lh1.05·7행)이 예산 13.3%h 이내여야 PASS(넘침 없음)
  const slPct = statLeadersListPct(SL_ROW_SCALE, SL_ROW_LH, SL_ROWS);
  console.log(`  · 모아보기 리스트 예산: 존 ${SL_ZONE_H.toFixed(1)}% - 안전 ${SL_SAFETY}% = ${SL_BUDGET.toFixed(1)}% | 7행 ${slPct.toFixed(2)}% (행 ${bfh(SL_ROW_SCALE, SL_ROW_LH).toFixed(3)}%h)`);
  if (slPct <= SL_BUDGET) console.log(`PASS sl-budget :: 모아보기 7행 총높이 ${slPct.toFixed(2)}% ≤ ${SL_BUDGET.toFixed(1)}% — 리스트 존 넘침 없음`);
  else { fail++; console.log(`FAIL sl-budget :: 초과 (7행 ${slPct.toFixed(2)}% vs 예산 ${SL_BUDGET.toFixed(1)}%)`); }

  // (B) 모아보기 예산 민감도 A/B — 행 폰트 과대 변이(0.033w) 주입 시 예산 초과가 검출돼야 검사 유효(허위 오라클 방지)
  const slMutantScale = 0.033;
  const slMutantPct = statLeadersListPct(slMutantScale, SL_ROW_LH, SL_ROWS);
  if (slMutantPct > SL_BUDGET) console.log(`PASS sl-budget-sensitivity :: 과대 행 폰트(${slMutantScale}w) 7행 ${slMutantPct.toFixed(2)}% > 예산 ${SL_BUDGET.toFixed(1)}% 초과 검출 — 검사 유효 (존 ${SL_ZONE_H.toFixed(1)}% 넘침 ${(slMutantPct - SL_ZONE_H).toFixed(2)}%p)`);
  else { fail++; console.log(`FAIL sl-budget-sensitivity :: 과대 행 폰트도 예산 이내로 계산 — 오라클 허위(무의미)`); }

  // (A) 모아보기 프레임 내포 — 리스트 존이 네온 프레임 내부(80.56~95.07%)로 인셋 이상 들어있어야 PASS(자산 정합)
  const slFrameE = slFrameErrors(SL_ZONE_TOP, SL_ZONE_BOTTOM);
  const slBotEdge = 100 - SL_ZONE_BOTTOM;
  console.log(`  · 모아보기 프레임 내포: 프레임 내부 ${SL_FRAME_INNER_TOP}~${SL_FRAME_INNER_BOTTOM}% | 존 top ${SL_ZONE_TOP}%~엣지 ${slBotEdge.toFixed(1)}% (인셋 상 ${(SL_ZONE_TOP - SL_FRAME_INNER_TOP).toFixed(2)}%·하 ${(SL_FRAME_INNER_BOTTOM - slBotEdge).toFixed(2)}%)`);
  if (slFrameE.length === 0) console.log(`PASS sl-frame :: 모아보기 리스트 존이 네온 프레임 내부(${SL_FRAME_INNER_TOP}~${SL_FRAME_INNER_BOTTOM}%) 안쪽 인셋 이상 이격`);
  else { fail++; console.log('FAIL sl-frame ::\n  ' + slFrameE.join('\n  ')); }

  // (A) 모아보기 드리프트 — 컴포넌트 소스의 실제 list 존 좌표가 미러 상수와 일치(누군가 컴포넌트만 바꾸면 검출)
  const slSrc = readListZoneFromSource();
  if (!slSrc) { fail++; console.log('FAIL sl-drift :: StatLeadersPoster.tsx list 존 좌표 파싱 실패(구조 변경?)'); }
  else if (slSrc.top !== SL_ZONE_TOP || slSrc.bottom !== SL_ZONE_BOTTOM) {
    fail++; console.log(`FAIL sl-drift :: 소스 list(top ${slSrc.top}%·bottom ${slSrc.bottom}%) ≠ 가드 미러(${SL_ZONE_TOP}·${SL_ZONE_BOTTOM}) — 값 동기 깨짐`);
  } else console.log(`PASS sl-drift :: 컴포넌트 소스 list 존 좌표(top ${slSrc.top}%·bottom ${slSrc.bottom}%) = 가드 미러(값 동기)`);

  // (B) 모아보기 프레임 민감도 A/B — 구 존(top 78.5%·bottom 6.0%) 주입 시 프레임 상단 이탈이 검출돼야 검사 유효(이번 결함 재현)
  const slLegacyFrame = slFrameErrors(78.5, 6.0);
  if (slLegacyFrame.some((e) => e.includes('상단'))) console.log(`PASS sl-frame-sensitivity :: 구 존(top 78.5%) 주입 시 프레임 상단 이탈 검출 — 검사 유효 (재현: ${slLegacyFrame.find((e) => e.includes('상단'))})`);
  else { fail++; console.log(`FAIL sl-frame-sensitivity :: 구 존(top 78.5%)도 프레임 내부로 계산 — 오라클 허위(결함 재현 실패)`); }

  console.log(fail === 0 ? '\nALL PASS — award poster 오귀속·톤·오버레이 충돌·세로 예산·모아보기(3안 예산·프레임 내포·드리프트) 무결' : `\n${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
