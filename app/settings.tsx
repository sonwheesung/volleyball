import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Muted, Screen, theme, themedStyles, useThemeMode, setThemeMode } from '../components/Screen';
import { DEV_TOOLS } from '../data/flags';
import { useGameStore } from '../store/useGameStore';

const ROSE = '#FF5C8D';

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
  const resetTips = useGameStore((s) => s.resetTips);
  const season = useGameStore((s) => s.season);
  const supporter = useGameStore((s) => s.supporter);
  const setSupporter = useGameStore((s) => s.setSupporter);
  const sfxEnabled = useGameStore((s) => s.sfxEnabled);
  const setSfx = useGameStore((s) => s.setSfx);
  const mode = useThemeMode();
  const [confirmReset, setConfirmReset] = useState(false);

  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';

  return (
    <Screen title="설정">
      <Muted>게임 · 데이터 · 정보를 관리합니다.</Muted>

      {/* 응원 섹션(서포터 팩·크레딧) — 출시 전 임시 숨김(2026-06-28, 사용자 요청). IAP 연결 시 복원.
      <Text style={styles.section}>응원</Text>
      <View style={styles.group}>
        <Row icon="heart" tint={ROSE}
          label={supporter ? '서포터 ♥ — 감사합니다' : '서포터 팩'}
          sub={supporter ? '배구명가를 응원해주셨어요' : '한 번의 응원으로 다음 시즌을 함께'}
          onPress={() => router.push('/supporter')} />
        <Row icon="document-text-outline" tint={theme.muted} label="크레딧" sub="만든 사람 · 응원해주신 분들"
          onPress={() => router.push('/credits')} />
      </View>
      */}

      <Text style={styles.section}>게임</Text>
      <View style={styles.group}>
        <View style={styles.toggleRow}>
          <View style={[styles.rowIcon, { backgroundColor: theme.accent + '1A' }]}>
            <Ionicons name={sfxEnabled ? 'volume-high-outline' : 'volume-mute-outline'} size={18} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>효과음</Text>
            <Muted style={{ fontSize: 12, marginTop: 1 }}>경기 보드 휘슬·스파이크·서브 소리 (무음 모드 존중)</Muted>
          </View>
          <Switch value={sfxEnabled} onValueChange={setSfx} trackColor={{ true: theme.accent, false: theme.cardAlt }} />
        </View>
        <View style={styles.toggleRow}>
          <View style={[styles.rowIcon, { backgroundColor: theme.accent + '1A' }]}>
            <Ionicons name={mode === 'light' ? 'sunny-outline' : 'moon-outline'} size={18} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>라이트 모드</Text>
            <Muted style={{ fontSize: 12, marginTop: 1 }}>밝은 화면 테마 (끄면 다크). 적용 시 화면이 새로 그려집니다</Muted>
          </View>
          <Switch value={mode === 'light'} onValueChange={(v) => setThemeMode(v ? 'light' : 'dark')} trackColor={{ true: theme.accent, false: theme.cardAlt }} />
        </View>
        <Row icon="book-outline" tint={theme.accent} label="튜토리얼 다시보기" sub="게임 소개 + 화면 안내를 처음부터"
          onPress={() => { replayOnboarding(); resetTips(); router.replace('/onboarding'); }} />
      </View>

      <Text style={styles.section}>데이터</Text>
      <View style={styles.group}>
        <Row icon="refresh-outline" tint={theme.bad} label="세이브 초기화" sub={`현재 ${season + 1}시즌 — 구단 변경(진행 기록 삭제)`} danger
          onPress={() => setConfirmReset(true)} />
      </View>

      <Text style={styles.section}>정보</Text>
      <View style={styles.group}>
        <Row icon="information-circle-outline" tint={theme.muted} label="버전" sub={`배구명가 v${version}`} />
      </View>

      {/* 미리보기(개발용) — 실전 빌드에선 숨김. 서포터 적용된 모습을 즉시 확인 */}
      {DEV_TOOLS ? (
        <>
          <Text style={styles.section}>미리보기 (개발)</Text>
          <View style={styles.group}>
            <View style={styles.toggleRow}>
              <View style={[styles.rowIcon, { backgroundColor: ROSE + '1A' }]}>
                <Ionicons name="heart" size={18} color={ROSE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>서포터 보유 (적용 미리보기)</Text>
                <Muted style={{ fontSize: 12, marginTop: 1 }}>켜면 실제로 산 것처럼 ♥·크레딧·감사 화면 표시</Muted>
              </View>
              <Switch value={supporter} onValueChange={setSupporter} trackColor={{ true: ROSE, false: theme.cardAlt }} />
            </View>
          </View>
        </>
      ) : null}

      {/* 세이브 초기화 확인 — 되돌릴 수 없는 작업이라 명시 확인 */}
      <Modal visible={confirmReset} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setConfirmReset(false)}>
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

const styles = themedStyles(() => StyleSheet.create({
  section: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 6, marginLeft: 2 },
  group: { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
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
}));
