// 스포트라이트 튜토리얼 연출(ONBOARDING_SYSTEM 3) — 대상만 밝게, 그 외는 어둡게, 탭하면 다음.
// 컨텍스트(대상 좌표 보관) + Target(대상 측정) + Overlay(어둠+구멍+카드)로 구성.
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { usePathname } from 'expo-router';
import { useGameStore } from '../store/useGameStore';
import { tipsForScreen } from '../data/tutorialSteps';
import { theme } from './Screen';
import { themedStyles } from './theme';
import { ScrollCtrlCtx } from './spotlightCtx';

// 현재 경로(expo-router usePathname)를 스포트라이트 screen 키로 환원. **Provider에서 한 번만** 계산해 모든
// 오버레이가 같은 값을 공유 → at most one만 매치 → "이중 스포트라이트" 구조적 불가(탭마다 각자 포커스로 인식하던
// 구 useSegments-per-overlay 버그 교정 2026-06-25). 경로 변형(/, /index, (tabs))도 관대히 매칭.
function screenFromPathname(p: string | null | undefined): string | null {
  if (!p) return null; // 초기 빈 경로 — 아무 것도 활성 아님(잘못된 플래시 방지)
  if (p.startsWith('/team/')) return 'team-detail';
  if (p === '/select-team') return 'select-team';
  if (p.endsWith('/schedule')) return 'tab-schedule';
  if (p.endsWith('/squad')) return 'tab-squad';
  if (p.endsWith('/office')) return 'tab-office';
  if (p.endsWith('/tryout')) return 'tryout'; // 외국인 트라이아웃만('/asian-tryout'은 '-tryout'이라 미매치)
  if (p.endsWith('/mypage')) return 'tab-mypage';
  if (p === '/' || p.endsWith('/index') || p.endsWith('(tabs)')) return 'tab-dashboard';
  return null;
}
/** 현재 활성 화면 키 — Provider가 usePathname으로 1회 계산해 공유. 오버레이는 자기 screen과 같을 때만 표시. */
const ActiveScreenCtx = createContext<string | null>(null);
/** 지금 스포트라이트가 가리키는 anchor id(활성 화면의 첫 미본 팁) — SpotlightTarget이 자기 id와 같으면 화면 안으로 스크롤. */
const ActiveAnchorCtx = createContext<string | null>(null);

const CARD_RADIUS = 18; // 기본 카드 borderRadius(components/Screen Card) — 대상이 안 알려주면 이 값 사용

type Rect = { x: number; y: number; width: number; height: number };
// 두 컨텍스트로 분리: targets(자주 바뀜)와 setTarget(영구 고정). 하나로 묶으면 Provider value가 매 렌더
// 새 객체가 돼, Target의 측정 effect가 ctx 변화로 매번 재실행→cleanup이 방금 등록한 좌표를 즉시 제거하는
// 무한 루프가 생긴다(측정이 a0에 멈추고 좌표를 못 잡는 진짜 원인, 사용자 진단 태그로 확인 2026-06-24).
const TargetsCtx = createContext<Record<string, Rect>>({});
const SetTargetCtx = createContext<(id: string, r: Rect | null) => void>(() => {});

/** 루트(_layout)에 1회 — 화면별 대상 사각형들을 보관. 화면 전환 시 Target이 mount/unmount로 갱신. */
export function SpotlightProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Record<string, Rect>>({});
  const pathname = usePathname();                     // 전역 현재 경로(1회) — 탭 전환마다 갱신
  const activeScreen = screenFromPathname(pathname);  // 모든 오버레이가 공유 → 동시 표시 불가
  // 활성 화면의 "첫 미본 팁" anchor(오버레이가 띄우는 것과 동일 = queue[0]) — primitive 셀렉터라 값이 바뀔 때만 재렌더.
  const activeAnchor = useGameStore((s) => {
    if (!activeScreen) return null;
    const seen = s.seenTips ?? {};
    const tip = tipsForScreen(activeScreen).find((t) => !seen[t.id]);
    return tip?.anchor ?? null;
  });
  const setTarget = useCallback((id: string, r: Rect | null) => {
    setTargets((prev) => {
      if (!r) { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; }
      const p = prev[id];
      if (p && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height) return prev;
      return { ...prev, [id]: r };
    });
  }, []); // 영구 고정(빈 deps) — Target effect가 이걸 의존해도 재실행 안 됨
  return (
    <SetTargetCtx.Provider value={setTarget}>
      <TargetsCtx.Provider value={targets}>
        <ActiveScreenCtx.Provider value={activeScreen}>
          <ActiveAnchorCtx.Provider value={activeAnchor}>{children}</ActiveAnchorCtx.Provider>
        </ActiveScreenCtx.Provider>
      </TargetsCtx.Provider>
    </SetTargetCtx.Provider>
  );
}

