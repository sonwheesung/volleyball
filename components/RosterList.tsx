import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Player } from '../types';
import { overall, overallRaw, displayOvr, fogOvr } from '../engine/overall';
import { formatMoney } from '../engine/salary';
import { OvrBadge, PosTag, theme } from './Screen';
import { themedStyles } from './theme';
import { POS_COLOR, POS_ORDER } from './posTokens';

export interface RosterDecor { dotColor?: string; mood?: string }

/** 포지션 → 연령 정렬된 선수 행 목록. 각 행 탭 시 상세로 이동.
 *  decor: 선수별 컨디션 점(●)·기분 뱃지(😟🪑) — 구단주 레이어 표시(선택).
 *  starterIds: 주어지면 "주전 먼저 → 포지션순, 그 다음 벤치 → 포지션순"으로 정렬 + 주전/벤치 구분선. */
export type RosterSort = 'position' | 'salary' | 'ovr';

export function RosterList({ players, decor, starterIds, sort = 'position', reveal = 1 }: { players: Player[]; decor?: (p: Player) => RosterDecor; starterIds?: Set<string>; sort?: RosterSort; reveal?: number }) {
  const router = useRouter();
  const isStarter = (p: Player) => !!starterIds && starterIds.has(p.id);
  const sorted = [...players].sort((a, b) => {
    if (starterIds) { const sa = isStarter(a) ? 0 : 1, sb = isStarter(b) ? 0 : 1; if (sa !== sb) return sa - sb; }
    if (sort === 'salary') return b.contract.salary - a.contract.salary || overallRaw(b) - overallRaw(a);
    if (sort === 'ovr') return overallRaw(b) - overallRaw(a) || POS_ORDER[a.position] - POS_ORDER[b.position];
    return POS_ORDER[a.position] - POS_ORDER[b.position] || overall(b) - overall(a);
  });
  const firstBenchIdx = starterIds ? sorted.findIndex((p) => !isStarter(p)) : -1;
  const showGroups = !!starterIds && firstBenchIdx > 0; // 주전·벤치가 둘 다 있을 때만 구분선

  return (
    <View style={{ gap: 6 }}>
      {sorted.map((p, i) => {
        const d = decor?.(p);
        return (
        <View key={p.id} style={{ gap: 6 }}>
          {showGroups && i === 0 ? <Text style={styles.groupLabel}>주전</Text> : null}
          {showGroups && i === firstBenchIdx ? <Text style={styles.groupLabel}>벤치</Text> : null}
          <Pressable
            onPress={() => router.push(`/player/${p.id}`)}
            style={({ pressed }) => [styles.row, { borderLeftWidth: 4, borderLeftColor: POS_COLOR[p.position] }, pressed && { opacity: 0.7 }]}
          >
            <PosTag pos={p.position} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {d?.dotColor ? <Text style={{ color: d.dotColor, fontSize: 11 }}>●</Text> : null}
                <Text style={styles.name}>{p.name}</Text>
                {d?.mood ? <Text style={{ fontSize: 12 }}>{d.mood}</Text> : null}
                {p.isAsianQuota ? <Text style={styles.asian}>아시아쿼터{p.nationality ? `·${p.nationality}` : ''}</Text> : p.isForeign ? <Text style={styles.foreign}>외국인</Text> : null}
              </View>
              <Text style={styles.sub}>
                {p.age}세 · {p.height}cm
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {reveal >= 0.92 ? (
                <OvrBadge value={overallRaw(p)} />
              ) : (
                <View style={styles.fogOvr}><Text style={styles.fogOvrTxt}>{fogOvr(displayOvr(overallRaw(p)), reveal)}</Text></View>
              )}
              <Text style={styles.salary}>{formatMoney(p.contract.salary)}</Text>
            </View>
          </Pressable>
        </View>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  groupLabel: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 6, marginLeft: 2 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  foreign: { color: theme.bad, fontSize: 11, fontWeight: '700' },
  asian: { color: theme.elite, fontSize: 11, fontWeight: '700' }, // 아시아쿼터 — 외국인(코랄)과 구분되는 블루
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  salary: { color: theme.text, fontSize: 13, fontWeight: '800', minWidth: 52, textAlign: 'right' },
  fogOvr: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  fogOvrTxt: { color: theme.muted, fontSize: 12, fontWeight: '800' },
}));
