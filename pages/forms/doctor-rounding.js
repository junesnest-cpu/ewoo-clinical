import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '../_app';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const FLOOR_LABELS = { '2': '2병동', '3': '3병동', '5': '5병동', '6': '6병동' };

// 주치의는 강국형, 이숙경 둘 뿐 (김민준/진영문은 협진)
const ATTENDING_DOCTORS = ['강국형', '이숙경'];

function birthAndAge(jumin, birthDate) {
  const thisYear = new Date().getFullYear();
  let birthYear = null, age = null;
  if (jumin && jumin.length >= 6) {
    const yy = parseInt(jumin.slice(0, 2), 10);
    birthYear = yy >= 30 ? 1900 + yy : 2000 + yy;
    age = thisYear - birthYear;
  } else if (birthDate) {
    const y = parseInt(String(birthDate).slice(0, 4), 10);
    if (y > 1900) { birthYear = y; age = thisYear - y; }
  }
  return { birthYear, age };
}

function formatDate(d) {
  if (!d) return '';
  const s = String(d).replace(/-/g, '');
  if (s.length >= 8) return `${parseInt(s.slice(4, 6))}/${parseInt(s.slice(6, 8))}`;
  return d;
}

function daysFromAdmit(admitDate) {
  if (!admitDate) return '';
  const s = String(admitDate).replace(/-/g, '');
  if (s.length < 8) return '';
  const admit = new Date(parseInt(s.slice(0,4)), parseInt(s.slice(4,6))-1, parseInt(s.slice(6,8)));
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.floor((today - admit) / 86400000);
  return diff >= 0 ? `D+${diff}` : '';
}

