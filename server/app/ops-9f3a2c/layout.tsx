// 운영 콘솔 레이아웃 — noindex(검색 크롤 차단). 경로도 /admin 아님(추측 차단, 2026-07-04).
// 실제 보호는 API의 requireAdmin(fail-closed §13.15) — 경로 은닉은 보조.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '운영 콘솔',
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
