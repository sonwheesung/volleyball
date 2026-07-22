// 내 팀 드래프트 지명 포스터 (UI_RULES DL-9, 2026-07-22 사용자 시안). 순수 표시 —
// 엔진·store 무의존, 결정론 무관. AwardPoster(AWARDS_SYSTEM §8)의 규약을 공유하되 **드래프트 전용 자산·좌표**를 쓴다:
//   3:4 · 폭 min(win.width-32,460) · 폭 파생 폰트 · allowFontScaling=false · lineHeight 명시+includeFontPadding:false ·
//   배경 위 픽셀 고정색(앱 테마 무관) · 세로 예산 산식으로 넘침 봉인(넘침 3연전 교훈).
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

// 배경(딥 네이비 이미지) 위 고정 색 — 앱 테마 무관(이미지가 항상 어둡다).
// 이름·수치는 순백, 키커/포지션/등급은 **옅은 블루-화이트 dim**(bright #FFFFFF는 이름과 충돌하므로 회피, §DL-9 톤 규약).
const WHITE = '#FFFFFF';                       // 이름(큰 흰색)
const DIM = 'rgba(206,218,245,0.82)';          // 키커·포지션(옅은 블루-화이트)
const BRIGHT = '#CFE0FF';                       // 등급 라벨(선명한 블루-화이트, 이름보다 낮은 위계)
const LINE = 'rgba(150,180,235,0.34)';         // 등급 칩 테두리

export interface DraftPosterProps {
  template: ImageSourcePropType;   // require(...) 배경 자산(draft_stage)
  kicker: string;                  // "{시즌연도} 신인 드래프트 · {round}R {전체순번}순번"
  name: string;                    // 지명 선수명(큰 흰색)
  posKo: string;                   // 포지션 한글(예 "세터")
  posEn: string;                   // 포지션 영문(예 "SETTER")
  grade: string;                   // 직관 등급 라벨(prospectGradeLabel(p,1) — 입단 확정이라 풀공개)
  emblem?: ImageSourcePropType;    // 구단 엠블럼 배지(좌측)
  width?: number;                  // 렌더 폭(기본 = 화면폭−32, Screen 패딩)
}

/** 3:4 배경(딥 네이비) 위, 하단 패널에 엠블럼·키커·이름·포지션·등급을 퍼센트 절대 배치. 세로 = 폭×4/3. */
export function DraftPoster({ template, kicker, name, posKo, posEn, grade, emblem, width }: DraftPosterProps) {
  const win = useWindowDimensions();
  const w = width ?? Math.min(win.width - 32, 460); // 태블릿 과대 방지 상한
  const h = w * (4 / 3);
  // 폭 파생 폰트 — 좁은 기기에서도 비율 유지(AwardPoster와 동일 방법론)
  const f = {
    kicker: w * 0.028,   // 키커(긴 문구) — numberOfLines 1 + adjustsFontSizeToFit
    name: w * 0.060,     // 이름(큰 흰색; AwardPoster name 0.056보다 살짝 큼 — 드래프트는 5칸 스탯이 없어 여백 여유)
    posText: w * 0.026,  // 포지션 한글·영문
    grade: w * 0.024,    // 등급 라벨 칩
  };

  return (
    <View style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden' }}>
      <ImageBackground source={template} style={{ width: w, height: h }} resizeMode="cover">
        {/* ── 상단 오버레이 없음(배경 "DRAFT DAY" 타이틀 9.03%가 타이틀 역할, §DL-9) ── */}

        {/* ── 하단: 정보 패널(엠블럼·키커·이름·포지션·등급) ── */}
        <View style={styles.panel}>
          {/* 상단행: [엠블럼] [키커/이름] */}
          <View style={styles.headRow}>
            {emblem ? <Image source={emblem} style={[styles.emblem, { width: h * 0.052, height: h * 0.052 }]} /> : null}
            <View style={styles.nameCol}>
              <Text allowFontScaling={false} style={[styles.kicker, { fontSize: f.kicker, lineHeight: f.kicker * 1.15, includeFontPadding: false, color: DIM }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{kicker}</Text>
              <Text allowFontScaling={false} style={[styles.name, { fontSize: f.name, lineHeight: f.name * 1.12, includeFontPadding: false, color: WHITE }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{name}</Text>
            </View>
          </View>

          {/* 하단행: 포지션 한글·영문 + 등급 칩 */}
          <View style={styles.posRow}>
            <Text allowFontScaling={false} style={[styles.posText, { fontSize: f.posText, lineHeight: f.posText * 1.15, includeFontPadding: false, color: DIM }]} numberOfLines={1}>{posKo} · {posEn}</Text>
            <View style={[styles.gradeChip, { borderColor: LINE }]}>
              <Text allowFontScaling={false} style={[styles.gradeText, { fontSize: f.grade, lineHeight: f.grade * 1.1, includeFontPadding: false, color: BRIGHT }]} numberOfLines={1}>{grade}</Text>
            </View>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // 하단 정보 패널 — top 74.5%~bottom 6.1% ⇒ 컨테이너 높이 19.4%h(아웃라인 74.0~94.4%의 0.5% 인셋). justifyContent:'center'라
  // 콘텐츠 총높이가 19.4%를 넘으면 위·아래로 균등 넘침 → 하단 네온 패널 밖으로 샌다(넘침 3연전 교훈, §DL-9 세로 예산).
  // ── 세로 예산 산식(%h; 폭 파생 폰트 s → %h=s×75 ∵ w/h=3/4, px p → 75p/428, 패널폭 % 마진 m → 0.6225m) ──
  //   headRow = max(nameCol, emblem 5.2);  nameCol = kicker(.028×1.15)·name(.060×1.12)+name mt 2px
  //   posRow  = posRow_mt(2.2%) + max(posText(.026×1.15), gradeChip)
  //     gradeChip = padV 3px(×2) + border 1px(×2) + gradeText(.024×1.1)
  //   · nameCol   = 2.415 + 0.35 + 5.04                 = 7.81%h
  //   · headRow   = max(7.81, 5.2)                      = 7.81%h
  //   · gradeChip = 1.051(padV6) + 0.351(border2) + 1.98(text) = 3.38%h
  //   · posRow    = 1.370(mt 2.2%) + max(2.243, 3.38)   = 4.75%h
  //   ⇒ 콘텐츠 총높이 = 7.81 + 4.75 = 12.56%h ≤ 예산(19.4 − 안전 0.5 = 18.9%h), 여유 6.34%h.
  //   가드 tools/_dv_draft_poster.ts '패널 세로 예산' 검사가 이 산식을 미러링(값 동기).
  panel: { position: 'absolute', top: '74.5%', bottom: '6.1%', left: '8.5%', right: '8.5%', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emblem: { resizeMode: 'contain' },
  nameCol: { flex: 1, minWidth: 0 },
  kicker: { fontWeight: '800', letterSpacing: 1.5, opacity: 0.95 },
  name: { fontWeight: '900', letterSpacing: 1, marginTop: 2, textShadowColor: 'rgba(10,20,50,0.55)', textShadowRadius: 6 },

  posRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: '2.2%' },
  posText: { fontWeight: '700', letterSpacing: 1.5, flexShrink: 1 },
  gradeChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(10,22,55,0.5)' },
  gradeText: { fontWeight: '800', letterSpacing: 1 },
});
