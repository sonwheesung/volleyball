// 가벼운 하단 토스트 큐 — 비모달·자동 소멸(UI-30). 화면을 막지 않는(pointerEvents=none) 알림.
// BusyOverlay(Modal, 차단형)와 반대: 관전형 흐름을 끊지 않고 "방금 무슨 일이 일어났나"만 스쳐 알린다.
// 재사용: useToastQueue()로 push, <ToastHost toasts=.../>를 화면 오버레이 슬롯(Screen overlay)에 건다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { themedStyles } from './theme';
import { subscribeToast } from '../lib/toastBus';

export interface ToastItemData { id: number; text: string }

const MAX_VISIBLE = 3;    // 최대 최근 3건(UI-30)
const LIFETIME_MS = 2600; // 2~3초 자동 소멸

/** 토스트 큐 훅 — push(text)로 넣으면 일정 시간 뒤 자동 제거. 연속 발생은 큐로 쌓이되 화면엔 최근 3건만. */
export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastItemData[]>([]);
  const seq = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const push = useCallback((text: string) => {
    const id = ++seq.current;
    setToasts((q) => [...q, { id, text }].slice(-MAX_VISIBLE));
    const t = setTimeout(() => setToasts((q) => q.filter((x) => x.id !== id)), LIFETIME_MS);
    timers.current.push(t);
  }, []);
  return { toasts, push };
}

/** 앱 전역 토스트 표시기 — _layout에 1개 마운트(DialogHost 옆). lib/toastBus 구독 → useToastQueue로 하단 표시(비차단·자동소멸).
 *  출석 패스 자동 수령 토스트(ATTENDANCE_PASS_SYSTEM §2.3·UI.2)가 화면 소유 없이 surface하는 경로. */
export function GlobalToastHost() {
  const { toasts, push } = useToastQueue();
  useEffect(() => subscribeToast(push), [push]);
  return <ToastHost toasts={toasts} />;
}

/** 화면 하단 고정 토스트 표시기 — Screen의 overlay 슬롯에 배치(ScrollView 밖 = 뷰포트 고정). */
export function ToastHost({ toasts }: { toasts: ToastItemData[] }) {
  if (!toasts.length) return null;
  return (
    <View pointerEvents="none" style={styles.host}>
      {toasts.map((t) => <Toast key={t.id} text={t.text} />)}
    </View>
  );
}

function Toast({ text }: { text: string }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [a]);
  return (
    <Animated.View
      style={[styles.toast, {
        opacity: a,
        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }]}
    >
      <Text style={styles.txt} numberOfLines={2}>{text}</Text>
    </Animated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 26, alignItems: 'center', paddingHorizontal: 18, gap: 8 },
  toast: {
    maxWidth: 460, backgroundColor: theme.popup, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 16,
    borderWidth: 1, borderColor: theme.accent + '55',
    shadowColor: '#000', shadowOpacity: 0.42, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  txt: { color: theme.text, fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
}));
