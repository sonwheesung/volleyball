// 아시아쿼터 FA (FOREIGN_SYSTEM §7.4, 2026-27 실규칙) — 트라이아웃 폐지→구단 직접 협상. 팀당 1명·연차 상한(1년/2년)·캡 제외.
// 노리는 선수(오퍼)를 정하면 선수가 조건을 보고 팀을 고른다(추첨 아님). 기존 구단 보유권(증액/거부→시즌아웃). 미리보기=endSeason 결과(동일 빌더).

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Row, Screen, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { ForeignResumeDetail } from '../components/ForeignResumeDetail';
import { buildDraftContext } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, teamScoutReveal, getEvolvedTeamPlayers } from '../data/league';
import { overall, overallRaw, displayOvr } from '../engine/overall';
import { ASIAN_SALARY_Y1, ASIAN_SALARY_Y2 } from '../engine/foreign';
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
  const faSignings = useGameStore((s) => s.faSignings);
  const faAggressive = useGameStore((s) => s.faAggressive);
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

  // endSeason과 같은 체인 — 미리보기=결과
  const ctx = useMemo(
    () => buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season + 1,
      buildOwnerFx(interviews, season, my, fanScore), cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian),
    [my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, season, interviews, fanScore, cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian],
  );
  const myAsian = useMemo(
    () => getEvolvedTeamPlayers(my, currentDay).find((p) => p.isAsianQuota),
    [my, currentDay, season],
  );
  const tryout = ctx.asianTryout;
  const snap = ctx.snapshot;
  const myPickId = tryout.picks[my];

  const reveal = teamScoutReveal(my);
  const fogOvr = (p: Player): string => {
    const o = displayOvr(overallRaw(p));
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
    <Screen title="아시아쿼터 FA">
      <Card accent={theme.bad}>
        <Muted style={{ fontSize: 12 }}>
          외국인과 별개 — 팀당 1명(AVC 국가) · **자유계약**(2026-27~) · 연차 상한 1년 {formatMoney(ASIAN_SALARY_Y1)}·2년 {formatMoney(ASIAN_SALARY_Y2)}(샐러리캡 제외).
          추첨 아닌 직접 협상 — 노리는 선수를 ★로 정하면, 선수가 팀 전력·출전 기회를 보고 고릅니다(강팀·자리 있는 팀이 유리).
        </Muted>
        <Row>
          <IconLabel icon="airplane-outline" color={theme.bad}>내 예상 영입</IconLabel>
          <Text style={{ color: theme.accent, fontWeight: '800' }}>
            {myPickId && snap[myPickId] ? `${snap[myPickId].name} (${snap[myPickId].nationality ?? ''} ${snap[myPickId].position})` : '- (자금 부족/공석)'}
          </Text>
        </Row>
      </Card>

      {myAsian ? (
        <>
          <Title>기존 구단 보유권 — {myAsian.name} ({myAsian.nationality ?? ''} · {myAsian.age}세 · OVR {displayOvr(overallRaw(myAsian))})</Title>
          <Card accent={theme.bad}>
            <Muted style={{ fontSize: 12 }}>
              보유권 — 2년차 상한({formatMoney(ASIAN_SALARY_Y2)})으로 증액 제시하면 우선 잔류. 놓아주면 자유계약 시장으로 나가 다른 팀과 협상할 수 있습니다.
            </Muted>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              {([['자동(추천)', null], ['보유(증액)', true], ['놓아줌', false]] as const).map(([label, v]) => (
                <Pressable
                  key={label}
                  onPress={() => setKeepAsian(v)}
                  style={[styles.chip, keepAsian === v && styles.chipOn]}
                >
                  <Text style={[styles.chipTxt, keepAsian === v && { color: theme.bg }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
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
                  <PosTag pos={p.position} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.name}>{p.name}</Text>
                      {p.nationality ? <Text style={styles.nat}>{p.nationality}</Text> : null}
                      {returning ? <Text style={styles.tagReturn}>재참가</Text> : null}
                    </View>
                    <Text style={styles.sub}>
                      {p.age}세 · {p.height}cm · OVR {fogOvr(p)} · {taker ? `→ ${taker}` : '미계약'} · {open ? '접기 ▲' : '이력 ▼'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => toggleAsianWish(p.id)} hitSlop={8} style={styles.wishBtn}>
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
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border },
  rowWrap: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  wishBtn: { paddingHorizontal: 14, paddingVertical: 14, borderLeftWidth: 1, borderLeftColor: theme.border, minWidth: 60, alignItems: 'center' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  nat: { color: theme.elite, fontSize: 11, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  tagReturn: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  tagWish: { color: theme.warn, fontSize: 12, fontWeight: '900' },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.text, fontSize: 13, fontWeight: '700' },
}));
