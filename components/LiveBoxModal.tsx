import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { buildLineup } from '../engine/lineup';
import { emptyBox } from '../engine/rally';
import type { Player, Position } from '../types';
import type { BoxSink, BoxLine } from '../engine/rally';

// 경기 보드 "스코어박스" 팝업 — 엔진 테스트 콘솔(sim-web)의 네이버 종합 박스스코어를 그대로.
// 지금까지 본 점수까지의 누적 박스(boxTimeline 스냅샷). 열리면 경기 일시정지, 닫으면 재개.
// 점수가 0이어도 선발 명단을 0으로 항상 표시(스포일러 아님 — 현재 점수까지만).
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
const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce;       // 득점 = 공격+블록+에이스
const rateN = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null); // 비율(%) or null(시도 0)
const fmt = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`);

const NAME_W = 86;
const C = { sc: 34, ak: 30, aa: 30, ap: 48, bl: 32, sv: 32, dg: 32, st: 32, rc: 46, er: 34 };
const ATK_W = C.ak + C.aa + C.ap;                          // 공격 그룹 폭
const REST_W = C.bl + C.sv + C.dg + C.st + C.rc + C.er;     // 공격 뒤 나머지 폭

export function LiveBoxModal({ visible, onClose, home, away, homeName, awayName, box, mineSide }: Props) {
  const [tab, setTab] = useState<'home' | 'away'>(mineSide ?? 'home');
  const squad = tab === 'home' ? home : away;

  // 점수 0이어도 스코어보드 유지 — 선발 7인(코트 6 + 리베로) 항상 + 교체 투입돼 기록 생긴 비선발.
  const order = useMemo(() => {
    const lu = buildLineup(squad);
    const starters = [...lu.six, lu.libero].filter((p): p is Player => !!p);
    const ids = new Set(starters.map((p) => p.id));
    const subs = squad.filter((p) => !ids.has(p.id) && !!box?.get(p.id));
    return [...starters, ...subs];
  }, [squad, box]);
  const rows = order
    .map((p, i) => ({ p, l: box?.get(p.id) ?? emptyBox(), i }))
    .sort((x, y) => pts(y.l) - pts(x.l) || y.l.atkAtt - x.l.atkAtt || x.i - y.i);

  const T = rows.reduce(
    (t, { l }) => {
      t.pt += pts(l); t.ak += l.atkKill; t.aa += l.atkAtt; t.bl += l.blockPt; t.ac += l.srvAce;
      t.dg += l.digSucc; t.as += l.assist; t.rg += l.recvGood; t.re += l.recvErr; t.ra += l.recvAtt;
      t.er += l.atkErr + l.srvErr;
      return t;
    },
    { pt: 0, ak: 0, aa: 0, bl: 0, ac: 0, dg: 0, as: 0, rg: 0, re: 0, ra: 0, er: 0 },
  );

  // 숫자 셀(0은 흐리게 — 네이버 가독성)
  const num = (v: number, w: number, extra?: object) => (
    <Text style={[styles.cell, { width: w }, v === 0 ? styles.zero : undefined, extra]}>{v}</Text>
  );

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
            <Text style={styles.empty}>출전 명단이 없습니다.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                {/* 그룹 헤더 — 공격 묶음 */}
                <View style={[styles.row, styles.grpRow]}>
                  <View style={{ width: NAME_W + C.sc }} />
                  <Text style={[styles.grpTxt, { width: ATK_W }]}>공격</Text>
                  <View style={{ width: REST_W }} />
                </View>
                {/* 칸 헤더 */}
                <View style={[styles.row, styles.hRow]}>
                  <Text style={[styles.hCell, { width: NAME_W, textAlign: 'left' }]}>선수</Text>
                  <Text style={[styles.hCell, { width: C.sc }]}>득점</Text>
                  <Text style={[styles.hCell, { width: C.ak }]}>성공</Text>
                  <Text style={[styles.hCell, { width: C.aa }]}>시도</Text>
                  <Text style={[styles.hCell, { width: C.ap }]}>성공률</Text>
                  <Text style={[styles.hCell, { width: C.bl }]}>블록</Text>
                  <Text style={[styles.hCell, { width: C.sv }]}>서브</Text>
                  <Text style={[styles.hCell, { width: C.dg }]}>디그</Text>
                  <Text style={[styles.hCell, { width: C.st }]}>세트</Text>
                  <Text style={[styles.hCell, { width: C.rc }]}>리시브</Text>
                  <Text style={[styles.hCell, { width: C.er }]}>범실</Text>
                </View>
                {/* 선수 행 */}
                <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                  {rows.map(({ p, l }) => {
                    const ap = rateN(l.atkKill, l.atkAtt); // 공격 성공률
                    const rc = l.recvAtt > 0 ? (l.recvGood - l.recvErr) / l.recvAtt * 100 : null; // 리시브 효율
                    const err = l.atkErr + l.srvErr;
                    return (
                      <View key={p.id} style={styles.row}>
                        <View style={[styles.nmCell, { width: NAME_W }]}>
                          <View style={[styles.pill, { backgroundColor: POS_COLOR[p.position] }]}><Text style={styles.pillTxt}>{p.position}</Text></View>
                          <Text style={styles.nmTxt} numberOfLines={1}>{p.name}</Text>
                        </View>
                        <Text style={[styles.cell, styles.sc, { width: C.sc }]}>{pts(l)}</Text>
                        {num(l.atkKill, C.ak)}
                        {num(l.atkAtt, C.aa)}
                        <Text style={[styles.cell, { width: C.ap }, ap !== null && ap >= 45 ? styles.hi : ap === null ? styles.zero : undefined]}>{fmt(ap)}</Text>
                        {num(l.blockPt, C.bl)}
                        {num(l.srvAce, C.sv)}
                        {num(l.digSucc, C.dg)}
                        {num(l.assist, C.st)}
                        <Text style={[styles.cell, { width: C.rc }, rc !== null && rc >= 45 ? styles.hi : rc === null ? styles.zero : undefined]}>{fmt(rc)}</Text>
                        <Text style={[styles.cell, { width: C.er }, err > 0 ? styles.err : styles.zero]}>{err}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
                {/* 팀 합계 */}
                <View style={[styles.row, styles.tot]}>
                  <Text style={[styles.totTxt, { width: NAME_W, textAlign: 'left' }]}>팀 합계</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.sc }]}>{T.pt}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.ak }]}>{T.ak}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.aa }]}>{T.aa}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.ap }]}>{fmt(rateN(T.ak, T.aa))}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.bl }]}>{T.bl}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.sv }]}>{T.ac}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.dg }]}>{T.dg}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.st }]}>{T.as}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.rc }]}>{fmt(rateN(T.rg - T.re, T.ra))}</Text>
                  <Text style={[styles.cell, styles.totTxt, { width: C.er }]}>{T.er}</Text>
                </View>
              </View>
            </ScrollView>
          )}

          <Text style={styles.hint}>득점=공격+블록+에이스 · 공격=성공/시도/성공률 · 리시브=효율((정확−실패)/시도)</Text>
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
  card: { backgroundColor: theme.card, borderRadius: 18, padding: 16, gap: 12, alignSelf: 'stretch', maxWidth: 600, width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: theme.text, fontSize: 17, fontWeight: '900' },
  close: { color: theme.muted, fontSize: 18, fontWeight: '800' },
  toggle: { flexDirection: 'row', gap: 8 },
  tBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center' },
  tBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tTxt: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  tTxtOn: { color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grpRow: { paddingBottom: 2 },
  grpTxt: { color: theme.accent, fontSize: 10.5, fontWeight: '800', textAlign: 'center', textTransform: 'uppercase', borderBottomWidth: 2, borderBottomColor: theme.accent, paddingBottom: 3 },
  hRow: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 5 },
  hCell: { color: theme.muted, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  cell: { textAlign: 'center', color: theme.text, fontSize: 12.5, fontVariant: ['tabular-nums'], paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  nmCell: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  nmTxt: { color: theme.text, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  pill: { minWidth: 24, paddingHorizontal: 3, paddingVertical: 1, borderRadius: 5, alignItems: 'center' },
  pillTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
  sc: { fontWeight: '900', color: theme.text, backgroundColor: 'rgba(16,185,166,0.10)' },
  hi: { color: theme.good, fontWeight: '800' },
  err: { color: theme.bad, fontWeight: '800' },
  zero: { color: theme.border },
  tot: { borderTopWidth: 2, borderTopColor: theme.border, backgroundColor: theme.bg },
  totTxt: { color: theme.text, fontWeight: '800', fontSize: 12.5, textAlign: 'center', paddingVertical: 7, borderBottomWidth: 0 },
  empty: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  hint: { color: theme.muted, fontSize: 10.5, lineHeight: 15 },
  resume: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  resumeTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
