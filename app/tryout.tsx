// 외국인 트라이아웃 (FOREIGN_SYSTEM) — 매 오프시즌, 팀당 1명·1년 계약·연봉 고정(캡 제외).
// 순번은 추첨. 위시리스트로 노리고, 순번에서 뺏기면 차순위. 미리보기 = endSeason 결과(동일 빌더).

import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { buildDraftContext } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, teamScoutReveal } from '../data/league';
import { overall } from '../engine/overall';
import { FOREIGN_SALARY } from '../engine/foreign';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';
import type { Player } from '../types';

export default function Tryout() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faSignings = useGameStore((s) => s.faSignings);
  const faAggressive = useGameStore((s) => s.faAggressive);
  const protectedIds = useGameStore((s) => s.protectedIds);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const tryoutWish = useGameStore((s) => s.tryoutWish);
  const toggleTryoutWish = useGameStore((s) => s.toggleTryoutWish);

  // endSeason과 같은 체인 — 미리보기=결과
  const ctx = useMemo(
    () => buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season + 1,
      buildOwnerFx(interviews, season, my, fanScore), cash, tryoutWish),
    [my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season, interviews, fanScore, cash, tryoutWish],
  );
  const tryout = ctx.tryout;
  const snap = ctx.snapshot;
  const order = useMemo(() => {
    const seen: string[] = [];
    for (const [t] of Object.entries(tryout.picks)) seen.push(t);
    return seen;
  }, [tryout]);
  const myPickId = tryout.picks[my];

  const reveal = teamScoutReveal(my);
  const fogOvr = (p: Player): string => {
    const o = overall(p);
    if (reveal >= 0.92) return `${o}`;
    const w = Math.max(2, Math.round((1 - reveal) * 14));
    return `${Math.max(40, o - w)}~${Math.min(99, o + w)}`;
  };

  const pool = tryout.poolIds.map((id) => snap[id]).filter((p): p is Player => !!p);
  const pickedBy = (pid: string): string | null => {
    const t = Object.keys(tryout.picks).find((k) => tryout.picks[k] === pid);
    return t ? (getTeam(t)?.name ?? t) : null;
  };

  return (
    <Screen title="외국인 트라이아웃">
      <Card>
        <Muted style={{ fontSize: 12 }}>
          팀당 1명 · 1년 계약 · 연봉 {formatMoney(FOREIGN_SALARY)} 고정(샐러리캡 제외, 운영 자금 지출).
          지명 순번은 추첨 — 위시리스트 순서로 노리고, 뺏기면 차순위로 내려갑니다.
        </Muted>
        <Row>
          <Muted>내 예상 지명</Muted>
          <Text style={{ color: theme.accent, fontWeight: '800' }}>
            {myPickId && snap[myPickId] ? `${snap[myPickId].name} (${snap[myPickId].position})` : '-'}
          </Text>
        </Row>
      </Card>

      <Title>후보 ({pool.length}명) — ★ 위시 토글</Title>
      {pool
        .slice()
        .sort((a, b) => overall(b) - overall(a))
        .map((p) => {
          const wishIdx = tryoutWish.indexOf(p.id);
          const taker = pickedBy(p.id);
          const returning = !p.id.startsWith('fgn-s');
          return (
            <Pressable key={p.id} style={styles.row} onPress={() => toggleTryoutWish(p.id)}>
              <PosTag pos={p.position} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  {returning ? <Text style={styles.tagReturn}>재참가</Text> : null}
                  {wishIdx >= 0 ? <Text style={styles.tagWish}>★{wishIdx + 1}</Text> : null}
                </View>
                <Text style={styles.sub}>
                  {p.age}세 · {p.height}cm · OVR {fogOvr(p)}
                </Text>
              </View>
              <Text style={{ color: taker === getTeam(my)?.name ? theme.accent : theme.muted, fontSize: 12, fontWeight: '700' }}>
                {taker ? `→ ${taker}` : '미지명'}
              </Text>
            </Pressable>
          );
        })}

      <Muted style={{ fontSize: 11 }}>
        미지명자 중 상위 {tryout.altPoolIds.length}명은 대체 풀로 남아 시즌 중 교체(1회)에 쓸 수 있습니다.
        스카우터 투자(공개도 {(reveal * 100).toFixed(0)}%)가 도박의 보험입니다.
      </Muted>
      <Button label="FA 센터 →" onPress={() => router.push('/fa')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  tagReturn: { color: '#38bdf8', fontSize: 11, fontWeight: '700' },
  tagWish: { color: theme.warn, fontSize: 12, fontWeight: '900' },
});