export default function DoctorRounding() {
  const { userName } = useAuth() || {};
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 주치의 필터: 'all' | '강국형' | '이숙경'
  const [selectedDoctor, setSelectedDoctor] = useState('all');
  const [showAllPatients, setShowAllPatients] = useState(false);

  const now = new Date();
  const dateDisplay = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()} (${DAY_NAMES[now.getDay()]})`;

  // EMR 벌크 API 한 번 호출로 모든 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/emr/rounding-summary');
        if (r.ok) {
          const data = await r.json();
          setPatients(data.patients || []);
        } else {
          setError('EMR 데이터 조회 실패');
        }
      } catch (e) {
        console.error('Rounding load error:', e);
        setError('서버 연결 실패');
      }
      setLoading(false);
    })();
  }, []);

  // 주치의 필터
  const filteredPatients = useMemo(() => {
    if (selectedDoctor === 'all' || showAllPatients) return patients;
    return patients.filter(p => p.attending === selectedDoctor);
  }, [patients, selectedDoctor, showAllPatients]);

  // 병동별 그룹핑
  const grouped = useMemo(() => {
    const g = {};
    filteredPatients.forEach(p => {
      const floor = String(p.dong);
      if (!g[floor]) g[floor] = {};
      if (!g[floor][p.roomLabel]) g[floor][p.roomLabel] = [];
      g[floor][p.roomLabel].push(p);
    });
    return g;
  }, [filteredPatients]);

  const floorCount = floor => Object.values(grouped[floor] || {}).reduce((s, arr) => s + arr.length, 0);

  const S = {
    page: { maxWidth: 1100, margin: '0 auto', padding: '12px 10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    header: { background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', color: '#fff', padding: '18px 20px', borderRadius: 14, marginBottom: 12 },
    dateRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    date: { fontSize: 22, fontWeight: 800 },
    title: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
    back: { color: '#94a3b8', fontSize: 13, textDecoration: 'none' },
    statsRow: { display: 'flex', gap: 12, marginTop: 12 },
    stat: { background: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 14px' },
    statNum: { fontSize: 18, fontWeight: 800 },
    statLabel: { fontSize: 11, color: '#94a3b8' },
    toolbar: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    doctorBtn: (active) => ({
      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      border: active ? '2px solid #0369a1' : '2px solid #e2e8f0',
      background: active ? '#0369a1' : '#fff',
      color: active ? '#fff' : '#475569',
      transition: 'all 0.15s', userSelect: 'none',
    }),
    checkLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#64748b', cursor: 'pointer', userSelect: 'none', marginLeft: 'auto' },
    floorHeader: { background: '#1e3a5f', color: '#fff', padding: '8px 14px', borderRadius: '8px 8px 0 0', fontSize: 15, fontWeight: 700, marginTop: 16 },
    count: { fontSize: 12, color: '#94a3b8', marginLeft: 8, fontWeight: 400 },
    table: { width: '100%', borderCollapse: 'collapse', marginBottom: 2, fontSize: 13 },
    th: { background: '#f1f5f9', padding: '7px 8px', fontWeight: 600, textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontSize: 12, color: '#475569', whiteSpace: 'nowrap' },
    td: { padding: '6px 8px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top', lineHeight: 1.5 },
    roomGap: { height: 8, background: '#f8fafc' },
    name: { fontWeight: 700, fontSize: 14, color: '#0f172a', whiteSpace: 'nowrap' },
    room: { fontSize: 13, color: '#475569', fontWeight: 600, whiteSpace: 'nowrap' },
    twoLine: { fontSize: 12, color: '#374151', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '17px' },
    subText: { fontSize: 11, color: '#94a3b8', lineHeight: '15px' },
    dateTag: { fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '1px 4px', borderRadius: 4, marginRight: 4, whiteSpace: 'nowrap' },
    loading: { textAlign: 'center', padding: 40, color: '#64748b', fontSize: 14 },
    empty: { textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 14 },
    dash: { color: '#cbd5e1' },
  };

  if (loading) return <div style={S.loading}>환자 목록 조회 중...</div>;
  if (error) return <div style={S.loading}>{error}</div>;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.dateRow}>
          <div>
            <div style={S.date}>{dateDisplay}</div>
            <div style={S.title}>의과 병동 라운딩</div>
          </div>
          <Link href="/" style={S.back}>← 메인</Link>
        </div>
        <div style={S.statsRow}>
          <div style={S.stat}>
            <div style={S.statNum}>{patients.length}</div>
            <div style={S.statLabel}>전체 환자</div>
          </div>
          <div style={S.stat}>
            <div style={S.statNum}>{filteredPatients.length}</div>
            <div style={S.statLabel}>표시 환자</div>
          </div>
        </div>
      </div>

      {/* 주치의 선택 */}
      <div style={S.toolbar}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>주치의:</span>
        <span
          style={S.doctorBtn(selectedDoctor === 'all')}
          onClick={() => { setSelectedDoctor('all'); setShowAllPatients(false); }}
        >전체</span>
        {ATTENDING_DOCTORS.map(name => (
          <span key={name}
            style={S.doctorBtn(selectedDoctor === name)}
            onClick={() => { setSelectedDoctor(name); setShowAllPatients(false); }}
          >{name}</span>
        ))}
        {selectedDoctor !== 'all' && (
          <label style={S.checkLabel}>
            <input type="checkbox" checked={showAllPatients}
              onChange={e => setShowAllPatients(e.target.checked)} />
            전체 환자 보기
          </label>
        )}
      </div>

      {filteredPatients.length === 0 ? (
        <div style={S.empty}>담당 환자가 없습니다</div>
      ) : (
        Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map(floor => (
          <div key={floor}>
            <div style={S.floorHeader}>
              {FLOOR_LABELS[floor] || `${floor}층`}
              <span style={S.count}>{floorCount(floor)}명</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 56 }}>병실</th>
                    <th style={{ ...S.th, width: 80 }}>이름</th>
                    <th style={{ ...S.th, width: 50 }}>나이</th>
                    <th style={{ ...S.th, width: 140 }}>주소증</th>
                    <th style={{ ...S.th, width: 80 }}>입원일</th>
                    <th style={{ ...S.th, minWidth: 160 }}>최근 S</th>
                    <th style={{ ...S.th, minWidth: 140 }}>업무메모</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(grouped[floor]).sort().map((roomLabel, ri) => {
                    const roomPts = grouped[floor][roomLabel];
                    return (
                      <React.Fragment key={roomLabel}>
                        {ri > 0 && <tr><td colSpan={7} style={S.roomGap}></td></tr>}
                        {roomPts.map(p => {
                          const { birthYear, age } = birthAndAge(p.jumin, p.birthDate);
                          const days = daysFromAdmit(p.admitDate);

                          return (
                            <tr key={p.chartNo}>
                              <td style={{ ...S.td, ...S.room }}>{p.roomLabel}-{p.bed}</td>
                              <td style={S.td}>
                                <div style={S.name}>{p.name}</div>
                                {(selectedDoctor === 'all' || showAllPatients) && p.attending && (
                                  <div style={S.subText}>{p.attending}</div>
                                )}
                                {!p.attending && (
                                  <div style={{ fontSize: 11, color: '#e11d48' }}>미배정</div>
                                )}
                              </td>
                              <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 12 }}>
                                {birthYear && <div style={{ color: '#94a3b8', fontSize: 11 }}>{String(birthYear).slice(2)}년생</div>}
                                {age !== null && <div style={{ color: '#374151', fontWeight: 600 }}>{age}세</div>}
                              </td>
                              <td style={S.td}>
                                <div style={S.twoLine} title={p.diagName || ''}>
                                  {p.diagName || <span style={S.dash}>-</span>}
                                </div>
                              </td>
                              <td style={S.td}>
                                <div style={{ fontSize: 12, color: '#475569' }}>{formatDate(p.admitDate)}</div>
                                {days && <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 600 }}>{days}</div>}
                              </td>
                              <td style={S.td}>
                                {p.soapS ? (
                                  <div style={S.twoLine} title={p.soapS.text || ''}>
                                    <span style={S.dateTag}>{formatDate(p.soapS.date)}</span>
                                    {p.soapS.text || '-'}
                                  </div>
                                ) : <span style={S.dash}>-</span>}
                              </td>
                              <td style={S.td}>
                                {p.workMemo ? (
                                  <div style={S.twoLine} title={p.workMemo.memo || ''}>
                                    <span style={S.dateTag}>{formatDate(p.workMemo.date)}</span>
                                    {p.workMemo.memo || '-'}
                                  </div>
                                ) : <span style={S.dash}>-</span>}
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
          </div>
        ))
      )}

      <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 12 }}>
        {filteredPatients.length}명 표시
      </div>
    </div>
  );
}
