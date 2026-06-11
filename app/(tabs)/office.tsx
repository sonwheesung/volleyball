import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../../components/Screen';
import { getEvolvedTeamPlayers, getPlayer, getTeam } from '../../data/league';
import { getPlayerProduction } from '../../data/production';
import { activeRoster, payroll } from '../../data/roster';
import { overall } from '../../engine/overall';
import { canAfford, isFranchise, LEAGUE_CAP } from '../../engine/cap';
import { ROSTER_MIN } from '../../engine/transactions';
import { assignFAGrades, askingPrice, willBeFA } from '../../engine/faMarket';
import { contractStatus, formatMoney, marketValue } from '../../engine/salary';
import { useGameStore } from '../../store/useGameStore';
import type { Contract, Player } from '../../types';

const STATUS_COLOR = { 꿀계약: theme.good, 적정: theme.muted, 고연봉: theme.bad } as const;
const RESIGN_YEARS = 3;

export default function Office() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const reSign = useGameStore((s) => s.reSign);
  const release = useGameStore((s) => s.release);
  const unrelease = useGameStore((s) => s.unrelease);
  const setResign = useGameStore((s) => s.setResign);

  const team = getTeam(teamId);
  const evolved = getEvolvedTeamPlayers(teamId, currentDay);
  const roster = activeRoster(evolved, overrides, released).sort(
    (a, b) => b.contract.salary - a.contract.salary,
  );
  const total = payroll(roster);
  const budget = LEAGUE_CAP;
  void team;
  const releasedPlayers = released.map((id) => getPlayer(id)).filter((p): p is Player => !!p);
  const faList = roster.filter(willBeFA);
  const faGrades = assignFAGrades(faList);

  const onResign = (p: Player) => {
    const market = marketValue(p, getPlayerProduction(p.id, currentDay));
    if (!canAfford(total - p.contract.salary, market, { franchise: isFranchise(p) })) {
      Alert.alert(
        '샐러리캡 초과',
        `${p.name} 재계약(${formatMoney(market)})이 캡(${formatMoney(LEAGUE_CAP)})을 넘습니다. 방출/정리 후 시도하세요.`,
      );
      return;
    }
    const contract: Contract = {
      salary: market,
      years: RESIGN_YEARS,
      remaining: RESIGN_YEARS,
      signedAtAge: p.age,
    };
    Alert.alert(
      '재계약',
      `${p.name}\n연봉 ${formatMoney(p.contract.salary)} → ${formatMoney(market)} · ${RESIGN_YEARS}년 연장`,
      [
        { text: '취소', style: 'cancel' },
        { text: '재계약', onPress: () => reSign(p.id, contract) },
      ],
    );
  };

  const onRelease = (p: Player) => {
    Alert.alert('방출', `${p.name} 방출\n연봉 ${formatMoney(p.contract.salary)} 절감 (되돌릴 수 있음)`, [
      { text: '취소', style: 'cancel' },
      {
        text: '방출', style: 'destructive',
        onPress: () => {
          if (!release(p.id)) Alert.alert('방출 불가', `로스터 하한(${ROSTER_MIN}명) 밑으로는 방출할 수 없습니다.`);
        },
      },
    ]);
  };

  return (
    <Screen title="단장 업무">
      <Card>
        <Row>
          <Muted>팀 총연봉 / 예산</Muted>
          <Text style={{ color: total > budget ? theme.bad : theme.text, fontSize: 16, fontWeight: '800' }}>
            {formatMoney(total)} / {formatMoney(budget)}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          잔여 {formatMoney(Math.max(0, budget - total))} · 선수 {roster.length}명
        </Muted>
      </Card>

      <Card onPress={() => router.push('/staff')}>
        <Row>
          <Title>스태프 계약</Title>
          <Muted>감독 · 코치 · 스카우터 →</Muted>
        </Row>
        <Muted style={{ fontSize: 12, marginTop: 2 }}>감독 영입 · 전문 코치(훈련 부스트) · 스카우터(드래프트 공개도)</Muted>
      </Card>

      <Card onPress={() => router.push('/transactions')}>
        <Row>
          <Title>시즌 중 FA 영입</Title>
          <Muted>포지션 구멍 메우기 →</Muted>
        </Row>
        <Muted style={{ fontSize: 12, marginTop: 2 }}>방출 선수·미계약 FA를 시즌 중 즉시 영입(캡·정원 적용)</Muted>
      </Card>

      <Title>계약 관리</Title>
      {roster.map((p) => {
        const market = marketValue(p, getPlayerProduction(p.id, currentDay));
        const status = contractStatus(p.contract.salary, market);
        return (
          <View key={p.id} style={styles.row}>
            <Pressable
              style={styles.info}
              onPress={() => router.push(`/player/${p.id}`)}
            >
              <PosTag pos={p.position} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.sub}>
                  {p.age}세 · {formatMoney(p.contract.salary)} · 잔여 {p.contract.remaining}년 ·{' '}
                  <Text style={{ color: STATUS_COLOR[status] }}>{status}</Text>
                  {isFranchise(p) ? <Text style={{ color: theme.warn }}> · 프랜차이즈</Text> : null}
                </Text>
              </View>
              <OvrBadge value={overall(p)} />
            </Pressable>
            <View style={styles.actions}>
              <Pressable onPress={() => onResign(p)} style={[styles.btn, { borderColor: theme.accent }]}>
                <Text style={[styles.btnText, { color: theme.accent }]}>재계약</Text>
              </Pressable>
              <Pressable onPress={() => onRelease(p)} style={[styles.btn, { borderColor: theme.bad }]}>
                <Text style={[styles.btnText, { color: theme.bad }]}>방출</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {faList.length > 0 ? (
        <>
          <Title>FA 예정 (시즌 종료 시)</Title>
          <Muted style={{ fontSize: 12 }}>
            잔류하려면 요구연봉(시장가치×등급 프리미엄)을 지불합니다. 포기하면 떠납니다.
          </Muted>
          {faList.map((p) => {
            const grade = faGrades.get(p.id)!;
            const ask = askingPrice(marketValue(p, getPlayerProduction(p.id, currentDay)), grade);
            const keep = resignDecisions[p.id] !== false;
            return (
              <View key={p.id} style={styles.row}>
                <View style={styles.info}>
                  <PosTag pos={p.position} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {p.name} <Text style={{ color: theme.accent }}>{grade}등급</Text>
                    </Text>
                    <Text style={styles.sub}>{p.age}세 · 요구 {formatMoney(ask)}</Text>
                  </View>
                  <OvrBadge value={overall(p)} />
                </View>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => setResign(p.id, true)}
                    style={[styles.btn, { borderColor: keep ? theme.good : theme.border, backgroundColor: keep ? theme.good + '22' : 'transparent' }]}
                  >
                    <Text style={[styles.btnText, { color: keep ? theme.good : theme.muted }]}>잔류</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setResign(p.id, false)}
                    style={[styles.btn, { borderColor: !keep ? theme.bad : theme.border, backgroundColor: !keep ? theme.bad + '22' : 'transparent' }]}
                  >
                    <Text style={[styles.btnText, { color: !keep ? theme.bad : theme.muted }]}>포기</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </>
      ) : null}

      {releasedPlayers.length > 0 ? (
        <>
          <Title>방출 선수</Title>
          {releasedPlayers.map((p) => (
            <View key={p.id} style={styles.row}>
              <View style={styles.info}>
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: theme.muted }]}>{p.name}</Text>
                  <Text style={styles.sub}>{p.age}세 · {formatMoney(p.contract.salary)}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  if (!unrelease(p.id)) Alert.alert('복귀 불가', '방출 철회는 방출 당일에만 가능합니다(이후엔 FA 시장에서 재영입).');
                }}
                style={[styles.btn, { borderColor: theme.good }]}
              >
                <Text style={[styles.btnText, { color: theme.good }]}>복귀</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      <Muted style={{ fontSize: 12 }}>
        방출 선수는 즉시 FA가 되어 시즌 중 다른 팀이 영입할 수 있습니다(미영입 시 시즌말 정리).
        철회(복귀)는 방출 당일에만 가능합니다.
      </Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
});
