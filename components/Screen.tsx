import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, Easing, ImageBackground, InteractionManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { displayOvr } from '../engine/overall';
import { POS_COLOR, POS_LABEL } from './posTokens';

/** 감독 성향 한글 라벨 — 여러 화면 공유 */
export const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

// 시네마틱 글래스 디자인 시스템 — 2026-06-27 다크 글래스 전환(구 KOVO 라이트 테마 폐기, UI-7).
// 키는 그대로 유지하고 값만 다크화 → 전 화면 자동 재스킨.
// 카드는 **다크 반투명**(2026-06-28 교정): 흰색 0.06 반투명은 뒤 코트/네트가 비쳐 내용 집중이
// 어렵다는 사용자 보고 → 어두운 틴트(0.82~0.85)로 배경을 가려 또렷하게. 은은한 투과+헤어라인+그림자로
// 글래스 질감은 유지. cardAlt는 카드 위/배경 위 모두에서 보이도록 카드보다 한 톤 밝은 다크.
export const theme = {
  bg: '#0B1018',                      // 다크 베이스(배경 이미지 뒤·헤더)
  card: 'rgba(16,22,34,0.86)',        // 프로스티드 다크 글래스 카드(배경 차폐 — 가독성)
  cardAlt: 'rgba(40,50,68,0.92)',     // 트랙·세그먼트·칩·스켈레톤(카드보다 한 톤 밝게)
  text: '#F2F5FA',                    // 밝은 잉크
  muted: '#9AA7BC',                   // 보조 텍스트
  accent: '#19C2AE',                  // 틸 민트(프라이머리) — 다크에서 또렷
  good: '#2BD17E',                    // 승/긍정
  warn: '#F2A93B',                    // 주의
  bad: '#FF6B5A',                     // 코랄(패/위험·외국인)
  elite: '#5B9BFF',                   // OVR 88+ 엘리트(블루칩)
  border: 'rgba(255,255,255,0.14)',   // 글래스 헤어라인(다크 카드 위 엣지 하이라이트)
  accentGlass: 'rgba(25,194,174,0.16)', // 액센트 글래스 — primary 버튼(accent #19C2AE=rgb 25,194,174의 16% 틴트)
  gold: '#E8C46A',                    // 절제된 골드(우승·트로피·로고 한정)
  // 카테고리 장식 색(UI-12) — 의미 없음, 메뉴/카드를 색으로 구분해 다크 단조로움 해소. 다크 위에서 또렷한 채도.
  violet: '#9B7BFF',                  // 보라
  sky: '#46C8FF',                     // 하늘/시안
  rose: '#FF7BA6',                    // 로즈/핑크
};

// 전역 배경 — 다크 아레나(GPT 생성). Screen 래퍼가 모든 화면에 깐다. select-team도 동일 파일 사용.
const BG = require('../assets/bg/court.png');

interface ScreenProps {
  title?: string;
  children?: ReactNode;
  scroll?: boolean;
}

/** 기본 화면 래퍼 — SafeArea를 한 곳에서 중앙 관리(하단 홈인디케이터·좌우 라운드/노치).
 *  상단은 네비게이션 헤더가 담당(전 Stack/Tabs 화면이 헤더 보유)하므로 top edge는 제외 —
 *  헤더 있는 화면에 top inset을 또 주면 이중 여백이 된다. */
export function Screen({ title, children, scroll = true }: ScreenProps) {
  const inner = (
    <>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </>
  );
  return (
    <ImageBackground source={BG} style={styles.bgRoot} resizeMode="cover">
      {/* 가독성 스크림 — 다크 톤으로 깔아 글래스 카드/텍스트가 스포트라이트 위에서도 읽히게(콘텐츠 화면은 다소 강하게) */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim]} />
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        {scroll ? (
          <ScrollView style={styles.safe} contentContainerStyle={styles.contentScroll}>
            {inner}
          </ScrollView>
        ) : (
          <View style={[styles.safe, styles.content]}>{inner}</View>
        )}
      </SafeAreaView>
    </ImageBackground>
  );
}

