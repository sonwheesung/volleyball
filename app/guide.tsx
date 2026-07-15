// 게임 가이드 — "게임 흐름 + 각 시스템이 왜 있나"를 초등학생도 이해하게 설명(아코디언). 마이페이지에서 진입.
//   시즌 흐름 개요 → 경기·관전 → 선수 이해 → 다이아·전지훈련 → 단장 결정(감독·FA·드래프트·외국인·스카우터)
//   → 구단 운영(운영자금·팬심) → 기록·명예. 각 항목은 "이게 뭐다 → 왜 있다 → 하면 뭐가 달라진다".
//   특성/성격은 실제 데이터(TRAITS·ARCHETYPE_KO)를 그대로 끌어와 문구가 게임과 항상 일치.
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, IconLabel, Muted, Screen, Title, theme, themedStyles } from '../components/Screen';
import { TRAITS } from '../engine/traits';
import { AD_REWARD, AD_DAILY_CAP, WELCOME_DIAMONDS } from '../engine/diamonds';
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
      <Muted style={{ marginBottom: 4 }}>항목을 누르면 설명이 펼쳐져요. 배구명가를 처음 한다면 위에서부터 차례로 읽어보세요.</Muted>

      <IconLabel icon="compass-outline" color={theme.accent}>먼저 · 이 게임과 시즌 흐름</IconLabel>
      <Card flat>
        <Accordion icon="tv-outline" title="이게 무슨 게임이에요? (보는 게임)">
          <P>배구명가는 내가 직접 배구를 하는 게임이 아니라, 배구단을 지켜보는 게임이에요. 나는 배구단의 구단주가 되어 팀을 수십 시즌 동안 오래오래 운영해요. 경기는 자동으로 진행되고, 알림으로 귀찮게 하지 않아요. 내 팀의 경기와 선수들이 만들어 가는 이야기를 지켜보는 게 이 게임의 핵심이에요.</P>
          <P>구단주는 경기장 안의 일(선발·교체·타임아웃)은 직접 못 해요. 그건 감독의 몫이에요. 대신 어떤 선수를 데려오고, 누구와 다시 계약하고, 어떤 감독에게 팀을 맡길지 같은 큰 결정을 해요. 좋은 결정이 쌓이면 팀이 강해지고, 세월이 흐르면 그게 우리 구단의 역사가 돼요.</P>
        </Accordion>
        <Accordion icon="sync-outline" title="한 시즌은 이렇게 흘러가요">
          <P>아래 순서가 시즌마다 계속 반복돼요. 큰 결정은 대부분 경기가 없는 '오프시즌'에 몰려 있어요.</P>
          <Line k="① 오프시즌" v="팀을 꾸리는 준비 기간이에요. 내 선수와 재계약 → FA 영입/유출 → 신인 드래프트 → 외국인 트라이아웃 → 전지훈련 순으로 진행해요." />
          <Line k="② 개막·경기" v="정해진 일정대로 경기가 자동으로 진행돼요. 중요한 경기는 빅매치로 표시돼서, 보고 싶을 때 직접 관전할 수 있어요." />
          <Line k="③ 시즌 종료" v="순위가 정해지고, 시상식(MVP·신인상 등)과 기록이 쌓여요." />
          <Line k="④ 다음 시즌" v="선수들이 성장하거나 나이 들어 기량이 하락하고, 은퇴한 자리엔 새 얼굴이 들어와요(세대교체). 그리고 다시 ①로." />
        </Accordion>
      </Card>

      <IconLabel icon="play-outline" color={theme.warn}>경기 · 관전</IconLabel>
      <Card flat>
        <Accordion icon="eye-outline" title="관전: 직접 보기 vs 자동으로 넘기기">
          <P>경기는 직접 보거나(이어보기) 자동으로 넘길 수 있어요. 이 게임은 조작하는 게임이 아니라 보는 게임이라, 내 팀 경기와 시즌 이야기를 지켜보는 게 가장 큰 재미예요.</P>
          <P>바빠서 안 봐도 경기는 알아서 진행되니 걱정 없어요. 경기와 경기 사이에는 모든 선수가 스스로 훈련하며 조금씩 성장해요.</P>
        </Accordion>
        <Accordion icon="flame-outline" title="빅매치: 볼 만한 경기를 알려줘요">
          <P>순위에 크게 영향을 주는 경기는 ⭐중요·🔥빅매치로 표시돼요. 상위권 팀끼리 붙거나, 시즌 막판에 순위가 비슷한 팀과 만날 때예요.</P>
          <P>왜 표시하냐면, 이 게임은 '보는 게임'이라 볼 만한 순간을 놓치지 않게 알려주는 거예요. 직접 보면 더 짜릿하지만, 안 봐도 경기는 자동으로 진행돼요.</P>
        </Accordion>
        <Accordion icon="clipboard-outline" title="선발·교체·타임아웃: 누가 정하나">
          <P>누구를 주전으로 쓰고 누구를 벤치에 둘지는 구단주가 직접 정해요. 감독이 거절하지 않고, 다음 경기부터 반영돼요. 다만 에이스를 벤치에 앉히는 것 같은 결정은 감독이 내키지 않아 하고, 팬심과 선수의 마음에도 대가가 따라요.</P>
          <P>내 팀 경기는 관전할 때 직접 개입할 수 있어요(원할 때만). 경기 중에 타임아웃을 부르거나 선수를 교체하는 거예요. 개입하지 않으면 감독이 알아서 다 해주니까, 그냥 지켜봐도 돼요(그게 기본이에요).</P>
          <P>단, 랠리 안에서 누구에게 토스할지 같은 순간순간의 플레이는 여전히 선수와 감독의 몫이에요. 다른 팀 경기는 전부 자동으로 진행돼요. 감독이 어떤 사람이고 왜 중요한지는 아래 '단장 결정 · 감독' 항목에서 설명해요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="body-outline" color={theme.sky}>선수 이해</IconLabel>
      <Card flat>
        <Accordion icon="stats-chart-outline" title="스탯: 능력치는 2층으로 되어 있어요">
          <P>겉으로 보이는 종합 능력치(스파이크·블로킹·디그·리시브·세팅·서브)는 그냥 정해진 숫자가 아니라, 밑에 깔린 작은 능력들이 합쳐져 만들어져요.</P>
          <P>· 신체: 키·점프력·민첩성·체력  · 공통: 반응속도·위치선정  · 멘탈: 집중력·기복·배구IQ</P>
          <P>세팅은 특별해요. 팀 공격 전체에 곱해지는 숫자거든요. 좋은 세터 한 명이 있으면 팀의 공격수 모두가 함께 강해져요. 그래서 세터는 영입 가치가 아주 커요. 포지션마다 중요한 능력치가 달라요(리베로=디그·리시브, 미들=블로킹·높이).</P>
        </Accordion>
        <Accordion icon="trending-up-outline" title="잠재력 · 성장 · 하락: 선수는 자라고 나이 들어요">
          <P>잠재력은 그 선수가 앞으로 올라갈 수 있는 성장의 한계예요. 능력치 막대 위에 있는 작은 표시(틱)가 그 한계를 나타내요. 선수는 경기와 훈련을 하면서 그 한계까지 천천히 자라요.</P>
          <P>나이가 들면 신체 능력치(점프력·민첩성·체력 등)가 서서히 떨어져요(기량 하락). 하지만 기술 능력치는 더 오래 유지돼서, 노련한 선수는 몸이 예전 같지 않아도 경험으로 버텨요. 특히 미들은 높이에 크게 기대는 자리라 전성기가 짧아요.</P>
          <P>내 팀 선수는 잠재력까지 다 볼 수 있지만, 다른 팀 선수나 유망주는 스카우터 실력만큼만 흐릿하게 보여요.</P>
        </Accordion>
        <Accordion icon="sparkles-outline" title="특성: 타고난 개성">
          <P>선수마다 타고난 특성이 있어요. 좋은 특성은 흔하고 나쁜 특성은 드물어요. 그래서 유망주를 데려오는 건 될지 안 될지 모르는 도박이라 더 재밌고, 세월이 쌓이면 그 선수만의 이야기가 돼요.</P>
          {(Object.keys(TRAITS) as (keyof typeof TRAITS)[]).map((t) => (
            <Line key={t} k={`${TRAITS[t].good ? '▲' : '▼'} ${TRAITS[t].name}`} v={TRAITS[t].desc} />
          ))}
        </Accordion>
        <Accordion icon="happy-outline" title="성격: 계약할 때 무엇을 우선하나">
          <P>선수가 계약이나 잔류를 정할 때 무엇을 가장 중요하게 여기는지예요. 성격에 따라 마음을 얻는 방법(협상하는 방법)이 달라져요.</P>
          {(Object.keys(ARCHETYPE_KO) as (keyof typeof ARCHETYPE_KO)[]).map((a) => (
            <Line key={a} k={`${ARCHETYPE_KO[a].emoji} ${ARCHETYPE_KO[a].label}`} v={ARCHETYPE_KO[a].note} />
          ))}
        </Accordion>
        <Accordion icon="pulse-outline" title="컨디션: 경기감각">
          <P>벤치에 오래 앉아 있거나 경기에 못 나오는 날이 쌓이면 경기 감각이 무뎌져서 실제 실력이 최대 −7%까지 떨어져요. 주전으로 꾸준히 뛰는 선수는 감각이 그대로 유지돼요. 그래서 좋은 선수도 계속 안 쓰면 감각이 무뎌져요.</P>
          <P>부상에서 돌아오거나 오랜만에 다시 뛸 때는 감각을 되찾는 데 시간이 좀 걸려요. "실전 감각 좋음/녹슴"으로 표시돼요.</P>
        </Accordion>
        <Accordion icon="heart-half-outline" title="지금 마음: 선수의 불만">
          <P>선수는 상황에 따라 불만을 가질 수 있어요. 불만이 조금씩 쌓이면 재계약을 거부하거나 다른 팀으로 떠나려고 해요. 그래서 선수의 마음을 살피는 게 중요해요.</P>
          <Line k="🏆 성적" v="팀이 계속 하위권일 때" />
          <Line k="🔥 출전" v="주전감인데 출전이 부족할 때 (약체 후보는 벤치를 당연히 받아들임)" />
          <Line k="💰 연봉" v="실력 대비 저연봉일 때" />
          <Line k="🏠 연고" v="국내 선수가 고향(선호)팀을 그리워할 때" />
        </Accordion>
        <Accordion icon="people-outline" title="인간관계: 친한·라이벌">
          <P>선수들은 서로 친하기도 하고(친한) 경쟁하기도 해요(라이벌). 같은 팀에 친한 선수가 있으면 마음이 편해져서 도움이 돼요. 영입할 때 이런 관계까지 살피면 팀 분위기가 달라져요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="diamond-outline" color={theme.accent}>다이아 · 전지훈련</IconLabel>
      <Card flat>
        <Accordion icon="diamond-outline" title="다이아: 어떻게 얻나요">
          <P>다이아는 돈을 내고 사는 유료 재화예요. 결제 말고도 여러 방법으로 모을 수 있어요.</P>
          <Line k="📺 광고 시청" v={`광고를 끝까지 보면 +${AD_REWARD} 다이아를 받아요 (30분 간격, 하루 ${AD_DAILY_CAP}회까지).`} />
          <Line k="🏅 업적 달성" v="구단 운영 목표(우승·기록 등)를 이루면 다이아를 줘요." />
          <Line k="🎟️ 쿠폰 입력" v="이벤트로 받은 쿠폰 코드를 넣으면 다이아를 받아요." />
          <Line k="🎁 환영 선물" v={`처음 전지훈련을 열어보면 환영 다이아 ${WELCOME_DIAMONDS.toLocaleString()}개를 드려요 (계정당 한 번).`} />
          <P>모은 다이아는 선수를 강하게 키우는 '전지훈련'에 써요.</P>
        </Accordion>
        <Accordion icon="airplane-outline" title="전지훈련: 능력치를 지금 올리고, 성장 한계도 함께 열어요">
          <P>전지훈련은 오프시즌에만 할 수 있어요. 선수 한 명을 해외 캠프로 보내는 거예요. 다이아 300이 들어요.</P>
          <P>코스(공격·수비·블로킹·세터·서브) 하나를 고르면, 그와 관련된 3가지 능력치가 바로 +3 오르고, 그 능력치들의 성장 한계(잠재력)도 +3 올라가요(최고 99까지). 선수 한 명은 오프시즌에 딱 한 번만 보낼 수 있고, 효과는 영원히 남아요(되돌리거나 환불할 수 없어요).</P>
          <P>바로 오르는 +3은 다음 시즌부터 곧장 체감돼요. 여기에 성장 한계도 +3 열리기 때문에, 앞으로 뛸 시즌이 많이 남은 어린 선수는 그 열린 한계까지 경기·훈련으로 더 자라나 이득이 조금 더 커요. 나이 많은 선수도 지금 실력 +3은 그대로 챙기니까 손해는 아니에요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="briefcase-outline" color={theme.sky}>단장 결정: 팀 꾸리기</IconLabel>
      <Card flat>
        <Accordion icon="person-outline" title="감독: 팀 전체를 좌우하는 사람">
          <P>감독은 평소 경기장 안의 결정(선발·교체·타임아웃)을 자동으로 맡아요. 선발·벤치는 구단주가 직접 정하고 내 팀 경기는 볼 때 직접 개입할 수도 있지만(위 '선발·교체·타임아웃' 항목), 개입하지 않으면 감독이 알아서 다 해줘요. 그래서 어떤 감독을 앉히느냐에 따라 팀이 통째로 달라져요. 감독은 크게 세 가지를 결정해요.</P>
          <Line k="성향" v="공격형·수비형·밸런스. 경기에서 어떤 전술과 스타일로 싸울지를 정해요." />
          <Line k="카리스마" v="작전타임(타임아웃)의 효과가 얼마나 큰지를 좌우해요. 카리스마가 높을수록 흐트러진 팀 분위기를 더 잘 다잡아요." />
          <Line k="훈련 방향" v="감독이 선호하는 능력치를 팀이 집중해서 키워요. 즉 우리 팀이 앞으로 어떤 방향으로 성장할지를 정해요." />
          <P>그래서 감독을 바꾸면 팀의 성장 방향·경기 성향·작전타임 효과가 한꺼번에 바뀌어요. 감독이 마음에 안 들면 교체하는 것, 그게 구단주가 팀을 바꿀 수 있는 가장 강력한 카드예요.</P>
        </Accordion>
        <Accordion icon="swap-horizontal-outline" title="FA: 자유계약">
          <P>계약이 끝난 선수는 자유계약(FA)이 돼요. 다른 팀의 FA 선수를 데려올 수도 있고, 반대로 내 선수가 다른 팀으로 빠져나갈 수도 있어요.</P>
          <P>선수의 성격·팀 성적·내가 제시한 연봉에 따라 선택이 달라져요. 선수를 맞바꾸는 트레이드는 없어요. 선수는 오직 FA·드래프트·외국인, 이 세 가지 길로만 데려와요.</P>
        </Accordion>
        <Accordion icon="school-outline" title="드래프트: 신인 지명">
          <P>매 시즌 드래프트로 유망주를 뽑아요. 하위 팀일수록 앞 순번을 뽑을 확률이 높아요(가중 추첨이라 꼴찌라고 항상 1순위는 아니에요). 유망주는 지금 실력은 낮지만 잠재력이 커서, 잘 키우면 미래의 주전이 돼요.</P>
          <P>아마추어 성적표를 보고 판단하는데, 이 성적표가 항상 정확하진 않아요. 잠재력은 스카우터가 일부만 알려줘요. 좋은 스카우터일수록 더 많이, 더 또렷하게 보여줘요.</P>
          <P>대기만성이나 반짝 같은 예외도 있어서 뽑기는 일종의 도박이에요. "1등 유망주인 줄 알았는데 별로였다", "무명이 대박 났다" 같은 일이 세월이 쌓이며 만들어지는 진짜 재미예요.</P>
        </Accordion>
        <Accordion icon="globe-outline" title="외국인 · 아시아쿼터: 수입 선수 둘">
          <P>수입 선수는 팀당 두 명이에요. 한 명은 외국인 선수(주로 아포짓 OP)로 트라이아웃에서 뽑고, 다른 한 명은 아시아쿼터 선수로 FA(자유계약)에서 데려와요. 둘 다 샐러리캡에는 포함되지 않아요.</P>
          <P>외국인 OP는 팀 공격의 핵심을 맡아서, 팀 전력을 가장 크게 바꾸는 결정이에요. 한 명이 시즌 성패를 좌우해요. 이미 다 큰 선수라 잠재력보다는 예전에 얼마나 잘했는지(다른 리그 성적·수상·부상·적응)를 보고 뽑아요.</P>
          <P>수입 선수가 기대에 못 미치면 시즌 도중에 각각 한 번씩 교체할 수 있어요.</P>
        </Accordion>
        <Accordion icon="search-outline" title="스카우터: 정보를 밝혀 주는 사람">
          <P>스카우터는 아직 우리 팀이 아닌 선수들(드래프트 유망주·외국인 후보)의 정보를 알아봐 주는 사람이에요.</P>
          <P>좋은 스카우터일수록 그 선수들의 실력과 잠재력을 더 많이, 더 또렷하게 보여줘요. 정보가 흐릿하면 뽑기가 도박이 되니까, 좋은 스카우터에게 돈을 쓰는 건 곧 좋은 영입으로 이어져요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="cash-outline" color={theme.warn}>구단 운영: 돈과 팬</IconLabel>
      <Card flat>
        <Accordion icon="wallet-outline" title="운영자금: 구단주의 지갑">
          <P>운영자금은 구단을 운영하는 데 쓰는 구단주의 지갑이에요. 선수 연봉을 관리하는 샐러리캡(모든 구단이 똑같이 지켜야 하는 연봉 상한)과는 다른, 별개의 돈이에요.</P>
          <P>이렇게 돈이 들어와요(수입):</P>
          <Line k="🏢 모기업 지원" v="가장 큰 몫이에요. 팀마다 지원 크기가 달라요." />
          <Line k="🎟️ 관중 수입" v="성적이 좋으면 관중이 늘어서 수입도 늘어요." />
          <Line k="👕 굿즈" v="인기 스타가 있으면 상품이 팔려서 돈이 들어와요." />
          <P>이렇게 돈이 나가요(지출):</P>
          <Line k="🌍 외국인 연봉" v="외국인 선수 몸값이 나가요." />
          <Line k="🧑‍🏫 스태프 계약" v="코치·스카우터와 계약하는 데 들어요." />
          <P>모기업은 부족한 돈을 메꿔주는 곳이라서, 지갑에 돈이 많이 남아 있으면 지원을 줄여요. 그래서 운영자금이 끝없이 쌓이지는 않아요.</P>
        </Accordion>
        <Accordion icon="heart-outline" title="팬심: 팬 관리가 곧 돈이에요">
          <P>팬심은 팬들의 마음이에요. 팀이 이기고 우승하면 올라가고, 인기 선수를 오랫동안 벤치에 앉혀 두거나 방출하면 내려가요.</P>
          <P>팬심은 다음 시즌 예산(운영자금)과 관중 수입을 좌우해요. 팬이 많아지면 경기장을 찾는 사람도, 구단에 들어오는 돈도 늘어나거든요. 그래서 팬을 잘 관리하는 게 결국 돈이 돼요. 성적만큼이나 인기 선수를 아끼는 게 중요해요.</P>
        </Accordion>
      </Card>

      <IconLabel icon="trophy-outline" color={theme.accent}>기록 · 명예</IconLabel>
      <Card flat>
        <Accordion icon="ribbon-outline" title="기록과 명예: 세월이 남기는 훈장">
          <P>시즌이 끝날 때마다 시상식(MVP·신인상 등)이 열리고, 선수의 통산 기록이 차곡차곡 쌓여요. 크게 활약한 선수는 명예의 전당에 오르고, 등번호가 영구결번이 되기도 해요.</P>
          <P>이런 기록은 왜 있냐면, 이 게임의 진짜 재미가 '세월이 쌓여 만들어지는 이야기'이기 때문이에요. 한 선수가 신인으로 들어와 스타가 되고 은퇴하기까지의 모든 기록이 남아서, 은퇴한 뒤에도 우리 구단의 역사로 계속 이어져요.</P>
        </Accordion>
      </Card>

      <Muted style={{ fontSize: 12, marginTop: 4, marginBottom: 8 }}>더 궁금한 게 있으면 마이페이지 &gt; 문의하기로 알려주세요.</Muted>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // 항목 구분선: 상·하 선 + marginTop -1로 인접 항목의 상단선이 이전 항목 하단선에 겹쳐 **경계마다 1줄**이 된다
  // (테스터 2026-07-11 — 상하 둘 다 두니 인접부가 2줄로 겹쳐 보임). 첫 항목 상단·마지막 항목 하단은 그대로 닫힘.
  item: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border, marginTop: -StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  headL: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { color: theme.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  body: { paddingBottom: 12, gap: 6 },
  p: { color: theme.muted, fontSize: 13, lineHeight: 20 },
  line: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  lk: { color: theme.text, fontSize: 13, fontWeight: '700', width: 92 },
  lv: { color: theme.muted, fontSize: 13, lineHeight: 19, flex: 1 },
}));
