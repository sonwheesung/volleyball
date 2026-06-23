import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme } from './Screen';

// 앱 공용 모달 셸 — 모든 팝업이 같은 배경·카드·동작을 쓰도록 통일.
// 기본은 밖 영역 탭으로 닫히지 않는다(dismissable=false). 버튼/✕ 으로만 닫음.
// onRequestClose 는 Android 하드웨어 백에만 연결(원하면 닫힘).
interface Props {
  visible: boolean;
  children: ReactNode;
  onRequestClose?: () => void;     // Android 백 키 등
  dismissable?: boolean;           // true면 배경 탭으로 닫힘(기본 false)
  card?: StyleProp<ViewStyle>;     // 카드 스타일 오버라이드(폭 등)
}

export function Popup({ visible, children, onRequestClose, dismissable = false, card }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      {/* 배경: dismissable일 때만 탭으로 닫힘. 아니면 탭을 먹기만 하고 닫지 않음. */}
      <Pressable style={styles.backdrop} onPress={dismissable ? onRequestClose : undefined}>
        {/* 카드 내부 탭이 배경으로 전파되지 않도록 */}
        <Pressable style={[styles.card, card]} onPress={() => {}}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#15202B80', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: theme.card, borderRadius: 18, padding: 18, gap: 12, alignSelf: 'stretch', maxWidth: 560, width: '100%' },
});
