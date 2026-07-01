import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { theme } from './Screen';
import { themedStyles } from './theme';
import type { Banner } from '../data/broadcast';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// 중계 현수막(lower-third) — 사건 큐를 슬라이드 인 → 홀드 → 아웃으로 순차 재생. TV 중계 자막 느낌.
export function BroadcastBanner({ banners }: { banners: Banner[] }) {
  const [idx, setIdx] = useState(0);
  const slide = useRef(new Animated.Value(0)).current; // 0 숨김 → 1 표시

  useEffect(() => {
    if (idx >= banners.length) return;
    slide.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(slide, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.delay(2400),
      Animated.timing(slide, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => { if (finished) setIdx((i) => i + 1); });
    return () => anim.stop();
  }, [idx, banners.length, slide]);

  if (idx >= banners.length) return null;
  const b = banners[idx];
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [44, 0] });

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity: slide, transform: [{ translateY }] }]}>
      <View style={[styles.bar, { borderLeftColor: b.tint }]}>
        <Ionicons name={b.icon as IoniconName} size={20} color={b.tint} />
        <Text style={styles.title} numberOfLines={1}>{b.title}</Text>
        {b.mine ? <View style={[styles.mine, { backgroundColor: b.tint }]}><Text style={styles.mineText}>내 팀</Text></View> : null}
        {banners.length > 1 ? <Text style={styles.count}>{idx + 1}/{banners.length}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, bottom: 10, alignItems: 'center' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFFF2', borderRadius: 12, borderLeftWidth: 4,
    paddingVertical: 11, paddingHorizontal: 14, alignSelf: 'stretch',
    shadowColor: '#1B2A4A', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  title: { flex: 1, color: theme.text, fontSize: 14.5, fontWeight: '800' },
  mine: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  mineText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  count: { color: theme.muted, fontSize: 11, fontWeight: '700' },
}));
