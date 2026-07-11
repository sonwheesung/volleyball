// 아시아쿼터 FA (FOREIGN_SYSTEM §7.4, 2026-27 실규칙) — 트라이아웃 폐지→구단 직접 협상. 팀당 1명·연차 상한(1년/2년)·캡 제외.
// 노리는 선수(오퍼)를 정하면 선수가 조건을 보고 팀을 고른다(추첨 아님). 기존 구단 보유권(증액/거부→시즌아웃). 미리보기=endSeason 결과(동일 빌더).

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Screen, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { ForeignResumeDetail } from '../components/ForeignResumeDetail';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { buildDraftContextFrom, buildOffseasonBase } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, teamScoutReveal, getEvolvedTeamPlayers } from '../data/league';
import { overall, overallRaw, displayOvr } from '../engine/overall';
import { fogOvr as fogOvrShared } from '../data/prospectScout';
import { ASIAN_SALARY_Y1, ASIAN_SALARY_Y2 } from '../engine/foreign';
import { RETIRE_AGE } from '../engine/retire';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';
import type { Player } from '../types';

export default function AsianTryout() {
  // 트라이아웃 컨텍스트 생성(buildDraftContext)은 무거워 한 틱 미뤄 로딩부터 그린다
  const ready = useDeferredReady();
  if (!ready) return <Loading title="아시아쿼터 FA" variant="list" />;
  return <AsianTryoutInner />;
}

function AsianTryoutInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faOffers = useGameStore((s) => s.faOffers); // FA 오퍼 다레버(§2.8 Phase1) — 구 faSignings+faAggressive 대체
  const protectedIds = useGameStore((s) => s.protectedIds);
  const moneyOnlyIds = useGameStore((s) => s.moneyOnlyIds);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const tryoutWish = useGameStore((s) => s.tryoutWish);
  const keepForeign = useGameStore((s) => s.keepForeign);
  const asianWish = useGameStore((s) => s.asianWish);
  const toggleAsianWish = useGameStore((s) => s.toggleAsianWish);
  const [openId, setOpenId] = useState<string | null>(null);
  const keepAsian = useGameStore((s) => s.keepAsian);
  const setKeepAsian = useGameStore((s) => s.setKeepAsian);
  const currentDay = useGameStore((s) => s.currentDay);
  // 스냅샷/해결 분리(REALTIME_SIM §7.3): 무거운 base는 안정 deps로 메모, 오퍼/보유 토글은 가벼운 해결만 재실행. 오버레이 마스킹(UI-27).
  const busy = useBusyRun();

  // endSeason과 같은 체인 — 미리보기=결과
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore, contractOverrides), [interviews, season, my, fanScore, contractOverrides]);
  const base = useMemo(
    () => buildOffseasonBase(my, resignDecisions, contractOverrides, season + 1, ownerFx),
    [my, resignDecisions, contractOverrides, season, ownerFx],
  );
  const ctx = useMemo(
    () => buildDraftContextFrom(base, my, Object.keys(faOffers), false, protectedIds, season + 1, ownerFx, cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian, faOffers),
    [base, my, faOffers, protectedIds, season, ownerFx, cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian],
  );
  const myAsian = useMemo(
    () => getEvolvedTeamPlayers(my, currentDay).find((p) => p.isAsianQuota),
    [my, currentDay, season],
  );
  const tryout = ctx.asianTryout;
  const snap = ctx.snapshot;
  const myPickId = tryout.picks[my];

  const reveal = teamScoutReveal(my);
  // 공용 fogOvr(data/prospectScout → engine/overall 정본)에 위임 — 로컬 중복 제거(동작 동일).
  const fogOvr = (p: Player): string => fogOvrShared(p, reveal);

  const pool = tryout.poolIds.map((id) => snap[id]).filter((p): p is Player => !!p);
  const pickedBy = (pid: string): string | null => {
    const t = Object.keys(tryout.picks).find((k) => tryout.picks[k] === pid);
    return t ? (getTeam(t)?.name ?? t) : null;
  };

  return (
    <Screen title="아시아쿼터 FA">
      <Card accent={theme.bad} flat>
        <IconLabel icon="airplane-outline" color={theme.bad}>아시아쿼터 현황</IconLabel>
        <View style={styles.statHeader}>
          <View style={styles.statCell}>
            <Text style={styles.statCellLabel}>등록 선수</Text>
            <Text style={styles.statCellVal} numberOfLines={1}>{pool.length}명</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statCellLabel}>스카우터 공개도</Text>
            <Text style={styles.statCellVal} numberOfLines={1}>{(reveal * 100).toFixed(0)}%</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statCellLabel}>내 예상 영입</Text>
            <Text style={[styles.statCellVal, { color: theme.accent }]} numberOfLines={1}>
              {myPickId && snap[myPickId] ? snap[myPickId].name : '-'}
            </Text>
          </View>
        </View>
        <Muted style={{ fontSize: 12 }}>
          외국인과 별개 — 팀당 1명(AVC 국가) · **자유계약**(2026-27~) · 연차 상한 1년 {formatMoney(ASIAN_SALARY_Y1)}·2년 {formatMoney(ASIAN_SALARY_Y2)}(샐러리캡 제외).
          추첨 아닌 직접 협상 — 노리는 선수를 ★로 정하면, 선수가 팀 전력·출전 기회를 보고 고릅니다(강팀·자리 있는 팀이 유리).
        </Muted>
      </Card>

      {myAsian ? (
        <>
          <Title>기존 구단 보유권 — {myAsian.name} ({myAsian.nationality ?? ''} · {myAsian.age}세 · OVR {displayOvr(overallRaw(myAsian))})</Title>
          <Card accent={theme.bad}>
            {myAsian.age + 1 >= RETIRE_AGE ? (
              // 정년(FOREIGN_SYSTEM §1.6): 다음 시즌 나이 40+ → 보유(재계약) 불가(리그 정년은 수입선수에도 적용).
              <Muted style={{ fontSize: 12 }}>
                정년 도달({RETIRE_AGE}세) — 보유(재계약) 불가입니다(리그 정년은 아시아쿼터에도 적용). 아래 후보에서 새 얼굴에게 오퍼하세요.
              </Muted>
            ) : (
              <>
                <Muted style={{ fontSize: 12 }}>
                  보유권 — 2년차 상한({formatMoney(ASIAN_SALARY_Y2)})으로 증액 제시하면 우선 잔류. 놓아주면 자유계약 시장으로 나가 다른 팀과 협상할 수 있습니다.
                </Muted>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {([['자동(추천)', null], ['보유(증액)', true], ['놓아줌', false]] as const).map(([label, v]) => (
                    <Pressable
                      key={label}
                      onPress={() => busy.run('스카우트 리포트를 정리하는 중…', () => setKeepAsian(v))}
                      style={[styles.chip, keepAsian === v && styles.chipOn]}
                    >
                      <Text style={[styles.chipTxt, keepAsian === v && { color: theme.bg }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </Card>
        </>
      ) : null}

      <Title>협상 후보 ({pool.length}명) — 눌러서 이력 · 우측 오퍼</Title>
      {pool
        .slice()
        .sort((a, b) => overall(b) - overall(a))
        .map((p) => {
          const wishIdx = asianWish.indexOf(p.id);
          const taker = pickedBy(p.id);
          const returning = !p.id.startsWith('asn-s');
          const open = openId === p.id;
          return (
            <View key={p.id} style={[styles.rowWrap, wishIdx >= 0 && { borderColor: theme.warn, borderWidth: 1 }]}>
              <View style={styles.rowInner}>
                <Pressable onPress={() => setOpenId(open ? null : p.id)} style={styles.rowTap}>
                  <View style={styles.avatarWrap}>
                    <PlayerAvatar id={p.id} size={60} />
                  </View>
                  <View style={{ flex: 1 }}>
                    {/* 이름 + 국적 + 포지션 + 협상 팀(포지션 오른쪽, 2026-07-12 테스터) */}
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                      {p.nationality ? <Text style={styles.nat}>{p.nationality}</Text> : null}
                      <PosTag pos={p.position} />
                      <Text style={[styles.taker, taker ? { color: theme.accent } : null]} numberOfLines={1}>
                        {taker ? `→ ${taker}` : '미계약'}
                      </Text>
                      {returning ? <Text style={styles.tagReturn}>재참가</Text> : null}
                    </View>
                    <Text style={styles.sub} numberOfLines={1}>
                      {p.age}세 · {p.height}cm · OVR {fogOvr(p)}
                    </Text>
                    {/* 이력 토글 — 메타 텍스트에 파묻히지 않게 별도 칩(2026-07-11 테스터: UI 그룹화) */}
                    <View style={[styles.resumeChip, open && styles.resumeChipOn]}>
                      <Text style={[styles.resumeChipTxt, open && styles.resumeChipTxtOn]}>{open ? '이력 접기 ▲' : '이력 보기 ▼'}</Text>
                    </View>
                  </View>
                </Pressable>
                <Pressable onPress={() => busy.run('스카우트 리포트를 정리하는 중…', () => toggleAsianWish(p.id))} hitSlop={8} style={styles.wishBtn}>
                  <Text style={{ color: wishIdx >= 0 ? theme.warn : theme.muted, fontWeight: '900', fontSize: 13 }}>
                    {wishIdx >= 0 ? `★${wishIdx + 1}` : '오퍼'}
                  </Text>
                </Pressable>
              </View>
              {open ? <ForeignResumeDetail p={p} reveal={reveal} /> : null}
            </View>
          );
        })}

      <Muted style={{ fontSize: 11 }}>
        미계약자 중 상위 {tryout.altPoolIds.length}명은 대체 풀로 남아 시즌 중 교체(1회)에 쓸 수 있습니다.
        스카우터 투자(공개도 {(reveal * 100).toFixed(0)}%)가 협상의 보험입니다.
      </Muted>
      <Button label="FA 센터 →" onPress={() => router.push('/fa')} />
      <BusyOverlay visible={busy.busy} message={busy.message} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border },
  rowWrap: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  wishBtn: { paddingHorizontal: 14, paddingVertical: 14, borderLeftWidth: 1, borderLeftColor: theme.border, minWidth: 60, alignItems: 'center' },
  // 현황 헤더 카드 — 가로 3칸 스탯(등록 선수·공개도·예상 영입), 셀 사이 얇은 구분선
  statHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  statCell: { flex: 1, gap: 2 },
  statCellLabel: { color: theme.muted, fontSize: 11 },
  statCellVal: { color: theme.text, fontSize: 15, fontWeight: '800' },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: theme.border, marginHorizontal: 10 },
  // 아바타(60) + 하단 OVR 범위 오버레이 배지(반투명 검정 바 위 흰 글씨)
  avatarWrap: { width: 60, height: 60, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.cardAlt },
  ovrOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', paddingVertical: 1.5, alignItems: 'center' },
  ovrOverlayTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  nat: { color: theme.elite, fontSize: 11, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 2 },
  taker: { color: theme.muted, fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  tagReturn: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  tagWish: { color: theme.warn, fontSize: 12, fontWeight: '900' },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.text, fontSize: 13, fontWeight: '700' },
  // 이력 토글 칩 — 텍스트와 분리된 또렷한 인터랙션 어포던스(테두리 pill, 눌리면 accent)
  resumeChip: { alignSelf: 'flex-start', marginTop: 6, borderWidth: 1, borderColor: theme.accent + '80', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9 },
  resumeChipOn: { backgroundColor: theme.accent + '1A' },
  resumeChipTxt: { color: theme.accent, fontSize: 12, fontWeight: '800' },
  resumeChipTxtOn: { color: theme.accent },
}));
