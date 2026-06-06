import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { currentRosters, getTeam } from '../data/league';
import { buildOffseason } from '../data/offseason';
import { LEAGUE_CAP } from '../engine/cap';
import { needsCompensationPlayer, pickCompensation, PROTECT_COUNT } from '../engine/compensation';
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
  const protectedIds = useGameStore((s) => s.protectedIds);
  const signFA = useGameStore((s) => s.signFA);
  const unsignFA = useGameStore((s) => s.unsignFA);
  const toggleProtect = useGameStore((s) => s.toggleProtect);
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

  // 내 로스터(보호명단 대상) + 예상 보상선수
  const myRosterIds = off.rosters[my] ?? [];
  const myRoster = myRosterIds
    .map((id) => off.snapshot[id])
    .filter(Boolean)
    .sort((a, b) => overall(b) - overall(a));
  // 캡 사용량 = 내 로스터 연봉 + 영입 예정 요구연봉
  const myPayroll = myRosterIds.reduce((s, id) => s + (off.snapshot[id]?.contract.salary ?? 0), 0);
  const askOf = (id: string) => {
    const p = off.snapshot[id];
    const g = grades.get(id);
    return p && g ? askingPrice(marketValue(p), g) : 0;
  };
  const signCost = faSignings.reduce((s, id) => s + askOf(id), 0);
  const projected = myPayroll + signCost;

  const projectedComp = pickCompensation(myRosterIds, protectedIds, off.snapshot, []);
  const projectedCompName = projectedComp ? off.snapshot[projectedComp]?.name : null;
  // A/B 영입 수(보상선수 필요 건수)
  const compNeeded = faSignings.filter((id) => {
    const g = grades.get(id);
    return g ? needsCompensationPlayer(g) : false;
  }).length;

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
        <Row>
          <Muted>샐러리캡</Muted>
          <Text style={{ color: projected > LEAGUE_CAP ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(projected)} / {formatMoney(LEAGUE_CAP)}
          </Text>
        </Row>
      </Card>

      <Button label="다음 시즌 시작" onPress={onFinish} />

      {compNeeded > 0 ? (
        <Card>
          <Text style={{ color: theme.warn, fontSize: 13, fontWeight: '700' }}>
            A/B 영입 {compNeeded}명 → 보호명단 밖 {compNeeded}명이 원소속팀으로 갑니다.
          </Text>
          {projectedCompName ? (
            <Muted style={{ fontSize: 12 }}>현재 보상 1순위: {projectedCompName}</Muted>
          ) : null}
        </Card>
      ) : null}

      <Title>보호선수 명단 ({protectedIds.length}/{PROTECT_COUNT})</Title>
      <Muted style={{ fontSize: 12 }}>보호하지 않은 선수가 보상선수로 지명될 수 있습니다.</Muted>
      {myRoster.map((p) => {
        const prot = protectedIds.includes(p.id);
        return (
          <Pressable
            key={p.id}
            onPress={() => toggleProtect(p.id)}
            style={[styles.protectRow, prot && { borderColor: theme.good, backgroundColor: theme.good + '18' }]}
          >
            <PosTag pos={p.position} />
            <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
            <OvrBadge value={overall(p)} />
            <Text style={{ color: prot ? theme.good : theme.muted, fontWeight: '800', width: 36, textAlign: 'right' }}>
              {prot ? '보호' : '—'}
            </Text>
          </Pressable>
        );
      })}

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
          const overCap = !signed && projected + ask > LEAGUE_CAP;
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
                    {needsCompensationPlayer(grade) ? ' · 보상선수' : ''}
                  </Text>
                </View>
                <OvrBadge value={overall(p)} />
              </View>
              <Pressable
                disabled={overCap}
                onPress={() => (signed ? unsignFA(p.id) : signFA(p.id))}
                style={[
                  styles.btn,
                  { borderColor: signed ? theme.bad : theme.accent, backgroundColor: signed ? theme.bad + '22' : theme.accent + '22' },
                  overCap && { opacity: 0.4 },
                ]}
              >
                <Text style={[styles.btnText, { color: signed ? theme.bad : theme.accent }]}>
                  {signed ? '취소' : overCap ? '캡초과' : '영입'}
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
  protectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
});

