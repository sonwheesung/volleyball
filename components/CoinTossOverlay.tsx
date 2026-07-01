// 5세트(결승 세트) 코인토스 연출 오버레이 — MATCH_SYSTEM v2.1.
// 첫 5세트 랠리 직전 1회, 보드 위에 풀오버레이로 동전을 던져 누가 서브로 시작하는지 보여준다.
// 순수 연출(승패·기록 무영향). 타이밍·해제는 부모(MatchCourt)가 제어하고, 이 컴포넌트는 마운트 시 입장 애니만 재생.

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { theme } from './Screen';
import { themedStyles } from './theme';
import type { Side } from '../types';

interface Props {
  serving: Side;        // 코인토스 결과 = 5세트 첫 서브 팀
  homeName?: string;
  awayName?: string;
  fast?: boolean;       // 빠르게 모드 — 애니 단축
}

export function CoinTossOverlay({ serving, homeName, awayName, fast }: Props) {
  const spin = useRef(new Animated.Value(0)).current; // 동전 회전 0→1
  const fade = useRef(new Animated.Value(0)).current; // 패널 페이드 인
  const pop = useRef(new Animated.Value(0.6)).current; // 패널 팝인

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: fast ? 120 : 200, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(spin, { toValue: 1, duration: fast ? 380 : 760, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [spin, fade, pop, fast]);

  const rotateY = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1980deg'] }); // 5.5바퀴
  const serverName = serving === 'home' ? (homeName ?? '홈') : (awayName ?? '원정');

  return (
    <Animated.View style={[styles.overlay, { opacity: fade }]} pointerEvents="none">
      <Animated.View style={[styles.panel, { transform: [{ scale: pop }] }]}>
        <Text style={styles.head}>🏐 5세트 · 결승</Text>
        <Animated.Text style={[styles.coin, { transform: [{ perspective: 600 }, { rotateY }] }]}>🪙</Animated.Text>
        <Text style={styles.label}>코인토스</Text>
        <Text style={styles.result}>▶ {serverName} 서브로 시작</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,20,0.62)',
    zIndex: 20,
  },
  panel: {
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 30,
    borderRadius: 18,
    backgroundColor: 'rgba(18,24,36,0.96)',
    borderWidth: 1.5,
    borderColor: theme.accent,
  },
  head: { color: theme.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  coin: { fontSize: 52, marginBottom: 6 },
  label: { color: theme.muted, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  result: { color: theme.text, fontSize: 16, fontWeight: '800' },
}));
