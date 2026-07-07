// 무거운 동기 작업용 사전 페인트 오버레이 + 실행 훅 (UI-27).
// staff.tsx(busy 게이트)·team/[id].tsx(rAF×2) 패턴을 단일 컴포넌트로 일반화 —
// 화면마다 재구현하지 않도록. 핵심: ActivityIndicator는 **네이티브 뷰**라 JS 스레드가
// 동기 블록으로 막혀도 UI 스레드에서 계속 회전한다(스피너 독립성). 그래서 오버레이를
// 먼저 그려 한 프레임 페인트한 뒤 무거운 fn을 돌리면 "탭했는데 화면이 멈춘" 체감이 사라진다.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { themedStyles } from './theme';

/** 사전 페인트 오버레이 — dim 배경 + 네이티브 스피너 + 세계관 사유 문구(message) + 선택 보조문구(sub).
 *  Modal(statusBarTranslucent)이라 뷰포트 전체를 덮는다. animationType='none' — 페이드로 페인트가 밀리지 않게 즉시 표시. */
export function BusyOverlay({ visible, message, sub }: { visible: boolean; message: string; sub?: string }) {
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <View style={styles.dim}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.msg}>{message}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

/** staff.tsx 패턴 캡슐화 — `run(message, fn)` 호출 시:
 *   ① setState로 오버레이를 렌더(busy=true) → ② rAF×2로 네이티브 스피너가 실제 페인트될 때까지 양보 →
 *   ③ 무거운 동기 fn 실행(이 사이 화면은 오버레이 프레임을 유지, 스피너 회전) → ④ busy=false로 복귀.
 *  rAF **2회** 이유: 1회는 layout 직후 커밋 전이라 네이티브 모달·스피너가 아직 화면에 안 떠 있을 수 있다(UI-4).
 *  2회째면 커밋→네이티브 렌더가 한 프레임 지나 스피너가 확실히 얹힌 뒤 블록을 시작한다.
 *  재진입 가드: 진행 중(fnRef 有)엔 run()을 무시 → 더블탭 중복 실행 차단(busy 게이트). */
export function useBusyRun() {
  const [pending, setPending] = useState<{ message: string; sub?: string } | null>(null);
  const fnRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!pending) return;
    let r1 = 0;
    let r2 = 0;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        try {
          fnRef.current?.();
        } finally {
          fnRef.current = null;
          setPending(null);
        }
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [pending]);
  const run = (message: string, fn: () => void, sub?: string) => {
    if (fnRef.current) return; // 재진입 가드(더블탭) — 진행 중엔 무시
    fnRef.current = fn;
    setPending({ message, sub });
  };
  return { busy: !!pending, message: pending?.message ?? '', sub: pending?.sub, run };
}

const styles = themedStyles(() => StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(7,10,16,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: theme.popup, borderRadius: 18, paddingVertical: 26, paddingHorizontal: 30, gap: 14, alignItems: 'center',
    maxWidth: 420, borderWidth: 1, borderColor: theme.accent + '55',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
  msg: { color: theme.text, fontSize: 15, fontWeight: '700', textAlign: 'center', lineHeight: 21 },
  sub: { color: theme.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
}));