/** 골격 시머 블록 — 곧 올 콘텐츠 자리를 잡는 플레이스홀더(Animated opacity 루프, useNativeDriver — Expo Go 안전).
 *  단일 소스: 모든 스켈레톤은 이 프리미티브로 조립한다(UI-6). */
export function Skeleton({ w = '100%', h, r = 8, style }: { w?: number | string; h: number; r?: number; style?: object }) {
  const a = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.45, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={[{ width: w as number, height: h, borderRadius: r, backgroundColor: theme.cardAlt, opacity: a }, style]} />;
}

/** 콘텐츠 화면(리스트/카드)용 스켈레톤 — 카드 골격 5줄로 곧 올 내용을 예고(맨 스피너보다 체감 대기↓, UI-6). */
function SkeletonList() {
  return (
    <View style={{ gap: 12 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Skeleton w={44} h={44} r={22} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton w={'58%'} h={13} />
              <Skeleton w={'38%'} h={10} />
            </View>
            <Skeleton w={38} h={20} r={6} />
          </View>
          <Skeleton w={'100%'} h={9} r={5} />
        </View>
      ))}
    </View>
  );
}

const AnimView = Animated.View;

/** 브랜드 연출 로더 — 워드마크 "배구명가" + 원형 스피너(회전 링). 콘텐츠 모양이 아직 없는 긴 대기
 *  (앱 복원·무거운 재계산)용. 관전형 1순위 — 첫 인상/대기도 "보는 경험"(UI-6).
 *  ⚠ 단순 원형 스피너로 채택(2026-06-30 사용자 요청 "그냥 원으로 도는 로딩"): 직전 "여러 공 서브연습" 안은
 *    endSeason 무거운 동기 블록 중 네이티브 애니가 멈춰(에뮬 실측) 공이 바닥에 뚝 떨어진 채 정지 → 보기 안 좋음.
 *    회전 링은 블록 중 멈춰도 그냥 멈춘 동그라미라 거슬리지 않는다(블록 내내 돌게 하려면 endSeason 청크화 필요 — 미결). */
function BrandLoading({ message }: { message?: string }) {
  const SIZE = 64, STROKE = 5, R = (SIZE - STROKE) / 2, C = 2 * Math.PI * R;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
      <AnimView style={{ width: SIZE, height: SIZE, transform: [{ rotate }] }}>
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={theme.border} strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={theme.accent} strokeWidth={STROKE} fill="none"
            strokeLinecap="round" strokeDasharray={`${C * 0.3} ${C * 0.7}`}
          />
        </Svg>
      </AnimView>
      <Text style={styles.brandMark}>배구명가</Text>
      {message ? <Text style={styles.loadingMsg}>{message}</Text> : null}
    </View>
  );
}

/** 전체 화면 로딩 표시(UI-6). variant: `list`=콘텐츠 화면 카드 스켈레톤 · `brand`=워드마크+코트 모션(긴 대기) ·
 *  `spinner`=기본 스피너(폴백). 로딩 게이트 로직(UI-1·UI-4)은 불변 — 표시만 맥락에 맞춘다. */
export function Loading({ title, message, variant = 'spinner' }: { title?: string; message?: string; variant?: 'spinner' | 'list' | 'brand' }) {
  if (variant === 'list') {
    return (
      <Screen title={title} scroll={false}>
        <SkeletonList />
      </Screen>
    );
  }
  return (
    <Screen title={title} scroll={false}>
      {variant === 'brand' ? (
        <BrandLoading message={message} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <ActivityIndicator size="large" color={theme.accent} />
          {message ? <Text style={styles.loadingMsg}>{message}</Text> : null}
        </View>
      )}
    </Screen>
  );
}

