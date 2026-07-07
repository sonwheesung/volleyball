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
      <Muted style={{ marginBottom: 4 }}>항목을 누르면 설명이 펼쳐져요. 배구명가를 처음 한다면 여기부터 읽어보세요.</Muted>

      <IconLabel icon="tv-outline" color={theme.warn}>경기 · 관전</IconLabel>
      <Card>
        <Accordion icon="flame-outline" title="빅매치 — 중요 경기 표시">
          <P>순위에 크게 영향을 주는 경기는 ⭐중요·🔥빅매치로 표시돼요. 상위권(3위 이내) 팀끼리 붙거나, 시즌 막판에 순위가 비슷한 팀과 만날 때예요.</P>
          <P>직접 보면 더 재미있지만, 안 봐도 경기는 자동으로 진행돼요 — 꼭 볼 필요는 없어요.</P>
        </Accordion>
        <Accordion icon="play-outline" title="관전 — 직접 보기 vs 자동">
          <P>경기는 직접 보거나(이어보기) 자동으로 넘길 수 있어요. 이 게임은 직접 조작하는 게임이 아니라 보는 게임이에요 — 내 팀 경기와 시즌 이야기를 지켜보는 게 핵심이에요.</P>
          <P>경기와 경기 사이에는 모든 선수가 알아서 훈련해요.</P>
        </Accordion>
        <Accordion icon="clipboard-outline" title="감독 건의 — 선발·벤치">
          <P>선발·교체 같은 경기장 안의 결정은 감독이 해요. 구단주는 특정 선수를 선발이나 벤치로 써달라고 부탁(건의)만 할 수 있어요.</P>
          <P>감독은 성격(카리스마·합리)에 따라 부탁을 들어주기도 하고 거절하기도 해요 — 에이스를 빼라고 하면 강하게 반대해요. 인기 선수를 오래 벤치에 앉혀 두면 팬들이 화를 내요(기사·관중·예산으로 이어져요). 감독이 마음에 안 들면 감독을 바꾸는 것도 구단주가 쓸 수 있는 방법이에요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="body-outline" color={theme.accent}>선수 이해</IconLabel>
      <Card>
        <Accordion icon="stats-chart-outline" title="스탯 — 능력치 2층 구조">
          <P>겉으로 보이는 종합 능력치(스파이크·블로킹·디그·리시브·세팅·서브)는 여러 작은 능력이 합쳐져 정해져요.</P>
          <P>· 신체: 키·점프력·민첩성·체력  · 공통: 반응속도·위치선정  · 멘탈: 집중력·기복·배구IQ</P>
          <P>세팅은 팀 공격 전체에 곱해지는 숫자라서, 좋은 세터가 있으면 팀 전체가 강해져요. 포지션마다 중요한 능력치가 달라요(리베로=디그·리시브, 미들=블로킹·높이).</P>
          <P>내 팀 선수는 잠재력(더 클 수 있는 정도)까지 볼 수 있어요. 능력치 막대 위 작은 표시가 그 선수가 앞으로 올라갈 수 있는 한계예요. 다른 팀 선수나 유망주는 스카우터 실력만큼만 흐릿하게 보여요.</P>
        </Accordion>
        <Accordion icon="sparkles-outline" title="특성 — 타고난 개성">
          <P>선수마다 타고난 특성이 있어요. 좋은 특성은 흔하고 나쁜 특성은 드물어요 — 그래서 유망주를 데려오는 건 될지 안 될지 모르는 도박이라 더 재밌어요.</P>
          {(Object.keys(TRAITS) as (keyof typeof TRAITS)[]).map((t) => (
            <Line key={t} k={`${TRAITS[t].good ? '▲' : '▼'} ${TRAITS[t].name}`} v={TRAITS[t].desc} />
          ))}
        </Accordion>
        <Accordion icon="happy-outline" title="성격 — FA·재계약 때 무엇을 우선하나">
          <P>선수가 계약이나 잔류를 정할 때 무엇을 가장 중요하게 여기는지예요. 성격에 따라 협상하는 방법이 달라져요.</P>
          {(Object.keys(ARCHETYPE_KO) as (keyof typeof ARCHETYPE_KO)[]).map((a) => (
            <Line key={a} k={`${ARCHETYPE_KO[a].emoji} ${ARCHETYPE_KO[a].label}`} v={ARCHETYPE_KO[a].note} />
          ))}
        </Accordion>
        <Accordion icon="pulse-outline" title="컨디션 — 경기감각">
          <P>벤치에 오래 앉아 있거나 경기에 못 나오는 날이 쌓이면 경기 감각이 떨어져서 실제 실력이 최대 −7%까지 떨어져요. 주전으로 꾸준히 뛰면 그대로 유지돼요.</P>
          <P>부상에서 돌아오거나 오랜만에 다시 뛸 때는 감각을 되찾는 데 시간이 좀 걸려요. "실전 감각 좋음/녹슴"으로 표시돼요.</P>
        </Accordion>
        <Accordion icon="heart-half-outline" title="지금 마음 — 선수의 불만">
          <P>선수는 상황에 따라 불만을 가질 수 있어요. 불만이 쌓이면 재계약을 거부하거나 다른 팀으로 떠나려고 해요.</P>
          <Line k="🏆 성적" v="팀이 계속 하위권일 때" />
          <Line k="🔥 출전" v="주전감인데 출전이 부족할 때 (약체 후보는 벤치를 당연히 받아들임)" />
          <Line k="💰 연봉" v="실력 대비 저연봉일 때" />
          <Line k="🏠 연고" v="국내 선수가 고향(선호)팀을 그리워할 때" />
        </Accordion>
        <Accordion icon="people-outline" title="인간관계 — 친한·라이벌">
          <P>선수들은 서로 친하기도 하고(친한) 경쟁하기도 해요(라이벌). 같은 팀에 친한 선수가 있으면 마음이 편해져서 도움이 돼요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="briefcase-outline" color={theme.sky}>영입·운영</IconLabel>
      <Card>
        <Accordion icon="swap-horizontal-outline" title="FA — 자유계약">
          <P>계약이 끝난 선수는 자유계약(FA)이 돼요. 다른 팀 선수를 데려올 수도 있고, 내 선수가 빠져나갈 수도 있어요.</P>
          <P>선수의 성격·팀 성적·제시한 연봉에 따라 선택이 달라져요. 선수를 맞바꾸는 트레이드는 없어요 — 선수는 FA·드래프트·외국인으로 데려와요.</P>
        </Accordion>
        <Accordion icon="school-outline" title="드래프트 — 신인 지명">
          <P>매 시즌 드래프트로 유망주를 뽑아요. 하위 팀일수록 앞 순번을 뽑을 확률이 높아요(추첨이라 꼴찌도 항상 1순위는 아니에요). 유망주는 지금 실력은 낮지만 잠재력이 커요.</P>
          <P>아마추어 성적표를 보고 판단하는데, 성적표가 항상 정확하진 않아요. 잠재력은 스카우터가 일부만 알려줘요 — 좋은 스카우터일수록 더 많이, 더 또렷하게 보여줘요.</P>
          <P>대기만성이나 반짝 같은 예외도 있어서 뽑기는 도박이에요. "1등 유망주인 줄 알았는데 별로였다", "무명이 대박 났다" 같은 일이 진짜 재미예요.</P>
        </Accordion>
        <Accordion icon="globe-outline" title="외국인 — 트라이아웃">
          <P>외국인 선수는 팀당 1명이에요. 주로 아포짓(OP)으로 팀 공격의 핵심이에요. 1년 계약(트라이아웃)이고, 잘하면 여러 시즌 다시 계약할 수 있어요.</P>
          <P>이미 다 큰 선수라서 잠재력보다는 예전에 얼마나 잘했는지(다른 리그 성적·수상·부상·적응)를 보고 뽑아요. 팀 전력을 가장 크게 바꾸는 중요한 결정이에요.</P>
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
