// 기록왕 "모아보기" 포스터 (AWARDS_SYSTEM §8.1, 2026-07-23 프로토타입 3안 中 [3안]). statleader_stage.webp 배경 +
// 하단에 7부문 리더를 한 줄씩(부문 라벨 · 이름 · 팀 · 수치) 얹는 순수 표시 컴포넌트(엔진/store 무의존, 결정론 무관).
//
// 오버레이 좌표·세로 예산(§8.1 실측 산식, 자산 1080×1440):
//   · 상단 시즌 라벨 : top 3.2% full(키커+연도) — 렌더 하단 ≈11.0% < 배경 타이틀 "STAT LEADER" 상단 12.36%(기존 충돌 가드가 커버).
//   · 하단 리스트 존 : top 80.9% ~ bottom 5.3% ⇒ 높이 13.8%h. **네온 프레임 내부(sharp 실측)** 에만 배치 — 프레임 상단 네온
//     테두리 79.93~80.56% / 하단 네온 테두리 95.07% / 좌·우 5.2%·95.4%. 순-다크 내부 = 80.56%~95.07%. 존(80.9~94.7%)은
//     상 인셋 0.34%·하 인셋 0.37%로 프레임 안. 구 존(top 78.5%)은 프레임 상단 테두리(79.93%) 위 포디움 반사 밴드(78~80.5%)에
//     1행이 얹혀 값 가독성 붕괴(2026-07-23 에뮬 실사 결함 — §8.1 정정). 자산 중앙(실루엣·포디움·헤일로 ≈28~77%)·타이틀과 무충돌.
//     행 높이 = max(name/value 라인박스) = 0.0235w×lh1.05×75 = 1.851%h, 7행 = 12.95%h ≤ 예산(13.8 − 안전0.5 = 13.3%h).
//     justifyContent:'space-between'로 슬랙을 행간에 균등 분배. 가드 tools/_dv_award_poster.ts 'sl-budget'(예산)+'sl-frame'(프레임 내포)가 미러링.
// 폰트는 %가 안 되므로 렌더 폭(w) 파생 → 어떤 기기 폭에서도 비율 유지. 색은 다크 네온 배경 위라 앱 테마 무관(자산 실버 톤·흰색).
import { ImageBackground, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import type { PosterTone } from '../data/awardPoster';
import { theme } from './Screen';

const MINT = theme.accent;
const WHITE = '#FFFFFF';
// 톤 기본값(민트) — tone 미지정 시 AwardPoster.DEFAULT_TONE·data/awardPoster TONE_MINT와 값 동기(무회귀).
const DEFAULT_TONE: PosterTone = {
  bright: '#5FEAD8',
  dim: 'rgba(150,238,224,0.72)',
  line: 'rgba(120,230,215,0.28)',
  glow: 'rgba(95,234,216,0.5)',
};

export interface StatLeaderRow {
  catKo: string;   // 부문 한글 라벨(득점·공격·블로킹·서브·디그·세트·리시브)
  name: string;    // 수상자 이름
  team: string;    // 팀 식별(짧은 이름)
  value: string;   // 부문 수치(카운트)
}

export interface StatLeadersPosterProps {
  template: ImageSourcePropType;   // require(...) 배경 자산(statleader_stage.webp)
  seasonLabel: string;             // 시즌 식별("2025-26")
  rows: StatLeaderRow[];           // 7부문(초과분은 존 예산을 벗어나므로 상위 7행 권장)
  tone?: PosterTone;               // 상별 색 계열(미지정=민트)
  accent?: string;                 // 수치 강조색(기본 민트)
  seasonKicker?: string;           // 시즌 라벨 위 소형 키커(기본 "LEAGUE LEADERS")
  width?: number;                  // 렌더 폭(기본 = 화면폭−32, 상한 460)
}

/** 3:4 배경 위 상단 시즌 라벨 + 하단 7부문 리더 리스트를 퍼센트 절대 배치. 세로 = 폭×4/3. */
export function StatLeadersPoster({
  template, seasonLabel, rows, tone = DEFAULT_TONE, accent = MINT, seasonKicker = 'LEAGUE LEADERS', width,
}: StatLeadersPosterProps) {
  const win = useWindowDimensions();
  const w = width ?? Math.min(win.width - 32, 460);
  const h = w * (4 / 3);
  const f = {
    kicker: w * 0.030, season: w * 0.052,
    row: w * 0.0235,   // §8.1 name/value 행 폰트(≈10.1px @428 — 프레임 내부 축소 존에 7행 수용, 다크 프레임 대비로 가독 유지)
    cat: w * 0.021,    // 부문 라벨·팀(약간 작게)
  };
  const LH = 1.05;     // §8.1 행 라인하이트(프레임 내부 존 압축)

  return (
    <View style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden' }}>
      <ImageBackground source={template} style={{ width: w, height: h }} resizeMode="cover">
        {/* ── 상단: 시즌 라벨 (배경 타이틀 위 빈 공간) ── */}
        <View style={styles.topZone}>
          <Text allowFontScaling={false} style={[styles.kicker, { fontSize: f.kicker, color: tone.bright }]}>{seasonKicker}</Text>
          <Text allowFontScaling={false} style={[styles.season, { fontSize: f.season, color: WHITE, textShadowColor: tone.glow }]} numberOfLines={1}>{seasonLabel}</Text>
        </View>

        {/* ── 하단: 7부문 리더 리스트 (§8.1 리스트 존) ── */}
        <View style={styles.list}>
          {rows.map((r, i) => (
            <View key={r.catKo + i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tone.line }]}>
              <Text allowFontScaling={false} style={[styles.cat, { fontSize: f.cat, lineHeight: f.cat * LH, includeFontPadding: false, color: tone.bright }]} numberOfLines={1}>{r.catKo}</Text>
              <Text allowFontScaling={false} style={[styles.name, { fontSize: f.row, lineHeight: f.row * LH, includeFontPadding: false, color: WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{r.name}</Text>
              <Text allowFontScaling={false} style={[styles.team, { fontSize: f.cat, lineHeight: f.cat * LH, includeFontPadding: false, color: tone.dim }]} numberOfLines={1}>{r.team}</Text>
              <Text allowFontScaling={false} style={[styles.value, { fontSize: f.row, lineHeight: f.row * LH, includeFontPadding: false, color: accent }]} numberOfLines={1}>{r.value}</Text>
            </View>
          ))}
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // 상단 시즌 라벨 — AwardPoster와 동일 geometry(top 3.2%, full 하단 ≈11.0% < 타이틀 12.36%).
  topZone: { position: 'absolute', top: '3.2%', left: 0, right: 0, alignItems: 'center' },
  kicker: { fontWeight: '800', letterSpacing: 4, opacity: 0.9 },
  season: { fontWeight: '900', letterSpacing: 2, marginTop: 2, textShadowRadius: 8 },

  // 리스트 존 — top 80.9% ~ bottom 5.3% = 13.8%h (§8.1, 프레임 내부 sharp 실측 80.56~95.07% 안, 인셋 상0.34%·하0.37%).
  // space-between으로 7행 균등 분배. 하단 좌표 드리프트 시 가드 'sl-frame' 검출(_dv_award_poster.ts가 이 소스에서 값 추출·대조).
  list: { position: 'absolute', top: '80.9%', bottom: '5.3%', left: '8.5%', right: '8.5%', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  cat: { fontWeight: '800', letterSpacing: 1, width: '22%' },
  name: { fontWeight: '900', flex: 1, minWidth: 0 },
  team: { fontWeight: '700', opacity: 0.85 },
  value: { fontWeight: '900', letterSpacing: 0.5, textAlign: 'right', minWidth: '16%' },
});
