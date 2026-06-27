import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { theme } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const ROSE = '#FF5C8D';      // 후원/응원 — 따뜻한 로즈
const ROSE_DK = '#E63E72';

const PERKS: { icon: IoniconName; title: string; sub: string }[] = [
  { icon: 'heart', title: '후원자 뱃지', sub: '대시보드·설정에 ♥ 후원자 표시 (영구)' },
  { icon: 'document-text', title: '크레딧 등재', sub: '"이 게임을 응원해주신 분들"에 함께' },
  { icon: 'sparkles', title: '개발 응원', sub: '한 사람이 만든 배구명가를 계속 가꾸는 힘' },
];

export default function Supporter() {
  const router = useRouter();
  const supporter = useGameStore((s) => s.supporter);
  const grantSupporter = useGameStore((s) => s.grantSupporter);

  // 하트 은은한 펄스
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.34] });

  // TODO(출시): 실제 IAP — react-native-iap/expo-in-app-purchases 결제 성공 콜백에서 grantSupporter() 호출.
  //  현재는 골격(미리보기). 비소모성이라 스토어가 중복 구매를 막는다.
  const onPurchase = () => grantSupporter();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.hero}>
        <Animated.View style={[styles.glowRing, { backgroundColor: ROSE, opacity: glow, transform: [{ scale }] }]} />
        <Animated.View style={[styles.heartCircle, { transform: [{ scale }] }]}>
          <Ionicons name="heart" size={52} color="#FFFFFF" />
        </Animated.View>
        <Text style={styles.title}>{supporter ? '함께해주셔서 고맙습니다' : '서포터 팩'}</Text>
        <Text style={styles.subtitle}>
          {supporter
            ? '당신의 응원이 이 긴 시즌을 계속 잇습니다 ♥'
            : '배구명가는 한 사람이 만듭니다.\n응원으로 다음 시즌을 함께 만들어요.'}
        </Text>
      </View>

      <View style={styles.card}>
        {PERKS.map((p, i) => (
          <View key={p.title} style={[styles.perk, i > 0 && styles.perkBorder]}>
            <View style={styles.perkIcon}><Ionicons name={p.icon} size={18} color={ROSE} /></View>
            <View style={{ flex: 1 }}>
              <View style={styles.perkHead}>
                <Text style={styles.perkTitle}>{p.title}</Text>
                {supporter ? <Ionicons name="checkmark-circle" size={16} color={ROSE} /> : null}
              </View>
              <Text style={styles.perkSub}>{p.sub}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }} />

      {supporter ? (
        <View style={styles.ownedBox}>
          <View style={styles.ownedBadge}><Ionicons name="heart" size={14} color="#FFFFFF" /><Text style={styles.ownedBadgeTxt}>후원자</Text></View>
          <Text style={styles.ownedTxt}>이미 서포터예요. 진심으로 감사합니다.</Text>
        </View>
      ) : (
        <>
          <Pressable onPress={onPurchase} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}>
            <Ionicons name="heart" size={18} color="#FFFFFF" />
            <Text style={styles.ctaTxt}>서포터 팩 응원하기</Text>
            <View style={styles.priceChip}><Text style={styles.priceTxt}>₩2,000</Text></View>
          </Pressable>
          <Text style={styles.note}>한 번만 구매하는 비소모성 아이템이에요 · 결제는 출시 시 스토어로 연결됩니다</Text>
        </>
      )}

      <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeBtn}>
        <Text style={styles.closeTxt}>{supporter ? '닫기' : '다음에 할게요'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 22, paddingTop: 8 },
  hero: { alignItems: 'center', paddingTop: 28, paddingBottom: 18, gap: 12 },
  glowRing: { position: 'absolute', top: 8, width: 132, height: 132, borderRadius: 66 },
  heartCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: ROSE, alignItems: 'center', justifyContent: 'center',
    shadowColor: ROSE_DK, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  title: { color: theme.text, fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 6 },
  subtitle: { color: theme.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  card: { backgroundColor: theme.card, borderRadius: 18, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 16, marginTop: 4 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15 },
  perkBorder: { borderTopWidth: 1, borderTopColor: theme.border },
  perkIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: ROSE + '1A', alignItems: 'center', justifyContent: 'center' },
  perkHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perkTitle: { color: theme.text, fontSize: 15, fontWeight: '800' },
  perkSub: { color: theme.muted, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: ROSE, borderRadius: 16, paddingVertical: 17,
    shadowColor: ROSE_DK, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  ctaTxt: { color: '#FFFFFF', fontSize: 16.5, fontWeight: '900' },
  priceChip: { backgroundColor: '#FFFFFF33', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 2 },
  priceTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  note: { color: theme.muted, fontSize: 11.5, textAlign: 'center', marginTop: 10, lineHeight: 16 },
  ownedBox: { alignItems: 'center', gap: 10, backgroundColor: ROSE + '12', borderRadius: 16, borderWidth: 1, borderColor: ROSE + '33', paddingVertical: 18 },
  ownedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ROSE, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  ownedBadgeTxt: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  ownedTxt: { color: theme.text, fontSize: 14, fontWeight: '700' },
  closeBtn: { alignSelf: 'center', paddingVertical: 16, marginTop: 4 },
  closeTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
});
