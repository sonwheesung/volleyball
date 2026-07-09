// 라이브 드래프트(앱) — 자동진행 픽 공개 + **내 차례에 직접 지명**(FA_SYSTEM §3.2.1 인터랙티브 재설계).
//   엔진은 순수 해석(resolveDraft) 그대로. 내 슬롯에서 하드정지 → 남은 유망주에서 확정 → 재개.
//   결정론: 같은 ctx + 같은 mySelections = 같은 시퀀스. 확정마다 store.draftSelections 즉시 영속(재개용).
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Screen, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { buildOffseasonBase } from '../data/draftSetup';
import { resolveDraftContextFor } from '../data/offseasonArgs';
import { buildOwnerFx } from '../data/owner';
import { getTeam, shortTeamName, teamScoutReveal, SEASON } from '../data/league';
import { resolveDraft, neededPositions, type PickReason } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget';
import { planNextAction } from '../engine/advance';
import { overall } from '../engine/overall';
import { fogOvr } from '../data/prospectScout';
import { useGameStore } from '../store/useGameStore';
import { showSeasonStartAd } from '../lib/ads';
import { ProspectDetail } from './draft';
import type { Player, Position } from '../types';

const REASON: Record<PickReason, { ko: string; color: string }> = {
  super: { ko: '특급 영입', color: theme.warn },
  need: { ko: '포지션 보강', color: theme.accent },
  best: { ko: '최고 + 성격', color: theme.muted },
  wish: { ko: '구단 지명', color: theme.good },
};

const POS_KO: Record<Position, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };

export default function DraftLive() {
  const ready = useDeferredReady();
  if (!ready) return <Loading title="라이브 드래프트" variant="list" />;
  return <DraftLiveInner />;
}

interface SeqItem { i: number; teamId: string; player: Player; playerId: string; reason: PickReason; round: number; mine: boolean }

function DraftLiveInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const results = useGameStore((s) => s.results);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faSignings = useGameStore((s) => s.faSignings);
  const protectedIds = useGameStore((s) => s.protectedIds);
  const draftPicks = useGameStore((s) => s.draftPicks);
  const faAggressive = useGameStore((s) => s.faAggressive);
  const moneyOnlyIds = useGameStore((s) => s.moneyOnlyIds);
  const tryoutWish = useGameStore((s) => s.tryoutWish);
  const keepForeign = useGameStore((s) => s.keepForeign);
  const asianWish = useGameStore((s) => s.asianWish);
  const keepAsian = useGameStore((s) => s.keepAsian);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const draftSelections = useGameStore((s) => s.draftSelections);
  const setDraftSelections = useGameStore((s) => s.setDraftSelections);

  // 무거운 컨텍스트 — 픽 독립(스냅샷/해결 분리). 안정 deps로 메모(조정 C — 확정마다 재계산 안 함).
  //   endSeason과 동일한 인자 전체(트라이아웃/아시아 토글·돈만 보상 포함)로 만들어 라이브 시퀀스=결과 보장
  //   (EC-FA-09 — 누락 인자로 확정 지명 신인이 실제 입단 안 하던 문제). 공용 조립 함수 경유.
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore), [interviews, season, my, fanScore]);
  const base = useMemo(
    () => buildOffseasonBase(my, resignDecisions, contractOverrides, season + 1, ownerFx),
    [my, resignDecisions, contractOverrides, season, ownerFx],
  );
  const ctx = useMemo(
    () => resolveDraftContextFor(base, { my, resignDecisions, contractOverrides, faSignings, faAggressive,
      protectedIds, nextSeason: season + 1, ownerFx, myCash: cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian }),
    [base, my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season, ownerFx, cash,
      tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian],
  );
  const clsById = useMemo(() => new Map(ctx.cls.map((p) => [p.id, p])), [ctx]);
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';

  // 내 확정 픽(로컬) — 초기값 = 저장 draftSelections(앱 종료 후 재개). 확정마다 append + 즉시 영속.
  const [mySelections, setMySelections] = useState<string[]>(() => [...draftSelections]);
  const [revealed, setRevealed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(600); // 600(보통)/300(빠르게)
  const [openId, setOpenId] = useState<string | null>(null); // 선택 패널 상세 펼침
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 픽 시퀀스 — [ctx, mySelections]에만 의존(값싼 재계산, 조정 C). 내 슬롯은 mySelections 우선 → 찜 폴백 → AI.
  const seq = useMemo<SeqItem[]>(() => {
    const res = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => ctx.snapshot[id], my, draftPicks, styleOf, teamScoutReveal, mySelections, aiTargetOf());
    const seen: Record<string, number> = {};
    return res.sequence.map((s, i) => {
      seen[s.teamId] = (seen[s.teamId] ?? 0) + 1;
      return { i, teamId: s.teamId, player: clsById.get(s.playerId)!, playerId: s.playerId, reason: s.reason, round: seen[s.teamId], mine: s.teamId === my };
    }).filter((x) => x.player);
  }, [ctx, mySelections, my, draftPicks, clsById]);

  const total = seq.length;
  // 내 픽의 시퀀스 배열 위치(order 고정 → mySelections 무관하게 안정). k번째 = mySelections[k] 슬롯.
  const myPickPositions = useMemo(() => seq.reduce<number[]>((a, p, k) => (p.mine ? [...a, k] : a), []), [seq]);
  const myCount = myPickPositions.length;
  const confirmedMyCount = mySelections.length;

  // stopAt: 아직 확정 안 된 첫 내 픽 위치(그 앞까지만 공개). 다 확정(또는 0픽)이면 total(끝까지).
  const stopAt = confirmedMyCount < myCount ? myPickPositions[confirmedMyCount] : total;
  const done = revealed >= total;
  const atMyPick = revealed >= stopAt && stopAt < total; // 내 픽 대기(직접 지명 필요)
  const allMineDone = confirmedMyCount >= myCount;       // 내 픽 전부 확정(또는 0픽)

  // 재개 fast-forward(조정 F) — 마운트 1회. 확정된 픽 직후로 점프(부분 공개상태는 저장 안 함, 재계산).
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (confirmedMyCount > 0 && myPickPositions.length >= confirmedMyCount) {
      setRevealed(myPickPositions[confirmedMyCount - 1] + 1);
    }
  }, [confirmedMyCount, myPickPositions]);

  // 자동진행(조정 F) — 정지/내픽대기/종료가 아니면 speed 간격으로 stopAt까지 한 픽씩.
  useEffect(() => {
    if (paused || atMyPick || done) { if (timer.current) { clearInterval(timer.current); timer.current = null; } return; }
    timer.current = setInterval(() => setRevealed((r) => Math.min(stopAt, r + 1)), speed);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [paused, atMyPick, done, stopAt, speed]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // 확정 — 내 슬롯 픽 선택. append + 즉시 영속 + 그 픽 공개. 마지막 픽이면 "나머지 자동 진행" 게이트로 정지.
  const confirm = (playerId: string) => {
    const next = [...mySelections, playerId];
    setMySelections(next);
    setDraftSelections(next);       // 즉시 영속(조정 D — 재개 대비)
    setRevealed((r) => r + 1);      // 방금 확정한 내 픽 공개(현재 revealed==stopAt)
    setOpenId(null);
    if (next.length >= myCount) setPaused(true); // 내 마지막 픽 뒤 → 버튼 게이트
  };

  // 시즌 시작 — 오늘과 동일 출구(광고 후 /season-start replace → endSeason 체인). draft-live:78 관계 유지.
  const onFinish = async () => { setPaused(true); await showSeasonStartAd(); router.replace('/season-start'); };

  // 오프시즌 게이트(조정 B) — 드래프트 창(seasonOver) 밖이면 리다이렉트(stale-input 주입 차단). ★ 모든 훅 뒤.
  if (planNextAction(SEASON, my, results).kind !== 'seasonOver') return <Redirect href="/(tabs)/schedule" />;

  const shown = seq.slice(0, revealed).slice().reverse(); // 최신이 위로

  // ── 내 픽 선택 패널 데이터(atMyPick일 때만 계산) ──
  let panel: null | {
    recommended: SeqItem;
    needs: Position[];
    sorted: Player[];
    reveal: number;
  } = null;
  if (atMyPick) {
    const pending = seq[stopAt];                                   // 위시폴백/AI가 뽑을 추천 픽
    const pickedSoFar = new Set(seq.slice(0, stopAt).map((s) => s.playerId));
    const remaining = ctx.cls.filter((p) => !pickedSoFar.has(p.id));
    const shortlistOrder = new Map(draftPicks.map((id, idx) => [id, idx] as const));
    const sorted = [...remaining].sort((a, b) => {
      const sa = shortlistOrder.get(a.id), sb = shortlistOrder.get(b.id);
      if (sa !== undefined && sb !== undefined) return sa - sb;   // 둘 다 찜 → 찜 순서
      if (sa !== undefined) return -1;                            // 찜 우선(상단 고정)
      if (sb !== undefined) return 1;
      return overall(b) - overall(a);                            // 나머지 현재 실력순
    });
    // 필요 포지션(현 로스터 + 지금까지 내 픽) 힌트
    const myRosterNow = [...(ctx.rosters[my] ?? []), ...seq.slice(0, stopAt).filter((s) => s.mine).map((s) => s.playerId)];
    const getP = (id: string) => ctx.snapshot[id] ?? clsById.get(id);
    const needs = Array.from(new Set(neededPositions(myRosterNow, getP)));
    panel = { recommended: pending, needs, sorted, reveal: teamScoutReveal(my) };
  }
  const needSet = new Set(panel?.needs ?? []);
  const roundLabel = done ? '지명 종료' : atMyPick ? '내 지명 순번!' : `${seq[revealed]?.round ?? '-'}R 진행 중`;

  return (
    <Screen title={`${season + 2}시즌 드래프트`}>
      <View style={styles.bar}>
        <Muted>{revealed} / {total}픽 · 내 지명 {confirmedMyCount}/{myCount}</Muted>
        <Text style={{ color: atMyPick ? theme.accent : theme.text, fontWeight: '800' }}>{roundLabel}</Text>
      </View>

      {total === 0 ? (
        // 총 픽 0 — 즉시 완료 상태(지명할 신인 자리 없음)
        <>
          <Card><Muted>이번 드래프트는 지명할 자리가 없습니다. 바로 시즌을 시작하세요.</Muted></Card>
          <Button label="시즌 시작하기 ▶" onPress={onFinish} />
        </>
      ) : done ? (
        <Button label="시즌 시작하기 ▶" onPress={onFinish} />
      ) : atMyPick && panel ? (
        // ── 내 픽 하드정지: 직접 지명 패널 ──
        <Card accent={theme.accent}>
          <IconLabel icon="hand-left-outline" color={theme.accent}>내 지명 순번 — 직접 선택 ({confirmedMyCount + 1}/{myCount})</IconLabel>
          {panel.needs.length ? (
            <Muted style={{ fontSize: 12, marginTop: 4 }}>필요 포지션: {panel.needs.map((p) => POS_KO[p]).join(' · ')}</Muted>
          ) : (
            <Muted style={{ fontSize: 12, marginTop: 4 }}>로스터 구성은 채워졌습니다 — 가치 위주로 골라도 좋아요.</Muted>
          )}
          <Pressable onPress={() => confirm(panel!.recommended.playerId)} style={[styles.recBtn]}>
            <Text style={styles.recT}>자동 지명(추천 픽) ▸ {panel.recommended.player.name}
              <Text style={{ color: theme.muted, fontWeight: '700' }}>  {REASON[panel.recommended.reason].ko}</Text>
            </Text>
          </Pressable>
          <ScrollView style={styles.panelList} nestedScrollEnabled>
            {panel.sorted.map((p) => {
              const open = openId === p.id;
              const isShort = draftPicks.includes(p.id);
              const isRec = p.id === panel!.recommended.playerId;
              return (
                <View key={p.id} style={[styles.rowWrap, isShort && { borderColor: theme.accent, backgroundColor: theme.accent + '10' }]}>
                  <View style={styles.rowInner}>
                    <Pressable onPress={() => setOpenId(open ? null : p.id)} style={styles.rowTap}>
                      <PosTag pos={p.position} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.nm}>
                          {isShort ? <Text style={{ color: theme.accent }}>★ </Text> : null}{p.name}
                          {needSet.has(p.position) ? <Text style={{ color: theme.good, fontWeight: '800' }}>  ·필요</Text> : null}
                          {isRec ? <Text style={{ color: theme.warn, fontWeight: '800' }}>  ·추천</Text> : null}
                        </Text>
                        <Text style={styles.sub}>{p.age}세 · {p.height}cm · OVR {fogOvr(p, panel!.reveal)} · {open ? '접기 ▲' : '자세히 ▼'}</Text>
                      </View>
                    </Pressable>
                    <Pressable onPress={() => confirm(p.id)} hitSlop={8} style={styles.pickBtn}>
                      <Text style={{ color: theme.accent, fontWeight: '800', fontSize: 13 }}>지명</Text>
                    </Pressable>
                  </View>
                  {open ? <ProspectDetail p={p} reveal={panel!.reveal} /> : null}
                </View>
              );
            })}
          </ScrollView>
        </Card>
      ) : allMineDone && myCount > 0 && paused ? (
        // 내 마지막 픽 뒤 — 나머지 AI 픽을 마저 자동 진행
        <Button label="나머지 자동 진행 ▶" onPress={() => setPaused(false)} />
      ) : (
        // ── 관전 진행 컨트롤 ──
        <View>
          {myCount === 0 ? (
            <Card accent={theme.muted}>
              <Muted style={{ fontSize: 13 }}>이번 드래프트는 지명권이 없습니다 — 참관합니다.</Muted>
            </Card>
          ) : null}
          <View style={styles.ctrl}>
            <Pressable onPress={() => setPaused((p) => !p)} style={[styles.btn, { borderColor: paused ? theme.accent : theme.warn }]}>
              <Text style={[styles.btnT, { color: paused ? theme.accent : theme.warn }]}>{paused ? '▶ 재생' : '⏸ 정지'}</Text>
            </Pressable>
            <Pressable onPress={() => setSpeed((s) => (s === 600 ? 300 : 600))} style={[styles.btn, { borderColor: theme.border }]}>
              <Text style={[styles.btnT, { color: theme.muted }]}>{speed === 600 ? '» 빠르게' : '› 보통'}</Text>
            </Pressable>
            {myCount === 0 ? (
              <Pressable onPress={() => setRevealed(total)} style={[styles.btn, { borderColor: theme.border }]}>
                <Text style={[styles.btnT, { color: theme.muted }]}>바로 마치기 ▶</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {revealed === 0 && !atMyPick ? (
        <Muted style={{ marginTop: 14, fontSize: 13 }}>
          하위 팀부터 지명합니다. 자동으로 한 픽씩 공개되고, 내 차례엔 멈춰 직접 지명합니다.
          찜해둔 선수는 선택 목록 위에 뜹니다.
        </Muted>
      ) : null}

      <ScrollView style={{ marginTop: 10 }}>
        {shown.map((p) => {
          const r = REASON[p.reason];
          const why = p.reason === 'need' ? `${r.ko} (${p.player.position})` : r.ko;
          const reveal = teamScoutReveal(p.teamId);
          return (
            <View key={p.i} style={[styles.row, p.mine && styles.mineRow]}>
              <Text style={styles.pk}>{p.round}R</Text>
              <PosTag pos={p.player.position} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nm}>
                  {p.mine ? <Text style={{ color: theme.accent }}>★ </Text> : null}
                  {p.player.name}
                </Text>
                <Text style={styles.sub}>{shortTeamName(p.teamId)} · OVR {fogOvr(p.player, reveal)}</Text>
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

const styles = themedStyles(() => StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ctrl: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  btnT: { fontSize: 14, fontWeight: '800' },
  recBtn: { marginTop: 10, borderWidth: 1, borderColor: theme.accent, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: theme.accent + '14' },
  recT: { color: theme.accent, fontWeight: '800', fontSize: 14 },
  panelList: { marginTop: 10, maxHeight: 340 },
  rowWrap: { backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', marginBottom: 6 },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, paddingVertical: 9 },
  pickBtn: { paddingHorizontal: 16, paddingVertical: 16, borderLeftWidth: 1, borderLeftColor: theme.border, alignItems: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9,
    borderWidth: 1, borderColor: theme.border, marginBottom: 6,
  },
  mineRow: { borderColor: theme.accent, backgroundColor: theme.accent + '12' },
  pk: { color: theme.muted, fontWeight: '800', fontSize: 12, width: 34 },
  nm: { color: theme.text, fontSize: 15, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 12, marginTop: 1 },
  badge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
}));
