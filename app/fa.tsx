import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { currentRosters, getTeam } from '../data/league';
import { buildOffseason } from '../data/offseason';
import { assignFAGrades, askingPrice } from '../engine/faMarket';
import { overall } from '../engine/overall';
import { formatMoney, marketValue } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';

function shortTeam(teamId: string): string {
  const n = getTeam(teamId)?.name ?? '';
  const parts = n.split(' ');
  return parts.length > 1 ? parts[1] : n;
}

export default function FACenter() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faSignings = useGameStore((s) => s.faSignings);
  const signFA = useGameStore((s) => s.signFA);
  const unsignFA = useGameStore((s) => s.unsignFA);
  const endSeason = useGameStore((s) => s.endSeason);

  // 이전 소속(표시용) — 풀 형성 전 로스터 기준
  const prevTeamOf = useMemo(() => {
    const m: Record<string, string> = {};
    const rs = currentRosters();
    for (const tid of Object.keys(rs)) for (const id of rs[tid]) m[id] = tid;
    return m;
  }, [season]);

  const off = useMemo(
    () => buildOffseason(my, resignDecisions, contractOverrides, season + 1),
    [my, resignDecisions, contractOverrides, season],
  );

  const poolPlayers = off.pool
    .map((id) => off.snapshot[id])
    .filter(Boolean)
    .sort((a, b) => overall(b) - overall(a));
  const grades = assignFAGrades(poolPlayers);

  const onFinish = () => {
    endSeason();
    router.replace('/(tabs)');
  };

  return (
    <Screen title={`${season + 1}→${season + 2}시즌 FA 시장`}>
      <Card>
        <Row>
          <Muted>영입 선택 / FA 풀</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {faSignings.length}명 / {poolPlayers.length}명
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          타 구단이 풀어준 FA와 내가 포기한 선수가 풀에 나옵니다. 영입 후 "다음 시즌 시작"으로 확정.
          남은 자리는 AI·신인으로 채워집니다.
        </Muted>
      </Card>

      <Button label="다음 시즌 시작" onPress={onFinish} />

      <Title>FA 시장 ({poolPlayers.length}명)</Title>
      {poolPlayers.length === 0 ? (
        <Card>
          <Muted>이번 오프시즌 풀린 FA가 없습니다.</Muted>
        </Card>
      ) : (
        poolPlayers.map((p) => {
          const grade = grades.get(p.id)!;
          const ask = askingPrice(marketValue(p), grade);
          const signed = faSignings.includes(p.id);
          const prev = prevTeamOf[p.id];
          return (
            <View key={p.id} style={styles.row}>
              <View style={styles.info}>
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {p.name} <Text style={{ color: theme.accent }}>{grade}</Text>
                    {p.isForeign ? <Text style={{ color: theme.bad }}> 외</Text> : null}
                  </Text>
                  <Text style={styles.sub}>
                    {p.age}세 · {ask ? formatMoney(ask) : ''} {prev ? `· ${shortTeam(prev)}` : ''}
                  </Text>
                </View>
                <OvrBadge value={overall(p)} />
              </View>
              <Pressable
                onPress={() => (signed ? unsignFA(p.id) : signFA(p.id))}
                style={[
                  styles.btn,
                  { borderColor: signed ? theme.bad : theme.accent, backgroundColor: signed ? theme.bad + '22' : theme.accent + '22' },
                ]}
              >
                <Text style={[styles.btnText, { color: signed ? theme.bad : theme.accent }]}>
                  {signed ? '취소' : '영입'}
                </Text>
              </Pressable>
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
});
