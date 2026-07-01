// 배구명가 백엔드 관리자 루트 레이아웃. 대시보드 페이지들이 이 아래 렌더된다.
export const metadata = {
  title: '배구명가 백엔드',
  description: '다이아 지갑·결제·로그·문의·통계 관리자',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0B121C', color: '#E6EDF5' }}>
        {children}
      </body>
    </html>
  );
}