/** 밝게 띄울 요소를 감싼다 — onLayout + 마운트 직후 여러 번 윈도우 절대좌표를 측정해 등록(언마운트 시만 해제). */
export function SpotlightTarget({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const setTarget = useContext(SetTargetCtx); // 고정 참조 — 아래 effect가 한 번만 돌게 한다
  const activeAnchor = useContext(ActiveAnchorCtx);
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // measure(pageX/pageY=절대 화면 좌표)를 쓴다. measureInWindow는 독립 빌드(New Arch/Android)에서
    // 상태바 높이만큼 뺀 값을 줘서 전체화면 Modal 오버레이와 어긋났다(Expo Go는 우연히 실화면 좌표라 맞았음).
    // pageX/pageY는 Expo Go·독립 빌드 모두 실화면 좌표라 상태바 하드코딩 없이 어디서든 정렬된다.
    node.measure((_x, _y, width, height, pageX, pageY) => {
      if (width > 0 && height > 0) setTarget(id, { x: pageX, y: pageY, width, height });
    });
  }, [setTarget, id]);
  // 마운트 후 몇 차례 재측정(스크롤뷰·전환으로 첫 측정이 0/미안정인 경우 보강). cleanup은 언마운트에서만 해제.
  useEffect(() => {
    const ts = [0, 60, 200, 500, 900].map((d) => setTimeout(measure, d));
    return () => { ts.forEach(clearTimeout); setTarget(id, null); };
  }, [measure, setTarget, id]);
  // 내가 지금 스포트라이트 대상이면 → 오버레이가 스크롤을 거는 동안/직후 창 좌표를 여러 번 재측정
  // (스크롤로 위치가 바뀌므로). 스크롤 트리거·표시 순서는 오버레이가 조율(스크롤·표시 동시 발생 방지).
  useEffect(() => {
    if (activeAnchor !== id) return;
    let alive = true;
    const ts = [260, 480, 660].map((d) => setTimeout(() => { if (alive) measure(); }, d));
    return () => { alive = false; ts.forEach(clearTimeout); };
  }, [activeAnchor, id, measure]);
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style}>
      {children}
    </View>
  );
}

const PAD = 8;       // 구멍 여백
const CARD_W = 300;  // 설명 카드 폭

