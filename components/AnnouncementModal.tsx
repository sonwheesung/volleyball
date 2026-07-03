// 공지사항 진입 모달 (BACKEND_SYSTEM §13.13) — 안 본 활성 공지를 **하나의 리스트 모달**로(N연발 금지, 관전형 nag 방지).
// 무푸시: 앱 진입 시에만 조용히 surface. 닫으면 표시분 전체를 읽음 처리(재열람은 마이페이지 목록).
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme, themedStyles } from './Screen';

export interface AnnItem { id: string; title: string; body: string; pinned: boolean }

export function AnnouncementModal({ items, onClose }: { items: AnnItem[]; onClose: () => void }) {
  if (!items.length) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="megaphone-outline" size={20} color={theme.accent} />
            <Text style={styles.headTitle}>공지사항</Text>
            {items.length > 1 ? <Text style={styles.count}>{items.length}</Text> : null}
          </View>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 4 }}>
            {items.map((a, i) => (
              <View key={a.id} style={[styles.item, i > 0 && styles.itemDivider]}>
                <View style={styles.itemHead}>
                  {a.pinned ? <View style={styles.pin}><Text style={styles.pinTxt}>고정</Text></View> : null}
                  <Text style={styles.itemTitle}>{a.title}</Text>
                </View>
                <Text style={styles.itemBody}>{a.body}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.confirm, pressed && { opacity: 0.85 }]}>
            <Text style={styles.confirmTxt}>확인</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#000A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
    sheet: { width: '100%', maxWidth: 460, backgroundColor: theme.card, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 18, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headTitle: { color: theme.text, fontSize: 17, fontWeight: '900', flex: 1 },
    count: { color: theme.accent, fontSize: 13, fontWeight: '800', backgroundColor: theme.accentGlass, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9, overflow: 'hidden' },
    item: { paddingVertical: 10, gap: 5 },
    itemDivider: { borderTopWidth: 1, borderTopColor: theme.border },
    itemHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    pin: { backgroundColor: theme.warn + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    pinTxt: { color: theme.warn, fontSize: 10.5, fontWeight: '800' },
    itemTitle: { color: theme.text, fontSize: 15.5, fontWeight: '800', flex: 1 },
    itemBody: { color: theme.muted, fontSize: 13.5, lineHeight: 20 },
    confirm: { backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    confirmTxt: { color: theme.accent, fontSize: 15, fontWeight: '800' },
  }),
);
