import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { buildDraftContext } from '../data/draftSetup';
import { getTeam } from '../data/league';
import { computeStandings } from '../data/standings';
import { resolveDraft } from '../engine/draft';
import { overall } from '../engine/overall';
import { useGameStore } from '../store/useGameStore';
import type { Player } from '../types';

function potStars(p: Player): string {
  const pot = Math.max(...Object.values(p.potential));
  return pot >= 88 ? '★★★' : pot >= 80 ? '★★' : pot >= 72 ? '★' : '·';
}

export default function DraftCenter() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faSignings = useGameStore((s) => s.faSignings);
  const protectedIds = useGameStore((s) => s.protectedIds);
  const draftPicks = useGameStore((s) => s.draftPicks);
  const toggleDraftPick = useGameStore((s) => s.toggleDraftPick);
  const endSeason = useGameStore((s) => s.endSeason);

  const ctx = useMemo(
    () => buildDraftContext(my, resignDecisions, contractOverrides, faSignings, protectedIds, season + 1),
    [my, resignDecisions, contractOverrides, faSignings, protectedIds, season],
  );
  const standings = useMemo(() => computeStandings(), [season]);

  // 미리보기: 내가 실제로 지명하게 될 신인
  const clsById = useMemo(() => new Map(ctx.cls.map((p) => [p.id, p])), [ctx]);
  const preview = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => ctx.snapshot[id], my, draftPicks);
  const beforeMy = new Set(ctx.rosters[my] ?? []);
  const myDrafted = (preview.rosters[my] ?? [])
    .filter((id) => !beforeMy.has(id))
    .map((id) => clsById.get(id))
    .filter((p): p is Player => !!p);

  const classSorted = [...ctx.cls].sort((a, b) => overall(b) - overall(a));
  const myRank = standings.findIndex((s) => s.teamId === my) + 1;

  const onFinish = () => {
    endSeason();
    router.replace('/(tabs)');
  };

  return (
    <Screen title={`${season + 2}시즌 신인 드래프트`}>
      <Card>
        <Row>
          <Muted>내 순위 {myRank}위 · 지명권 {ctx.myHoles}장</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            지명 순번 {ctx.myPickSlots.map((i) => i + 1).join(', ') || '-'}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          하위 팀이 앞 순번(추첨). 원하는 신인을 담아두면 순번에서 가능한 선수를 자동 지명합니다.
          AI가 먼저 데려가면 다음 우선순위로 넘어갑니다. ★=포텐셜(스카우팅).
        </Muted>
      </Card>

      <Button label="다음 시즌 시작" onPress={onFinish} />

      <Title>내 지명 결과 (미리보기)</Title>
      {myDrafted.length === 0 ? (
        <Card><Muted>아직 지명 예정 선수가 없습니다. 아래에서 신인을 담아보세요.</Muted></Card>
      ) : (
        myDrafted.map((p) => (
          <View key={p.id} style={styles.row}>
            <PosTag pos={p.position} />
            <Text style={[styles.name, { flex: 1 }]}>{p.name}</Text>
            <Text style={styles.pot}>{potStars(p)}</Text>
            <OvrBadge value={overall(p)} />
          </View>
        ))
      )}

      <Title>드래프트 클래스 ({classSorted.length}명)</Title>
      {classSorted.map((p) => {
        const wi = draftPicks.indexOf(p.id);
        const picked = wi >= 0;
        return (
          <Pressable
            key={p.id}
            onPress={() => toggleDraftPick(p.id)}
            style={[styles.row, picked && { borderColor: theme.accent, borderWidth: 1, backgroundColor: theme.accent + '18' }]}
          >
            <PosTag pos={p.position} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {p.name} <Text style={{ color: theme.warn }}>{potStars(p)}</Text>
              </Text>
              <Text style={styles.sub}>{p.age}세 · {p.height}cm</Text>
            </View>
            <OvrBadge value={overall(p)} />
            <Text style={{ width: 40, textAlign: 'right', color: picked ? theme.accent : theme.muted, fontWeight: '800' }}>
              {picked ? `담음${wi + 1}` : '담기'}
            </Text>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  pot: { color: theme.warn, fontWeight: '800', width: 40, textAlign: 'center' },
});
