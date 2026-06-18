import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { shortTeamName as shortTeam } from '../data/league';
import { faMarketPreview } from '../data/offseason';
import { buildOwnerFx } from '../data/owner';
import { projectSettledCash } from '../data/financeProjection';
import { LEAGUE_CAP } from '../engine/cap';
import { needsCompensationPlayer, pickCompensation, PROTECT_COUNT } from '../engine/compensation';
import { assignFAGrades, askingPrice } from '../engine/faMarket';
import { overall, overallRaw } from '../engine/overall';
import { formatMoney } from '../engine/salary';
import { marketVal } from '../data/awardSalary';
import { useGameStore } from '../store/useGameStore';

export default function FACenter() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faSignings = useGameStore((s) => s.faSignings);
  const faAggressive = useGameStore((s) => s.faAggressive);
  const protectedIds = useGameStore((s) => s.protectedIds);
  const moneyOnlyIds = useGameStore((s) => s.moneyOnlyIds);
  const signFA = useGameStore((s) => s.signFA);
  const unsignFA = useGameStore((s) => s.unsignFA);
  const setAggressive = useGameStore((s) => s.setAggressive);
  const toggleProtect = useGameStore((s) => s.toggleProtect);
  const toggleMoneyOnly = useGameStore((s) => s.toggleMoneyOnly);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const archive = useGameStore((s) => s.archive);

  // 이번 시즌 정산 후 운영 자금 — endSeason이 FA에 쓰는 실제 지갑(모기업 지원·관중 수입 반영).
  //   store.cash(직전 정산값)로 미리보기하면 모기업 지원(14~28억)이 빠져 "영입 불가"로 오표시된다.
  const budgetCash = useMemo(
    () => projectSettledCash(my, season, cash, fanScore, archive),
    [my, season, cash, fanScore, archive],
  );

  // 경쟁 결과 미리보기(결정론) — 영입 성공/실패 예상.
  // endSeason과 동일한 ownerFx(면담·불만 거부)+정산 후 운영 자금을 넣어야 미리보기=결과가 보장된다
  const pv = useMemo(
    () => faMarketPreview(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season + 1,
      buildOwnerFx(interviews, season, my, fanScore), budgetCash, [], null, moneyOnlyIds),
    [my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season, interviews, fanScore, budgetCash, moneyOnlyIds],
  );
  const snap = pv.snapshot;

  const poolPlayers = pv.pool.map((id) => snap[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a));
  const grades = assignFAGrades(poolPlayers);
  const myRoster = pv.myRoster.map((id) => snap[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a));

  const myPayroll = pv.myRoster.reduce((s, id) => s + (snap[id]?.contract.salary ?? 0), 0);
  const signedCost = [...pv.signedByMe].reduce((s, id) => s + (snap[id]?.contract.salary ?? 0), 0);
  const projected = myPayroll + signedCost;

  const projectedComp = pickCompensation(pv.myRoster, protectedIds, snap, []);
  const projectedCompName = projectedComp ? snap[projectedComp]?.name : null;
  // 보상선수가 실제로 빠지는 영입 = A/B 중 '돈만' 미선택분
  const compNeeded = [...pv.signedByMe].filter((id) => {
    const g = grades.get(id);
    return g ? needsCompensationPlayer(g) && !moneyOnlyIds.includes(id) : false;
  }).length;
  const moneyOnlyCount = [...pv.signedByMe].filter((id) => moneyOnlyIds.includes(id) && needsCompensationPlayer(grades.get(id) ?? 'C')).length;

  return (
    <Screen title={`${season + 1}→${season + 2}시즌 FA 시장`}>
      <Card>
        <Row>
          <Muted>영입 성공 / 시도</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {pv.signedByMe.size} / {faSignings.length}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          영입을 눌러도 선수는 팀 전력·출전기회·충성도·연봉을 보고 결정합니다. 다른 구단과 경합에서
          질 수 있어요. 캡 안에서만 가능.
        </Muted>
        <Row>
          <Muted>샐러리캡(예상)</Muted>
          <Text style={{ color: projected > LEAGUE_CAP ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(projected)} / {formatMoney(LEAGUE_CAP)}
          </Text>
        </Row>
        <Row>
          <Muted>운영 자금(정산 후 · 연봉+보상금 차감)</Muted>
          <Text style={{ color: budgetCash - signedCost - pv.compCash < 0 ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(Math.max(0, budgetCash - signedCost - pv.compCash))} / {formatMoney(budgetCash)}
          </Text>
        </Row>
        <Pressable
          onPress={() => setAggressive(!faAggressive)}
          style={[styles.toggle, faAggressive && { borderColor: theme.warn, backgroundColor: theme.warn + '20' }]}
        >
          <Text style={{ color: faAggressive ? theme.warn : theme.muted, fontWeight: '800' }}>
            공격적 영입 {faAggressive ? 'ON' : 'OFF'} (연봉 +20% 제시 → 경쟁 우위)
          </Text>
        </Pressable>
      </Card>

      <Button label="신인 드래프트로 →" onPress={() => router.push('/draft')} />

      {(compNeeded > 0 || moneyOnlyCount > 0) ? (
        <Card>
          {compNeeded > 0 ? (
            <>
              <Text style={{ color: theme.warn, fontSize: 13, fontWeight: '700' }}>
                A/B 영입 {compNeeded}명 → 보호명단 밖 {compNeeded}명이 원소속팀으로 갑니다.
              </Text>
              {projectedCompName ? <Muted style={{ fontSize: 12 }}>현재 보상 1순위: {projectedCompName}</Muted> : null}
            </>
          ) : null}
          {moneyOnlyCount > 0 ? (
            <Text style={{ color: theme.good, fontSize: 13, fontWeight: '700' }}>
              '돈만' {moneyOnlyCount}명 → 선수단 보호(보상선수 없음), 보상금 가중(A 300%·B 200%).
            </Text>
          ) : null}
          {pv.compCash > 0 ? <Muted style={{ fontSize: 12, color: theme.warn }}>보상금 {formatMoney(pv.compCash)} 추가 차감</Muted> : null}
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
            <OvrBadge value={overallRaw(p)} />
            <Text style={{ color: prot ? theme.good : theme.muted, fontWeight: '800', width: 36, textAlign: 'right' }}>
              {prot ? '보호' : '—'}
            </Text>
          </Pressable>
        );
      })}

      <Title>FA 시장 ({poolPlayers.length}명)</Title>
      {poolPlayers.length === 0 ? (
        <Card><Muted>이번 오프시즌 풀린 FA가 없습니다.</Muted></Card>
      ) : (
        poolPlayers.map((p) => {
          const grade = grades.get(p.id)!;
          const ask = askingPrice(marketVal(p), grade);
          const targeted = faSignings.includes(p.id);
          const won = pv.signedByMe.has(p.id);
          const lost = pv.lostTo[p.id];
          let badge: { t: string; c: string } | null = null;
          if (won) badge = { t: '영입 성공', c: theme.good };
          else if (targeted && lost) badge = { t: `실패 → ${shortTeam(lost)}`, c: theme.bad };
          else if (targeted) badge = { t: '경합/불발', c: theme.warn };
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
                    {p.age}세 · 요구 {formatMoney(ask)}
                    {needsCompensationPlayer(grade) ? ' · 보상선수' : ''}
                  </Text>
                  {badge ? <Text style={{ color: badge.c, fontSize: 12, fontWeight: '800', marginTop: 2 }}>{badge.t}</Text> : null}
                </View>
                <OvrBadge value={overallRaw(p)} />
              </View>
              <Pressable
                onPress={() => (targeted ? unsignFA(p.id) : signFA(p.id))}
                style={[
                  styles.btn,
                  { borderColor: targeted ? theme.bad : theme.accent, backgroundColor: targeted ? theme.bad + '22' : theme.accent + '22' },
                ]}
              >
                <Text style={[styles.btnText, { color: targeted ? theme.bad : theme.accent }]}>
                  {targeted ? '취소' : '영입 시도'}
                </Text>
              </Pressable>
              {/* A/B FA만 — 보상선수 대신 보상금만 내고 선수단 보호 */}
              {targeted && needsCompensationPlayer(grade) ? (
                <Pressable
                  onPress={() => toggleMoneyOnly(p.id)}
                  style={[styles.btn, moneyOnlyIds.includes(p.id)
                    ? { borderColor: theme.good, backgroundColor: theme.good + '22' }
                    : { borderColor: theme.border }]}
                >
                  <Text style={[styles.btnText, { color: moneyOnlyIds.includes(p.id) ? theme.good : theme.muted }]}>
                    {moneyOnlyIds.includes(p.id) ? `✓ 돈만 보상 (${grade === 'A' ? '300' : '200'}%)` : '보상선수 보호 (돈만)'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: theme.border },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
  toggle: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, alignItems: 'center', marginTop: 4 },
  protectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
});
