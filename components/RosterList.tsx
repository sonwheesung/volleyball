import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Player, Position } from '../types';
import { overall } from '../engine/overall';
import { formatMoney } from '../engine/salary';
import { OvrBadge, PosTag, theme } from './Screen';

const POS_ORDER: Record<Position, number> = { S: 0, OH: 1, OP: 2, MB: 3, L: 4 };

export interface RosterDecor { dotColor?: string; mood?: string }

/** 포지션 → 연령 정렬된 선수 행 목록. 각 행 탭 시 상세로 이동.
 *  decor: 선수별 컨디션 점(●)·기분 뱃지(😟🪑) — 구단주 레이어 표시(선택). */
export function RosterList({ players, decor }: { players: Player[]; decor?: (p: Player) => RosterDecor }) {
  const router = useRouter();
  const sorted = [...players].sort(
    (a, b) => POS_ORDER[a.position] - POS_ORDER[b.position] || overall(b) - overall(a),
  );

  return (
    <View style={{ gap: 6 }}>
      {sorted.map((p) => {
        const d = decor?.(p);
        return (
        <Pressable
          key={p.id}
          onPress={() => router.push(`/player/${p.id}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <PosTag pos={p.position} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {d?.dotColor ? <Text style={{ color: d.dotColor, fontSize: 11 }}>●</Text> : null}
              <Text style={styles.name}>{p.name}</Text>
              {d?.mood ? <Text style={{ fontSize: 12 }}>{d.mood}</Text> : null}
              {p.isForeign ? <Text style={styles.foreign}>외국인</Text> : null}
            </View>
            <Text style={styles.sub}>
              {p.age}세 · {p.height}cm
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <OvrBadge value={overall(p)} />
            <Text style={styles.salary}>{formatMoney(p.contract.salary)}</Text>
          </View>
        </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  foreign: { color: theme.bad, fontSize: 11, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  salary: { color: theme.muted, fontSize: 12, fontWeight: '700' },
});
