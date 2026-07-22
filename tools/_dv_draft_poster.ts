// A/B 자가검증 가드 — 내 팀 지명 포스터 (UI_RULES DL-9). 표시 전용(엔진·store 무관)이라 시뮬 N 불필요:
//   결정적 구조 검사 — (1) 하단 패널 컨테이너가 자산 아웃라인(실측 74.0~94.4%) 안에 마진 이상 들어있는지,
//   (2) 패널 콘텐츠 세로 예산(폰트·마진 산식 미러링)이 컨테이너 높이 안인지. 넘침 3연전 교훈을 산식으로 봉인.
// A/B: (1) 아웃라인을 뚫는 좌표, (2) 예산 초과 구성을 각각 주입해 같은 검사가 FAIL로 뒤집힘을 증명(허위 오라클 방지).
// 값 동기[컴포넌트]: components/DraftPoster.tsx의 styles.panel 좌표·폭 파생 폰트 스케일·명시 lineHeight·마진과 아래 상수가 일치.
//   드리프트 방지: 컴포넌트 소스에서 실제 panel top/bottom%를 정규식으로 추출해 미러 상수와 대조(누군가 컴포넌트만 바꾸면 검출).
import { readFileSync } from 'fs';
import { join } from 'path';

// ── 자산 아웃라인 실측(§DL-9 sharp 스캔; 딥 네이비 패널 #1c1f35) ──
const OUTLINE_TOP = 74.0;      // 그림 하단 빈 패널 아웃라인 상단 y%
const OUTLINE_BOTTOM = 94.4;   // 아웃라인 하단 y%
const INSET_MIN = 0.3;         // 패널 컨테이너가 아웃라인 안쪽으로 이 이상 들어와야(스크린 넘침 방지)

// ── 컴포넌트 값 동기(components/DraftPoster.tsx styles.panel) ──
const PANEL_TOP = 74.5;        // panel top %
const PANEL_BOTTOM_PCT = 6.1;  // panel bottom %(하단에서) → 패널 하단 엣지 = 100 - 6.1 = 93.9%
const PANEL_H = 100 - PANEL_BOTTOM_PCT - PANEL_TOP; // 19.4%h
const BUDGET_SAFETY = 0.5;
const PANEL_BUDGET = PANEL_H - BUDGET_SAFETY;       // 18.9%h

// ── 세로 예산 산식(%h; 폭 파생 폰트 s→%h=s×75 ∵ w/h=3/4, px p→75p/428, 패널폭 %마진 m→0.6225m) ──
const REF_W = 428;             // px→%h 환산 기준 폭(대표 폰)
const PANEL_W_FRAC = 0.83;     // 패널 내부폭 = w×(1 - 0.085×2)
const bpx = (p: number) => (75 * p) / REF_W;            // px → %h
const bfh = (scale: number, lh: number) => scale * lh * 75; // 폭 파생 폰트 라인박스 → %h
const bmpc = (m: number) => 0.01 * m * PANEL_W_FRAC * 75;   // 패널폭 % 마진 → %h (=0.6225×m)

