// 게임 가이드 — 사용자가 알면 좋은 개념 설명(아코디언). 마이페이지에서 진입.
//   선수 이해(스탯·특성·성격·컨디션·지금 마음·인간관계) + 영입·운영(FA·드래프트·외국인).
//   특성/성격은 실제 데이터(TRAITS·ARCHETYPE_KO)를 그대로 끌어와 문구가 게임과 항상 일치.
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, IconLabel, Muted, Screen, Title, theme, themedStyles } from '../components/Screen';
import { TRAITS } from '../engine/traits';
import { ARCHETYPE_KO } from '../data/owner';

function Accordion({ icon, title, children }: { icon: ComponentIcon; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.item}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.head}>
        <View style={styles.headL}>
          <Ionicons name={icon} size={18} color={theme.accent} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.muted} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}
type ComponentIcon = React.ComponentProps<typeof Ionicons>['name'];

const P = ({ children }: { children: ReactNode }) => <Text style={styles.p}>{children}</Text>;
const Line = ({ k, v }: { k: string; v: string }) => (
  <View style={styles.line}><Text style={styles.lk}>{k}</Text><Text style={styles.lv}>{v}</Text></View>
);

export default function Guide() {
  return (
    <Screen title="게임 가이드">
      <Muted style={{ marginBottom: 4 }}>항목을 누르면 설명이 펼쳐집니다. 배구명가를 처음 한다면 여기부터.</Muted>

      <IconLabel icon="tv-outline" color={theme.warn}>경기 · 관전</IconLabel>
      <Card>
        <Accordion icon="flame-outline" title="빅매치 — 중요 경기 표시">
          <P>순위에 직결되는 중요 경기(상위권 맞대결·인접 순위전·라이벌전)는 ⭐중요·🔥빅매치로 표시됩니다.</P>
          <P>직접 관전하면 더 몰입되지만, 안 봐도 경기는 자동으로 진행됩니다 — 강요하지 않습니다.</P>
        </Accordion>
        <Accordion icon="play-outline" title="관전 — 직접 보기 vs 자동">
          <P>경기는 직접 관전(이어보기)하거나 자동으로 넘길 수 있습니다. 이 게임은 조작이 아니라 보는 게임 — 내 팀 경기와 시즌 서사를 관전하는 게 핵심입니다.</P>
          <P>경기 사이 기간엔 모든 선수가 자동으로 훈련합니다.</P>
        </Accordion>
        <Accordion icon="clipboard-outline" title="감독 건의 — 선발·벤치">
          <P>선발·교체 등 현장 권한은 감독에게 있습니다. 구단주는 특정 선수를 선발/벤치로 써달라고 건의만 할 수 있습니다.</P>
          <P>감독은 성향(카리스마·합리)에 따라 수락하거나 거절합니다 — 에이스를 빼라면 강하게 저항합니다. 인기 선수를 오래 벤치에 두면 팬들이 분노합니다(기사·관중·예산). 마음에 안 들면 감독을 교체하는 게 구단주의 칼입니다.</P>
        </Accordion>
      </Card>

      <IconLabel icon="body-outline" color={theme.accent}>선수 이해</IconLabel>
      <Card>
        <Accordion icon="stats-chart-outline" title="스탯 — 능력치 2층 구조">
          <P>겉으로 보이는 종합 스탯(스파이크·블로킹·디그·리시브·세팅·서브)은 밑단 세부 능력의 조합으로 산출됩니다.</P>
          <P>· 신체: 키·점프력·민첩성·체력  · 공통: 반응속도·위치선정  · 멘탈: 집중력·기복·배구IQ</P>
          <P>세팅은 팀 공격 전체에 곱해지는 승수라 좋은 세터의 가치가 특히 큽니다. 포지션마다 중요한 스탯이 다릅니다(리베로=디그·리시브, 미들=블로킹·높이).</P>
          <P>내 팀 선수는 잠재력(→NN)까지 보이지만, 타 구단·유망주는 스카우터 수준만큼만 흐리게 보입니다.</P>
        </Accordion>
        <Accordion icon="sparkles-outline" title="특성 — 타고난 개성">
          <P>선수마다 고유 특성이 있습니다. 긍정 특성은 흔하고 부정 특성은 드뭅니다 — 그래서 유망주 영입은 일종의 도박입니다.</P>
          {(Object.keys(TRAITS) as (keyof typeof TRAITS)[]).map((t) => (
            <Line key={t} k={`${TRAITS[t].good ? '▲' : '▼'} ${TRAITS[t].name}`} v={TRAITS[t].desc} />
          ))}
        </Accordion>
        <Accordion icon="happy-outline" title="성격 — FA·재계약 때 무엇을 우선하나">
          <P>선수가 계약·잔류를 정할 때 무엇을 가장 중시하는지. 유형에 따라 협상 방식이 달라집니다.</P>
          {(Object.keys(ARCHETYPE_KO) as (keyof typeof ARCHETYPE_KO)[]).map((a) => (
            <Line key={a} k={`${ARCHETYPE_KO[a].emoji} ${ARCHETYPE_KO[a].label}`} v={ARCHETYPE_KO[a].note} />
          ))}
        </Accordion>
        <Accordion icon="pulse-outline" title="컨디션 — 경기감각">
          <P>벤치·결장이 누적되면 경기감각이 떨어져 체감 능력이 최대 −7%까지 하락합니다. 주전으로 꾸준히 뛰면 유지됩니다.</P>
          <P>부상 복귀·벤치 복귀 초반엔 감각을 되찾는 데 시간이 걸립니다. "실전 감각 좋음/녹슴"으로 표시됩니다.</P>
        </Accordion>
        <Accordion icon="heart-half-outline" title="지금 마음 — 선수의 불만">
          <P>선수는 상황에 따라 불만을 품습니다. 불만이 쌓이면 재계약을 거부하거나 이적하려 합니다.</P>
          <Line k="🏆 성적" v="팀이 계속 하위권일 때" />
          <Line k="🔥 출전" v="주전감인데 출전이 부족할 때 (약체 후보는 벤치를 당연히 받아들임)" />
          <Line k="💰 연봉" v="실력 대비 저연봉일 때" />
          <Line k="🏠 연고" v="국내 선수가 고향(선호)팀을 그리워할 때" />
        </Accordion>
        <Accordion icon="people-outline" title="인간관계 — 친한·라이벌">
          <P>선수들은 서로 친하거나(친한) 경쟁 관계(라이벌)입니다. 같은 팀에 친한 선수가 있으면 심리적 안정에 도움이 됩니다.</P>
        </Accordion>
      </Card>

      <IconLabel icon="briefcase-outline" color={theme.sky}>영입·운영</IconLabel>
      <Card>
        <Accordion icon="swap-horizontal-outline" title="FA — 자유계약">
          <P>계약이 끝난 선수는 자유계약(FA)이 됩니다. 다른 팀 선수를 영입하거나, 내 선수가 빠져나갈 수 있습니다.</P>
          <P>선수의 성격·팀 성적·제시 연봉이 선택을 좌우합니다. 트레이드(맞교환)는 없습니다 — 선수 수급은 FA·드래프트·외국인으로.</P>
        </Accordion>
        <Accordion icon="school-outline" title="드래프트 — 신인 지명">
          <P>매 시즌 드래프트로 유망주를 지명합니다(하위 팀이 앞 순번). 유망주는 현재 실력은 낮지만 잠재력이 큽니다.</P>
          <P>아마추어 성적표로 판단하되 성적엔 노이즈가 있고, 잠재력은 스카우터가 일부만 공개합니다 — 좋은 스카우터일수록 더 많이·선명하게 보입니다.</P>
          <P>대기만성·반짝 같은 이상치가 있어 뽑기는 도박입니다. "최대어라더니 폭망", "무명이 대박"이 진짜 재미입니다.</P>
        </Accordion>
        <Accordion icon="globe-outline" title="외국인 — 트라이아웃">
          <P>외국인 선수는 팀당 1명, 주로 아포짓(OP)으로 팀 공격의 핵입니다. 1년 계약(트라이아웃), 잘하면 여러 시즌 재계약.</P>
          <P>이미 검증된 완성형 선수라 잠재력보다 이전 리그 성적·이력(폼·수상·부상·적응)을 보고 뽑습니다. 팀 전력을 가장 크게 좌우하는 결정입니다.</P>
        </Accordion>
      </Card>

      <Muted style={{ fontSize: 12, marginTop: 4, marginBottom: 8 }}>더 궁금한 게 있으면 마이페이지 &gt; 문의하기로 알려주세요.</Muted>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  item: { borderTopWidth: 1, borderTopColor: theme.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  headL: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { color: theme.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  body: { paddingBottom: 12, gap: 6 },
  p: { color: theme.muted, fontSize: 13, lineHeight: 20 },
  line: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  lk: { color: theme.text, fontSize: 13, fontWeight: '700', width: 92 },
  lv: { color: theme.muted, fontSize: 13, lineHeight: 19, flex: 1 },
}));
