// 관리자 레이아웃 — noindex(검색 크롤 차단, §13.15). 실제 보호는 API의 requireAdmin(fail-closed).
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '배구명가 관리자',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
