// 라이브 드래프트(앱) — 자동진행 픽 공개 + **내 차례에 직접 지명**(FA_SYSTEM §3.2.1 인터랙티브 재설계).
//   엔진은 순수 해석(resolveDraft) 그대로. 내 슬롯에서 하드정지 → 남은 유망주에서 확정 → 재개.
//   결정론: 같은 ctx + 같은 mySelections = 같은 시퀀스. 확정마다 store.draftSelections 즉시 영속(재개용).
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Screen, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { DraftPoster } from '../components/DraftPoster';
import { emblemFor } from '../data/emblems';
import { POS_EN } from '../data/awardPoster';
import { seasonYear } from '../data/seasonLabel';
import { buildOffseasonBase } from '../data/draftSetup';
import { resolveDraftContextFor } from '../data/offseasonArgs';
import { buildOwnerFx } from '../data/owner';
import { getTeam, shortTeamName, teamScoutReveal, SEASON } from '../data/league';
import { resolveDraft, neededPositions, type PickReason } from '../engine/draft';
import { ROSTER_CONTRACT_CAP } from '../engine/transactions';
import { aiTargetOf } from '../data/rosterTarget';
import { planNextAction } from '../engine/advance';
import { overall } from '../engine/overall';
import { fogOvr } from '../data/prospectScout';
import { prospectGradeLabel } from '../data/prospectGrade';
import { consensusOrder, projectionBand, pickTimingBadge } from '../data/draftProjection';
import { pickReasonProse } from '../data/draftPickReason';
import { myDraftSummary } from '../data/draftSummary';
import { passReasonFor, PASS_REASON_COPY } from '../data/draftPlan';
import { useGameStore } from '../store/useGameStore';
import { showSeasonStartAd } from '../lib/ads';
import { ProspectDetail } from './draft';
import type { Player, Position } from '../types';

const REASON: Record<PickReason, { ko: string; color: string }> = {
  super: { ko: '특급 영입', color: theme.warn },
  need: { ko: '포지션 보강', color: theme.accent },
  best: { ko: '미래 자원', color: theme.muted }, // reason=best(니즈 없음·BPA) — 내부 용어 노출 금지, DL-6 문장 톤 일치(EC-DR-05)
  wish: { ko: '구단 지명', color: theme.good },
};

const POS_KO: Record<Position, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };

