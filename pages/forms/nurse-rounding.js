import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '../_app';
import { apiFetch } from '../../lib/apiFetch';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const FLOOR_LABELS = { '2': '2층', '3': '3층', '5': '5층', '6': '6층' };

const BADGES = [
  { id: 'left',  label: '왼팔',  color: '#0369a1', bg: '#e0f2fe', match: m => /왼팔/.test(m) },
  { id: 'right', label: '오른팔', color: '#7c3aed', bg: '#ede9fe', match: m => /오른팔/.test(m) },
  { id: 'leg',   label: '하지',  color: '#0d9488', bg: '#ccfbf1', match: m => /하지/.test(m) },
  { id: 'dm',    label: '당뇨',  color: '#ca8a04', bg: '#fef9c3', match: m => /당뇨|DM(?![A-Z])/i.test(m) },
  { id: 'htn',   label: '고혈압', color: '#dc2626', bg: '#fee2e2', match: m => /고혈압|HTN/i.test(m) },
  { id: 'adr',   label: '알러지', color: '#be123c', bg: '#ffe4e6', match: m => /알러지|알레르기|ADR|allergy/i.test(m) },
];

function getBadges(memo) {
  return BADGES.filter(b => b.match(memo));
}

function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

export default function NurseRounding() {
  const { userName } = useAuth() || {};
  const userId = userName || '';
  const [patients, setPatients] = useState([]);
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [activeBadge, setActiveBadge] = useState(null);
  const saveTimers = useRef({});

  const dateKey = todayStr();
  const now = new Date();
  const dateDisplay = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()} (${DAY_NAMES[now.getDay()]})`;

  // 환자 목록 조회 (Firestore → fallback EMR)
  useEffect(() => {
    (async () => {
      try {
        // Firestore 우선
        const r = await apiFetch(`/api/rounding?date=${dateKey}`);
        if (r.ok) {
          const data = await r.json();
          if (data.patients?.length) {
            setPatients(data.patients);
            setLastSync(data.lastSync);
            setLoading(false);
            return;
          }
        }
      } catch (e) {}
      // Fallback: EMR 직접 조회 (로컬 개발용)
      try {
        const r = await apiFetch('/api/emr/rounding');
        if (r.ok) {
          const data = await r.json();
          setPatients(data.patients || []);
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, [dateKey]);

  // 사용자 참고사항 불러오기
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const r = await apiFetch(`/api/rounding?date=${dateKey}&notes=${userId}`);
        if (r.ok) {
          const data = await r.json();
          setNotes(data.notes || {});
        }
      } catch (e) {}
    })();
  }, [dateKey, userId]);

  // 참고사항 자동 저장 (입력 후 1초 디바운스)
  const saveNote = useCallback((chartNo, value) => {
    if (!userId) return;
    if (saveTimers.current[chartNo]) clearTimeout(saveTimers.current[chartNo]);
    saveTimers.current[chartNo] = setTimeout(async () => {
      try {
        await apiFetch('/api/rounding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateKey, userId, chartNo, note: value }),
        });
      } catch (e) {}
    }, 1000);
  }, [dateKey, userId]);

  const updateNote = (chartNo, value) => {
    setNotes(prev => ({ ...prev, [chartNo]: value }));
    saveNote(chartNo, value);
  };


  // 병동(층)별 → 병실별 그룹핑
  const grouped = {};
  patients.forEach(p => {
    const floor = String(p.dong);
    if (!grouped[floor]) grouped[floor] = {};
    if (!grouped[floor][p.roomLabel]) grouped[floor][p.roomLabel] = [];
    grouped[floor][p.roomLabel].push(p);
  });

  const floorCount = floor => Object.values(grouped[floor] || {}).reduce((s, arr) => s + arr.length, 0);

  const S = {
    container: { maxWidth: 960, margin: '0 auto', padding: '16px 12px' },
    header: { background: '#0f172a', color: '#fff', padding: '20px 24px', borderRadius: '12px 12px 0 0', position: 'sticky', top: 0, zIndex: 100 },
    badgeBar: { background: '#1e293b', padding: '10px 24px', borderRadius: '0 0 12px 12px', marginBottom: 16, position: 'sticky', top: 90, zIndex: 99, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    badgeFilter: (b, active) => ({ display: 'inline-block', padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: active ? `2px solid ${b.color}` : '2px solid transparent', color: active ? '#fff' : b.color, background: active ? b.color : b.bg, transition: 'all 0.15s', userSelect: 'none' }),
    badgeBarLabel: { fontSize: 12, color: '#94a3b8', fontWeight: 600, marginRight: 4 },
    date: { fontSize: 22, fontWeight: 800, letterSpacing: 1 },
    title: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
    back: { position: 'absolute', top: 20, right: 24, color: '#94a3b8', fontSize: 14, cursor: 'pointer' },
    syncInfo: { fontSize: 12, color: '#64748b', marginTop: 6 },
    floorHeader: { background: '#1e3a5f', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontSize: 16, fontWeight: 700, marginTop: 20 },
    count: { fontSize: 13, color: '#94a3b8', marginLeft: 8, fontWeight: 400 },
    table: { width: '100%', borderCollapse: 'collapse', marginBottom: 2, fontSize: 14, tableLayout: 'fixed' },
    th: { background: '#f1f5f9', padding: '8px 10px', fontWeight: 600, textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontSize: 13, color: '#475569', position: 'sticky', top: 130, zIndex: 50 },
    td: { padding: '7px 10px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'middle', height: 44, overflow: 'hidden' },
    roomGap: { height: 15, background: '#f8fafc' },
    name: { fontWeight: 700, fontSize: 15, color: '#0f172a', whiteSpace: 'nowrap', minWidth: 72, flexShrink: 0 },
    room: { fontSize: 13, color: '#475569', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'center' },
    memo: { fontSize: 12, color: '#374151', lineHeight: '18px', height: 36, overflowY: 'auto', overflowX: 'hidden' },
    badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: '18px' },
    badgeArea: { display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 },
    nameCell: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', height: 30 },
    noteInput: { width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 13, resize: 'none', height: 30, outline: 'none', fontFamily: 'inherit', overflow: 'hidden' },
    loading: { textAlign: 'center', padding: 40, color: '#64748b' },
  };

  if (loading) return <div style={S.loading}>환자 목록 조회 중...</div>;

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.date}>{dateDisplay}</div>
        <div style={S.title}>간호과 환자 라운딩 체크</div>
        <Link href="/" style={S.back}>← 메인</Link>
        {lastSync && <div style={S.syncInfo}>동기화: {new Date(lastSync).toLocaleString('ko-KR')}</div>}
      </div>
      <div style={S.badgeBar}>
        <span style={S.badgeBarLabel}>주석:</span>
        {BADGES.map(b => (
          <span
            key={b.id}
            style={S.badgeFilter(b, activeBadge === b.id)}
            onClick={() => setActiveBadge(prev => prev === b.id ? null : b.id)}
          >
            {b.label}
          </span>
        ))}
        {activeBadge && (
          <span
            style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', marginLeft: 4 }}
            onClick={() => setActiveBadge(null)}
          >
            ✕ 해제
          </span>
        )}
      </div>

      {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map(floor => (
        <div key={floor}>
          <div style={S.floorHeader}>
            {FLOOR_LABELS[floor] || `${floor}층`}
            <span style={S.count}>{floorCount(floor)}명</span>
          </div>
          <table style={S.table}>
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 280 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th style={S.th}>병실</th>
                <th style={S.th}>이름</th>
                <th style={S.th}>환자정보 메모</th>
                <th style={S.th}>참고사항</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(grouped[floor]).sort().map((roomLabel, ri) => {
                const roomPts = grouped[floor][roomLabel];
                return (
                  <React.Fragment key={roomLabel}>
                    {ri > 0 && <tr><td colSpan={4} style={S.roomGap}></td></tr>}
                    {roomPts.map(p => {
                      const badges = getBadges(p.memo);
                      const matchedBadge = activeBadge ? badges.find(b => b.id === activeBadge) : null;
                      const rowBg = matchedBadge
                        ? { background: matchedBadge.bg, boxShadow: `inset 3px 0 0 ${matchedBadge.color}` }
                        : undefined;
                      return (
                        <tr key={p.chartNo} style={rowBg}>
                          <td style={{ ...S.td, ...S.room }}>{p.roomLabel}-{p.bed}</td>
                          <td style={S.td}>
                            <div style={S.nameCell}>
                              <span style={S.name}>{p.name}</span>
                              <div style={S.badgeArea}>
                                {badges.map(b => (
                                  <span key={b.id} style={{ ...S.badge, color: b.color, background: b.bg }}>{b.label}</span>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td style={S.td}><div style={S.memo}>{p.memo || '-'}</div></td>
                          <td style={S.td}>
                            <textarea
                              style={{ ...S.noteInput, opacity: userId ? 1 : 0.4 }}
                              value={notes[p.chartNo] || ''}
                              onChange={e => updateNote(p.chartNo, e.target.value)}
                              placeholder={userId ? '참고사항 입력' : '사용자 선택 필요'}
                              rows={1}
                              disabled={!userId}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
        총 {patients.length}명 {lastSync ? '· Firestore 동기화' : '· EMR 실시간 조회'}
        {userId && ` · ${userId}`}
      </div>
    </div>
  );
}
