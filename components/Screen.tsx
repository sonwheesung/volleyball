import type { ComponentProps, ReactNode } from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, Easing, ImageBackground, InteractionManager, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { HeaderShownContext } from '@react-navigation/elements';
import { displayOvr, fogStat } from '../engine/overall';
import { POS_COLOR, POS_LABEL } from './posTokens';
import { ScrollCtrlCtx, SPOTLIGHT_SCROLL_MARGIN } from './spotlightCtx';
import type { SpotlightScrollController } from './spotlightCtx';

/** 감독 성향 한글 라벨 — 여러 화면 공유 */
export const STYLE_LABEL = { attack: '공격 중심', defense: '수비 중심', balanced: '밸런스형' } as const;

// 디자인 시스템 색·테마는 components/theme.ts(다크/라이트 토글, 2026-07-01). 여기선 재수출(기존 import 경로 유지)
// + 렌더 시 스타일(themedStyles)·모드별 배경/스크림(themeAssets)만 사용.
import { theme, themeAssets, themedStyles, useThemeMode, setThemeMode } from './theme';
export { theme, themeAssets, themedStyles, useThemedStyles, useThemeMode, setThemeMode } from './theme';
export type { ThemeMode } from './theme';

interface ScreenProps {
  title?: string;
  children?: ReactNode;
  scroll?: boolean;
  headerRight?: ReactNode; // 제목 행 우측 액션(예: 뉴스 "모두 읽기"). 없으면 미표시 — 무파급 옵션.
  overlay?: ReactNode;     // 뷰포트 고정 오버레이 슬롯(ScrollView 밖) — 하단 토스트 등. 없으면 미표시 — 무파급 옵션.
  keyboard?: boolean;      // 텍스트 입력 화면(문의·쿠폰 등) — KeyboardAvoidingView로 입력창이 키보드에 가리지 않게(UI-38). 기본 false — 입력 없는 화면 무영향.
}

/** 기본 화면 래퍼 — SafeArea를 한 곳에서 중앙 관리(상단 상태바·하단 홈인디케이터·좌우 라운드/노치).
 *  top edge 조건부(2026-07-12 테스터 재보고 — 헤더 아래 빈 band):
 *  ~~SafeAreaView가 헤더-인지적이라 top이 0에 수렴~~(2026-07-08 가정)은 **틀렸다** — 네이티브 위치감지가
 *  이 구성에선 안 먹어, 헤더가 이미 소비한 상태바 인셋을 SafeAreaView가 헤더 아래에 **한 번 더** 넣어
 *  ~28dp 고정 빈 band(경기장 배경이 비침)가 생겼다(스크롤해도 남음 = 스크롤 패딩 아님). →
 *  **HeaderShownContext로 명시 처리**: 헤더 있는 화면(전 Tabs/대부분 Stack)은 top 엣지를 빼고(헤더가 상태바 담당),
 *  headerShown:false 세리머니(enshrine·season-opening·champion)만 top 유지(제목이 상태바 밑으로 내려오게).
 *  ⚠ `useSafeAreaInsets().top`(raw) 직접 패딩 금지 — 헤더 화면에서 이중 패딩. 반드시 이 conditional edges 경유. */
export function Screen({ title, children, scroll = true, headerRight, overlay, keyboard = false }: ScreenProps) {
  useThemeMode(); // 테마 토글 시 리렌더(배경·스크림 갱신)
  // 헤더 유무를 컨텍스트로 판정 — 헤더 있으면(=true) 상태바를 헤더가 이미 먹었으니 top 엣지 제외(이중 여백 방지).
  const headerShown = useContext(HeaderShownContext);
  const edges: Edge[] = headerShown ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right'];
  // 튜토리얼 스포트라이트 대상이 화면 밖이면 이 화면의 ScrollView가 대상을 위로 끌어온다.
  // 오프셋은 "콘텐츠 최상단 센티넬 View"와 대상을 각각 measureInWindow로 재 계산(Fabric 안전 — measureLayout 회피).
  const scrollRef = useRef<ScrollView>(null);
  const topRef = useRef<View>(null);
  const ctrlRef = useRef<SpotlightScrollController>({
    scrollToWindowY: (targetWindowY) => {
      const sv = scrollRef.current, top = topRef.current;
      if (!sv || !top) return;
      top.measureInWindow((_x: number, topY: number) => {
        // 대상의 콘텐츠 오프셋 = (대상 창Y − 센티넬 창Y). 여백만큼 위로 여유.
        sv.scrollTo({ y: Math.max(0, targetWindowY - topY - SPOTLIGHT_SCROLL_MARGIN), animated: true });
      });
    },
  });
  const inner = (
    <>
      {title ? (
        headerRight ? (
          <View style={styles.titleRow}>
            <Text style={[styles.title, { flex: 1 }]}>{title}</Text>
            {headerRight}
          </View>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )
      ) : null}
      {children}
    </>
  );
  const body = scroll ? (
    <ScrollCtrlCtx.Provider value={ctrlRef.current}>
      <ScrollView
        ref={scrollRef}
        style={styles.safe}
        contentContainerStyle={styles.contentScroll}
        keyboardShouldPersistTaps={keyboard ? 'handled' : undefined} // 키보드 떠 있을 때 버튼 첫 탭이 먹히게(입력 화면만)
      >
        <View ref={topRef} collapsable={false} style={styles.scrollTop} />
        {inner}
      </ScrollView>
    </ScrollCtrlCtx.Provider>
  ) : (
    <View style={[styles.safe, styles.content]}>{inner}</View>
  );
  return (
    <ImageBackground source={themeAssets.bg} style={styles.bgRoot} resizeMode="cover">
      {/* 가독성 스크림 — 모드별 톤(다크=검정 베일 / 라이트=밝은 베일)으로 배경 위 카드·텍스트 가독 */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: themeAssets.scrim }]} />
      <SafeAreaView style={styles.safe} edges={edges}>
        {keyboard ? (
          // 입력 화면 전용(UI-38): iOS는 padding으로 입력창을 키보드 위로 밀어 올린다. Android는 앱 기본
          // softInputMode=resize라 창이 줄며 ScrollView가 알아서 스크롤 → behavior 불필요(undefined).
          <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {body}
          </KeyboardAvoidingView>
        ) : body}
        {overlay}
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