/** 각 화면 끝에 1개 — 그 화면의 미본 스텝 큐의 첫 스텝을 스포트라이트로 띄운다. */
export function SpotlightOverlay({ screen }: { screen: string }) {
  const targets = useContext(TargetsCtx);
  const scrollCtrl = useContext(ScrollCtrlCtx);
  const seen = useGameStore((s) => s.seenTips) ?? {};
  const markTip = useGameStore((s) => s.markTip);
  const [attempt, setAttempt] = useState(0);
  const [revealed, setRevealed] = useState(false); // 스크롤 안착 후에만 true → 스크롤·표시 동시 발생 방지
  const handledRef = useRef<string | null>(null);   // 이 팁에 대해 스크롤/표시 결정을 이미 내렸나
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // 안착 타이머 — effect 재실행에 취소되면 안 됨(ref 보관)

  // 활성 화면(Provider가 공유)과 같을 때만 표시. 모든 오버레이가 같은 값을 보므로 둘 이상 동시 표시 불가.
  // 폴백 없음(불일치=숨김) — "이중 표시 방지"가 "한 화면 누락"보다 우선(누락은 자기 화면 들어가면 바로 뜸).
  const activeScreen = useContext(ActiveScreenCtx);
  const focused = activeScreen === screen;

  const queue = focused ? tipsForScreen(screen).filter((t) => !seen[t.id]) : [];
  const active = queue[0];
  const rect = active?.anchor ? targets[active.anchor] : undefined;

  // 새 스텝마다 측정 시도·표시 상태 리셋(다음 팁은 다시 "스크롤→안착→표시"). 이전 안착 타이머는 취소.
  useEffect(() => {
    setAttempt(0); setRevealed(false); handledRef.current = null;
    if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null; }
  }, [active?.id]);
  // 언마운트 시 타이머 정리
  useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current); }, []);
  // 대상이 아직 측정 안 됐으면 재시도. 단 일정 횟수(≈720ms) 넘으면 포기하고 가운데 카드로 폴백(안 보이는 일 없게).
  useEffect(() => {
    if (active?.anchor && !rect && attempt < 6) {
      const t = setTimeout(() => setAttempt((a) => a + 1), 120);
      return () => clearTimeout(t);
    }
  }, [active, rect, attempt]);

  // 표시 순서 조율: 대상이 편안한 위치(상단~중앙)가 아니면 **먼저 스크롤 → 안착 대기 → 표시**.
  // 이미 편안하거나 스크롤 불가(비-Screen 화면)면 즉시 표시. 팁당 1회만 결정(handledRef).
  // ⚠ 타이머는 ref에 보관 — 이 effect는 rect 변화(스크롤 후 재측정)로 재실행되는데, cleanup으로 타이머를
  //    지우면 안착 전에 취소돼 영영 안 뜬다(에뮬 실측 버그 2026-07-04). 재실행 시 handledRef로 즉시 return만.
  useEffect(() => {
    if (!active || !focused || handledRef.current === active.id) return;
    if (active.anchor && !rect && attempt < 6) return; // 아직 측정 중 — 대기
    handledRef.current = active.id;
    const SH = Dimensions.get('window').height;
    const comfy = !!rect && rect.y >= 60 && rect.y <= SH * 0.5; // 이미 화면 상단~중앙에 보임
    if (rect && active.anchor && scrollCtrl && !comfy) {
      scrollCtrl.scrollToWindowY(rect.y);                                  // 스크롤만 먼저
      revealTimer.current = setTimeout(() => setRevealed(true), 680);      // 안착(≈애니 300ms + 재측정 여유) 후 표시
    } else {
      setRevealed(true); // 스크롤 불필요 → 즉시
    }
  }, [active, focused, rect, attempt, scrollCtrl]);

  if (!active) return null;
  // 이중 모달 걱정 없음 — 모달이 탭바까지 덮어 안내를 탭으로 넘기기 전엔 다른 화면 이동 불가(이미 본 화면은 큐가 빔).
  const measuring = !!active.anchor && !rect && attempt < 6;
  if (measuring) return null; // 잠깐 측정 대기(최대 ≈720ms). 그 뒤엔 폴백으로 무조건 표시.
  if (!revealed) return null; // 스크롤 안착 전엔 아무것도 안 그림(스크롤과 스포트라이트 동시 표시 방지 — 사용자 지적 2026-07-04)

  const { width: SW, height: SH } = Dimensions.get('window');
  const total = tipsForScreen(screen).length;
  const idx = total - queue.length + 1; // 현재가 몇 번째인지(1-based)

  // 앵커가 **화면 안**에 있을 때만 구멍을 판다. 스크롤해야 보이는(화면 밖) 대상은 좌표가 화면 밖으로
  // 나와 어둠 띠가 전체를 덮고 카드도 밖으로 가 "시커멓고 멈춘" 화면이 된다 → 전체 어둠 + 가운데 카드로 폴백.
  const onScreen = !!rect && rect.y + rect.height > 0 && rect.y < SH && rect.x + rect.width > 0 && rect.x < SW;
  const hole = onScreen && rect
    ? { x: Math.max(0, rect.x - PAD), y: Math.max(0, rect.y - PAD), w: rect.width + PAD * 2, h: rect.height + PAD * 2 }
    : null;

  // 카드 위치 — 구멍 아래가 넉넉하면 아래, 위가 넉넉하면 위, 둘 다 좁으면(대상이 화면보다 큼) 하단에 겹쳐 띄운다.
  let cardTop = SH / 2 - 80;
  let cardLeft = (SW - CARD_W) / 2;
  if (hole) {
    const below = SH - (hole.y + hole.h); // 구멍 아래 여백
    const above = hole.y;                 // 구멍 위 여백
    cardTop = below > 180 ? hole.y + hole.h + 14
      : above > 200 ? hole.y - 170
      : SH - 250; // 대상이 화면을 꽉 채움(예: 선수단 전체) — 카드를 하단에 얹어 대상 위에 겹침
    cardLeft = Math.min(Math.max(12, hole.x + hole.w / 2 - CARD_W / 2), SW - CARD_W - 12);
  }

  const dim = 'rgba(8,16,28,0.82)';
  // 구멍 모서리 반경 = 카드 borderRadius + PAD(카드와 동심원). 작은 구멍이면 절반으로 클램프.
  const R = hole ? Math.min((active.radius ?? CARD_RADIUS) + PAD, hole.w / 2, hole.h / 2) : 0;
  // 둥근 구멍 — **거대 테두리 기법**: View의 content 영역(투명)을 구멍에 맞추고, 화면을 덮을 만큼 큰 borderWidth(dim)로
  //  주위를 어둡게. borderRadius(R+BIG)면 inner(=구멍) 모서리 반경이 정확히 R → 띠 4개의 직각 구멍 대신 카드와 같은 곡률.
  const BIG = SW + SH;

  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible onRequestClose={() => markTip(active.id)}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => markTip(active.id)}>
        {hole ? (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', left: hole.x - BIG, top: hole.y - BIG, width: hole.w + 2 * BIG, height: hole.h + 2 * BIG, borderWidth: BIG, borderColor: dim, borderRadius: R + BIG }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: R, borderWidth: 2.5, borderColor: theme.accent }} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />
        )}

        <View pointerEvents="none" style={[styles.card, { top: cardTop, left: cardLeft, width: CARD_W }]}>
          <Text style={styles.step}>{idx} / {total}</Text>
          <Text style={styles.title}>{active.title}</Text>
          <Text style={styles.body}>{active.body}</Text>
          <Text style={styles.hint}>화면을 탭하면 계속 →</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: { position: 'absolute', backgroundColor: theme.card, borderRadius: 16, padding: 16, gap: 6,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
  step: { color: theme.accent, fontSize: 12, fontWeight: '800' },
  title: { color: theme.text, fontSize: 18, fontWeight: '800' },
  body: { color: theme.text, fontSize: 14, lineHeight: 21 },
  hint: { color: theme.muted, fontSize: 12, fontWeight: '700', marginTop: 4 },
}));
