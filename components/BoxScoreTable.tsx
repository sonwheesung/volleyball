import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PosTag, theme } from './Screen';
import { themedStyles } from './theme';
import { buildLineup } from '../engine/lineup';
import { emptyBox } from '../engine/rally';
import type { Player } from '../types';
import type { BoxSink, BoxLine } from '../engine/rally';

// 공용 박스스코어 표(한 팀) — 엔진 테스트 콘솔(sim-web)의 네이버 종합 스타일.
// 경기 보드 스코어박스 팝업(LiveBoxModal)과 경기 상세(matchresult)가 같은 표를 쓰도록 추출.
// 박스 싱크(BoxSink, 실제 스윙 단위)를 그린다 — 점수 0이어도 선발 7인을 0으로 항상 표시.
// 포지션 배지는 공용 PosTag(solid·compact) — 색은 posTokens 단일 소스(예전 로컬 POS_COLOR는 S색 드리프트였음).
const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce;       // 득점 = 공격+블록+에이스
const rateN = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const fmt = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`);

const NAME_W = 96;
// 리시브(서브 리시브) 칸 제거(2026-07-29 테스터: "리시브"가 스파이크 수비[디그]로 오해됨). 엔진의 서브 리시브 계산은
//   그대로(밸런스·귀속 유지) — 표시만 뺀다. 서브 리시브는 리베로+OH만 담당(세터·OP·MB는 대형서 숨김)이라 칸이 대부분
//   "–"라 오해를 키웠음. 수비는 디그 칸(전원)이 대표.
const C = { sc: 34, ak: 30, aa: 30, ap: 48, bl: 32, sv: 32, dg: 32, st: 32, er: 34 };
const ATK_W = C.ak + C.aa + C.ap;
const REST_W = C.bl + C.sv + C.dg + C.st + C.er;
const TABLE_W = NAME_W + C.sc + ATK_W + REST_W;

// dvPhilosophy: 감독 육성 철학 — 엔진(match.ts buildLineup)과 **동일 인자**로 선발 7인을 도출해야 선발/교체 그룹핑이
//   실제 시뮬 코트와 일치(dv 미전달 시 근소차 슬롯이 어긋나 U23이 선발/비선발로 오분류, 감사 P1·P2 ④). 생략=0(neutral).
export function BoxScoreTable({ squad, box, dvPhilosophy = 0 }: { squad: Player[]; box: BoxSink | undefined; dvPhilosophy?: number }) {
  // 선발 7인(코트 6 + 리베로) 항상 + 교체 투입돼 기록 생긴 비선발. 득점순(동점=선발 순서).
  const order = useMemo(() => {
    const lu = buildLineup(squad, dvPhilosophy);
    const starters = [...lu.six, lu.libero].filter((p): p is Player => !!p);
    const ids = new Set(starters.map((p) => p.id));
    const subs = squad.filter((p) => !ids.has(p.id) && !!box?.get(p.id));
    return [...starters, ...subs];
  }, [squad, box, dvPhilosophy]);
  const rows = order
    .map((p, i) => ({ p, l: box?.get(p.id) ?? emptyBox(), i }))
    .sort((x, y) => pts(y.l) - pts(x.l) || y.l.atkAtt - x.l.atkAtt || x.i - y.i);

  const T = rows.reduce(
    (t, { l }) => {
      t.pt += pts(l); t.ak += l.atkKill; t.aa += l.atkAtt; t.bl += l.blockPt; t.ac += l.srvAce;
      t.dg += l.digSucc; t.as += l.assist;
      t.er += l.atkErr + l.srvErr;
      return t;
    },
    { pt: 0, ak: 0, aa: 0, bl: 0, ac: 0, dg: 0, as: 0, er: 0 },
  );

  const num = (v: number, w: number) => (
    <Text style={[styles.cell, { width: w }, v === 0 ? styles.zero : undefined]}>{v}</Text>
  );

  if (rows.length === 0) return <Text style={styles.empty}>출전 명단이 없습니다.</Text>;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ width: TABLE_W }}>
        {/* 공격/수비 그룹 라벨 제거(2026-07-29 테스터: 블록·서브·세트가 두 그룹 사이 라벨 없이 끼어 수비 범위가 어색 —
            배구 스탯은 2분류로 안 떨어지는 7개 개별 항목. 칸 헤더만으로 충분). 세트는 서브·디그 사이 유지. */}
        {/* 칸 헤더 */}
        <View style={[styles.row, styles.hRow]}>
          <Text style={[styles.hCell, { width: NAME_W, textAlign: 'left' }]}>선수</Text>
          <Text style={[styles.hCell, { width: C.sc }]}>득점</Text>
          <Text style={[styles.hCell, { width: C.ak }]}>성공</Text>
          <Text style={[styles.hCell, { width: C.aa }]}>시도</Text>
          <Text style={[styles.hCell, { width: C.ap }]}>성공률</Text>
          <Text style={[styles.hCell, { width: C.bl }]}>블록</Text>
          <Text style={[styles.hCell, { width: C.sv }]}>서브</Text>
          <Text style={[styles.hCell, { width: C.st }]}>세트</Text>
          <Text style={[styles.hCell, { width: C.dg }]}>디그</Text>
          <Text style={[styles.hCell, { width: C.er }]}>범실</Text>
        </View>
        {/* 선수 행 */}
        {rows.map(({ p, l }) => {
          const ap = rateN(l.atkKill, l.atkAtt);
          const err = l.atkErr + l.srvErr;
          return (
            <View key={p.id} style={styles.row}>
              <View style={[styles.nmCell, { width: NAME_W }]}>
                <PosTag pos={p.position} solid compact />
                <Text style={styles.nmTxt} numberOfLines={1} ellipsizeMode="tail">{p.name}</Text>
              </View>
              <Text style={[styles.cell, styles.sc, { width: C.sc }]}>{pts(l)}</Text>
              {num(l.atkKill, C.ak)}
              {num(l.atkAtt, C.aa)}
              <Text style={[styles.cell, { width: C.ap }, ap !== null && ap >= 45 ? styles.hi : ap === null ? styles.zero : undefined]}>{fmt(ap)}</Text>
              {num(l.blockPt, C.bl)}
              {num(l.srvAce, C.sv)}
              {num(l.assist, C.st)}
              {num(l.digSucc, C.dg)}
              <Text style={[styles.cell, { width: C.er }, err > 0 ? styles.err : styles.zero]}>{err}</Text>
            </View>
          );
        })}
        {/* 팀 합계 */}
        <View style={[styles.row, styles.tot]}>
          <Text style={[styles.totTxt, { width: NAME_W, textAlign: 'left' }]}>팀 합계</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.sc }]}>{T.pt}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.ak }]}>{T.ak}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.aa }]}>{T.aa}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.ap }]}>{fmt(rateN(T.ak, T.aa))}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.bl }]}>{T.bl}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.sv }]}>{T.ac}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.st }]}>{T.as}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.dg }]}>{T.dg}</Text>
          <Text style={[styles.cell, styles.totTxt, { width: C.er }]}>{T.er}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  hRow: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 5 },
  hCell: { color: theme.muted, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  cell: { textAlign: 'center', color: theme.text, fontSize: 12.5, fontVariant: ['tabular-nums'], paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  nmCell: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  nmTxt: { color: theme.text, fontSize: 12.5, fontWeight: '700', flex: 1, minWidth: 0 },
  sc: { fontWeight: '900', color: theme.text, backgroundColor: 'rgba(16,185,166,0.10)' },
  hi: { color: theme.good, fontWeight: '800' },
  err: { color: theme.bad, fontWeight: '800' },
  zero: { color: theme.border },
  tot: { borderTopWidth: 2, borderTopColor: theme.border, backgroundColor: theme.bg },
  totTxt: { color: theme.text, fontWeight: '800', fontSize: 12.5, textAlign: 'center', paddingVertical: 7, borderBottomWidth: 0 },
  empty: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
}));
