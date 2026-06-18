import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Muted, Screen, theme } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function Row({ icon, tint, label, sub, onPress, danger }: { icon: IoniconName; tint: string; label: string; sub?: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: theme.bad }]}>{label}</Text>
        {sub ? <Muted style={{ fontSize: 12, marginTop: 1 }}>{sub}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.muted} /> : null}
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const resetSave = useGameStore((s) => s.resetSave);
  const replayOnboarding = useGameStore((s) => s.replayOnboarding);
  const season = useGameStore((s) => s.season);
  const [confirmReset, setConfirmReset] = useState(false);

  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';

  return (
    <Screen title="설정">
      <Muted>게임 · 데이터 · 정보를 관리합니다.</Muted>

      <Text style={styles.section}>게임</Text>
      <View style={styles.group}>
        <Row icon="book-outline" tint={theme.accent} label="튜토리얼 다시보기" sub="게임 소개를 처음부터"
          onPress={() => { replayOnboarding(); router.replace('/onboarding'); }} />
      </View>

      <Text style={styles.section}>데이터</Text>
      <View style={styles.group}>
        <Row icon="refresh-outline" tint={theme.bad} label="세이브 초기화" sub={`현재 ${season + 1}시즌 — 구단 변경(진행 기록 삭제)`} danger
          onPress={() => setConfirmReset(true)} />
      </View>

      <Text style={styles.section}>정보</Text>
      <View style={styles.group}>
        <Row icon="information-circle-outline" tint={theme.muted} label="버전" sub={`백년배구 v${version}`} />
      </View>

      {/* 세이브 초기화 확인 — 되돌릴 수 없는 작업이라 명시 확인 */}
      <Modal visible={confirmReset} transparent animationType="fade" onRequestClose={() => setConfirmReset(false)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirmReset(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={[styles.rowIcon, { backgroundColor: theme.bad + '1A', alignSelf: 'center', width: 48, height: 48, borderRadius: 14 }]}>
              <Ionicons name="warning-outline" size={24} color={theme.bad} />
            </View>
            <Text style={styles.modalTitle}>세이브를 초기화할까요?</Text>
            <Text style={styles.modalBody}>현재 구단의 모든 진행 기록(시즌·계약·기록)이 사라지고 구단 선택으로 돌아갑니다. 되돌릴 수 없습니다.</Text>
            <View style={styles.modalBtns}>
              <Pressable style={[styles.mBtn, styles.mGhost]} onPress={() => setConfirmReset(false)}>
                <Text style={styles.mGhostText}>취소</Text>
              </Pressable>
              <Pressable style={[styles.mBtn, styles.mDanger]} onPress={() => { setConfirmReset(false); resetSave(); router.replace('/select-team'); }}>
                <Text style={styles.mDangerText}>초기화</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 6, marginLeft: 2 },
  group: { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#15202B80', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modal: { backgroundColor: theme.card, borderRadius: 18, padding: 22, gap: 12, alignSelf: 'stretch' },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  modalBody: { color: theme.muted, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  mBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  mGhost: { backgroundColor: theme.cardAlt },
  mGhostText: { color: theme.text, fontSize: 15, fontWeight: '800' },
  mDanger: { backgroundColor: theme.bad },
  mDangerText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
