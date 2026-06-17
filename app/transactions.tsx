import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { evolveOnDay } from '../data/league';
import { availableFAsOnDay, rosterIdsOnDay } from '../data/dynamics';
import { overall, overallRaw, displayOvr } from '../engine/overall';
import { LEAGUE_CAP } from '../engine/cap';
import { ROSTER_MAX, inSeasonCost } from '../engine/transactions';
import { FOREIGN_SALARY } from '../engine/foreign';
import { formatMoney, marketValue } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';
import type { Player } from '../types';

export default function Transactions() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const inSeasonTx = useGameStore((s) => s.inSeasonTx);
  const signInSeason = useGameStore((s) => s.signInSeason);
  const cash = useGameStore((s) => s.cash); // 운영 자금(FINANCE) — 캡과 별개 게이트
  const foreignAltPool = useGameStore((s) => s.foreignAltPool);
  const foreignSubUsed = useGameStore((s) => s.foreignSubUsed);
  const replaceForeign = useGameStore((s) => s.replaceForeign);

  // 내 팀 현재 명단(날짜 인지) — 정원·캡 계산
  const myIds = rosterIdsOnDay(teamId, currentDay);
  const payroll = myIds.reduce((s, id) => s + (evolveOnDay(id, currentDay)?.contract.salary ?? 0), 0);
  const capLeft = Math.max(0, LEAGUE_CAP - payroll);
  const full = myIds.length >= ROSTER_MAX;

  // 영입 가능 FA(날짜 인지) — OVR 순
  const fas = availableFAsOnDay(currentDay)
    .map((id) => evolveOnDay(id, currentDay))
    .filter((p): p is Player => !!p)
    .sort((a, b) => overall(b) - overall(a));

  const signedThis = inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === teamId);

  // 내가 이번 시즌 방출한 선수 — 재영입엔 배신 웃돈 ×1.5
  const isBetrayed = (id: string) => inSeasonTx.some((t) => t.kind === 'release' && t.teamId === teamId && t.playerId === id);

  const onSign = (p: Player) => {
    const betrayed = isBetrayed(p.id);
    const cost = inSeasonCost(marketValue(p), betrayed);
    Alert.alert('FA 영입', `${p.name} (${p.position})\n연봉 ${formatMoney(cost)}${betrayed ? ' (방출 재영입 웃돈 ×1.5)' : ''} · 즉시 합류`, [
      { text: '취소', style: 'cancel' },
      {
        text: '영입',
        onPress: () => {
          if (!signInSeason(p.id)) {
            Alert.alert('영입 불가', full
              ? `로스터 정원(${ROSTER_MAX}명) 초과`
              : cost > cash
                ? `운영 자금 부족 — 잔고 ${formatMoney(cash)} (캡과 별개로 구단 지갑이 비었습니다)`
                : `샐러리캡 초과 — 잔여 ${formatMoney(capLeft)}`);
          }
        },
      },
    ]);
  };

  return (
    <Screen title="시즌 중 FA 영입">
      <Card>
        <Row>
          <Muted>캡 잔여 · 운영 자금 · 정원</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {formatMoney(capLeft)} · {formatMoney(cash)} · {myIds.length}/{ROSTER_MAX}명
          </Text>
        </Row>
        <Muted style={{ fontSize: 12, marginTop: 2 }}>
          포지션 구멍을 즉시 메웁니다. 방출은 단장 업무(계약 관리)에서. 미영입 방출자는 시즌말 정리됩니다.
        </Muted>
      </Card>

      {signedThis.length > 0 ? (
        <>
          <Title>이번 시즌 영입</Title>
          {signedThis.map((t) => {
            const p = evolveOnDay(t.playerId, currentDay);
            return (
              <View key={t.playerId} style={styles.row}>
                <PosTag pos={p?.position ?? 'OH'} />
                <Text style={styles.name}>{p?.name ?? t.playerId}</Text>
                <Muted style={{ fontSize: 12 }}>day {t.day} 영입</Muted>
              </View>
            );
          })}
        </>
      ) : null}

      {foreignAltPool.length > 0 ? (
        <>
          <Title>외국인 교체 (시즌 1회{foreignSubUsed ? ' — 사용함' : ''})</Title>
          <Muted style={{ fontSize: 12 }}>
            부진한 외인을 퇴출하고 대체 외인을 영입합니다. 퇴출 외인은 리그를 떠나며,
            대체 외인 연봉 {formatMoney(FOREIGN_SALARY)}은 운영 자금에서 추가 부담합니다.
          </Muted>
          {foreignAltPool.map((id) => {
            const p = evolveOnDay(id, currentDay);
            if (!p) return null;
            const can = !foreignSubUsed && FOREIGN_SALARY <= cash;
            return (
              <View key={id} style={styles.row}>
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <Text style={styles.sub}>{p.age}세 · OVR {displayOvr(overallRaw(p))}</Text>
                </View>
                <Pressable
                  onPress={() => {
                    Alert.alert('외인 교체', `${p.name}을(를) 영입하고 현 외국인 선수를 퇴출합니다.\n추가 부담 ${formatMoney(FOREIGN_SALARY)} · 시즌 1회`, [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '교체', style: 'destructive',
                        onPress: () => {
                          if (!replaceForeign(p.id)) Alert.alert('교체 불가', foreignSubUsed ? '이번 시즌 교체를 이미 사용했습니다.' : FOREIGN_SALARY > cash ? '운영 자금이 부족합니다.' : '현재 외국인 선수가 없습니다.');
                        },
                      },
                    ]);
                  }}
                  disabled={!can}
                  style={[styles.btn, { borderColor: can ? theme.warn : theme.border }]}
                >
                  <Text style={[styles.btnText, { color: can ? theme.warn : theme.muted }]}>교체</Text>
                </Pressable>
              </View>
            );
          })}
        </>
      ) : null}

      <Title>영입 가능 FA ({fas.length})</Title>
      {fas.length === 0 ? (
        <Card><Muted>현재 영입 가능한 FA가 없습니다. (방출 선수·오프시즌 미계약자가 풀에 쌓입니다.)</Muted></Card>
      ) : (
        fas.map((p) => {
          const betrayed = isBetrayed(p.id);
          const cost = inSeasonCost(marketValue(p), betrayed);
          const afford = payroll + cost <= LEAGUE_CAP && !full && cost <= cash;
          return (
            <Pressable
              key={p.id}
              style={styles.row}
              onPress={() => router.push(`/player/${p.id}`)}
            >
              <PosTag pos={p.position} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.sub}>
                  {p.age}세 · {formatMoney(cost)}{betrayed ? ' · 웃돈 ×1.5 (우리가 방출)' : ''}
                </Text>
              </View>
              <OvrBadge value={overallRaw(p)} />
              <Pressable
                onPress={() => onSign(p)}
                disabled={!afford}
                style={[styles.btn, { borderColor: afford ? theme.accent : theme.border }]}
              >
                <Text style={[styles.btnText, { color: afford ? theme.accent : theme.muted }]}>영입</Text>
              </Pressable>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
});
