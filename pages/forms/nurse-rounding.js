import { useState, useEffect } from 'react';
import Link from 'next/link';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// 병동 층 구분
const FLOOR_LABELS = { '2': '2층', '3': '3층', '5': '5층', '6': '6층' };

export default function NurseRounding() {
  const [patients, setPatients] = useState([]);
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const dateStr = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()} (${DAY_NAMES[now.getDay()]})`;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/emr/rounding');
        if (r.ok) {
          const data = await r.json();
          setPatients(data.patients || []);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  // 병동(층)별 그룹핑
  const grouped = {};
  patients.forEach(p => {
    const floor = String(p.dong);
    if (!grouped[floor]) grouped[floor] = [];
    grouped[floor].push(p);
  });

  const updateNote = (chartNo, value) => {
    setNotes(prev => ({ ...prev, [chartNo]: value }));
  };

  const S = {
    container: { maxWidth: 900, margin: '0 auto', padding: '16px 12px' },
    header: { background: '#0f172a', color: '#fff', padding: '20px 24px', borderRadius: 12, marginBottom: 16, position: 'relative' },
    date: { fontSize: 22, fontWeight: 800, letterSpacing: 1 },
    title: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
    back: { position: 'absolute', top: 20, right: 24, color: '#94a3b8', fontSize: 14, cursor: 'pointer' },
    floorHeader: { background: '#1e3a5f', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontSize: 16, fontWeight: 700, marginTop: 16 },
    table: { width: '100%', borderCollapse: 'collapse', marginBottom: 2, fontSize: 14 },
    th: { background: '#f1f5f9', padding: '8px 10px', fontWeight: 600, textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontSize: 13, color: '#475569' },
    td: { padding: '8px 10px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' },
    name: { fontWeight: 700, fontSize: 15, color: '#0f172a', whiteSpace: 'nowrap' },
    room: { fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' },
    memo: { fontSize: 12, color: '#dc2626', lineHeight: 1.5, whiteSpace: 'pre-line', maxWidth: 300 },
    noteInput: { width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 13, resize: 'vertical', minHeight: 32, outline: 'none', fontFamily: 'inherit' },
    loading: { textAlign: 'center', padding: 40, color: '#64748b' },
    count: { fontSize: 13, color: '#94a3b8', marginLeft: 8, fontWeight: 400 },
  };

  if (loading) return <div style={S.loading}>환자 목록 조회 중...</div>;

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.date}>{dateStr}</div>
        <div style={S.title}>간호과 환자 라운딩 체크</div>
        <Link href="/" style={S.back}>← 메인</Link>
      </div>

      {Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([floor, pts]) => (
        <div key={floor}>
          <div style={S.floorHeader}>
            {FLOOR_LABELS[floor] || `${floor}층`}
            <span style={S.count}>{pts.length}명</span>
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 70 }}>이름</th>
                <th style={{ ...S.th, width: 50 }}>병실</th>
                <th style={{ ...S.th, width: 35 }}>병상</th>
                <th style={{ ...S.th, width: 250 }}>환자정보 메모</th>
                <th style={S.th}>참고사항</th>
              </tr>
            </thead>
            <tbody>
              {pts.map(p => {
                const isAlert = p.memo.includes('ADR') || p.memo.includes('알러지') || p.memo.includes('알레르기') || p.memo.includes('★');
                return (
                  <tr key={p.chartNo} style={isAlert ? { background: '#fef2f2' } : undefined}>
                    <td style={{ ...S.td, ...S.name }}>{p.name}</td>
                    <td style={{ ...S.td, ...S.room }}>{p.roomLabel}</td>
                    <td style={{ ...S.td, ...S.room, textAlign: 'center' }}>{p.bed}</td>
                    <td style={{ ...S.td, ...S.memo, color: isAlert ? '#dc2626' : '#374151' }}>
                      {p.memo || '-'}
                    </td>
                    <td style={S.td}>
                      <textarea
                        style={S.noteInput}
                        value={notes[p.chartNo] || ''}
                        onChange={e => updateNote(p.chartNo, e.target.value)}
                        placeholder="라운딩 참고사항 입력"
                        rows={1}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
        총 {patients.length}명 · EMR 실시간 조회
      </div>
    </div>
  );
}
