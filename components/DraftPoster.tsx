// 내 팀 드래프트 지명 포스터 (UI_RULES DL-9, 2026-07-22 사용자 시안 · 하단 패널 개편 2026-07-22). 순수 표시 —
// 엔진·store 무의존, 결정론 무관. AwardPoster(AWARDS_SYSTEM §8)의 **패널 문법**을 공유하되 **드래프트 전용 자산·좌표**를 쓴다:
//   3:4 · 폭 min(win.width-32,460) · 폭 파생 폰트 · allowFontScaling=false · lineHeight 명시+includeFontPadding:false ·
//   배경 위 픽셀 고정색(앱 테마 무관) · 세로 예산 산식으로 넘침 봉인(넘침 3연전 교훈).
//
// 개편(2026-07-22 사용자 피드백): (1) 포지션 표기 영문만(구 "한글 · 영문"), (2) 직관 등급 칩 제거,
//   (3) **종합 능력치 표시 추가** — AwardPoster 패널처럼 OVR 칩(displayOvr, 구단 accent)+대표 5능력(윗단, 선수 상세와 동일 표시 규약).
//   스탯은 시즌 생산이 아니라 능력치(deriveRatings 윗단) — data/awardPoster.ts posterAbilityStats가 포지션별 5칸을 조립(호출부에서 전달).
//
// 자산 draft_stage.webp(1080×1440, 딥 네이비/화이트): 배경에 "DRAFT DAY" 타이틀이 박혀 있고(상단 titleTop 9.03% 실측),
// 그림의 하단 빈 패널에만 텍스트를 얹는다. **상단 오버레이 없음**(배경 타이틀이 9.03%부터라 시즌 라벨을 얹으면 충돌 —
// 시즌 정보는 하단 패널 키커에 포함). AwardPoster와 달리 톤 prop 없음(자산 1종, 네이비 단색이라 로컬 상수로 고정).
//
// 오버레이 좌표 규약(퍼센트 = 포스터 높이 기준, 자산 실측):
//   · 하단 정보 패널 : top 74.5% ~ bottom 6.1%(=93.9%) — 그림 패널 아웃라인 실측 74.0~94.4%의 안쪽 0.5% 인셋.
//     컨테이너 높이 = 100 - 74.5 - 6.1 = 19.4%h. 시상 포스터(79.9~95.1%)와 좌표가 다르므로 전용값(§DL-9).
// 폰트 크기는 퍼센트가 안 되므로 렌더 폭(w)에서 파생 → 어떤 기기 폭에서도 비율 유지.
// 색은 배경(고정 딥 네이비 이미지) 위라 앱 라이트/다크 테마와 무관 — 흰색·옅은 블루-화이트(dim).
import { Image, ImageBackground, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { displayOvr } from '../engine/overall';

// 배경(딥 네이비 이미지) 위 고정 색 — 앱 테마 무관(이미지가 항상 어둡다).
// 이름·수치는 순백, 키커/포지션/스탯 라벨은 **옅은 블루-화이트 dim**(bright #FFFFFF는 이름과 충돌하므로 회피, §DL-9 톤 규약).
const WHITE = '#FFFFFF';                       // 이름·스탯 값(큰 흰색)
const DIM = 'rgba(206,218,245,0.82)';          // 키커·포지션·OVR 태그·스탯 라벨(옅은 블루-화이트)
const BRIGHT = '#CFE0FF';                       // accent 미지정 시 OVR 칩 폴백(선명한 블루-화이트)
const LINE = 'rgba(150,180,235,0.30)';         // 스탯 칸 구분선

export interface DraftPosterStat { label: string; value: string }

export interface DraftPosterProps {
  template: ImageSourcePropType;   // require(...) 배경 자산(draft_stage)
  kicker: string;                  // "{시즌연도} 신인 드래프트 · {round}R {전체순번}순번"
  name: string;                    // 지명 선수명(큰 흰색)
  posEn: string;                   // 포지션 영문(예 "SETTER")
  ovr: number;                     // raw 연속 OVR(내부에서 displayOvr 적용 — OvrBadge/AwardPoster와 동일 규약)
  stats: DraftPosterStat[];        // 대표 5능력(윗단 원시치; posterAbilityStats 조립)
  emblem?: ImageSourcePropType;    // 구단 엠블럼 배지(좌측)
  accent?: string;                 // OVR 칩 테두리/숫자 색(구단색). 미지정=옅은 블루-화이트
  width?: number;                  // 렌더 폭(기본 = 화면폭−32, Screen 패딩)
}

/** 3:4 배경(딥 네이비) 위, 하단 패널에 엠블럼·키커·이름·OVR·포지션·5능력을 퍼센트 절대 배치. 세로 = 폭×4/3. */
export function DraftPoster({ template, kicker, name, posEn, ovr, stats, emblem, accent = BRIGHT, width }: DraftPosterProps) {
  const win = useWindowDimensions();
  const w = width ?? Math.min(win.width - 32, 460); // 태블릿 과대 방지 상한
  const h = w * (4 / 3);
  // 폭 파생 폰트 — 좁은 기기에서도 비율 유지(AwardPoster와 동일 방법론)
  const f = {
    kicker: w * 0.028,   // 키커(긴 문구) — numberOfLines 1 + adjustsFontSizeToFit
    name: w * 0.060,     // 이름(큰 흰색; 드래프트 히어로)
    ovrTag: w * 0.020,   // "OVR" 태그
    ovrNum: w * 0.044,   // OVR 숫자(displayOvr, 구단 accent)
    posEn: w * 0.024,    // 포지션 영문
    statVal: w * 0.034,  // 스탯 값
    statLab: w * 0.021,  // 스탯 라벨
  };
  const cells = stats.slice(0, 5);

  return (
    <View style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden' }}>
      <ImageBackground source={template} style={{ width: w, height: h }} resizeMode="cover">
        {/* ── 상단 오버레이 없음(배경 "DRAFT DAY" 타이틀 9.03%가 타이틀 역할, §DL-9) ── */}

        {/* ── 하단: 정보 패널(엠블럼·키커·이름·OVR·포지션·5능력) ── */}
        <View style={styles.panel}>
          {/* 상단행: [엠블럼] [키커/이름] [OVR 칩] — AwardPoster headRow와 동일 배치 */}
          <View style={styles.headRow}>
            {emblem ? <Image source={emblem} style={[styles.emblem, { width: h * 0.052, height: h * 0.052 }]} /> : null}
            <View style={styles.nameCol}>
              <Text allowFontScaling={false} style={[styles.kicker, { fontSize: f.kicker, lineHeight: f.kicker * 1.15, includeFontPadding: false, color: DIM }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{kicker}</Text>
              <Text allowFontScaling={false} style={[styles.name, { fontSize: f.name, lineHeight: f.name * 1.12, includeFontPadding: false, color: WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{name}</Text>
            </View>
            <View style={[styles.ovrChip, { borderColor: accent }]}>
              <Text allowFontScaling={false} style={[styles.ovrTag, { fontSize: f.ovrTag, lineHeight: f.ovrTag * 1.15, includeFontPadding: false, color: DIM }]}>OVR</Text>
              <Text allowFontScaling={false} style={[styles.ovrNum, { fontSize: f.ovrNum, lineHeight: f.ovrNum * 1.1, includeFontPadding: false, color: accent }]}>{displayOvr(ovr)}</Text>
            </View>
          </View>

          {/* 포지션 영문(구 "한글 · 영문 + 등급 칩" → 영문만, 등급 칩 제거) */}
          <Text allowFontScaling={false} style={[styles.posEn, { fontSize: f.posEn, lineHeight: f.posEn * 1.15, includeFontPadding: false, color: DIM }]} numberOfLines={1}>{posEn}</Text>

          {/* 대표 5능력(윗단 원시치) — AwardPoster statRow 문법 */}
          <View style={styles.statRow}>
            {cells.map((c, i) => (
              <View key={c.label + i} style={[styles.statCell, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: LINE }]}>
                <Text allowFontScaling={false} style={[styles.statVal, { fontSize: f.statVal, lineHeight: f.statVal * 1.12, includeFontPadding: false, color: WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{c.value}</Text>
                <Text allowFontScaling={false} style={[styles.statLab, { fontSize: f.statLab, lineHeight: f.statLab * 1.15, includeFontPadding: false, color: DIM }]} numberOfLines={1}>{c.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // 하단 정보 패널 — top 74.5%~bottom 6.1% ⇒ 컨테이너 높이 19.4%h(아웃라인 74.0~94.4%의 0.5% 인셋). justifyContent:'center'라
  // 콘텐츠 총높이가 19.4%를 넘으면 위·아래로 균등 넘침 → 하단 네온 패널 밖으로 샌다(넘침 3연전 교훈, §DL-9 세로 예산).
  // ── 세로 예산 산식(%h; 폭 파생 폰트 s → %h=s×lh×75 ∵ w/h=3/4, px p → 75p/428, 패널폭 % 마진 m → 0.6225m) ──
  //   headRow  = max(nameCol, ovrChip 6.23, emblem 5.2);  nameCol = kicker(.028×1.15)·name(.060×1.12)+name mt 2px
  //   posEnRow = posEnRow_mt(2.0%) + posEn(.024×1.15);   statRow = statRow_mt(1.8%) + statVal(.034×1.12)+statLab(.021×1.15)+statLab mt 1px
  //   · nameCol   = 2.415 + 0.351 + 5.04                       = 7.81%h
  //   · ovrChip   = padV2(×2)0.70 + border1.5(×2)0.53 + tag(.020×1.15)1.73 + num(.044×1.1)3.63 + tag mb −2px(−0.35) = 6.23%h
  //   · headRow   = max(7.81, 6.23, 5.2)                       = 7.81%h
  //   · posEnRow  = 1.245(mt 2.0%) + 2.070(posEn)              = 3.32%h
  //   · statRow   = 1.121(mt 1.8%) + 2.856(statVal) + 0.175(statLab mt 1px) + 1.811(statLab) = 5.96%h
  //   ⇒ 콘텐츠 총높이 = 7.81 + 3.32 + 5.96 = 17.08%h ≤ 예산(19.4 − 안전 0.5 = 18.9%h), 여유 1.82%h.
  //   가드 tools/_dv_draft_poster.ts '패널 세로 예산' 검사가 이 산식을 미러링(값 동기).
  panel: { position: 'absolute', top: '74.5%', bottom: '6.1%', left: '8.5%', right: '8.5%', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emblem: { resizeMode: 'contain' },
  nameCol: { flex: 1, minWidth: 0 },
  kicker: { fontWeight: '800', letterSpacing: 1.5, opacity: 0.95 },
  name: { fontWeight: '900', letterSpacing: 1, marginTop: 2, textShadowColor: 'rgba(10,20,50,0.55)', textShadowRadius: 6 },
  ovrChip: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(10,22,55,0.5)' },
  ovrTag: { fontWeight: '800', letterSpacing: 1.5, marginBottom: -2 },
  ovrNum: { fontWeight: '900' },

  posEn: { fontWeight: '700', letterSpacing: 1.5, marginTop: '2.0%' },
  statRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: '1.8%' },
  statCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statVal: { fontWeight: '900' },
  statLab: { fontWeight: '700', marginTop: 1 },
});