/** 무거운 동기 생성/재계산 화면용 — 첫 프레임에 로딩을 그리고 다음 인터랙션 틱에 본문을 마운트해
 *  "탭했는데 화면이 멈춘" 체감을 없앤다(team/[id] 패턴 일반화). 동기 계산이라 "빠르면 안 보이게"가
 *  불가하므로 즉시 뜨는 가벼운 화면엔 쓰지 말 것(불필요한 깜빡임). 반환값 false 동안 <Loading/>을 렌더. */
export function useDeferredReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);
  return ready;
}

// accent: 좌측 컬러 바(카테고리 구분, UI-12). borderLeftWidth를 키워 라운드 코너 자동 준수(overflow 불필요).
export function Card({ children, onPress, accent }: { children: ReactNode; onPress?: () => void; accent?: string }) {
  const accentStyle = accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null;
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, accentStyle, pressed && { opacity: 0.7 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, accentStyle]}>{children}</View>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}

// 카테고리 컬러 아이콘 칩 + 보조 라벨(UI-12) — 다크 단조로움 해소. 아이콘을 틴트 배경 칩에 담아 색 존재감↑.
// 화면마다 재구현 금지(UI-3), 여기 단일 소스.
export function IconLabel({ icon, color, children }: { icon: ComponentProps<typeof Ionicons>['name']; color: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: color + '26', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.muted}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? styles.btnPrimary : styles.btnGhost,
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.8 },
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

/** OVR 진행호 링 배지 (값에 따라 색·채움) — 스타일타일의 원형 레이팅 링 */
export function OvrBadge({ value, size = 46 }: { value: number; size?: number }) {
  // value는 raw OVR(overall/teamOverall) — 표시 스케일로 스트레치해 색·링·숫자에 일괄 반영.
  // 호출부는 항상 raw를 넘긴다(이중 변환 금지). 색 임계값은 스트레치된 값 기준이라 의미가 또렷.
  const v = displayOvr(value);
  // 프로 스케일(신입~70·평균80·90+ 독보적)에 맞춘 색 구간
  const color = v >= 88 ? theme.elite : v >= 80 ? theme.accent : v >= 74 ? theme.warn : theme.muted;
  const stroke = size >= 56 ? 5 : 4;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0.04, Math.min(1, v / 100));
  return (
    <View style={[styles.ovr, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.cardAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={[styles.ovrText, { color, fontSize: size >= 56 ? 19 : 15 }]}>{v}</Text>
    </View>
  );
}

/** 포지션 배지 — 전 화면 단일 컴포넌트(색·라벨은 posTokens 단일 소스).
 *  약어(S·OH…)는 **고정 너비**로 정렬(글자수 1·2 섞여도 들쭉날쭉 안 함).
 *  variant: 기본=소프트(반투명 배경·컬러 글씨) / `solid`=솔리드 배경·흰 글씨(테이블 등 조밀 표시).
 *  `compact`=작은 폰트·고정 28(박스스코어 열 정렬). `full`=한글 풀라벨(가변 폭). */
export function PosTag({ pos, full, solid, compact }: { pos: string; full?: boolean; solid?: boolean; compact?: boolean }) {
  const c = POS_COLOR[pos as keyof typeof POS_COLOR] ?? theme.muted;
  return (
    <View style={[
      compact ? styles.posCompact : styles.pos,
      full ? styles.posFull : null,
      // 기본/full = 아웃라인(다크 틴트 배경 + 컬러 보더 + 컬러 글씨, 라운드 8) — 사용자 요청(2026-06-28).
      // solid = 채움(흰 글씨, 테이블), compact = 기존 소프트(박스스코어 열 정렬 — 변경 안 함).
      solid ? { backgroundColor: c }
        : compact ? { backgroundColor: c + '33' }
        : { backgroundColor: c + '1A', borderWidth: 1.5, borderColor: c },
    ]}>
      <Text
        style={[compact ? styles.posTextCompact : styles.posText, { color: solid ? '#FFFFFF' : c }]}
        numberOfLines={1}
      >
        {full ? POS_LABEL[pos as keyof typeof POS_LABEL] ?? pos : pos}
      </Text>
    </View>
  );
}

/** 0~100 스탯 막대 */
export function StatBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? theme.good : value >= 65 ? theme.accent : value >= 50 ? theme.warn : theme.bad;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.rowBetween}>{children}</View>;
}

