import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, OvrBadge, PosTag, Row, Screen, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { buildOffseasonBase } from '../data/draftSetup';
import { resolveDraftContextFor } from '../data/offseasonArgs';
import { buildOwnerFx } from '../data/owner';
import { teamScoutReveal } from '../data/league';
import { computeStandings } from '../data/standings';
import { amateurRecord } from '../data/amateurRecord';
import { revealedPotential, fogOvr } from '../data/prospectScout';
import { prospectReport } from '../data/prospectReport';
import { draftClassPreview } from '../data/draftPreview';
import { prospectGradeLabel } from '../data/prospectGrade';
import { consensusOrder, projectionBand } from '../data/draftProjection';
import { neededPositions } from '../engine/draft';
import { overallRaw, REVEAL_PRECISE } from '../engine/overall';
import type { Position } from '../types';
import { useGameStore } from '../store/useGameStore';
import { showSeasonStartAd } from '../lib/ads';
import type { Player } from '../types';

const POS_KO: Record<Position, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };

// 아마추어 성적표 + 스카우터 공개 잠재력 + 스카우트 리포트 (★ 포텐 별 제거 — 스카우팅 2.0 4단계)
// export: 라이브 드래프트(app/draft-live.tsx) 내 픽 선택 패널이 같은 안개 존중 상세를 재사용(FA_SYSTEM §3.2.1).
export function ProspectDetail({ p, reveal }: { p: Player; reveal: number }) {
  const rec = amateurRecord(p);
  const rev = revealedPotential(p, reveal);
  const report = prospectReport(p, reveal);
  return (
    <View style={styles.detail}>
      <Text style={styles.detailHead}>아마추어 성적 · {rec.leagueLabel}</Text>
      <View style={styles.statWrap}>
        {rec.stats.map((s) => (
          <View key={s.key} style={styles.statChip}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={styles.statVal}>{s.value}{s.unit === '%' ? '%' : ''}<Text style={styles.statUnit}>{s.unit === '%' ? '' : s.unit}</Text></Text>
          </View>
        ))}
      </View>

      <Text style={[styles.detailHead, { marginTop: 10 }]}>스카우터 공개 잠재력</Text>
      {rev.length === 0 ? (
        <Muted style={{ fontSize: 12 }}>스카우터가 부족해 잠재력을 읽지 못했습니다. (스태프에서 스카우터 영입)</Muted>
      ) : (
        <View style={styles.statWrap}>
          {rev.map((r) => (
            <View key={r.key} style={[styles.statChip, { borderColor: theme.sky + '55' }]}>
              <Text style={styles.statLabel}>{r.label} 잠재</Text>
              <Text style={[styles.statVal, { color: theme.sky }]}>{r.text}{r.exact ? '' : ''}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.detailHead, { marginTop: 10 }]}>스카우트 리포트</Text>
      {report.map((line, i) => (
        <Text key={i} style={styles.reportLine}>· {line}</Text>
      ))}
    </View>
  );
}

export default function DraftCenter() {
  // 드래프트 컨텍스트 생성(buildDraftContext)은 무거워 한 틱 미뤄 로딩부터 그린다(미리보기 삭제로 resolveDraft 재실행 없음)
  const ready = useDeferredReady();
  if (!ready) return <Loading title="신인 드래프트" variant="list" />;
  return <DraftCenterInner />;
}

function DraftCenterInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faOffers = useGameStore((s) => s.faOffers); // FA 오퍼 다레버(§2.8 Phase1) — 구 faSignings+faAggressive 대체
  const protectedIds = useGameStore((s) => s.protectedIds);
  const draftPicks = useGameStore((s) => s.draftPicks);
  const toggleDraftPick = useGameStore((s) => s.toggleDraftPick);

  const moneyOnlyIds = useGameStore((s) => s.moneyOnlyIds);
  const tryoutWish = useGameStore((s) => s.tryoutWish);
  const keepForeign = useGameStore((s) => s.keepForeign);
  const asianWish = useGameStore((s) => s.asianWish);
  const keepAsian = useGameStore((s) => s.keepAsian);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const [openId, setOpenId] = useState<string | null>(null);
  // 찜 담기/빼기는 가벼운 토글(더 이상 resolveDraft 재실행 없음 — 미리보기 삭제, 조정 A). 짧은 마스킹만.
  const busy = useBusyRun();
  // endSeason과 동일한 인자 전체(면담 거부·자금·트라이아웃/아시아 토글·돈만 보상)로 컨텍스트를 만들어
  //   지명 순번·클래스가 결과와 동일하게(EC-FA-09 — 누락 인자로 라이브 확정픽 유실/발산 차단). 공용 조립 함수 경유.
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore), [interviews, season, my, fanScore]);
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
  const standings = useMemo(() => computeStandings(Number.MAX_SAFE_INTEGER), [season]);

  // 스카우팅 안개(STAFF_SYSTEM) — 공개도↓일수록 현재 OVR은 범위로.
  const reveal = teamScoutReveal(my);
  // DL-5: 예상 지명순(리그 컨센서스) 정렬 + 순위 밴드. reveal-gated·숨은 포텐 미참조.
  const rankMap = useMemo(() => consensusOrder(ctx.cls, reveal), [ctx, reveal]);
  const classSorted = useMemo(
    () => [...ctx.cls].sort((a, b) => (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0)),
    [ctx, rankMap],
  );
  const myRank = standings.findIndex((s) => s.teamId === my) + 1;
  const preview_ = useMemo(() => draftClassPreview(ctx.cls, reveal), [ctx, reveal]);
  // DL-1: 우리 필요 포지션(floor 대비 부족 힌트) — 공개 로스터 파생.
  const myNeeds = useMemo<Position[]>(
    () => Array.from(new Set(neededPositions(ctx.rosters[my] ?? [], (id) => ctx.snapshot[id]))),
    [ctx, my],
  );

  const onFinish = async () => {
    // 시즌 시작하기 — 동영상 광고(첫 시즌 제외·MONETIZATION_SYSTEM §3) 후 시즌 시작 로딩으로.
    // 광고는 항상 resolve(스킵/실패/오프라인이어도 진행 하드블록 없음). endSeason은 로딩 화면이 페인트 후 실행(SEASON §5.5 D).
    await showSeasonStartAd();
    router.replace('/season-start');
  };

  return (
    <Screen title={`${season + 2}시즌 신인 드래프트`}>
      <Card accent={theme.sky}>
        <Row>
          <IconLabel icon="person-add-outline" color={theme.sky}>내 순위 {myRank}위 · 지명권 {ctx.myPickSlots.length}장</IconLabel>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            지명 순번 {ctx.myPickSlots.map((i) => i + 1).join(', ') || '-'}
          </Text>
        </Row>
        <Text style={{ color: myNeeds.length ? theme.good : theme.muted, fontSize: 12, fontWeight: '800', marginTop: 4 }}>
          {myNeeds.length ? `우리 필요 포지션: ${myNeeds.map((p) => POS_KO[p]).join(' · ')}` : '구성 균형 — 미래를 위한 최고 자원 위주'}
        </Text>
        <Muted style={{ fontSize: 12, marginTop: 2 }}>
          매 라운드 지명 또는 패스 — 미래를 위한 어린 선수를 뽑습니다. 원하는 신인을 찜해두면 라이브 드래프트에서
          위에 뜨고, 내 차례에 직접 지명합니다. 선수를 누르면 아마추어 성적·스카우트 리포트를 볼 수 있어요.
        </Muted>
        <Muted style={{ fontSize: 12, marginTop: 4, color: reveal >= 0.6 ? theme.good : theme.warn }}>
          스카우팅 공개도 {Math.round(reveal * 100)}% {reveal >= REVEAL_PRECISE ? '(정밀)' : '— 스카우터를 영입하면 잠재력이 더 많이·선명하게 보입니다'}
        </Muted>
      </Card>

      <Card accent={theme.warn}>
        <IconLabel icon="newspaper-outline" color={theme.warn}>{preview_.headline}</IconLabel>
        {preview_.notes.map((n, i) => (
          <Muted key={i} style={{ fontSize: 12, marginTop: 4 }}>· {n}</Muted>
        ))}
      </Card>

      <Button label="라이브 드래프트 보기 ▶" onPress={() => router.push('/draft-live')} />
      <Pressable onPress={onFinish} style={{ paddingVertical: 8, alignItems: 'center' }}>
        <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '700' }}>건너뛰면 찜 순서대로 자동 지명합니다</Text>
      </Pressable>

      <Title>드래프트 클래스 ({classSorted.length}명)</Title>
      {classSorted.map((p) => {
        const wi = draftPicks.indexOf(p.id);
        const picked = wi >= 0;
        const open = openId === p.id;
        return (
          <View key={p.id} style={[styles.rowWrap, picked && { borderColor: theme.accent, borderWidth: 1, backgroundColor: theme.accent + '12' }]}>
            <View style={styles.rowInner}>
              <Pressable onPress={() => setOpenId(open ? null : p.id)} style={styles.rowTap}>
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <Text style={styles.sub}>{p.age}세 · {p.height}cm · {open ? '접기 ▲' : '자세히 ▼'}</Text>
                  <Text style={styles.gradeLine}>
                    <Text style={{ color: theme.sky, fontWeight: '800' }}>{prospectGradeLabel(p, reveal)}</Text>
                    <Text style={{ color: theme.muted }}>  ·  {projectionBand(rankMap.get(p.id) ?? 0, ctx.cls.length, reveal).text}</Text>
                  </Text>
                </View>
                {reveal >= REVEAL_PRECISE
                  ? <OvrBadge value={overallRaw(p)} />
                  : <Text style={styles.fogOvr}>{fogOvr(p, reveal)}</Text>}
              </Pressable>
              <Pressable onPress={() => busy.run('지명 결과를 정리하는 중…', () => toggleDraftPick(p.id))} hitSlop={8} style={styles.pickBtn}>
                <Text style={{ color: picked ? theme.accent : theme.muted, fontWeight: '800', fontSize: 13 }}>
                  {picked ? `담음${wi + 1}` : '담기'}
                </Text>
              </Pressable>
            </View>
            {open ? <ProspectDetail p={p} reveal={reveal} /> : null}
          </View>
        );
      })}
      <BusyOverlay visible={busy.busy} message={busy.message} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: theme.border,
  },
  rowWrap: {
    backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden',
  },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pickBtn: { paddingHorizontal: 14, paddingVertical: 14, borderLeftWidth: 1, borderLeftColor: theme.border, minWidth: 64, alignItems: 'center' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  gradeLine: { fontSize: 12, marginTop: 2 },
  fogOvr: { minWidth: 52, textAlign: 'center', color: theme.muted, fontWeight: '800', fontSize: 13 },
  detail: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bg + '00' },
  detailHead: { color: theme.muted, fontSize: 12, fontWeight: '800', marginBottom: 5, marginTop: 6 },
  statWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statChip: { borderWidth: 1, borderColor: theme.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6, minWidth: 96 },
  statLabel: { color: theme.muted, fontSize: 11 },
  statVal: { color: theme.text, fontSize: 16, fontWeight: '800' },
  statUnit: { color: theme.muted, fontSize: 11, fontWeight: '600' },
  reportLine: { color: theme.text, fontSize: 13, lineHeight: 19, marginBottom: 1 },
}));
