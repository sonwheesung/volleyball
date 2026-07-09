// 테스트 전용 목(mock) 전면광고 모달 (MONETIZATION_SYSTEM §3.2) — Expo Go/개발에서 광고 슬롯 발동을 눈으로 확인.
//
// 왜 필요한가: AdMob은 네이티브 모듈이라 Expo Go에 없어 `showSeasonStartAd()`가 조용히 통과(no-op) →
//   개발/QA에서 "시즌 시작 광고 슬롯이 실제로 불렸는지" 확인이 불가능했다. 실 빌드에서 전면광고가 재생될 자리에
//   목 모달을 띄워 흐름(버튼 → 광고 → 시즌 시작)을 시각 검증한다.
//
// 아키텍처: lib/ads(순수 모듈)는 모달을 못 그리므로, 이 호스트가 루트(_layout)에서 컨트롤러를 등록하고
//   showSeasonStartAd가 그걸 호출해 await한다(AppDialog/DialogHost와 같은 모듈-레벨 레지스트리 패턴).
// 게이팅: 루트에서 IS_MOCK_AD_ENV(개발 or Expo Go)일 때만 마운트 → 운영 릴리스에선 등록 자체가 없어 목이 안 뜬다.
//   그래도 showSeasonStartAd가 removeAds/실광고 경로를 먼저 가르므로 이중 안전.
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { create } from 'zustand';
import { theme } from './Screen';
import { themedStyles } from './theme';
import { registerMockAdController } from '../lib/ads';

interface MockAdState {
  visible: boolean;
  resolver: (() => void) | null;
  /** 모달을 띄우고 사용자가 닫을 때 resolve하는 Promise 반환. */
  show: () => Promise<void>;
  /** 닫기 — 대기 중인 Promise를 resolve하고 숨김(자동 닫힘 아님, 버튼/백키로만 호출). */
  close: () => void;
}
const useMockAd = create<MockAdState>((set, get) => ({
  visible: false,
  resolver: null,
  show: () =>
    new Promise<void>((resolve) => {
      const prev = get().resolver;
      if (prev) prev();                       // 겹치면 이전 것 먼저 resolve(시즌 시작은 순차라 정상은 없음 — 방어)
      set({ visible: true, resolver: resolve });
    }),
  close: () => {
    const r = get().resolver;
    set({ visible: false, resolver: null });
    r?.();                                     // 닫힘 = showSeasonStartAd의 await 해제 → 시즌 시작 진행
  },
}));

export function MockAdHost() {
  const visible = useMockAd((s) => s.visible);
  const close = useMockAd((s) => s.close);
  // 컨트롤러 등록 — lib/ads가 이 함수를 호출해 목 모달을 띄운다(테스트 환경만 마운트되므로 등록도 그때만).
  useEffect(() => {
    registerMockAdController(() => useMockAd.getState().show());
    return () => registerMockAdController(null);
  }, []);

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
      {/* 전체 화면 딤 오버레이 — 실 전면광고(인터스티셜)처럼 뒤를 덮는다. */}
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.adBadge}>
            <Ionicons name="megaphone-outline" size={13} color={theme.bg} />
            <Text style={styles.adBadgeTxt}>AD</Text>
          </View>
          <View style={styles.body}>
            <Ionicons name="play-circle-outline" size={56} color={theme.accent} style={{ marginBottom: 14 }} />
            <Text style={styles.title}>테스트 광고 (시즌 시작 슬롯)</Text>
            <Text style={styles.desc}>실제 빌드에서 여기에 전면광고가 재생됩니다.</Text>
            <Text style={styles.note}>Expo Go·개발 환경 전용 목(mock) 화면 — 운영 빌드에선 실제 광고로 대체됩니다.</Text>
          </View>
          <Pressable
            onPress={close}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.closeTxt}>닫고 시즌 시작 →</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // 전면광고 톤 — Popup보다 더 짙은 스크림으로 전체 화면을 확실히 덮는다.
  backdrop: { flex: 1, backgroundColor: 'rgba(5,8,13,0.92)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  panel: {
    backgroundColor: theme.popup, borderRadius: 20, padding: 22, gap: 18, alignSelf: 'stretch',
    maxWidth: 480, width: '100%', minHeight: 380,
    borderWidth: 1.5, borderColor: theme.accent + '66',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
    justifyContent: 'space-between',
  },
  // 실 인터스티셜의 "광고" 표식 모사 — 우상단 작은 배지.
  adBadge: {
    position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: theme.accent, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2.5,
  },
  adBadgeTxt: { color: theme.bg, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  title: { color: theme.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  desc: { color: theme.muted, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 14, opacity: 0.7 },
  closeBtn: {
    borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent,
  },
  closeTxt: { color: theme.accent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
}));