// 지명 포스터 배경 자산(DL-9) — 화면당 1종(딥 네이비 "DRAFT DAY"). 컴포넌트는 template prop으로 받는다(AwardPoster 규약).
const DRAFT_STAGE = require('../assets/awards/draft_stage.webp');

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
  const faOffers = useGameStore((s) => s.faOffers); // FA 오퍼 다레버(§2.8 Phase1) — 구 faSignings+faAggressive 대체
  const protectedIds = useGameStore((s) => s.protectedIds);
  const draftPicks = useGameStore((s) => s.draftPicks);
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
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore, contractOverrides), [interviews, season, my, fanScore, contractOverrides]);
  const base = useMemo(
    () => buildOffseasonBase(my, resignDecisions, contractOverrides, season + 1, ownerFx),
    [my, resignDecisions, contractOverrides, season, ownerFx],
  );
  const ctx = useMemo(
    () => resolveDraftContextFor(base, { my, resignDecisions, contractOverrides, faOffers,
      protectedIds, nextSeason: season + 1, ownerFx, myCash: cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian }),
    [base, my, resignDecisions, contractOverrides, faOffers, protectedIds, season, ownerFx, cash,
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
  // DL-9 지명 포스터 비트 — 내 확정 픽 직후 한 박자(탭하면 닫히고 라이브 재개). null이면 미표시(타팀 픽·참관은 항상 null).
  const [posterPick, setPosterPick] = useState<{ player: Player; round: number; overallNo: number } | null>(null);
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
  // DL-1/DL-2: 보유 지명권(권리 — order 슬롯 수, 4라운드 고정) vs 예상 지명(myCount)·PASS 예정.
  //   PASS 예정 = 보유 − 예상 지명. 현재 mySelections를 반영한 seq에서 파생 → 개입으로 예상이 바뀌면 따라간다(실 행동 반영).
  const slots = ctx.myPickSlots.length;
  const passRemaining = Math.max(0, slots - myCount);

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

  // 자동진행(조정 F) — 정지/내픽대기/종료/지명 포스터 표시 중이 아니면 speed 간격으로 stopAt까지 한 픽씩.
  //   posterPick(DL-9)은 하드스톱과 같은 결로 정지 조건에 포함 — 포스터 표시 중 진행 멈춤, 탭으로 해제 시 재개.
  useEffect(() => {
    if (paused || atMyPick || done || posterPick) { if (timer.current) { clearInterval(timer.current); timer.current = null; } return; }
    timer.current = setInterval(() => setRevealed((r) => Math.min(stopAt, r + 1)), speed);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [paused, atMyPick, done, stopAt, speed, posterPick]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // 확정 — 내 슬롯 픽 선택. append + 즉시 영속 + 그 픽 공개. 마지막 픽이면 "나머지 자동 진행" 게이트로 정지.
  const confirm = (playerId: string) => {
    // DL-9 포스터 데이터는 append 전 현재 클로저에서 캡처 — round·overallNo는 order 고정(mySelections 무관 안정),
    //   player는 내가 고른 선수. seq[stopAt]는 이 슬롯의 추천 픽(round=내 팀 이 픽의 라운드, overallNo=전체 순번=stopAt+1).
    const round = seq[stopAt]?.round ?? 1;
    const overallNo = stopAt + 1;
    const picked = clsById.get(playerId) ?? ctx.snapshot[playerId];
    const next = [...mySelections, playerId];
    setMySelections(next);
    setDraftSelections(next);       // 즉시 영속(조정 D — 재개 대비)
    setRevealed((r) => r + 1);      // 방금 확정한 내 픽 공개(현재 revealed==stopAt)
    setOpenId(null);
    if (next.length >= myCount) setPaused(true); // 내 마지막 픽 뒤 → 버튼 게이트(포스터 탭 후 노출)
    if (picked) setPosterPick({ player: picked, round, overallNo }); // 한 박자 연출(자동진행 정지 조건에 포함)
  };

  // 시즌 시작 — 오늘과 동일 출구(광고 후 /season-start replace → endSeason 체인). draft-live:78 관계 유지.
  // 광고 뜨기 전 연타 재진입 가드(UI-31) — ref는 동기 차단, state는 로딩 표시용.
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const onFinish = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setPaused(true);
    try {
      await showSeasonStartAd();
      router.replace('/season-start');
    } finally {
      startingRef.current = false; // 광고 실패·미로드·오프라인에도 잠금 해제(UI-31 finally 필수)
      setStarting(false);
    }
  };

  // 오프시즌 게이트(조정 B) — 드래프트 창(seasonOver) 밖이면 리다이렉트(stale-input 주입 차단). ★ 모든 훅 뒤.
  if (planNextAction(SEASON, my, results).kind !== 'seasonOver') return <Redirect href="/(tabs)/schedule" />;

  const shown = seq.slice(0, revealed).slice().reverse(); // 최신이 위로

  // DL-5/DL-6/DL-8 파생(표시 전용·reveal-gated·무저장) — 내 팀 시선(UI-16).
  const myReveal = teamScoutReveal(my);
  const getP = (id: string) => ctx.snapshot[id] ?? clsById.get(id);
  const rankMap = useMemo(() => consensusOrder(ctx.cls, myReveal), [ctx, myReveal]);
  // DL-6: 각 픽 직전 그 팀의 공개 로스터(누적 픽 포함) — positionGap/주전 나이 근거.
  const rosterBeforePick = useMemo(() => {
    const acc: Record<string, string[]> = {};
    for (const k of Object.keys(ctx.rosters)) acc[k] = [...ctx.rosters[k]];
    const before: Record<number, string[]> = {};
    for (const s of seq) {
      before[s.i] = [...(acc[s.teamId] ?? [])];
      acc[s.teamId] = [...(acc[s.teamId] ?? []), s.playerId];
    }
    return before;
  }, [seq, ctx]);
  // DL-8: 내 팀 지명 요약(라운드 1~4 완결 + PASS). done일 때만 표시.
  const summary = useMemo(
    () => myDraftSummary(seq.map((s) => ({ teamId: s.teamId, playerId: s.playerId, reason: s.reason })), my, getP),
    [seq, my],
  );
  // ③ 내 PASS 사유(실 지명 결과 근거만 — 로스터 충분/가득). 첫 PASS 라운드에 한 줄. 가짜 드라마 금지(중립 폴백).
  const summaryPassReason = useMemo(
    () => passReasonFor(ctx, my, seq.filter((s) => s.mine).map((s) => s.playerId)),
    [ctx, my, seq],
  );
  const firstPassRound = summary.rows.find((r) => r.pass)?.round;

  // ── 내 픽 선택 패널 데이터(atMyPick일 때만 계산) ──
  let panel: null | {
    recommended: SeqItem;
    needs: Position[];
    sorted: Player[];
    reveal: number;
    rosterCount: number; // 현 로스터 인원(base + 지금까지 내 픽) — 계약 상한 대비 지명/패스 판단 근거(DL-2)
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
    panel = { recommended: pending, needs, sorted, reveal: teamScoutReveal(my), rosterCount: myRosterNow.length };
  }
  const needSet = new Set(panel?.needs ?? []);
  const roundLabel = done ? '지명 종료' : atMyPick ? '내 지명 순번!' : `${seq[revealed]?.round ?? '-'}R 진행 중`;

  // DL-9 지명 포스터 비트 — Screen overlay 슬롯(뷰포트 고정, ScrollView 밖). 스크림이 라이브 피드 터치를 가로채고, 탭하면 닫혀 재개.
  const posterOverlay = posterPick ? (
    <Pressable style={styles.posterScrim} onPress={() => setPosterPick(null)}>
      <Muted style={styles.posterHint}>화면을 탭해 계속 →</Muted>
      <DraftPoster
        template={DRAFT_STAGE}
        emblem={emblemFor(my)}
        kicker={`${seasonYear(season + 1)} 신인 드래프트 · ${posterPick.round}R ${posterPick.overallNo}순번`}
        name={posterPick.player.name}
        posKo={POS_KO[posterPick.player.position]}
        posEn={POS_EN[posterPick.player.position]}
        grade={prospectGradeLabel(posterPick.player, 1)}
      />
      <Text style={styles.posterTag}>우리 구단의 지명</Text>
    </Pressable>
  ) : null;

  return (
    <Screen title={`${season + 2}시즌 드래프트`} overlay={posterOverlay}>
      <View style={styles.bar}>
        {/* P3(2026-07-12): 헤더 분모를 예상 지명(myCount)으로 — 패널 "직접 선택 (n/myCount)"과 일치시켜 "보유 4 vs 예상 2" 혼동 제거.
            보유 지명권(slots)은 준비 화면 표기, 여기선 실제 지명 수 + PASS로 완결(지명 2 + 패스 2 = 권리 4). */}
        <Muted style={{ flexShrink: 1 }} numberOfLines={1}>{revealed} / {total}픽 · {myCount > 0 ? `내 지명 ${confirmedMyCount}/${myCount}` : '내 지명 없음'}{passRemaining > 0 ? ` · PASS 예정 ${passRemaining}회` : ''}</Muted>
        <Text numberOfLines={1} style={{ color: atMyPick ? theme.accent : theme.text, fontWeight: '800', flexShrink: 0, marginLeft: 8 }}>{roundLabel}</Text>
      </View>

      {total === 0 ? (
        // 총 픽 0 — 즉시 완료 상태(지명할 신인 자리 없음)
        <>
          <Card flat><Muted>이번 드래프트는 지명할 자리가 없습니다. 바로 시즌을 시작하세요.</Muted></Card>
          <Button label={starting ? '시즌 준비 중…' : '시즌 시작하기 ▶'} onPress={onFinish} disabled={starting} />
        </>
      ) : done ? (
        <>
          <Card accent={theme.accent} flat>
            <IconLabel icon="clipboard-outline" color={theme.accent}>우리 팀 지명 요약</IconLabel>
            {summary.pickCount === 0 ? (
              <Muted style={{ fontSize: 13, marginTop: 6 }}>이번은 참관. 다음 기약. (지명 없이 마쳤습니다)</Muted>
            ) : (
              summary.rows.map((row) => (
                <View key={row.round} style={styles.sumRow}>
                  <Text style={styles.sumR}>{row.round}R</Text>
                  {row.pass ? (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sumPass}>PASS</Text>
                      {row.round === firstPassRound ? (
                        <Text style={styles.sumReason}>{PASS_REASON_COPY[summaryPassReason]}</Text>
                      ) : null}
                    </View>
                  ) : (
                    <>
                      <PosTag pos={row.position!} />
                      <Text style={styles.sumName}>{row.name}</Text>
                      <Text style={styles.sumGrade}>{row.grade}</Text>
                    </>
                  )}
                </View>
              ))
            )}
          </Card>
          <Button label={starting ? '시즌 준비 중…' : '시즌 시작하기 ▶'} onPress={onFinish} disabled={starting} />
        </>
      ) : atMyPick && panel ? (
        // ── 내 픽 하드정지: 직접 지명 패널 ──
        <Card accent={theme.accent} flat>
          <IconLabel icon="hand-left-outline" color={theme.accent}>내 지명 순번, 직접 선택 ({confirmedMyCount + 1}/{myCount})</IconLabel>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>현재 로스터 {panel.rosterCount}/{ROSTER_CONTRACT_CAP}명 (계약 상한) — 상한을 넘겨 지명하면 다음 오프시즌에 자연 정리됩니다.</Muted>
          {panel.needs.length ? (
            <Muted style={{ fontSize: 12, marginTop: 4 }}>필요 포지션: {panel.needs.map((p) => POS_KO[p]).join(' · ')}</Muted>
          ) : (
            <Muted style={{ fontSize: 12, marginTop: 4 }}>로스터 구성은 채워졌습니다. 가치 위주로 골라도 좋아요.</Muted>
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
            <Card accent={theme.muted} flat>
              <Muted style={{ fontSize: 13 }}>
                {slots === 0
                  ? '이번 드래프트는 지명권이 없습니다. 참관합니다.'
                  : '선수단이 가득 차 이번 드래프트는 지명을 넘길 예정입니다. 참관합니다.'}
              </Muted>
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
          const steal = !p.mine && draftPicks.includes(p.playerId); // DL-7: 찜 강탈
          // DL-6: 타팀 지명 사유 자연어(공개 로스터 근거만). DL-5: 예상↔실제 괴리 배지.
          const prose = p.mine ? null : pickReasonProse({ player: p.player, reason: p.reason }, rosterBeforePick[p.i] ?? [], getP, myReveal);
          const band = projectionBand(rankMap.get(p.playerId) ?? 0, ctx.cls.length, myReveal);
          const timing = pickTimingBadge(p.i, band); // '이른' | '늦은' | null
          return (
            <View key={p.i} style={[styles.row, p.mine && styles.mineRow, steal && styles.stealRow]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={styles.pk}>{p.round}R</Text>
                <PosTag pos={p.player.position} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nm}>
                    {p.mine ? <Text style={{ color: theme.accent }}>★ </Text> : null}
                    {steal ? <Text style={{ color: theme.warn }}>💔 </Text> : null}
                    {p.player.name}
                  </Text>
                  <Text style={styles.sub}>{shortTeamName(p.teamId)} · OVR {fogOvr(p.player, reveal)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <View style={[styles.badge, { backgroundColor: r.color + '22', borderColor: r.color + '55' }]}>
                    <Text style={{ color: r.color, fontSize: 11, fontWeight: '800' }}>{why}</Text>
                  </View>
                  {timing ? (
                    <Text style={{ color: timing === '이른' ? theme.warn : theme.muted, fontSize: 10, fontWeight: '800' }}>
                      예상보다 {timing} 지명
                    </Text>
                  ) : null}
                </View>
              </View>
              {steal ? <Text style={styles.stealLine}>💔 {p.player.name}가 {shortTeamName(p.teamId)}의 지명을 받았습니다</Text> : null}
              {prose ? <Text style={styles.proseLine}>{prose}</Text> : null}
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
    backgroundColor: theme.card, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9,
    borderWidth: 1, borderColor: theme.border, marginBottom: 6,
  },
  mineRow: { borderColor: theme.accent, backgroundColor: theme.accent + '12' },
  stealRow: { borderColor: theme.warn, backgroundColor: theme.warn + '14' },
  stealLine: { color: theme.warn, fontSize: 12, fontWeight: '700', marginTop: 6 },
  proseLine: { color: theme.text, fontSize: 12, lineHeight: 17, marginTop: 6 },
  pk: { color: theme.muted, fontWeight: '800', fontSize: 12, width: 34 },
  nm: { color: theme.text, fontSize: 15, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 12, marginTop: 1 },
  badge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  sumR: { color: theme.muted, fontWeight: '800', fontSize: 12, width: 30 },
  sumName: { color: theme.text, fontSize: 14, fontWeight: '700', flex: 1 },
  sumGrade: { color: theme.sky, fontSize: 12, fontWeight: '800' },
  sumPass: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  sumReason: { color: theme.muted, fontSize: 12, fontWeight: '600', marginTop: 3, lineHeight: 16 },
  // DL-9 지명 포스터 오버레이 — 뷰포트 고정 스크림(딥 네이비 베일) + 중앙 포스터 + 탭 힌트/태그. 색은 배경 자산 톤(테마 무관).
  posterScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,7,20,0.86)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: 12, zIndex: 20 },
  posterHint: { fontSize: 12, letterSpacing: 1 },
  posterTag: { color: '#CFE0FF', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
}));