/** 로딩 화면 최소 표시 시간(ms) — 튜닝 가능(사용자가 실시간으로 조절).
 *  0 = 즉시/구 동작(캐시-웜 화면은 1프레임 깜빡임), ~800ms = 편안(의도적 로딩으로 읽힘),
 *  1500~2000 = 묵직한 연출. useDeferredReady(SCREEN_LOADING_MIN_MS)로 넘겨 쓴다. */
export const SCREEN_LOADING_MIN_MS = 800;

/** 무거운 동기 생성/재계산 화면용 — 첫 프레임에 로딩을 그리고 다음 인터랙션 틱에 본문을 마운트해
 *  "탭했는데 화면이 멈춘" 체감을 없앤다(team/[id] 패턴 일반화). 동기 계산이라 "빠르면 안 보이게"가
 *  불가하므로 즉시 뜨는 가벼운 화면엔 쓰지 말 것(불필요한 깜빡임). 반환값 false 동안 <Loading/>을 렌더.
 *  minMs를 주면 인터랙션 완료 + 최소 minMs 경과 **둘 다** 충족해야 true — 캐시-웜 화면이 1프레임
 *  깜빡이고 사라지는 걸 막아 로딩이 "의도적"으로 읽힌다(minMs=0이면 기존 동작 그대로). */
export function useDeferredReady(minMs = 0): boolean {
  const [interactionsDone, setInteractionsDone] = useState(false);
  const [minElapsed, setMinElapsed] = useState(minMs <= 0);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setInteractionsDone(true));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (minMs > 0) timer = setTimeout(() => setMinElapsed(true), minMs);
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [minMs]);
  return interactionsDone && minElapsed;
}

