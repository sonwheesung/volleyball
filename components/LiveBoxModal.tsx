import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { themedStyles } from './theme';
import { Popup } from './Popup';
import { BoxScoreTable } from './BoxScoreTable';
import type { Player } from '../types';
import type { BoxSink } from '../engine/rally';

// 경기 보드 "스코어박스" 팝업 — 지금까지 본 점수까지의 누적 박스(boxTimeline 스냅샷).
// 표 본체는 공용 BoxScoreTable(경기 상세와 동일). 열리면 경기 일시정지, 닫으면 재개.
// 밖 영역 탭으로 안 닫힘(Popup). 스포일러 아님(현재 점수까지만).
interface Props {
  visible: boolean;
  onClose: () => void;
  home: Player[];
  away: Player[];
  homeName: string;
  awayName: string;
  box: BoxSink | undefined;
  mineSide: 'home' | 'away' | null;
}

export function LiveBoxModal({ visible, onClose, home, away, homeName, awayName, box, mineSide }: Props) {
  const [tab, setTab] = useState<'home' | 'away'>(mineSide ?? 'home');

  return (
    <Popup visible={visible} onRequestClose={onClose} card={{ maxWidth: 600 }}>
      <View style={styles.head}>
        <Text style={styles.title}>실시간 기록</Text>
        <Pressable hitSlop={10} onPress={onClose}><Text style={styles.close}>✕</Text></Pressable>
      </View>

      {/* 팀 토글 */}
      <View style={styles.toggle}>
        {(['home', 'away'] as const).map((s) => (
          <Pressable key={s} style={[styles.tBtn, tab === s && styles.tBtnOn]} onPress={() => setTab(s)}>
            <Text style={[styles.tTxt, tab === s && styles.tTxtOn]} numberOfLines={1}>
              {s === 'home' ? homeName : awayName}{mineSide === s ? ' ★' : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      <BoxScoreTable squad={tab === 'home' ? home : away} box={box} />

      <Text style={styles.hint}>득점=공격+블록+에이스 · 공격=성공/시도/성공률 · 리시브=효율((정확−실패)/시도)</Text>
      <Pressable style={styles.resume} onPress={onClose}>
        <Text style={styles.resumeTxt}>경기 계속 보기 ▶</Text>
      </Pressable>
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: theme.text, fontSize: 17, fontWeight: '900' },
  close: { color: theme.muted, fontSize: 18, fontWeight: '800' },
  toggle: { flexDirection: 'row', gap: 8 },
  tBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center' },
  tBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tTxt: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  tTxtOn: { color: '#FFFFFF' },
  hint: { color: theme.muted, fontSize: 10.5, lineHeight: 15 },
  resume: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  resumeTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
}));
