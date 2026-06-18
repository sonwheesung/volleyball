// 구단 정체성 표시 위젯 (CLUB_IDENTITY_SYSTEM) — 선택 화면·구단 상세 공용.
import { Text, View } from 'react-native';
import { theme } from './Screen';
import type { ClubIdentity, ClubIdentityKey } from '../types';

const CHIP_COLOR: Record<ClubIdentityKey, string> = {
  dynasty: theme.elite,
  aging: theme.warn,
  rising: theme.good,
  midpack: theme.muted,
  rebuild: theme.accent,
  cellar: theme.bad,
  expansion: theme.accent,
};

/** 정체성 칩 — 라벨 + 색으로 결을 한눈에 */
export function IdentityChip({ identity }: { identity: ClubIdentity }) {
  const c = CHIP_COLOR[identity.key];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: c + '22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      <Text style={{ color: c, fontSize: 12, fontWeight: '800' }}>{identity.label}</Text>
    </View>
  );
}

/** 최근 N시즌 가상 순위 — 1(우승)=민트, 꼴찌권=코랄 */
export function RecentRanks({ ranks, teamCount = 7 }: { ranks: number[]; teamCount?: number }) {
  if (!ranks.length) {
    return <Text style={{ color: theme.muted, fontSize: 11 }}>창단 첫 시즌 — 기록 없음</Text>;
  }
  const rankColor = (r: number) => (r === 1 ? theme.good : r <= 3 ? theme.accent : r >= teamCount - 1 ? theme.bad : theme.muted);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ color: theme.muted, fontSize: 11, marginRight: 2 }}>최근</Text>
      {ranks.map((r, i) => (
        <View key={i} style={{ minWidth: 18, height: 18, borderRadius: 4, backgroundColor: rankColor(r) + '22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ color: rankColor(r), fontSize: 11, fontWeight: '700' }}>{r}</Text>
        </View>
      ))}
    </View>
  );
}