// accent: 좌측 컬러 바(카테고리 구분, UI-12). borderLeftWidth를 키워 라운드 코너 자동 준수(overflow 불필요).
// flat: 정보(읽기용) 패널 — 그림자·좌측 컬러바 없이 납작하게. 탭 카드(입체+화살표)와 시각 구분(UI-13, 2026-07-01).
//   accent를 줘도 flat이면 좌측 바 대신 얇은 상단 헤어라인만(색은 유지하되 "버튼 아님" 신호).
export function Card({ children, onPress, accent, flat }: { children: ReactNode; onPress?: () => void; accent?: string; flat?: boolean }) {
  if (flat) {
    // 정보 패널: 상하좌우 전체 보더를 accent 색으로(입체감 없이 색 테두리로 카테고리 표시). 탭 카드와 구분 유지.
    const borderAccent = accent ? { borderColor: accent + '99', borderWidth: 1.5 } : null;
    return <View style={[styles.cardFlat, borderAccent]}>{children}</View>;
  }
  const accentStyle = accent ? { borderLeftWidth: 2.8, borderLeftColor: accent } : null;
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
// help: 주면 라벨 오른쪽에 작은 [?] 아이콘 → 탭 시 콜백(도움말 팝업 등). 없으면 미표시 — 무파급 옵션.
export function IconLabel({ icon, color, children, help }: { icon: ComponentProps<typeof Ionicons>['name']; color: string; children: ReactNode; help?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: color + '26', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.muted}>{children}</Text>
      {help ? (
        <Pressable onPress={help} hitSlop={{ top: 10, bottom: 10, left: 8, right: 10 }} style={{ marginLeft: 1 }}>
          <Ionicons name="help-circle-outline" size={17} color={theme.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 공용 Button 내비게이션 래치 시간(ms, UI-33) — onPress 발화 후 이 시간 내 재발화는 무시(연타 이중 화면 방지). */
export const BUTTON_LATCH_MS = 600;

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  compact,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  /** compact: 높이 ~10%↓(paddingVertical 15→13.5) + primary는 배경 살짝 더 밝게(클릭 가능 강조).
   *  일정 화면 "다음 경기" CTA(이어보기/경기 시작) 전용 — 기본값 false라 다른 버튼엔 무영향. */
  compact?: boolean;
  /** small: 리스트 행 액션용 컴팩트 사이즈(pad 8/14·radius 10·minWidth 0·14pt). transactions/tryout 영입버튼과 동일 규격.
   *  스태프 시장(감독/코치/스카우터) 영입·방출처럼 카드 우측 인라인 액션에 쓴다(2026-07-11 규격 통일). */
  small?: boolean;
}) {
  // 내비게이션 래치(UI-33) — 연타로 화면이 이중 push 되거나 액션이 두 번 발화되는 것을 막는다.
  //   state는 비동기라 같은 프레임의 두 번째 탭이 stale 값을 보므로 **동기 ref**만이 확실히 차단(UI-31과 같은 원리).
  //   광고 래치(UI-31)와 달리 일반 규칙 — onPress 발화 후 LATCH_MS 내 재발화 무시. 시간 경과로 자동 해제(영구 잠금 없음).
  const lockRef = useRef(0);
  const guardedPress = () => {
    const now = Date.now();
    if (now - lockRef.current < BUTTON_LATCH_MS) return;
    lockRef.current = now;
    onPress();
  };
  return (
    <Pressable
      onPress={guardedPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? styles.btnPrimary : styles.btnGhost,
        small && styles.btnSmall, // 리스트 액션 규격(pad 8/14·radius 10·minWidth 0)
        compact && { paddingVertical: 13.5 },
        compact && variant === 'primary' && { backgroundColor: theme.accent + '38' }, // accentGlass(0.16)보다 밝은 ~0.22 틴트
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.btnText, small && styles.btnTextSmall]}>{label}</Text>
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

/** 0~100 스탯 막대.
 *  potential: 주면 천장 틱 + "→NN"(내 팀 선수 — 성장 여지 표시). reveal<1: 스카우팅 안개(타 구단 — 흐리게/물음표). */
export function StatBar({ label, value, potential, reveal = 1 }: { label: string; value: number; potential?: number; reveal?: number }) {
  const fog = reveal < 1 ? fogStat(value, reveal) : null;
  const shown = fog ? fog.fill : value;
  // 성장 여지 없음(현재값이 포텐 천장 도달) → 빨강으로 표시(더 못 큼). "→NN" 화살표 텍스트는 제거하되(사용자 요청)
  // 포텐셜은 **바 위 천장 틱**으로 시각화(사용자 요청 2026-07-04 — 차트에 나오게). 안개 낀 타 구단은 제외.
  const maxed = potential != null && value >= potential && (!fog || fog.exact);
  const showPot = potential != null && !fog && potential > value; // 내 팀 + 성장 여지 있을 때만 천장 틱
  const color = maxed ? theme.bad
    : value >= 80 ? theme.good : value >= 65 ? theme.accent : value >= 50 ? theme.warn : theme.bad;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.barTrack}>
        {shown != null ? (
          <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, shown))}%`, backgroundColor: fog && !fog.exact ? theme.muted : color, opacity: fog && !fog.exact ? 0.55 : 1 }]} />
        ) : null}
        {showPot ? <View style={[styles.potMark, { left: `${Math.min(100, potential!)}%` }]} /> : null}
      </View>
      <Text style={[styles.statVal, maxed ? { color: theme.bad } : null]} numberOfLines={1}>
        {fog ? fog.text : value}
      </Text>
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

const styles = themedStyles(() => StyleSheet.create({
  bgRoot: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  scrim: { backgroundColor: 'rgba(236,241,247,0.72)' }, // [라이트] 밝은 베일 강화 — 산만한 사진을 부드러운 밝은 면으로
  content: { padding: 16, gap: 12 },
  contentScroll: { padding: 16, paddingBottom: 32, gap: 12 }, // 스크롤 하단 여유(실제 inset은 SafeAreaView가 처리)
  scrollTop: { position: 'absolute', top: 0, left: 0, width: 1, height: 1 }, // 스포트라이트 스크롤 오프셋 기준(레이아웃 무영향)
  // 제목↔첫 카드 사이 숨통(UI polish) — marginBottom 2→7로 앱 전역 여백 +5.
  title: { color: theme.text, fontSize: 24, fontWeight: '700', marginBottom: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  h2: { color: theme.text, fontSize: 16, fontWeight: '700' },
  // 카드: 더 단단한 14R + 상하 축소(13)·우측 여유(23, 숫자가 가장자리에 안 붙게) 비대칭 패딩(UI polish).
  card: {
    backgroundColor: theme.card, borderRadius: 14, paddingVertical: 13, paddingLeft: 15, paddingRight: 23, gap: 8,
    borderWidth: 1, borderColor: theme.border,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  // 정보(읽기용) 패널 — 입체감(그림자/elevation) 없이 납작. 탭 카드와 구분(UI-13). 배경은 theme.card라 다크/라이트 자동 반전.
  cardFlat: {
    backgroundColor: theme.card, borderRadius: 10, paddingVertical: 12, paddingLeft: 13, paddingRight: 20, gap: 8,
    borderWidth: 1, borderColor: theme.border,
  },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  loadingMsg: { color: theme.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  brandMark: { color: theme.text, fontSize: 26, fontWeight: '700', letterSpacing: 1 },
  // 스켈레톤 카드 — 실제 카드(card)와 같은 골격(둥근모서리·패딩·헤어라인)이되 그림자는 빼 가벼운 플레이스홀더로. card 반경/패딩 미러.
  skCard: { backgroundColor: theme.card, borderRadius: 14, paddingVertical: 13, paddingLeft: 15, paddingRight: 23, gap: 10, borderWidth: 1, borderColor: theme.border },
  // 글래스 버튼(2026-06-28 UI-7, 사용자 선택) — 카드와 같은 14R + 다크 글래스 결.
  // primary: 액센트 글래스(민트 틴트 반투명) + 민트 보더 1.5 + 민트 글씨 + 액센트 글로우 → 유리판처럼 얹힌 CTA.
  // ghost: 중립 다크 글래스(theme.card) + 은은한 헤어라인 → 보조 버튼(primary보다 차분).
  // paddingHorizontal 필수 — 인라인(Row 안) 버튼은 폭이 글자에 맞춰지므로, 없으면 "영입"처럼 짧은
  // 라벨이 세로로 길쭉한 캡슐이 된다. 전체폭 버튼(Card 안)은 stretch라 영향 없음.
  btn: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 22, minWidth: 76, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  // small: 리스트 행 인라인 액션(transactions/tryout 영입버튼과 동일 규격) — 카드 우측에 얹는 작은 액션
  btnSmall: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, minWidth: 0 },
  btnTextSmall: { fontSize: 14 },
  btnPrimary: {
    backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent,
    // iOS 액센트 글로우만(elevation 제거 — Android는 반투명 배경 위 elevation이 사각 그림자 아티팩트를 만든다. 2026-06-28)
    shadowColor: theme.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
  },
  btnGhost: { backgroundColor: theme.card, borderColor: theme.border },
  btnText: { color: theme.accent, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  ovr: { alignItems: 'center', justifyContent: 'center' },
  // includeFontPadding:false + textAlign center → 안드로이드 폰트 상하 패딩 제거로 원 안 숫자 완전 중앙정렬(UI polish).
  ovrText: { fontWeight: '700', textAlign: 'center', includeFontPadding: false },
  // 약어 배지 — minWidth로 1글자(S·L)와 2글자(OH·OP·MB)가 같은 폭으로 정렬(들쭉날쭉 제거)
  pos: { minWidth: 34, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  posText: { fontSize: 12, fontWeight: '700' },
  posFull: { minWidth: 0, paddingHorizontal: 10 }, // 풀라벨(세터·아웃사이드…)은 가변 폭
  posCompact: { width: 28, paddingVertical: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center' }, // 박스스코어 열 정렬용 고정폭
  posTextCompact: { fontSize: 9.5, fontWeight: '700' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { color: theme.muted, fontSize: 13, width: 64 },
  statVal: { color: theme.text, fontSize: 13, fontWeight: '700', width: 28, textAlign: 'right' }, // 58→28(2026-07-12): 최대 텍스트 "~100"(~26dp)만 담으면 됨 — 넓은 폭(58)이 우측정렬 빈공간으로 바-숫자 간 큰 여백 유발(테스터). 좁은 종합스탯 컬럼에서 특히 도드라짐
  potTxt: { color: theme.good, fontSize: 12, fontWeight: '700' },
  barTrack: { flex: 1, height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  potMark: { position: 'absolute', top: 0, width: 3, height: 8, marginLeft: -1.5, borderRadius: 1, backgroundColor: theme.good }, // 포텐 천장 틱(성장 여지 상한) — 밝은 green
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  emptyStateText: { color: theme.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
}));
