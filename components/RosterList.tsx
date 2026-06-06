import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Player, Position } from '../types';
import { overall } from '../engine/overall';
import { OvrBadge, PosTag, theme } from './Screen';

const POS_ORDER: Record<Position, number> = { S: 0, OH: 1, OP: 2, MB: 3, L: 4 };

/** 포지션 → 연령 정렬된 선수 행 목록. 각 행 탭 시 상세로 이동. */
export function RosterList({ players }: { players: Player[] }) {
  const router = useRouter();
  const sorted = [...players].sort(
    (a, b) => POS_ORDER[a.position] - POS_ORDER[b.position] || overall(b) - overall(a),
  );

  return (
    <View style={{ gap: 6 }}>
      {sorted.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => router.push(`/player/${p.id}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <PosTag pos={p.position} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.name}>{p.name}</Text>
              {p.isForeign ? <Text style={styles.foreign}>외국인</Text> : null}
            </View>
            <Text style={styles.sub}>
              {p.age}세 · {p.height}cm
            </Text>
          </View>
          <OvrBadge value={overall(p)} />
        </Pressable>
      ))}
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
});
