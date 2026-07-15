// 개발자 노트/패치노트 목록 (DEVNOTES_SYSTEM §3.2) — 마이페이지에서 진입.
//   상단 세그먼트 탭(패치노트 | 개발자 노트, 기본=패치노트) · 탭별 최신순 카드(제목 + 버전 태그 + 게시일 + 미리보기 + 안읽음 점).
//   오프라인 캐시(§3.4): 캐시 먼저 렌더 → 온라인이면 백그라운드 fetch 갱신(SWR). 무푸시 — 배지로만 알림.
//   결정론 격리: 세이브·시드와 완전 무관(별도 AsyncStorage 키). 공지(차단성)와 달리 읽을거리라 오프라인에서도 보여준다.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, IconLabel, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { getDevnotes, type DevnoteItem, type DevnoteKind } from '../lib/server';
import { useAuthStore } from '../store/useAuthStore';

// ── 오프라인 캐시(§3.4) — 별도 스토리지 키(세이브/시드 무관, 결정론 격리). 목록 응답에 본문 포함이라 상세도 오프라인으로 열림. ──
const CACHE_KEY = 'devnotes.cache.v1';

export async function readDevnotesCache(): Promise<DevnoteItem[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DevnoteItem[]) : null;
  } catch {
    return null; // 캐시 파싱 실패해도 게임/화면에 0 영향 — 조용히 무캐시 취급.
  }
}

async function writeDevnotesCache(items: DevnoteItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {
    /* 캐시 쓰기 실패 무시(다음 성공 fetch가 갱신) */
  }
}

/** 서버에서 목록을 새로 받아 캐시 갱신 + prune(온라인 성공 시에만). 실패면 null(호출부가 캐시 유지).
 *  prune를 여기(성공 경로)에만 두어 "오프라인 prune로 유효 글 재노출"(§3.3 F 함정)을 구조적으로 차단. */
export async function refreshDevnotes(): Promise<DevnoteItem[] | null> {
  const r = await getDevnotes();
  if (!r.ok) return null;
  const items = r.devnotes ?? [];
  await writeDevnotesCache(items);
  useAuthStore.getState().pruneReadDevnotes(items.map((d) => d.id));
  return items;
}

// 게시일 표시(YYYY.MM.DD) — UI 런타임 포맷(엔진/시드 무관). timestamptz 문자열 파싱, 실패/누락은 빈 문자열.
export function fmtDevnoteDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// 마크다운 → 미리보기 평문(1~2줄). 서식 기호 제거만(렌더 아님).
export function devnotePreview(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim())
    .filter((l) => l.length > 0)
    .join(' ')
    .slice(0, 120);
}

const TABS: { kind: DevnoteKind; label: string }[] = [
  { kind: 'patch', label: '패치노트' },
  { kind: 'note', label: '개발자 노트' },
];

export default function Devnotes() {
  const router = useRouter();
  const readDevnotes = useAuthStore((s) => s.readDevnotes);
  const [tab, setTab] = useState<DevnoteKind>('patch'); // 기본=패치노트(§2)
  const [items, setItems] = useState<DevnoteItem[] | null>(null);
  const [loading, setLoading] = useState(true); // 캐시/fetch 첫 결과 전
  const [offline, setOffline] = useState(false); // 갱신 실패(캐시로 렌더 중이거나 캐시 없음)

  // SWR: 캐시 먼저 → 온라인 갱신(§3.4). 언마운트 후 setState 방지.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readDevnotesCache();
      if (alive && cached) { setItems(cached); setLoading(false); }
      const fresh = await refreshDevnotes();
      if (!alive) return;
      if (fresh) { setItems(fresh); setOffline(false); }
      else setOffline(true); // fetch 실패 — 캐시 있으면 그대로 두고 힌트, 없으면 빈 상태
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const readSet = useMemo(() => new Set(readDevnotes), [readDevnotes]);
  const all = items ?? [];
  // 탭별 안읽음 유무(라벨 점) — 게시글 중 readDevnotes에 없는 것.
  const unreadByKind = useMemo(() => {
    const m: Record<DevnoteKind, boolean> = { patch: false, note: false };
    for (const d of all) if (!readSet.has(d.id)) m[d.kind] = true;
    return m;
  }, [all, readSet]);
  const shown = useMemo(() => all.filter((d) => d.kind === tab), [all, tab]); // 서버가 이미 최신순 — 순서 보존

  return (
    <Screen title="개발자 노트">
      {/* 세그먼트 탭(§2) — 탭 라벨에도 안읽음 점 */}
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.kind;
          return (
            <Pressable key={t.kind} onPress={() => setTab(t.kind)} style={[styles.tab, active && styles.tabActive]}>
              <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{t.label}</Text>
              {unreadByKind[t.kind] ? <View style={styles.tabDot} /> : null}
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <Muted style={{ textAlign: 'center', marginTop: 24 }}>불러오는 중…</Muted>
      ) : shown.length === 0 ? (
        offline && all.length === 0 ? (
          // 캐시조차 없음(첫 실행 오프라인) — 공지처럼 연결 필요
          <Card accent={theme.warn} flat>
            <IconLabel icon="cloud-offline-outline" color={theme.warn}>연결 필요</IconLabel>
            <Muted style={{ fontSize: 13, marginTop: 4 }}>개발자 노트를 불러오려면 네트워크 연결이 필요합니다.</Muted>
          </Card>
        ) : (
          <Card accent={theme.muted} flat>
            <IconLabel icon="sparkles-outline" color={theme.muted}>아직 글이 없어요</IconLabel>
            <Muted style={{ fontSize: 13, marginTop: 4 }}>{tab === 'patch' ? '아직 등록된 패치노트가 없습니다.' : '아직 등록된 개발자 노트가 없습니다.'}</Muted>
          </Card>
        )
      ) : (
        <>
          {offline ? (
            // 캐시로 렌더 중 + 갱신 실패 — 조용한 힌트(읽을거리 우선, §3.4)
            <Muted style={{ fontSize: 12, marginBottom: 2 }}>오프라인 — 저장된 내용을 보여드려요.</Muted>
          ) : null}
          {shown.map((d) => {
            const unread = !readSet.has(d.id);
            return (
              <Card key={d.id} accent={unread ? theme.accent : theme.muted} onPress={() => router.push(`/devnotes/${d.id}`)}>
                <View style={styles.head}>
                  {unread ? <View style={styles.dot} /> : null}
                  {d.kind === 'patch' && d.appVersion ? (
                    <View style={styles.ver}><Text style={styles.verTxt}>v{d.appVersion}</Text></View>
                  ) : null}
                  <Text style={[styles.title, !unread && { color: theme.mutedBright }]} numberOfLines={2}>{d.title}</Text>
                </View>
                {fmtDevnoteDate(d.publishedAt) ? <Text style={styles.date}>{fmtDevnoteDate(d.publishedAt)}</Text> : null}
                <Text style={styles.preview} numberOfLines={2}>{devnotePreview(d.body)}</Text>
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardAlt },
  tabActive: { borderColor: theme.accent, backgroundColor: theme.accentGlass },
  tabTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
  tabTxtActive: { color: theme.accent },
  tabDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent },
  ver: { backgroundColor: theme.sky + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1 },
  verTxt: { color: theme.sky, fontSize: 11, fontWeight: '800' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800', flex: 1 },
  date: { color: theme.muted, fontSize: 12, marginTop: 2 },
  preview: { color: theme.muted, fontSize: 13.5, lineHeight: 20, marginTop: 2 },
}));