interface PanelCfg {
  kickerScale: number; kickerLH: number;
  nameScale: number; nameLH: number; nameMT: number;   // name marginTop(px)
  emblem: number;                                       // Image = h×0.052 ⇒ 5.2%h
  // OVR 칩(headRow 우측, AwardPoster ovrChip 동형) — tag/num 폰트 + padV/border(px) + tag marginBottom(px)
  ovrTagScale: number; ovrTagLH: number; ovrNumScale: number; ovrNumLH: number;
  ovrChipPadV: number; ovrChipBorder: number; ovrTagMB: number;
  posEnScale: number; posEnLH: number; posEnRowMT: number;   // posEn 줄 + marginTop(패널폭 %)
  // 스탯 5칸(statRow) — statVal/statLab 폰트 + statLab marginTop(px) + statRow marginTop(패널폭 %)
  statValScale: number; statValLH: number; statLabScale: number; statLabLH: number;
  statLabMT: number; statRowMT: number;
}
/** 하단 패널 콘텐츠 총높이(%h) — 컴포넌트 렌더 구조(headRow[emblem|kicker+name|ovrChip] + posEn줄 + statRow[5칸]) 미러링. */
function panelContentPct(c: PanelCfg): number {
  const nameCol = bfh(c.kickerScale, c.kickerLH) + bpx(c.nameMT) + bfh(c.nameScale, c.nameLH);
  const ovrChip = bpx(c.ovrChipPadV * 2) + bpx(c.ovrChipBorder * 2) + bfh(c.ovrTagScale, c.ovrTagLH) + bfh(c.ovrNumScale, c.ovrNumLH) + bpx(c.ovrTagMB);
  const headRow = Math.max(nameCol, ovrChip, c.emblem);
  const posEnRow = bmpc(c.posEnRowMT) + bfh(c.posEnScale, c.posEnLH);
  const statRow = bmpc(c.statRowMT) + bfh(c.statValScale, c.statValLH) + bpx(c.statLabMT) + bfh(c.statLabScale, c.statLabLH);
  return headRow + posEnRow + statRow;
}
// 프로덕션 값(components/DraftPoster.tsx와 동기)
const CFG_PROD: PanelCfg = {
  kickerScale: 0.028, kickerLH: 1.15,
  nameScale: 0.060, nameLH: 1.12, nameMT: 2,
  emblem: 5.2,
  ovrTagScale: 0.020, ovrTagLH: 1.15, ovrNumScale: 0.044, ovrNumLH: 1.1,
  ovrChipPadV: 2, ovrChipBorder: 1.5, ovrTagMB: -2,
  posEnScale: 0.024, posEnLH: 1.15, posEnRowMT: 2.0,
  statValScale: 0.034, statValLH: 1.12, statLabScale: 0.021, statLabLH: 1.15,
  statLabMT: 1, statRowMT: 1.8,
};
// A/B 예산 민감도용 — 폭 파생 폰트를 미압축 과대(넘침 재현)로 부풀린 구성. 예산 초과여야 검사가 유효.
const CFG_BLOATED: PanelCfg = {
  kickerScale: 0.040, kickerLH: 1.2,
  nameScale: 0.076, nameLH: 1.2, nameMT: 2,
  emblem: 5.2,
  ovrTagScale: 0.030, ovrTagLH: 1.2, ovrNumScale: 0.060, ovrNumLH: 1.2,
  ovrChipPadV: 8, ovrChipBorder: 2, ovrTagMB: 0,
  posEnScale: 0.040, posEnLH: 1.2, posEnRowMT: 6,
  statValScale: 0.050, statValLH: 1.2, statLabScale: 0.032, statLabLH: 1.2,
  statLabMT: 3, statRowMT: 6,
};

/** 패널 컨테이너[top%, bottomPct%]가 아웃라인 안쪽으로 INSET_MIN 이상 들어있는지 — 위반 목록. */
function coordErrors(panelTop: number, panelBottomPct: number): string[] {
  const errs: string[] = [];
  const topInset = panelTop - OUTLINE_TOP;                       // 패널 상단이 아웃라인 상단보다 아래(안쪽)
  const bottomEdge = 100 - panelBottomPct;                       // 패널 하단 엣지 y%
  const bottomInset = OUTLINE_BOTTOM - bottomEdge;               // 패널 하단이 아웃라인 하단보다 위(안쪽)
  if (topInset < INSET_MIN) errs.push(`패널 상단 ${panelTop}% 인셋 ${topInset.toFixed(2)}% < 최소 ${INSET_MIN}% (아웃라인 ${OUTLINE_TOP}% 뚫음/여백부족)`);
  if (bottomInset < INSET_MIN) errs.push(`패널 하단 엣지 ${bottomEdge.toFixed(1)}% 인셋 ${bottomInset.toFixed(2)}% < 최소 ${INSET_MIN}% (아웃라인 ${OUTLINE_BOTTOM}% 뚫음/여백부족)`);
  return errs;
}

// ── 컴포넌트 소스 좌표 추출(드리프트 검출) ──
function readPanelCoordsFromSource(): { top: number; bottom: number } | null {
  try {
    const src = readFileSync(join(__dirname, '..', 'components', 'DraftPoster.tsx'), 'utf8');
    const m = src.match(/panel:\s*\{[^}]*top:\s*'([\d.]+)%'[^}]*bottom:\s*'([\d.]+)%'/);
    if (!m) return null;
    return { top: parseFloat(m[1]), bottom: parseFloat(m[2]) };
  } catch { return null; }
}

