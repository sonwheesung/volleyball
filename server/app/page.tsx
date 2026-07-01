// 관리자 대시보드 랜딩(P1 스켈레톤). 통계·지갑·결제·로그·문의는 이후 마일스톤에서 붙는다.
export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>🏐 배구명가 백엔드</h1>
      <p style={{ color: '#9FB0C4' }}>
        다이아 지갑 · 결제 검증 · 로그 · 문의 · 통계 (BACKEND_SYSTEM.md §13). P1 스캐폴드 단계.
      </p>
      <ul style={{ color: '#9FB0C4', lineHeight: 1.9 }}>
        <li>
          <code>GET /api/health</code> — 서버 상태
        </li>
        <li>지갑·인증·결제·대시보드 — 이후 마일스톤(§13.5)</li>
      </ul>
    </main>
  );
}
