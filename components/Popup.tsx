import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme } from './Screen';

// 앱 공용 모달 셸 — 모든 팝업이 같은 배경·카드·동작을 쓰도록 통일.
// 기본은 밖 영역 탭으로 닫히지 않는다(dismissable=false). 버튼/✕ 으로만 닫음.
// ★ 비-dismissable일 땐 배경·카드를 View로 둔다 — Pressable이면 그 위의 가로 ScrollView
//   드래그(스크롤 제스처)를 가로채 스코어박스가 안 밀리는 문제가 있어, 터치를 ScrollView에 넘긴다.
// onRequestClose 는 Android 하드웨어 백에만 연결(원하면 닫힘).
interface Props {
  visible: boolean;
  children: ReactNode;
  onRequestClose?: () => void;     // Android 백 키 등
  dismissable?: boolean;           // true면 배경 탭으로 닫힘(기본 false)
  card?: StyleProp<ViewStyle>;     // 카드 스타일 오버라이드(폭 등)
}

export function Popup({ visible, children, onRequestClose, dismissable = false, card }: Props) {
  // statusBarTranslucent — 안드로이드에서 Modal이 기본적으로 상태바 영역까지 안 덮어 배경막 상단(스코어보드 등)이
  // 새던 문제 수정(2026-06-28). 전체 화면을 덮어 배경막이 위까지 깔린다.
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={onRequestClose}>
      {dismissable ? (
        // 배경 탭으로 닫힘 — 배경 Pressable(닫기) + 카드 Pressable(탭 전파 차단)
        <Pressable style={styles.backdrop} onPress={onRequestClose}>
          <Pressable style={[styles.card, card]} onPress={() => {}}>
            {children}
          </Pressable>
        </Pressable>
      ) : (
        // 밖 탭 비활성 — View로 둬서 자식 ScrollView의 가로 스크롤 제스처를 가로채지 않음
        // (일반 View라 배경 터치는 먹어 뒤 보드 조작은 막되, 자식 ScrollView pan은 안 가로챔)
        <View style={styles.backdrop}>
          <View style={[styles.card, card]}>
            {children}
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 배경막 — 진한 스크림(0.82)으로 뒤 보드를 확실히 가라앉혀 팝업이 뜨게(다크 위 다크 50%는 거의 안 어두워져
  // 경계가 안 보였다, 2026-06-28). 카드 — 불투명 표면(#161E2E, 배경보다 한 톤 밝게) + 헤어라인 보더 + 큰 그림자로
  // "떠 있는 패널"로 경계를 또렷하게(반투명 theme.card는 다크 보드와 섞여 어디부터 팝업인지 안 보였다).
  backdrop: { flex: 1, backgroundColor: 'rgba(7,10,16,0.82)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    backgroundColor: '#161E2E', borderRadius: 18, padding: 18, gap: 12, alignSelf: 'stretch', maxWidth: 560, width: '100%',
    borderWidth: 1, borderColor: theme.border,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
});
