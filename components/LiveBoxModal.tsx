import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import type { Player, Position } from '../types';
import type { BoxSink, BoxLine } from '../engine/rally';

// 경기 보드 "스코어박스" 팝업 — 지금까지 본 점수까지의 누적 박스(boxTimeline 스냅샷).
// 열리면 경기 일시정지(부모가 paused 처리), 닫으면 재개. 스포일러 아님(현재 점수까지만).
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

const POS_COLOR: Record<Position, string> = { S: '#2FB48E', OH: '#0E9C8C', OP: '#FF6B5A', MB: '#8B7CF0', L: '#C8961F' };
const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce; // 득점 = 공격+블록+에이스
const recvEff = (l: BoxLine) => (l.recvAtt > 0 ? `${Math.round(((l.recvGood - l.recvErr) / l.recvAtt) * 100)}%` : '–'); // KOVO 효율
const COLS: { key: string; w: number }[] = [
  { key: '득점', w: 38 }, { key: '공격', w: 52 }, { key: '블록', w: 34 },
  { key: '서브', w: 34 }, { key: '디그', w: 34 }, { key: '세트', w: 34 }, { key: '리효', w: 40 },
];

export function LiveBoxModal({ visible, onClose, home, away, homeName, awayName, box, mineSide }: Props) {
  const [tab, setTab] = useState<'home' | 'away'>(mineSide ?? 'home');
  const squad = tab === 'home' ? home : away;

  const rows = squad
    .map((p) => ({ p, l: box?.get(p.id) }))
    .filter((r): r is { p: Player; l: BoxLine } => !!r.l && (r.l.atkAtt > 0 || r.l.srvAtt > 0 || r.l.blockPt > 0 || r.l.digSucc > 0 || r.l.assist > 0))
    .sort((x, y) => pts(y.l) - pts(x.l) || y.l.atkAtt - x.l.atkAtt);

  const T = rows.reduce(
    (t, { l }) => {
      t.pt += pts(l); t.ak += l.atkKill; t.aa += l.atkAtt; t.bl += l.blockPt; t.ac += l.srvAce;
      t.dg += l.digSucc; t.as += l.assist; t.rg += l.recvGood; t.re += l.recvErr; t.ra += l.recvAtt;
      return t;
    },
    { pt: 0, ak: 0, aa: 0, bl: 0, ac: 0, dg: 0, as: 0, rg: 0, re: 0, ra: 0 },
  );
  const teamEff = T.ra > 0 ? `${Math.round(((T.rg - T.re) / T.ra) * 100)}%` : '–';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
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

          {rows.length === 0 ? (
            <Text style={styles.empty}>아직 기록이 없습니다 — 경기가 진행되면 쌓입니다.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                {/* 헤더 */}
                <View style={[styles.row, styles.hRow]}>
                  <Text style={[styles.nm, styles.hCell]}>선수</Text>
                  {COLS.map((c) => <Text key={c.key} style={[styles.cell, styles.hCell, { width: c.w }]}>{c.key}</Text>)}
                </View>
                {/* 선수 행 (스크롤) */}
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {rows.map(({ p, l }) => (
                    <View key={p.id} style={styles.row}>
                      <View style={[styles.nm, styles.nmCell]}>
                        <View style={[styles.pill, { backgroundColor: POS_COLOR[p.position] }]}><Text style={styles.pillTxt}>{p.position}</Text></View>
                        <Text style={styles.nmTxt} numberOfLines={1}>{p.name}</Text>
                      </View>
                      <Text style={[styles.cell, styles.sc, { width: COLS[0].w }]}>{pts(l)}</Text>
                      <Text style={[styles.cell, { width: COLS[1].w }]}>{l.atkAtt > 0 ? `${l.atkKill}/${l.atkAtt}` : '–'}</Text>
                      <Text style={[styles.cell, l.blockPt ? styles.on : styles.zero, { width: COLS[2].w }]}>{l.blockPt}</Text>
                      <Text style={[styles.cell, l.srvAce ? styles.on : styles.zero, { width: COLS[3].w }]}>{l.srvAce}</Text>
                      <Text style={[styles.cell, l.digSucc ? undefined : styles.zero, { width: COLS[4].w }]}>{l.digSucc}</Text>
                      <Text style={[styles.cell, l.assist ? undefined : styles.zero, { width: COLS[5].w }]}>{l.assist}</Text>
                      <Text style={[styles.cell, { width: COLS[6].w }]}>{recvEff(l)}</Text>
                    </View>
                  ))}
                </ScrollView>
                {/* 팀 합계 */}
                <View style={[styles.row, styles.tot]}>
                  <Text style={[styles.nm, styles.totTxt]}>팀 합계</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[0].w }]}>{T.pt}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[1].w }]}>{T.ak}/{T.aa}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[2].w }]}>{T.bl}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[3].w }]}>{T.ac}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[4].w }]}>{T.dg}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[5].w }]}>{T.as}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: COLS[6].w }]}>{teamEff}</Text>
                </View>
              </View>
            </ScrollView>
          )}

          <Text style={styles.hint}>득점=공격+블록+에이스 · 공격=성공/시도 · 리효=리시브 효율((정확−실패)/시도)</Text>
          <Pressable style={styles.resume} onPress={onClose}>
            <Text style={styles.resumeTxt}>경기 계속 보기 ▶</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#15202B80', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: theme.card, borderRadius: 18, padding: 16, gap: 12, alignSelf: 'stretch', maxWidth: 560, width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: theme.text, fontSize: 17, fontWeight: '900' },
  close: { color: theme.muted, fontSize: 18, fontWeight: '800' },
  toggle: { flexDirection: 'row', gap: 8 },
  tBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center' },
  tBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tTxt: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  tTxtOn: { color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 6 },
  hRow: { borderBottomWidth: 2 },
  hCell: { color: theme.muted, fontSize: 11, fontWeight: '800' },
  cell: { textAlign: 'center', color: theme.text, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  nm: { width: 96, textAlign: 'left' },
  nmCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nmTxt: { color: theme.text, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  pill: { minWidth: 24, paddingHorizontal: 3, paddingVertical: 1, borderRadius: 5, alignItems: 'center' },
  pillTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
  sc: { fontWeight: '900', color: theme.accent },
  on: { color: theme.text, fontWeight: '700' },
  zero: { color: theme.border },
  tot: { borderBottomWidth: 0, borderTopWidth: 2, borderTopColor: theme.border, backgroundColor: theme.bg, marginTop: 2 },
  totTxt: { color: theme.text, fontWeight: '800' },
  empty: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  hint: { color: theme.muted, fontSize: 10.5, lineHeight: 15 },
  resume: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  resumeTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
