// 앱 인트로(스플래시) — 뒷모습 스파이크 풀일러스트 + 하단 로딩 게이지. (2026-06-28)
// 핵심: 무거운 워밍(시즌 재계산)은 JS 스레드를 길게 막는다(엔진 범프 후 첫 진입 ~수십초). 따라서 게이지는
// **네이티브 드리븐(transform scaleX)** 으로 그려 JS가 막혀도 UI 스레드에서 계속 부드럽게 차오른다
// (width % 애니는 JS 드리븐이라 워밍 중 7%에서 얼어붙었음 — 사용자 보고). 준비+워밍 완료 시 100%로 채우고 진입.
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, ImageBackground, StyleSheet, Text, View } from 'react-native';

const { width: SCREEN_W, height: H } = Dimensions.get('window');
const TRACK_W = SCREEN_W * 0.82;
const MINT = '#19C2AE';

export function IntroSplash({ ready, onWarm, onDone }: { ready: boolean; onWarm?: () => void; onDone: () => void }) {
  const prog = useRef(new Animated.Value(0)).current; // 0..1 (네이티브 transform 구동)
  const done = useRef(false);

  useEffect(() => {
    // 준비 중 크리프: 0→0.9를 18초에 걸쳐 감속 진행(네이티브) — 워밍이 JS를 막아도 바는 계속 움직인다.
    // 워밍이 빨리 끝나면(캐시 복원) 아래 effect가 100%로 끊어 채운다.
    Animated.timing(prog, { toValue: 0.9, duration: 18000, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [prog]);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    // 폰트·복원 완료 → 바를 한 프레임 그린 뒤 무거운 워밍(시즌 재계산)을 실행(JS 블록). 네이티브 바는 그동안도
    // 계속 차오른다. 워밍이 끝나면 100%로 채우고 진입 → "100%인데 멈춤"·"7%에서 얼음" 둘 다 해소.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      onWarm?.();
      Animated.timing(prog, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(() => setTimeout(onDone, 240));
    }));
  }, [ready, prog, onWarm, onDone]);

  // 좌측 고정 scaleX — 중심 스케일을 보정(translateX)해 왼쪽에서 차오르게. 둘 다 transform=네이티브.
  const translateX = prog.interpolate({ inputRange: [0, 1], outputRange: [-TRACK_W / 2, 0] });

  return (
    <View style={styles.root}>
      <ImageBackground source={require('../assets/bg/intro.jpg')} style={styles.bg} resizeMode="cover">
        <View style={styles.barWrap}>
          <View style={[styles.track, { width: TRACK_W }]}>
            <Animated.View style={[styles.fill, { width: TRACK_W, transform: [{ translateX }, { scaleX: prog }] }]} />
          </View>
          <Text style={styles.label}>불러오는 중…</Text>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05080E' },
  bg: { flex: 1 },
  barWrap: { position: 'absolute', left: '9%', right: '9%', bottom: H * 0.075, alignItems: 'center', gap: 8 },
  track: { height: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(25,194,174,0.35)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: MINT },
  label: { color: MINT, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});
