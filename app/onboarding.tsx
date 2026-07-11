import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { theme, themeAssets, themedStyles } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
interface Slide { icon: IoniconName; tint: string; title: string; body: string; bullets?: { k: string; v: string }[] }

// 관전형(1순위) + 구단주 역할(직접 결정/건의/관전) + 누적 서사를 첫 사용자에게 안내.
const SLIDES: Slide[] = [
  {
    icon: 'tv-outline', tint: theme.accent,
    title: '보는 게임, 배구명가',
    body: '당신은 가상 V리그 구단을 수십 시즌 운영하는 구단주입니다. 평소 경기는 감독과 엔진이 자동으로 굴리고, 당신은 내 팀 경기와 시즌의 이야기를 관전합니다.',
    bullets: [
      { k: '자동 진행', v: '매 순간 손이 가지 않게 — 푸시 알림도 없습니다' },
      { k: '관전이 핵심', v: '중요 경기를 직접 보며 흐름을 즐깁니다' },
      { k: '결과는 실력', v: '경기는 선수 전력·라인업으로 정해져요. 영입·훈련·선발로 다음 경기를 준비하세요' },
    ],
  },
  {
    icon: 'briefcase-outline', tint: theme.elite,
    title: '당신의 역할 — 구단주',
    body: '현장 지휘는 감독 고유 권한입니다. 구단주는 프런트에서 큰 결정을 내리고, 현장에는 건의합니다.',
    bullets: [
      { k: '직접 결정', v: '재계약·방출·드래프트·FA·용병·스태프·재정·훈련 방향' },
      { k: '건의', v: '선발 기용 — 감독이 성향대로 수락/거절' },
      { k: '관전만', v: '타임아웃·교체 등 경기 중 운영은 감독이' },
    ],
  },
  {
    icon: 'trophy-outline', tint: theme.warn,
    title: '세월이 이야기가 된다',
    body: '선수는 성장하고, 나이 들면 기량이 하락하고, 언젠가 은퇴합니다. 통산 기록은 명예의전당에 남고, 우승·시상·기록 경신이 구단의 역사가 됩니다.',
    bullets: [
      { k: '장기 서사', v: '100년+ 운영, 세대교체로 이어지는 기록' },
      { k: '조급함 없이', v: '앱을 볼 때만 시즌이 흐릅니다 — 천천히' },
    ],
  },
  {
    icon: 'flag-outline', tint: theme.good,
    title: '이제 구단을 고르세요',
    body: '구단마다 역사와 색깔이 다릅니다 — 명문, 신흥 강호, 만년 약체, 신생팀까지. 선택한 구단의 선수단이 그 정체성에 맞춰 짜여 있습니다.',
  },
];

export default function Onboarding() {
  const router = useRouter();
  const completeOnboarding = useGameStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  const finish = () => { completeOnboarding(); router.replace('/select-team'); };

  // 안드로이드 하드웨어 백: 중간 단계에선 앱 종료가 아니라 이전 슬라이드로(step 0은 기본 동작 유지). 제스처백은 _layout에서 이미 비활성.
  useEffect(() => {
    const onBack = () => {
      if (step > 0) { setStep((s) => s - 1); return true; }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [step]);

  return (
    <ImageBackground source={themeAssets.bg} style={styles.bgRoot} resizeMode="cover">
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: themeAssets.scrim }]} />
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={finish} hitSlop={10}>
          <Text style={styles.skip}>건너뛰기</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: slide.tint + '1A' }]}>
          <Ionicons name={slide.icon} size={56} color={slide.tint} />
        </View>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.desc}>{slide.body}</Text>
        {slide.bullets ? (
          <View style={styles.bullets}>
            {slide.bullets.map((b) => (
              <View key={b.k} style={styles.bulletRow}>
                <View style={[styles.bulletDot, { backgroundColor: slide.tint }]} />
                <Text style={styles.bulletText}>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>{b.k}</Text>
                  {'  '}{b.v}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === step ? { backgroundColor: theme.accent, width: 20 } : null]} />
          ))}
        </View>
        <Pressable
          onPress={() => (last ? finish() : setStep((s) => s + 1))}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>{last ? '구단 고르러 가기' : '다음'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
    </ImageBackground>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bgRoot: { flex: 1, backgroundColor: theme.bg },
  root: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: 24 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8, minHeight: 32 },
  skip: { color: theme.muted, fontSize: 14, fontWeight: '700' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  iconWrap: { width: 112, height: 112, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 26, fontWeight: '900', textAlign: 'center' },
  desc: { color: theme.muted, fontSize: 15, lineHeight: 23, textAlign: 'center', paddingHorizontal: 4 },
  bullets: { gap: 10, alignSelf: 'stretch', marginTop: 6, backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  bulletText: { flex: 1, color: theme.muted, fontSize: 13.5, lineHeight: 20 },
  footer: { paddingBottom: 16, gap: 18 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.border },
  cta: {
    backgroundColor: theme.accentGlass, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    borderWidth: 1.5, borderColor: theme.accent,
    shadowColor: theme.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
  },
  ctaText: { color: theme.accent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
}));
