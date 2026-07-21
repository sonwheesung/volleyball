// 시상식 1인 개인상 포스터 (AWARDS_SYSTEM §8, 2026-07-21 사용자 시안). 재사용 컴포넌트 —
// 배경 자산(template)만 바꾸면 MVP·신인상·기량발전상 등 **모든 1인 개인상**에 그대로 쓴다.
// 배경 이미지에 상 타이틀("MVP / MOST VALUABLE PLAYER")이 박혀 있고, 이 컴포넌트는 그림의 빈 공간
// (상단 시즌 라벨·하단 정보 패널)에만 텍스트를 얹는다. 순수 표시(엔진·store 무의존, 결정론 무관).
//
// 오버레이 좌표 규약(퍼센트 = 포스터 높이 기준, 자산 1080×1440 실측):
//   · 상단 시즌 라벨    : top 3.2% ~ 8.5%(타이틀 y≈12% 위 빈 공간)
//   · 하단 정보 패널    : top 80.5% ~ 94.2%(그림 패널 아웃라인 실측 79.9~95.1%의 안쪽 — sharp 민트 라인 스캔 2026-07-21)
//     ⚠ 내용물 합계가 컨테이너보다 크면 아래로 흘러넘쳐 패널 밖으로 샌다(실기기 보고) — 폰트·마진은 반드시 이 높이(13.7%) 안에 들어오게
// 폰트 크기는 퍼센트가 안 되므로 렌더 폭(w)에서 파생 → 어떤 기기 폭에서도 비율 유지.
// 색은 배경(고정 다크 네온 이미지) 위라 앱 라이트/다크 테마와 무관 — 고정 민트 네온·흰색(자산 톤).
import { Image, ImageBackground, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { displayOvr } from '../engine/overall';
import { theme } from './Screen';

// 배경(다크 네온 이미지) 위 고정 색 — 앱 테마 무관(이미지가 항상 어둡다). theme.accent(민트)와 동계열.
const MINT = theme.accent;            // #19C2AE — 구조 민트(칸 구분·라벨)
const MINT_BRIGHT = '#5FEAD8';        // 시즌 라벨·포지션 글로우(자산 네온 톤)
const MINT_DIM = 'rgba(150,238,224,0.72)'; // 스탯 라벨(가라앉힌 민트)
const WHITE = '#FFFFFF';

export interface AwardPosterStat { label: string; value: string }

export interface AwardPosterProps {
  template: ImageSourcePropType;   // require(...) 배경 자산 — 상별로 교체
  seasonLabel: string;             // 시즌 식별(예: "2025-26")
  name: string;                    // 수상자 이름(큰 한글)
  posEn: string;                   // 포지션 영문(예: "OUTSIDE HITTER")
  ovr: number;                     // raw 연속 OVR(내부에서 displayOvr 적용)
  stats: AwardPosterStat[];        // 4~5칸(라벨 한글·수치 강조)
  emblem?: ImageSourcePropType;    // 구단 엠블럼 배지(좌측)
  accent?: string;                 // 강조색(우리 구단 등) — 기본 민트
  seasonKicker?: string;           // 시즌 라벨 위 소형 키커(기본 "SEASON")
  footnote?: string;               // 하단 문구(선택)
  width?: number;                  // 렌더 폭(기본 = 화면폭−32, Screen 패딩)
}

/** 3:4 배경 위에 시즌·수상자·OVR·스탯을 퍼센트 절대 배치. 세로 = 폭×4/3. */
export function AwardPoster({
  template, seasonLabel, name, posEn, ovr, stats,
  emblem, accent = MINT, seasonKicker = 'SEASON', footnote, width,
}: AwardPosterProps) {
  const win = useWindowDimensions();
  const w = width ?? Math.min(win.width - 32, 460); // 태블릿 과대 방지 상한
  const h = w * (4 / 3);
  // 폭 파생 폰트 — 좁은 기기에서도 비율 유지
  const f = {
    kicker: w * 0.030, season: w * 0.052,
    posEn: w * 0.022, name: w * 0.056,
    ovrTag: w * 0.020, ovrNum: w * 0.044,
    statVal: w * 0.034, statLab: w * 0.021,
    foot: w * 0.026,
  };
  const cells = stats.slice(0, 5);

  return (
    <View style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden' }}>
      <ImageBackground source={template} style={{ width: w, height: h }} resizeMode="cover">
        {/* ── 상단: 시즌 라벨 (타이틀 위 빈 공간) ── */}
        <View style={styles.topZone}>
          <Text allowFontScaling={false} style={[styles.kicker, { fontSize: f.kicker, color: MINT_BRIGHT }]}>{seasonKicker}</Text>
          <Text allowFontScaling={false} style={[styles.season, { fontSize: f.season, color: WHITE }]} numberOfLines={1}>{seasonLabel}</Text>
        </View>

        {/* ── 하단: 정보 패널 (수상자·OVR·스탯) ── */}
        <View style={styles.panel}>
          {/* 상단행: [엠블럼] [포지션/이름] [OVR] */}
          <View style={styles.headRow}>
            {emblem ? <Image source={emblem} style={[styles.emblem, { width: h * 0.048, height: h * 0.048 }]} /> : null}
            <View style={styles.nameCol}>
              <Text allowFontScaling={false} style={[styles.posEn, { fontSize: f.posEn, lineHeight: f.posEn * 1.15, includeFontPadding: false, color: MINT_BRIGHT }]} numberOfLines={1}>{posEn}</Text>
              <Text allowFontScaling={false} style={[styles.name, { fontSize: f.name, lineHeight: f.name * 1.12, includeFontPadding: false, color: WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{name}</Text>
            </View>
            <View style={[styles.ovrChip, { borderColor: accent }]}>
              <Text allowFontScaling={false} style={[styles.ovrTag, { fontSize: f.ovrTag, lineHeight: f.ovrTag * 1.15, includeFontPadding: false, color: MINT_DIM }]}>OVR</Text>
              <Text allowFontScaling={false} style={[styles.ovrNum, { fontSize: f.ovrNum, lineHeight: f.ovrNum * 1.1, includeFontPadding: false, color: accent }]}>{displayOvr(ovr)}</Text>
            </View>
          </View>

          {/* 하단행: 스탯 5칸 */}
          <View style={styles.statRow}>
            {cells.map((c, i) => (
              <View key={c.label + i} style={[styles.statCell, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(120,230,215,0.28)' }]}>
                <Text allowFontScaling={false} style={[styles.statVal, { fontSize: f.statVal, lineHeight: f.statVal * 1.12, includeFontPadding: false, color: WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{c.value}</Text>
                <Text allowFontScaling={false} style={[styles.statLab, { fontSize: f.statLab, lineHeight: f.statLab * 1.15, includeFontPadding: false, color: MINT_DIM }]} numberOfLines={1}>{c.label}</Text>
              </View>
            ))}
          </View>

          {footnote ? <Text allowFontScaling={false} style={[styles.foot, { fontSize: f.foot, color: MINT_DIM }]} numberOfLines={1}>{footnote}</Text> : null}
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // 상단 시즌 라벨 — top 3.2%~8.5%
  topZone: { position: 'absolute', top: '3.2%', left: 0, right: 0, alignItems: 'center' },
  kicker: { fontWeight: '800', letterSpacing: 4, opacity: 0.9 },
  season: { fontWeight: '900', letterSpacing: 2, marginTop: 2, textShadowColor: 'rgba(95,234,216,0.5)', textShadowRadius: 8 },

  // 하단 정보 패널 — top 79%~95.5% (시안 y≈79~94%, 아웃라인 82~96% 살짝 위에서 시작)
  panel: { position: 'absolute', top: '80.5%', bottom: '5.8%', left: '8.5%', right: '8.5%', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emblem: { resizeMode: 'contain' },
  nameCol: { flex: 1, minWidth: 0 },
  posEn: { fontWeight: '800', letterSpacing: 2 },
  name: { fontWeight: '900', marginTop: 1 },
  ovrChip: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(5,20,20,0.45)' },
  ovrTag: { fontWeight: '800', letterSpacing: 1.5, marginBottom: -2 },
  ovrNum: { fontWeight: '900' },

  statRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: '1.8%' },
  statCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statVal: { fontWeight: '900' },
  statLab: { fontWeight: '700', marginTop: 1 },

  foot: { textAlign: 'center', marginTop: 6, letterSpacing: 1, opacity: 0.85 },
});
