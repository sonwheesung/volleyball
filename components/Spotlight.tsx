// 스포트라이트 튜토리얼 연출(ONBOARDING_SYSTEM 3) — 대상만 밝게, 그 외는 어둡게, 탭하면 다음.
// 컨텍스트(대상 좌표 보관) + Target(대상 측정) + Overlay(어둠+구멍+카드)로 구성.
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useGameStore } from '../store/useGameStore';
import { tipsForScreen } from '../data/tutorialSteps';
import { theme } from './Screen';

type Rect = { x: number; y: number; width: number; height: number };
interface Ctx { targets: Record<string, Rect>; setTarget: (id: string, r: Rect | null) => void }
const SpotlightCtx = createContext<Ctx | null>(null);

/** 루트(_layout)에 1회 — 화면별 대상 사각형들을 보관. 화면 전환 시 Target이 mount/unmount로 갱신. */
export function SpotlightProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Record<string, Rect>>({});
  const setTarget = useCallback((id: string, r: Rect | null) => {
    setTargets((prev) => {
      if (!r) { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; }
      const p = prev[id];
      if (p && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height) return prev;
      return { ...prev, [id]: r };
    });
  }, []);
  return <SpotlightCtx.Provider value={{ targets, setTarget }}>{children}</SpotlightCtx.Provider>;
}

/** 밝게 띄울 요소를 감싼다 — onLayout 후 윈도우 절대좌표를 측정해 등록(언마운트 시 해제). */
export function SpotlightTarget({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ctx = useContext(SpotlightCtx);
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node || !ctx) return;
    // measureInWindow는 레이아웃이 안정된 다음 틱에 정확 → onLayout 후 + 마운트 직후 여러 번 시도
    node.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) ctx.setTarget(id, { x, y, width, height });
    });
  }, [ctx, id]);
  // 마운트 후 몇 차례 재측정(스크롤뷰·전환 애니메이션으로 첫 onLayout이 0/미안정인 경우 보강)
  useEffect(() => {
    const ts = [0, 60, 200, 500, 900].map((d) => setTimeout(measure, d));
    return () => { ts.forEach(clearTimeout); ctx?.setTarget(id, null); };
  }, [measure, ctx, id]);
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
  const ctx = useContext(SpotlightCtx);
  const seen = useGameStore((s) => s.seenTips) ?? {};
  const markTip = useGameStore((s) => s.markTip);
  const [attempt, setAttempt] = useState(0);

  const queue = tipsForScreen(screen).filter((t) => !seen[t.id]);
  const active = queue[0];
  const rect = active?.anchor ? ctx?.targets[active.anchor] : undefined;

  // 새 스텝마다 측정 시도 카운트 리셋
  useEffect(() => { setAttempt(0); }, [active?.id]);
  // 대상이 아직 측정 안 됐으면 재시도. 단 일정 횟수(≈720ms) 넘으면 포기하고 가운데 카드로 폴백(안 보이는 일 없게).
  useEffect(() => {
    if (active?.anchor && !rect && attempt < 6) {
      const t = setTimeout(() => setAttempt((a) => a + 1), 120);
      return () => clearTimeout(t);
    }
  }, [active, rect, attempt]);

  if (!active) return null;
  // 이중 모달 걱정 없음 — 모달이 탭바까지 덮어 안내를 탭으로 넘기기 전엔 다른 화면 이동 불가(이미 본 화면은 큐가 빔).
  const measuring = !!active.anchor && !rect && attempt < 6;
  if (measuring) return null; // 잠깐 측정 대기(최대 ≈720ms). 그 뒤엔 폴백으로 무조건 표시.

  const { width: SW, height: SH } = Dimensions.get('window');
  const total = tipsForScreen(screen).length;
  const idx = total - queue.length + 1; // 현재가 몇 번째인지(1-based)

  // 구멍(측정 성공 시) 둘레 4밴드 + 강조 링. 측정 실패/앵커없음이면 전체 어둠 + 가운데 카드.
  const hole = rect
    ? { x: Math.max(0, rect.x - PAD), y: Math.max(0, rect.y - PAD), w: rect.width + PAD * 2, h: rect.height + PAD * 2 }
    : null;

  // 카드 위치 — 구멍 아래 공간이 넉넉하면 아래, 아니면 위, 둘 다 좁으면 가운데
  let cardTop = SH / 2 - 80;
  let cardLeft = (SW - CARD_W) / 2;
  if (hole) {
    const below = SH - (hole.y + hole.h);
    cardTop = below > 180 ? hole.y + hole.h + 14 : Math.max(40, hole.y - 170);
    cardLeft = Math.min(Math.max(12, hole.x + hole.w / 2 - CARD_W / 2), SW - CARD_W - 12);
  }

  const dim = 'rgba(8,16,28,0.82)';
  const band = (s: ViewStyle, key: string) => <View key={key} style={[{ position: 'absolute', backgroundColor: dim }, s]} />;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => markTip(active.id)}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => markTip(active.id)}>
        {hole ? (
          <>
            {band({ left: 0, top: 0, width: SW, height: hole.y }, 't')}
            {band({ left: 0, top: hole.y + hole.h, width: SW, height: SH - (hole.y + hole.h) }, 'b')}
            {band({ left: 0, top: hole.y, width: hole.x, height: hole.h }, 'l')}
            {band({ left: hole.x + hole.w, top: hole.y, width: SW - (hole.x + hole.w), height: hole.h }, 'r')}
            <View pointerEvents="none" style={{ position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: 14, borderWidth: 2.5, borderColor: theme.accent }} />
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

const styles = StyleSheet.create({
  card: { position: 'absolute', backgroundColor: theme.card, borderRadius: 16, padding: 16, gap: 6,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
  step: { color: theme.accent, fontSize: 12, fontWeight: '800' },
  title: { color: theme.text, fontSize: 18, fontWeight: '800' },
  body: { color: theme.text, fontSize: 14, lineHeight: 21 },
  hint: { color: theme.muted, fontSize: 12, fontWeight: '700', marginTop: 4 },
});
