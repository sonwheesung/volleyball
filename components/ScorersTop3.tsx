import { StyleSheet, Text, View } from 'react-native';
import { IconLabel, PosTag, theme } from './Screen';
import { themedStyles } from './theme';
import { emptyBox } from '../engine/rally';
import type { Player } from '../types';
import type { BoxSink, BoxLine } from '../engine/rally';

// 한 팀 득점원 Top3 — 경기 뉴스 상세(news/[id])의 축약 카드(NEWS §11.5). BoxScoreTable과 동일 득점식.
// 풀박스(BoxScoreTable)가 아니라 득점 상위 3인 + 내역(공격·블록·서브)만. 득점 0(세터·리베로)은 순수 득점 Top3라 자연 제외.
const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce; // 득점 = 공격+블록+에이스 (BoxScoreTable와 단일 식)

export function ScorersTop3({ teamName, squad, box, accent = theme.elite }: {
  teamName: string; squad: Player[]; box: BoxSink | undefined; accent?: string;
}) {
  const rows = squad
    .map((p) => ({ p, l: box?.get(p.id) ?? emptyBox() }))
    .filter((r) => pts(r.l) > 0)
    .sort((x, y) => pts(y.l) - pts(x.l) || y.l.atkAtt - x.l.atkAtt) // 동점=공격 시도순(BoxScoreTable 2차키와 동일)
    .slice(0, 3);

  return (
    <View>
      <IconLabel icon="podium-outline" color={accent}>{teamName} 득점원</IconLabel>
      {rows.length === 0 ? (
        <Text style={styles.empty}>기록된 득점이 없습니다.</Text>
      ) : (
        rows.map(({ p, l }, i) => {
          const parts: string[] = [];
          if (l.atkKill > 0) parts.push(`공격 ${l.atkKill}`);
          if (l.blockPt > 0) parts.push(`블록 ${l.blockPt}`);
          if (l.srvAce > 0) parts.push(`서브 ${l.srvAce}`);
          return (
            <View key={p.id} style={styles.row}>
              <Text style={styles.rank}>{i + 1}</Text>
              <PosTag pos={p.position} solid compact />
              <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{p.name}</Text>
              <Text style={styles.detail} numberOfLines={1}>{parts.join(' · ')}</Text>
              <Text style={styles.pts}>{pts(l)}<Text style={styles.ptsUnit}>점</Text></Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  rank: { color: theme.muted, fontSize: 13, fontWeight: '800', width: 16, textAlign: 'center' },
  name: { color: theme.text, fontSize: 14.5, fontWeight: '700', flexShrink: 0 },
  detail: { color: theme.muted, fontSize: 12.5, flex: 1, textAlign: 'right' },
  pts: { color: theme.text, fontSize: 17, fontWeight: '900', minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
  ptsUnit: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  empty: { color: theme.muted, fontSize: 13, paddingVertical: 12 },
}));