(() => {
  let fail = 0;

  // (A) 좌표 — 프로덕션 패널이 아웃라인 안쪽 마진 이상
  const cErrs = coordErrors(PANEL_TOP, PANEL_BOTTOM_PCT);
  console.log(`  · 아웃라인 ${OUTLINE_TOP}~${OUTLINE_BOTTOM}% | 패널 top ${PANEL_TOP}%~하단엣지 ${(100 - PANEL_BOTTOM_PCT).toFixed(1)}% (인셋 상 ${(PANEL_TOP - OUTLINE_TOP).toFixed(2)}%·하 ${(OUTLINE_BOTTOM - (100 - PANEL_BOTTOM_PCT)).toFixed(2)}%)`);
  if (cErrs.length === 0) console.log('PASS coords :: 하단 패널이 자산 아웃라인(74.0~94.4%) 안쪽 마진 이상 이격');
  else { fail++; console.log('FAIL coords ::\n  ' + cErrs.join('\n  ')); }

  // (A) 드리프트 — 컴포넌트 소스의 실제 panel 좌표가 미러 상수와 일치
  const srcCoords = readPanelCoordsFromSource();
  if (!srcCoords) { fail++; console.log('FAIL drift :: DraftPoster.tsx panel 좌표 파싱 실패(구조 변경?)'); }
  else if (srcCoords.top !== PANEL_TOP || srcCoords.bottom !== PANEL_BOTTOM_PCT) {
    fail++; console.log(`FAIL drift :: 소스 panel(top ${srcCoords.top}%·bottom ${srcCoords.bottom}%) ≠ 가드 미러(${PANEL_TOP}·${PANEL_BOTTOM_PCT}) — 값 동기 깨짐`);
  } else console.log(`PASS drift :: 컴포넌트 소스 panel 좌표(top ${srcCoords.top}%·bottom ${srcCoords.bottom}%) = 가드 미러(값 동기)`);

  // (A) 세로 예산 — 프로덕션 콘텐츠 총높이가 예산(18.9%h) 이내
  const prodPct = panelContentPct(CFG_PROD);
  console.log(`  · 패널 세로 예산: 컨테이너 ${PANEL_H.toFixed(1)}% - 안전 ${BUDGET_SAFETY}% = ${PANEL_BUDGET.toFixed(1)}% | 콘텐츠 ${prodPct.toFixed(2)}%`);
  if (prodPct <= PANEL_BUDGET) console.log(`PASS budget :: 패널 콘텐츠 총높이 ${prodPct.toFixed(2)}% ≤ ${PANEL_BUDGET.toFixed(1)}% — 넘침 없음(여유 ${(PANEL_BUDGET - prodPct).toFixed(2)}%)`);
  else { fail++; console.log(`FAIL budget :: 초과 (${prodPct.toFixed(2)} vs 예산 ${PANEL_BUDGET.toFixed(1)})`); }

  // (B) 좌표 민감도 A/B — 아웃라인을 뚫는 패널(top 73.5%·bottom 5.0%)을 주입하면 검출돼야 유효
  const badCoord = coordErrors(73.5, 5.0);
  if (badCoord.length >= 2) console.log(`PASS coord-sensitivity :: 아웃라인 뚫는 좌표 주입 시 상·하 ${badCoord.length}건 검출 — 검사 유효`);
  else { fail++; console.log(`FAIL coord-sensitivity :: 뚫는 좌표를 검출 못 함(${badCoord.length}건) — 오라클 허위`); }

  // (B) 예산 민감도 A/B — 미압축 과대 폰트 구성을 주입하면 예산 초과가 검출돼야 유효
  const bloatedPct = panelContentPct(CFG_BLOATED);
  if (bloatedPct > PANEL_BUDGET) console.log(`PASS budget-sensitivity :: 과대 폰트 구성 ${bloatedPct.toFixed(2)}% > 예산 ${PANEL_BUDGET.toFixed(1)}% 초과 검출 — 검사 유효(패널 ${PANEL_H.toFixed(1)}% 넘침 ${(bloatedPct - PANEL_H).toFixed(2)}%p)`);
  else { fail++; console.log(`FAIL budget-sensitivity :: 과대 구성 ${bloatedPct.toFixed(2)}%도 예산 이내로 계산 — 오라클 허위`); }

  console.log(fail === 0 ? '\nALL PASS — draft poster 패널 좌표·세로 예산 무결' : `\n${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
