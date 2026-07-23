// 시상식 1인 개인상 포스터 (AWARDS_SYSTEM §8, 2026-07-21 사용자 시안). 재사용 컴포넌트 —
// 배경 자산(template)만 바꾸면 MVP·신인상·기량발전상 등 **모든 1인 개인상**에 그대로 쓴다.
// 배경 이미지에 상 타이틀("MVP / MOST VALUABLE PLAYER")이 박혀 있고, 이 컴포넌트는 그림의 빈 공간
// (상단 시즌 라벨·하단 정보 패널)에만 텍스트를 얹는다. 순수 표시(엔진·store 무의존, 결정론 무관).
//
// 오버레이 좌표 규약(퍼센트 = 포스터 높이 기준, 자산 1080×1440 실측):
//   · 상단 시즌 라벨    : top 3.2% ~ (렌더 실측) full ≈11.0%(키커+연도 2줄) / yearOnly ≈7.9%(연도 1줄)
//     ↳ 정정(2026-07-22): 구 주석 "~8.5%"는 눈대중 오류 — 실제 렌더 하단은 full ~11%(연도 글리프 8.1~11.0% 실측).
//       타이틀이 낮은 자산(mvp/finals/rookie/statleader ≈12%)은 클리어하나, mip 타이틀 "MOST"(8.7%)와는 겹쳐 seasonMode='yearOnly' 필요.
//       가드 tools/_dv_award_poster.ts 충돌 검사가 이 산식을 미러링해 titleTopPct와 대조(값 동기).
//   · 하단 정보 패널    : top 80.5% ~ 94.2%(그림 패널 아웃라인 실측 79.9~95.1%의 안쪽 — sharp 민트 라인 스캔 2026-07-21)
//     ⚠ 내용물 합계가 컨테이너(13.7%h)보다 크면 아래로 흘러넘쳐 패널 밖으로 샌다(실기기 보고). 풋노트 有는 5번째 줄이 붙어
//       총높이 15.51%h로 초과 → 풋노트 有 구성만 라인하이트·마진 압축(총 12.89%h). 세로 예산 산식은 styles.panel 주석 참조.
// 폰트 크기는 퍼센트가 안 되므로 렌더 폭(w)에서 파생 → 어떤 기기 폭에서도 비율 유지.
// 색은 배경(고정 다크 네온 이미지) 위라 앱 라이트/다크 테마와 무관 — 자산 네온 톤·흰색.
// 톤(상별 색 계열)은 tone prop으로 주입(신인상=블루·기량발전=오렌지·기록왕=실버 …). 미지정=민트(기존 무회귀).
import { Image, ImageBackground, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { displayOvr } from '../engine/overall';
import type { PosterTone, PosterSeasonMode } from '../data/awardPoster';
import { theme } from './Screen';

// 배경(다크 네온 이미지) 위 고정 색 — 앱 테마 무관(이미지가 항상 어둡다). theme.accent(민트)와 동계열.
const MINT = theme.accent;            // #19C2AE — accent(OVR 칩) 기본값
const WHITE = '#FFFFFF';
// 톤 기본값(민트) — tone 미지정 시 기존과 픽셀 동일(무회귀). data/awardPoster.ts TONE_MINT와 값 동기(자산 mvp — finals는 골드로 분리).
const DEFAULT_TONE: PosterTone = {
  bright: '#5FEAD8',                    // 시즌 키커·포지션 라벨 글로우
  dim: 'rgba(150,238,224,0.72)',        // 스탯 라벨·OVR 태그·풋노트
  line: 'rgba(120,230,215,0.28)',       // 스탯 칸 구분선
  glow: 'rgba(95,234,216,0.5)',         // 시즌 라벨 텍스트 섀도
};

export interface AwardPosterStat { label: string; value: string }

export interface AwardPosterProps {
  template: ImageSourcePropType;   // require(...) 배경 자산 — 상별로 교체
  seasonLabel: string;             // 시즌 식별(예: "2025-26")
  name: string;                    // 수상자 이름(큰 한글)
  posEn: string;                   // 포지션 영문(예: "OUTSIDE HITTER")
  teamName?: string;               // 소속팀 표시명 — 포지션 줄에 병기("OPPOSITE · 인천 타이드"). 미지정=현행(무회귀). §8
  isMyTeam?: boolean;              // 수상자가 내 팀 → 팀명 강조(tone.bright+볼드) + "MY TEAM" 칩. false/미지정=현행(무회귀). §8(2026-07-23)
  ovr: number;                     // raw 연속 OVR(내부에서 displayOvr 적용)
  stats: AwardPosterStat[];        // 4~5칸(라벨 한글·수치 강조)
  emblem?: ImageSourcePropType;    // 구단 엠블럼 배지(좌측)
  accent?: string;                 // 강조색(우리 구단 등) — 기본 민트. OVR 칩 테두리/숫자(구단색)
  tone?: PosterTone;               // 상별 색 계열(bright/dim/line/glow). 미지정=민트(무회귀)
  seasonKicker?: string;           // 시즌 라벨 위 소형 키커(기본 "SEASON")
  seasonMode?: PosterSeasonMode;   // 'full'(키커+연도, 기본) / 'yearOnly'(연도만 — 타이틀이 높은 자산의 겹침 회피, §8)
  footnote?: string;               // 하단 문구(선택)
  highlightLabels?: string[];      // 강조할 스탯 칸 라벨(부문왕 해당 칸 — 값·라벨 tone.bright+볼드). 미지정=강조 없음(기존 렌더와 바이트 동일). §8.1
  width?: number;                  // 렌더 폭(기본 = 화면폭−32, Screen 패딩)
}

/** 3:4 배경 위에 시즌·수상자·OVR·스탯을 퍼센트 절대 배치. 세로 = 폭×4/3. */
export function AwardPoster({
  template, seasonLabel, name, posEn, teamName, isMyTeam = false, ovr, stats,
  emblem, accent = MINT, tone = DEFAULT_TONE, seasonKicker = 'SEASON', seasonMode = 'full', footnote, highlightLabels, width,
}: AwardPosterProps) {
  // yearOnly = 키커 미렌더 → 연도가 topZone(3.2%) 최상단에서 시작(하단 ~7.9%). 키커 위 여백(marginTop:2)도 이때만 제거(연도가 3.2%에 붙게).
  const showKicker = seasonMode !== 'yearOnly';
  const win = useWindowDimensions();
  const w = width ?? Math.min(win.width - 32, 460); // 태블릿 과대 방지 상한
  const h = w * (4 / 3);
  // 폭 파생 폰트 — 좁은 기기에서도 비율 유지
  const f = {
    kicker: w * 0.030, season: w * 0.052,
    posEn: w * 0.022, name: w * 0.056,
    ovrTag: w * 0.020, ovrNum: w * 0.044,
    statVal: w * 0.034, statLab: w * 0.021,
    foot: w * 0.022,        // 풋노트(있을 때만 렌더) — 0.026→0.022 축소(패널 세로 예산, styles.panel 주석 산식)
    chip: w * 0.013,        // "MY TEAM" 칩 폰트(내 팀 수상자만) — 칩 박스 높이 0.021w ≤ posEn 라인박스라 줄 높이 불변, §8 2026-07-23
  };
  // "MY TEAM" 칩 치수(전부 폭 파생 → 폭 무관 비율). 박스 높이 = 폰트(lh1.0) + padV×2 + border×2 = (0.013+0.002+0.006)w = 0.021w
  //   ≤ posEn 라인박스(0.022×1.10w, 풋노트 有 최소) → 칩이 행을 키우지 않음(세로 예산 불변). 가드 _dv_award_poster '칩 높이' 검사와 값 동기.
  const chipPadV = w * 0.001;
  const chipBorder = w * 0.003;
  const cells = stats.slice(0, 5);
  // 풋노트가 있으면 하단 패널에 5번째 줄이 붙어 콘텐츠 총높이가 컨테이너(13.7%h)를 넘어 아래로 샌다(실기기 버그, §8).
  // → 풋노트 有일 때만 라인하이트·마진을 압축해 총높이 ≤13.0%h(패널 13.7 - 안전 0.7)로 맞춘다. 풋노트 無(4장)는 픽셀 무회귀.
  // 조정 전후 총높이(15.51→12.89%h)·산식은 styles.panel 주석 + 가드 tools/_dv_award_poster.ts(패널 세로 예산 검사)와 값 동기.
  const hasFoot = !!footnote;

  return (
    <View style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden' }}>
      <ImageBackground source={template} style={{ width: w, height: h }} resizeMode="cover">
        {/* ── 상단: 시즌 라벨 (타이틀 위 빈 공간) ── */}
        <View style={styles.topZone}>
          {showKicker ? <Text allowFontScaling={false} style={[styles.kicker, { fontSize: f.kicker, color: tone.bright }]} numberOfLines={1}>{seasonKicker}</Text> : null}
          <Text allowFontScaling={false} style={[styles.season, { fontSize: f.season, color: WHITE, textShadowColor: tone.glow, marginTop: showKicker ? 2 : 0 }]} numberOfLines={1}>{seasonLabel}</Text>
        </View>

        {/* ── 하단: 정보 패널 (수상자·OVR·스탯) ── */}
        <View style={styles.panel}>
          {/* 상단행: [엠블럼] [포지션/이름] [OVR] */}
          <View style={styles.headRow}>
            {emblem ? <Image source={emblem} style={[styles.emblem, { width: h * 0.048, height: h * 0.048 }]} /> : null}
            <View style={styles.nameCol}>
              {/* 포지션 줄에 소속팀명 병기(§8) — 새 줄 없음(줄 수 불변 → 세로 예산·충돌 마진 무영향). adjustsFontSizeToFit로 긴 조합 폭 축소.
                  내 팀 수상자(isMyTeam)면 팀명 볼드 강조 + "MY TEAM" 칩(§8 2026-07-23). 칩 박스 높이 ≤ posEn 라인박스라 줄 높이 불변.
                  false/미지정이면 기존 단일 Text 그대로(무회귀 — posRow·칩 미생성). */}
              {isMyTeam ? (
                <View style={styles.posRow}>
                  <Text allowFontScaling={false} style={[styles.posEn, { fontSize: f.posEn, lineHeight: f.posEn * (hasFoot ? 1.10 : 1.15), includeFontPadding: false, color: tone.bright, flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {posEn}{teamName ? <Text>{' · '}<Text style={{ fontWeight: '900', color: tone.bright }}>{teamName}</Text></Text> : null}
                  </Text>
                  <View style={[styles.myTeamChip, { borderColor: tone.bright, borderWidth: chipBorder, paddingVertical: chipPadV, marginLeft: w * 0.012 }]}>
                    <Text allowFontScaling={false} style={[styles.myTeamChipTxt, { fontSize: f.chip, lineHeight: f.chip, includeFontPadding: false, color: tone.bright }]} numberOfLines={1}>MY TEAM</Text>
                  </View>
                </View>
              ) : (
                <Text allowFontScaling={false} style={[styles.posEn, { fontSize: f.posEn, lineHeight: f.posEn * (hasFoot ? 1.10 : 1.15), includeFontPadding: false, color: tone.bright }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{teamName ? `${posEn} · ${teamName}` : posEn}</Text>
              )}
              <Text allowFontScaling={false} style={[styles.name, { fontSize: f.name, lineHeight: f.name * (hasFoot ? 1.10 : 1.12), includeFontPadding: false, color: WHITE, marginTop: hasFoot ? 0 : 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{name}</Text>
            </View>
            <View style={[styles.ovrChip, { borderColor: accent }]}>
              <Text allowFontScaling={false} style={[styles.ovrTag, { fontSize: f.ovrTag, lineHeight: f.ovrTag * 1.15, includeFontPadding: false, color: tone.dim }]}>OVR</Text>
              <Text allowFontScaling={false} style={[styles.ovrNum, { fontSize: f.ovrNum, lineHeight: f.ovrNum * 1.1, includeFontPadding: false, color: accent }]}>{displayOvr(ovr)}</Text>
            </View>
          </View>

          {/* 하단행: 스탯 5칸 */}
          <View style={[styles.statRow, hasFoot && { marginTop: '0.3%' }]}>
            {cells.map((c, i) => {
              // 부문왕 해당 칸이면 값·라벨을 tone.bright + 볼드로 강조(한눈에 어느 부문인지 — §8.1). 미지정 시 hl=false → 기존 렌더 무변경.
              const hl = highlightLabels?.includes(c.label) ?? false;
              return (
              <View key={c.label + i} style={[styles.statCell, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: tone.line }]}>
                <Text allowFontScaling={false} style={[styles.statVal, { fontSize: f.statVal, lineHeight: f.statVal * (hasFoot ? 1.08 : 1.12), includeFontPadding: false, color: hl ? tone.bright : WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{c.value}</Text>
                <Text allowFontScaling={false} style={[styles.statLab, { fontSize: f.statLab, lineHeight: f.statLab * (hasFoot ? 1.10 : 1.15), includeFontPadding: false, color: hl ? tone.bright : tone.dim, marginTop: hasFoot ? 0 : 1 }, hl && { fontWeight: '900' }]} numberOfLines={1}>{c.label}</Text>
              </View>
              );
            })}
          </View>

          {footnote ? <Text allowFontScaling={false} style={[styles.foot, { fontSize: f.foot, lineHeight: f.foot * 1.08, includeFontPadding: false, color: tone.dim }]} numberOfLines={1}>{footnote}</Text> : null}
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // 상단 시즌 라벨 — top 3.2% 시작, 렌더 하단 full ≈11.0% / yearOnly ≈7.9%(구 주석 "8.5%"는 눈대중 오류, §8 정정)
  topZone: { position: 'absolute', top: '3.2%', left: 0, right: 0, alignItems: 'center' },
  kicker: { fontWeight: '800', letterSpacing: 4, opacity: 0.9 },
  season: { fontWeight: '900', letterSpacing: 2, marginTop: 2, textShadowColor: 'rgba(95,234,216,0.5)', textShadowRadius: 8 },

  // 하단 정보 패널 — top 80.5%~bottom 5.8% ⇒ 컨테이너 높이 13.7%h. justifyContent:'center'라 콘텐츠 총높이가
  // 13.7%를 넘으면 위·아래로 균등 넘침 → 풋노트가 패널 하단 네온 레일에 걸침(실기기 버그, §8 세로 예산 근본수정 2026-07-22).
  // ── 세로 예산 산식(%h; 폭 파생 폰트 s → %h=s×75 ∵ w/h=3/4, px p → 75p/428, 패널폭 % 마진 m → 0.6225m) ──
  //   headRow=max(nameCol, ovrChip 6.23, emblem 4.8);  nameCol=posEn(.022×lh)·name(.056×lh)+name mt
  //   statRow=statRow_mt + statVal(.034×lh)+statLab(.021×lh)+statLab mt;  foot=foot_mt + foot(.022×1.08)
  //   · 풋노트 無(4장, 현행 무회귀): 6.777 + 5.963            = 12.74%h  (lh posEn1.15·name1.12·statVal1.12·statLab1.15, mt 1.8%/1px)
  //   · 풋노트 有(구, 버그):        6.777 + 5.963 + 2.768     = 15.51%h  (13.7 초과 1.81 → 하단 0.9%h 넘침)
  //   · 풋노트 有(신, 압축):        6.435 + 4.673 + 1.782     = 12.89%h  (lh posEn1.10·name1.10·statVal1.08·statLab1.10, statRow mt 0.3%·name/statLab mt 0·foot mt 0·f.foot .022×1.08)
  //   ⇒ 신 풋노트 총높이 ≤13.0%h(패널 13.7 - 안전 0.7). 가드 tools/_dv_award_poster.ts '패널 세로 예산' 검사가 이 산식을 미러링(값 동기).
  panel: { position: 'absolute', top: '80.5%', bottom: '5.8%', left: '8.5%', right: '8.5%', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emblem: { resizeMode: 'contain' },
  nameCol: { flex: 1, minWidth: 0 },
  // 내 팀 수상자: 포지션 줄을 row로(팀명 텍스트 flexShrink + 칩 고정). alignItems:'center'라 행 높이=max(자식)=posEn 라인박스(칩이 더 작음).
  posRow: { flexDirection: 'row', alignItems: 'center' },
  // "MY TEAM" 칩 — 폭 파생 border/padV(인라인). 박스 높이 0.021w ≤ posEn 라인박스(0.022×1.10w) → 줄 높이 불변(§8 세로 예산 보존).
  myTeamChip: { borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)', paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  myTeamChipTxt: { fontWeight: '900', letterSpacing: 1 },
  posEn: { fontWeight: '800', letterSpacing: 2 },
  name: { fontWeight: '900', marginTop: 1 },
  ovrChip: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(5,20,20,0.45)' },
  ovrTag: { fontWeight: '800', letterSpacing: 1.5, marginBottom: -2 },
  ovrNum: { fontWeight: '900' },

  statRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: '1.8%' },
  statCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statVal: { fontWeight: '900' },
  statLab: { fontWeight: '700', marginTop: 1 },

  // marginTop 0(구 6→3→0, 패널 세로 예산 근본수정 2026-07-22 §8). lineHeight는 인라인 f.foot×1.08(includeFontPadding:false).
  // foot Text는 footnote 有일 때만 렌더되므로 여기 값은 항상 '풋노트 압축 구성'(무회귀 대상 아님).
  // ed9f2ff(mt 6→3·lh1.15)는 3px만 회수해 여전히 넘침(실기기 재보고) → styles.panel 세로 예산식 기반 압축으로 봉인.
  foot: { textAlign: 'center', marginTop: 0, letterSpacing: 1, opacity: 0.85 },
});
