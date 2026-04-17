import { useState, useEffect } from 'react';
import Link from 'next/link';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const MEDICAL_FORMS = [
  { id: 'doctor-rounding',    icon: '🩺', label: '병동 라운딩 체크',   desc: '입원환자 일일 라운딩 체크리스트', color: '#0369a1' },
  { id: 'medical-opinion',    icon: '📄', label: '소견서 작성',       desc: '진단·치료 경과 기반 소견서 생성', color: '#7c3aed' },
];

const NURSING_FORMS = [
  { id: 'nurse-rounding',  icon: '👩‍⚕️', label: '환자 라운딩 체크',  desc: '간호 관찰·호소 증상·주의사항 기록', color: '#0891b2' },
  { id: 'vital-check',     icon: '💓', label: '바이탈 체크지',      desc: '바이탈 사인 기록·추이 분석·이상치 알림', color: '#e11d48' },
  { id: 'nursing-record',  icon: '📑', label: '간호기록지',         desc: 'SBAR 형식 간호기록 자동 작성', color: '#ca8a04' },
  { id: 'handoff-summary', icon: '🔄', label: '병동 인계사항 요약',  desc: '근무 교대 시 핵심 인계사항 정리', color: '#6366f1' },
];

export default function Home() {
  const [patientCount, setPatientCount] = useState(null);

  const now = new Date();
  const dateDisplay = `${now.getMonth() + 1}/${now.getDate()} (${DAY_NAMES[now.getDay()]})`;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/emr/rounding-summary');
        if (r.ok) {
          const data = await r.json();
          setPatientCount((data.patients || []).length);
        }
      } catch (e) { console.error(e); }
    })();
  }, []);

  const S = {
    container: { maxWidth: 1200, margin: '0 auto', padding: '24px 16px' },
    header: { background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', color: '#fff', padding: '32px 24px', borderRadius: 16, marginBottom: 24 },
    title: { fontSize: 28, fontWeight: 800, marginBottom: 6 },
    subtitle: { fontSize: 15, color: '#94a3b8' },
    sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 32 },
    card: { background: '#fff', borderRadius: 12, padding: '20px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', borderLeft: '4px solid' },
    cardIcon: { fontSize: 28, marginBottom: 8 },
    cardLabel: { fontSize: 17, fontWeight: 700, marginBottom: 4 },
    cardDesc: { fontSize: 13, color: '#64748b', lineHeight: 1.5 },
    statsBar: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 },
    stat: { background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 20px', minWidth: 120 },
    statNum: { fontSize: 24, fontWeight: 800 },
    statLabel: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  };

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.title}>이우병원 임상서식 시스템</div>
        <div style={S.subtitle}>EMR 데이터 기반 의과·간호과 서식 자동화 + AI 요약</div>
        <div style={S.statsBar}>
          <div style={S.stat}>
            <div style={S.statNum}>{dateDisplay}</div>
            <div style={S.statLabel}>오늘</div>
          </div>
          <div style={S.stat}>
            <div style={S.statNum}>{patientCount !== null ? patientCount : '...'}</div>
            <div style={S.statLabel}>현재 입원환자</div>
          </div>
        </div>
      </div>

      <div style={S.sectionTitle}>
        <span style={{ fontSize: 22 }}>🩺</span> 의과 서식
      </div>
      <div style={S.grid}>
        {MEDICAL_FORMS.map(f => (
          <Link key={f.id} href={`/forms/${f.id}`}>
            <div style={{ ...S.card, borderLeftColor: f.color }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; }}>
              <div style={S.cardIcon}>{f.icon}</div>
              <div style={{ ...S.cardLabel, color: f.color }}>{f.label}</div>
              <div style={S.cardDesc}>{f.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      <div style={S.sectionTitle}>
        <span style={{ fontSize: 22 }}>👩‍⚕️</span> 간호과 서식
      </div>
      <div style={S.grid}>
        {NURSING_FORMS.map(f => (
          <Link key={f.id} href={`/forms/${f.id}`}>
            <div style={{ ...S.card, borderLeftColor: f.color }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; }}>
              <div style={S.cardIcon}>{f.icon}</div>
              <div style={{ ...S.cardLabel, color: f.color }}>{f.label}</div>
              <div style={S.cardDesc}>{f.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
