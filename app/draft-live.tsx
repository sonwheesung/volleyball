// 라이브 드래프트(앱) — resolveDraft 결과를 한 픽씩 재생. 내 차례 강조 + AI 사유(특급/필요/OVR성격) 연출.
// 엔진은 순수 해석 그대로(미리보기=결과 == draft.tsx와 동일 입력). 위시 미설정이면 자동 — 조작 강요 없음(관전형).
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Loading, Muted, PosTag, Screen, Title, theme, useDeferredReady } from '../components/Screen';
import { buildDraftContext } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, shortTeamName, teamScoutReveal } from '../data/league';
import { resolveDraft, prospectStars, type PickReason } from '../engine/draft';
import { overall, overallRaw, displayOvr } from '../engine/overall';
import { useGameStore } from '../store/useGameStore';
import type { Player } from '../types';

const REASON: Record<PickReason, { ko: string; color: string }> = {
  super: { ko: '특급 영입', color: theme.warn },
  need: { ko: '포지션 보강', color: theme.accent },
  best: { ko: '최고 + 성격', color: theme.muted },
  wish: { ko: '구단 지명', color: theme.good },
};

export default function DraftLive() {
  const ready = useDeferredReady();
  if (!ready) return <Loading title="라이브 드래프트" message="지명 순서를 준비하는 중…" />;
  return <DraftLiveInner />;
}

function DraftLiveInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faSignings = useGameStore((s) => s.faSignings);
  const protectedIds = useGameStore((s) => s.protectedIds);
  const draftPicks = useGameStore((s) => s.draftPicks);
  const faAggressive = useGameStore((s) => s.faAggressive);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const endSeason = useGameStore((s) => s.endSeason);

  // draft.tsx 미리보기와 동일 입력 → 동일 결과(미리보기=결과 보장)
  const picks = useMemo(() => {
    const ctx = buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season + 1,
      buildOwnerFx(interviews, season, my, fanScore), cash);
    const clsById = new Map(ctx.cls.map((p) => [p.id, p]));
    const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
    const res = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => ctx.snapshot[id], my, draftPicks, styleOf, teamScoutReveal);
    const seen: Record<string, number> = {};
    return res.sequence.map((s, i) => {
      seen[s.teamId] = (seen[s.teamId] ?? 0) + 1;
      return { i, teamId: s.teamId, player: clsById.get(s.playerId)!, reason: s.reason, round: seen[s.teamId], mine: s.teamId === my };
    }).filter((x) => x.player);
  }, [my, season, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, draftPicks, interviews, fanScore, cash]);

  const total = picks.length;
  const [revealed, setRevealed] = useState(0);
  const [auto, setAuto] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const myCount = picks.filter((p) => p.mine).length;
  const myRevealed = picks.slice(0, revealed).filter((p) => p.mine).length;

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => {
    if (!auto) { if (timer.current) { clearInterval(timer.current); timer.current = null; } return; }
    timer.current = setInterval(() => {
      setRevealed((r) => { if (r >= total) { setAuto(false); return r; } return r + 1; });
    }, 600);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, total]);

  const done = revealed >= total;
  const shown = picks.slice(0, revealed).reverse(); // 최신이 위로

  const onFinish = () => { setAuto(false); endSeason(); router.replace('/(tabs)'); };

  return (
    <Screen title={`${season + 2}시즌 드래프트`}>
      <View style={styles.bar}>
        <Muted>{revealed} / {total}픽 · 내 지명 {myRevealed}/{myCount}</Muted>
        <Text style={{ color: theme.text, fontWeight: '800' }}>{done ? '지명 종료' : `${picks[revealed]?.round ?? '-'}R 진행 중`}</Text>
      </View>

      {!done ? (
        <View style={styles.ctrl}>
          <Pressable onPress={() => setRevealed((r) => Math.min(total, r + 1))} style={[styles.btn, { borderColor: theme.accent }]}>
            <Text style={[styles.btnT, { color: theme.accent }]}>다음 픽 ▶</Text>
          </Pressable>
          <Pressable onPress={() => setAuto((a) => !a)} style={[styles.btn, { borderColor: auto ? theme.warn : theme.border }]}>
            <Text style={[styles.btnT, { color: auto ? theme.warn : theme.muted }]}>{auto ? '⏸ 정지' : '▶ 자동'}</Text>
          </Pressable>
          <Pressable onPress={() => { setAuto(false); setRevealed(total); }} style={[styles.btn, { borderColor: theme.border }]}>
            <Text style={[styles.btnT, { color: theme.muted }]}>전체 ⏭</Text>
          </Pressable>
        </View>
      ) : (
        <Button label="다음 시즌 시작" onPress={onFinish} />
      )}

      {revealed === 0 ? (
        <Muted style={{ marginTop: 14, fontSize: 13 }}>
          하위 팀부터 지명합니다. "다음 픽 ▶" 또는 "▶ 자동"으로 진행하세요. 내 지명은 강조됩니다.
          위시리스트에 담아둔 선수를 우선 지명하고(구단 지명), 없으면 감독이 자동으로 뽑습니다.
        </Muted>
      ) : null}

      <ScrollView style={{ marginTop: 10 }}>
        {shown.map((p) => {
          const r = REASON[p.reason];
          const why = p.reason === 'need' ? `${r.ko} (${p.player.position})` : r.ko;
          const reveal = teamScoutReveal(p.teamId);
          return (
            <View key={p.i} style={[styles.row, p.mine && styles.mineRow]}>
              <Text style={styles.pk}>{p.round}R·{p.i + 1}</Text>
              <PosTag pos={p.player.position} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nm}>
                  {p.mine ? <Text style={{ color: theme.accent }}>★ </Text> : null}
                  {p.player.name} <Text style={{ color: theme.warn, fontSize: 12 }}>{prospectStars(p.player)}</Text>
                </Text>
                <Text style={styles.sub}>{esc(p.teamId)} · OVR {reveal >= 0.92 ? displayOvr(overallRaw(p.player)) : '?'}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: r.color + '22', borderColor: r.color + '55' }]}>
                <Text style={{ color: r.color, fontSize: 11, fontWeight: '800' }}>{why}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const esc = (tid: string) => shortTeamName(tid);

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ctrl: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  btnT: { fontSize: 14, fontWeight: '800' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9,
    borderWidth: 1, borderColor: theme.border, marginBottom: 6,
  },
  mineRow: { borderColor: theme.accent, backgroundColor: theme.accent + '12' },
  pk: { color: theme.muted, fontWeight: '800', fontSize: 12, width: 48 },
  nm: { color: theme.text, fontSize: 15, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 12, marginTop: 1 },
  badge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
});
