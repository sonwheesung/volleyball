// 개발자 노트/패치노트 목록 (DEVNOTES_SYSTEM §3.2) — 마이페이지 2카드에서 각각 진입(정정 2026-08-01).
//   `?kind=patch|note` 파라미터로 그 kind만 표시(세그먼트 탭 제거 — 패치노트 화면 / 개발자 노트 화면 별개). 무파라미터 딥링크는 patch 폴백.
//   카드 = 제목 + (패치노트면) 버전 태그 + 게시일 + 안읽음 점. 본문 미리보기는 없앰(2026-07-17) — 본문은 상세 전용, 3화면(공지·패치·노트) 목록↔상세 구조 통일.
//   오프라인 캐시(§3.4): 캐시 먼저 렌더 → 온라인이면 백그라운드 fetch 갱신(SWR). 캐시는 전체(공유) — 화면에선 kind로 필터. 무푸시 — 배지로만 알림.
//   결정론 격리: 세이브·시드와 완전 무관(별도 AsyncStorage 키). 공지(차단성)와 달리 읽을거리라 오프라인에서도 보여준다.
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet, Text, View } from 'react-native';
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

export default function Devnotes() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  // 마이페이지 2카드에서 ?kind=patch|note로 진입. 무파라미터/오타 딥링크는 patch 폴백(정정 2026-08-01).
  const kind: DevnoteKind = params.kind === 'note' ? 'note' : 'patch';
  const readDevnotes = useAuthStore((s) => s.readDevnotes);
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
  const shown = useMemo(() => all.filter((d) => d.kind === kind), [all, kind]); // 서버가 이미 최신순 — 순서 보존
  const screenTitle = kind === 'patch' ? '패치노트' : '개발자 노트';

  return (
    <Screen title={screenTitle}>
      {loading ? (
        <Muted style={{ textAlign: 'center', marginTop: 24 }}>불러오는 중…</Muted>
      ) : shown.length === 0 ? (
        offline && all.length === 0 ? (
          // 캐시조차 없음(첫 실행 오프라인) — 공지처럼 연결 필요
          <Card accent={theme.warn} flat>
            <IconLabel icon="cloud-offline-outline" color={theme.warn}>연결 필요</IconLabel>
            <Muted style={{ fontSize: 13, marginTop: 4 }}>{screenTitle}를 불러오려면 네트워크 연결이 필요합니다.</Muted>
          </Card>
        ) : (
          <Card accent={theme.muted} flat>
            <IconLabel icon={kind === 'patch' ? 'document-text-outline' : 'sparkles-outline'} color={theme.muted}>아직 글이 없어요</IconLabel>
            <Muted style={{ fontSize: 13, marginTop: 4 }}>{kind === 'patch' ? '아직 등록된 패치노트가 없습니다.' : '아직 등록된 개발자 노트가 없습니다.'}</Muted>
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
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent },
  ver: { backgroundColor: theme.sky + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1 },
  verTxt: { color: theme.sky, fontSize: 11, fontWeight: '800' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800', flex: 1 },
  date: { color: theme.muted, fontSize: 12, marginTop: 2 },
}));
