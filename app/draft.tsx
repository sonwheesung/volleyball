import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../components/Screen';
import { buildDraftContext } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, teamScoutReveal } from '../data/league';
import { computeStandings } from '../data/standings';
import { resolveDraft } from '../engine/draft';
import { overall, overallRaw, displayOvr } from '../engine/overall';
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

  const faAggressive = useGameStore((s) => s.faAggressive);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  // endSeason과 동일한 ownerFx+자금 — 미리보기=결과 보장(면담 거부·자금 게이트가 명단·순번에 반영)
  const ctx = useMemo(
    () => buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season + 1,
      buildOwnerFx(interviews, season, my, fanScore), cash),
    [my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season, interviews, fanScore, cash],
  );
  const standings = useMemo(() => computeStandings(Number.MAX_SAFE_INTEGER), [season]);

  // 미리보기: 내가 실제로 지명하게 될 신인
  const clsById = useMemo(() => new Map(ctx.cls.map((p) => [p.id, p])), [ctx]);
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const preview = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => ctx.snapshot[id], my, draftPicks, styleOf, teamScoutReveal);
  const beforeMy = new Set(ctx.rosters[my] ?? []);
  const myDrafted = (preview.rosters[my] ?? [])
    .filter((id) => !beforeMy.has(id))
    .map((id) => clsById.get(id))
    .filter((p): p is Player => !!p);

  const classSorted = [...ctx.cls].sort((a, b) => overall(b) - overall(a));
  const myRank = standings.findIndex((s) => s.teamId === my) + 1;

  // 스카우팅 안개(STAFF_SYSTEM) — 공개도↓일수록 OVR은 범위로, 포텐셜은 흐리게
  const reveal = teamScoutReveal(my);
  const fogStars = (p: Player) => (reveal >= 0.6 ? potStars(p) : reveal >= 0.3 ? '?·?' : '?');
  const fogOvr = (p: Player): string => {
    const o = displayOvr(overallRaw(p));
    if (reveal >= 0.92) return `${o}`;
    const w = Math.max(2, Math.round((1 - reveal) * 14));
    return `${Math.max(40, o - w)}~${Math.min(99, o + w)}`;
  };

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
        <Muted style={{ fontSize: 12, marginTop: 4, color: reveal >= 0.6 ? theme.good : theme.warn }}>
          스카우팅 공개도 {Math.round(reveal * 100)}% {reveal >= 0.92 ? '(정밀)' : '— 스태프에서 스카우터를 영입하면 능력치가 더 선명해집니다'}
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
            <OvrBadge value={overallRaw(p)} />
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
                {p.name} <Text style={{ color: theme.warn }}>{fogStars(p)}</Text>
              </Text>
              <Text style={styles.sub}>{p.age}세 · {p.height}cm</Text>
            </View>
            {reveal >= 0.92
              ? <OvrBadge value={overallRaw(p)} />
              : <Text style={{ minWidth: 52, textAlign: 'center', color: theme.muted, fontWeight: '800', fontSize: 13 }}>{fogOvr(p)}</Text>}
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
    borderWidth: 1, borderColor: theme.border,
  },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  pot: { color: theme.warn, fontWeight: '800', width: 40, textAlign: 'center' },
});