/** 빈 상태 — 데이터 없을 때 안내문을 **화면 가운데** 정렬(전체화면 빈 상태용).
 *  세로 중앙은 부모가 공간을 줘야 하므로 `<Screen scroll={false}>` 안에서 쓴다(flex:1로 남은 공간을 채워 중앙).
 *  섹션 단위 "없음"(다른 내용과 함께 뜨는)은 인라인 Card/Muted를 그대로 둔다. */
export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bgRoot: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  scrim: { backgroundColor: 'rgba(7,10,16,0.62)' },
  content: { padding: 16, gap: 12 },
  contentScroll: { padding: 16, paddingBottom: 32, gap: 12 }, // 스크롤 하단 여유(실제 inset은 SafeAreaView가 처리)
  title: { color: theme.text, fontSize: 24, fontWeight: '800', marginBottom: 2 },
  h2: { color: theme.text, fontSize: 16, fontWeight: '700' },
  card: {
    backgroundColor: theme.card, borderRadius: 18, padding: 16, gap: 8,
    borderWidth: 1, borderColor: theme.border,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  loadingMsg: { color: theme.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  brandMark: { color: theme.text, fontSize: 26, fontWeight: '900', letterSpacing: 1 },
  // 스켈레톤 카드 — 실제 카드(card)와 같은 골격(둥근모서리·패딩·헤어라인)이되 그림자는 빼 가벼운 플레이스홀더로
  skCard: { backgroundColor: theme.card, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: theme.border },
  // 글래스 버튼(2026-06-28 UI-7, 사용자 선택) — 카드와 같은 14R + 다크 글래스 결.
  // primary: 액센트 글래스(민트 틴트 반투명) + 민트 보더 1.5 + 민트 글씨 + 액센트 글로우 → 유리판처럼 얹힌 CTA.
  // ghost: 중립 다크 글래스(theme.card) + 은은한 헤어라인 → 보조 버튼(primary보다 차분).
  // paddingHorizontal 필수 — 인라인(Row 안) 버튼은 폭이 글자에 맞춰지므로, 없으면 "영입"처럼 짧은
  // 라벨이 세로로 길쭉한 캡슐이 된다. 전체폭 버튼(Card 안)은 stretch라 영향 없음.
  btn: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 22, minWidth: 76, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnPrimary: {
    backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent,
    // iOS 액센트 글로우만(elevation 제거 — Android는 반투명 배경 위 elevation이 사각 그림자 아티팩트를 만든다. 2026-06-28)
    shadowColor: theme.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
  },
  btnGhost: { backgroundColor: theme.card, borderColor: theme.border },
  btnText: { color: theme.accent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  ovr: { alignItems: 'center', justifyContent: 'center' },
  ovrText: { fontWeight: '900' },
  // 약어 배지 — minWidth로 1글자(S·L)와 2글자(OH·OP·MB)가 같은 폭으로 정렬(들쭉날쭉 제거)
  pos: { minWidth: 34, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  posText: { fontSize: 12, fontWeight: '800' },
  posFull: { minWidth: 0, paddingHorizontal: 10 }, // 풀라벨(세터·아웃사이드…)은 가변 폭
  posCompact: { width: 28, paddingVertical: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center' }, // 박스스코어 열 정렬용 고정폭
  posTextCompact: { fontSize: 9.5, fontWeight: '800' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { color: theme.muted, fontSize: 13, width: 64 },
  statVal: { color: theme.text, fontSize: 13, fontWeight: '700', width: 28, textAlign: 'right' },
  barTrack: { flex: 1, height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  emptyStateText: { color: theme.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
