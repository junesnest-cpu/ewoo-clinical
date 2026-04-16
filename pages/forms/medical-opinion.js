import { useState, useEffect, useCallback, useRef } from 'react';

export default function MedicalOpinion() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [opinionData, setOpinionData] = useState(null);
  const [selectedAdmission, setSelectedAdmission] = useState(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  // 이름 검색 (300ms debounce) — 서버 API를 통해 hospital Firebase 조회
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || selectedPatient) { if (!selectedPatient) setResults(null); return; }
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/patients/search?q=${encodeURIComponent(trimmed)}`);
        if (r.ok) {
          const data = await r.json();
          setResults(data.patients || []);
        } else {
          console.error('환자 검색 실패:', r.status);
          setResults([]);
        }
      } catch (e) {
        console.error('환자 검색 오류:', e);
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selectedPatient]);

  // 환자 선택 시 기본정보 + 입원이력만 로드 (상세 데이터는 입원기간 선택 시)
  const selectPatient = useCallback(async (patient) => {
    setSelectedPatient(patient);
    setQuery(patient.name);
    setResults(null);
    setDraft('');
    setOpinionData(null);
    setSelectedAdmission(null);
    setError('');

    if (!patient.chartNo) {
      setOpinionData({
        basic: { chartNo: '', name: patient.name, birth: patient.birthDate, sex: patient.gender },
        diagnoses: patient.diagnosis ? [{ code: '', name: patient.diagnosis, startDate: '' }] : [],
        admissions: [], treatments: [], memo: '', progressNotes: [],
      });
      return;
    }

    setLoading(true);
    try {
      const r = await fetch('/api/emr/opinion-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartNo: patient.chartNo }),
      });
      if (r.ok) {
        const data = await r.json();
        // 입원이력만 먼저 표시, 상세 데이터는 입원기간 선택 후 로드
        setOpinionData({
          ...data,
          diagnoses: [],
          treatments: [],
          progressNotes: [],
          prescriptionMemos: [],
        });
        setLoading(false);
        return;
      }
    } catch (e) {
      console.warn('EMR 조회 실패:', e.message);
    }
    setOpinionData({
      basic: { chartNo: patient.chartNo, name: patient.name, birth: patient.birthDate, sex: patient.gender },
      diagnoses: patient.diagnosis ? [{ code: '', name: patient.diagnosis, startDate: '' }] : [],
      admissions: [], treatments: [], memo: '', progressNotes: [],
    });
    setLoading(false);
  }, []);

  // 입원기간 선택 시 해당 기간의 진단/치료/경과기록/처방메모 조회
  const selectAdmission = useCallback(async (admission) => {
    setSelectedAdmission(admission);
    if (!selectedPatient?.chartNo || !admission) return;

    setLoading(true);
    setDraft('');
    try {
      const r = await fetch('/api/emr/opinion-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chartNo: selectedPatient.chartNo,
          admitDate: admission.admitDate,
          dischargeDate: admission.dischargeDate || '',
        }),
      });
      if (r.ok) {
        const data = await r.json();
        setOpinionData(prev => ({
          ...prev,
          diagnoses: data.diagnoses || prev.diagnoses,
          treatments: data.treatments,
          progressNotes: data.progressNotes,
          prescriptionMemos: data.prescriptionMemos || prev.prescriptionMemos,
        }));
      }
    } catch (e) {
      console.warn('기간별 조회 실패:', e.message);
    }
    setLoading(false);
  }, [selectedPatient]);

  // 검색 초기화
  const clearSearch = () => {
    setQuery('');
    setResults(null);
    setSelectedPatient(null);
    setOpinionData(null);
    setSelectedAdmission(null);
    setDraft('');
    setError('');
    inputRef.current?.focus();
  };

  // AI 소견서 내용 생성 — 선택된 입원기간 데이터만 전달
  const generateDraft = async () => {
    if (!opinionData) return;
    setGenerating(true);
    setError('');
    try {
      // 선택된 입원기간만 포함하여 AI에 전달
      const dataForAI = {
        ...opinionData,
        admissions: selectedAdmission ? [selectedAdmission] : opinionData.admissions,
      };
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formType: 'medical_opinion',
          patientData: dataForAI,
        }),
      });
      if (!r.ok) throw new Error('생성 실패');
      const data = await r.json();
      setDraft(data.draft || '');
    } catch (e) {
      setError(e.message);
    }
    setGenerating(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const formatDate = (d) => {
    if (!d || d.length !== 8) return d || '';
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  };

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <a href="/" style={S.backLink}>&larr; 메인</a>
          <h1 style={S.title}>소견서 내용 자동 제안</h1>
          <p style={S.subtitle}>환자를 검색하면 EMR 데이터를 기반으로 소견서 내용을 자동 생성합니다</p>
        </div>
      </div>

      {/* 환자 검색 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>환자 검색</div>
        <div style={S.searchBox}>
          <input
            ref={inputRef}
            style={S.searchInput}
            placeholder="환자 이름을 입력하세요"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              if (selectedPatient) {
                setSelectedPatient(null);
                setOpinionData(null);
                setDraft('');
              }
            }}
            autoFocus
          />
          {query && (
            <button style={S.clearBtn} onClick={clearSearch}>&times;</button>
          )}
        </div>

        {/* 검색 결과 목록 */}
        {results !== null && !selectedPatient && (
          <div style={S.resultsList}>
            {results.length === 0 ? (
              <div style={S.noResult}>검색 결과 없음</div>
            ) : (
              <>
                <div style={S.resultCount}>{results.length}명 검색됨</div>
                {results.map((p, i) => (
                  <div
                    key={p.chartNo || i}
                    style={S.resultItem}
                    onClick={() => selectPatient(p)}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={S.resultName}>{p.name}</div>
                      <div style={S.resultMeta}>
                        {p.chartNo && `차트 ${p.chartNo}`}
                        {p.birthDate && ` · ${p.birthDate}`}
                        {p.diagnosis && ` · ${p.diagnosis}`}
                      </div>
                    </div>
                    <span style={{ color: '#7c3aed', fontSize: 18 }}>&rsaquo;</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* 선택된 환자 표시 */}
        {selectedPatient && (
          <div style={S.selectedBar}>
            <span style={S.selectedName}>{selectedPatient.name}</span>
            {selectedPatient.chartNo && <span style={S.selectedChart}>차트 {selectedPatient.chartNo}</span>}
            {selectedPatient.diagnosis && <span style={S.selectedChart}>{selectedPatient.diagnosis}</span>}
            <button style={S.changeBtn} onClick={clearSearch}>변경</button>
          </div>
        )}
      </div>

      {loading && <div style={S.loadingBar}>EMR 데이터 조회 중...</div>}
      {error && <div style={S.errorBar}>{error}</div>}

      {/* 1단계: 입원기간 선택 */}
      {opinionData && opinionData.admissions.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>입원기간 선택</div>
          <div style={S.admissionList}>
            {opinionData.admissions.map((a, i) => {
              const isSelected = selectedAdmission?.admitDate === a.admitDate;
              const isCurrent = !a.dischargeDate;
              return (
                <div
                  key={i}
                  style={{
                    ...S.admissionItem,
                    background: isSelected ? '#ede9fe' : '#f8fafc',
                    borderColor: isSelected ? '#7c3aed' : '#e2e8f0',
                  }}
                  onClick={() => !isSelected && selectAdmission(a)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: isSelected ? '#7c3aed' : '#1e293b' }}>
                      {formatDate(a.admitDate)} ~ {isCurrent ? '현재' : formatDate(a.dischargeDate)}
                    </span>
                    {isCurrent && <span style={S.currentBadge}>입원중</span>}
                  </div>
                  {isSelected && <span style={{ color: '#7c3aed', fontSize: 14, fontWeight: 700 }}>선택됨</span>}
                </div>
              );
            })}
          </div>
          {!selectedAdmission && (
            <div style={S.admissionHint}>입원기간을 선택하면 해당 기간의 진단·치료·경과기록을 불러옵니다</div>
          )}
        </div>
      )}

      {/* 2단계: 선택된 입원기간의 EMR 데이터 요약 (입원이력 없는 환자는 바로 표시) */}
      {opinionData && (selectedAdmission || opinionData.admissions.length === 0) && (
        <>
          <div style={S.dataGrid}>
            {/* 환자 정보 */}
            <div style={S.dataCard}>
              <div style={S.dataCardTitle}>환자 정보</div>
              <div style={S.dataRow}>
                <span style={S.dataLabel}>이름</span>
                <span>{opinionData.basic.name}</span>
              </div>
              <div style={S.dataRow}>
                <span style={S.dataLabel}>차트번호</span>
                <span>{opinionData.basic.chartNo}</span>
              </div>
              <div style={S.dataRow}>
                <span style={S.dataLabel}>입원일</span>
                <span>{formatDate(selectedAdmission.admitDate)}</span>
              </div>
              <div style={S.dataRow}>
                <span style={S.dataLabel}>퇴원일</span>
                <span>{selectedAdmission.dischargeDate ? formatDate(selectedAdmission.dischargeDate) : '입원 중'}</span>
              </div>
            </div>

            {/* 진단명 */}
            <div style={S.dataCard}>
              <div style={S.dataCardTitle}>진단명</div>
              {opinionData.diagnoses.length > 0 ? (
                opinionData.diagnoses.map((d, i) => (
                  <div key={i} style={S.dataRow}>
                    <span style={S.diagCode}>{d.code}</span>
                    <span style={{ flex: 1 }}>{d.name}</span>
                  </div>
                ))
              ) : (
                <div style={S.emptyText}>진단 데이터 없음</div>
              )}
            </div>

            {/* 처방메모 */}
            <div style={S.dataCard}>
              <div style={S.dataCardTitle}>처방메모 ({opinionData.prescriptionMemos?.length || 0}건)</div>
              {opinionData.prescriptionMemos?.length > 0 ? (
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {opinionData.prescriptionMemos.map((m, i) => (
                    <div key={i} style={S.noteItem}>
                      <div style={S.noteHeader}>
                        <span style={S.noteDate}>{formatDate(m.date)}</span>
                        {m.author && <span style={S.noteType}>{m.author}</span>}
                      </div>
                      <div style={S.noteContent}>{m.content}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={S.emptyText}>처방메모 없음</div>
              )}
            </div>

            {/* 주요 치료 내역 */}
            <div style={{ ...S.dataCard, gridColumn: '1 / -1' }}>
              <div style={S.dataCardTitle}>치료 내역 ({opinionData.treatments.length}건)</div>
              {opinionData.treatments.length > 0 ? (
                <div style={S.treatGrid}>
                  {opinionData.treatments.map((t, i) => (
                    <div key={i} style={S.treatItem}>
                      <div style={S.treatName}>{t.name}</div>
                      <div style={S.treatMeta}>
                        {t.count}회 | {t.dates.length > 0 && `${formatDate(t.dates[t.dates.length - 1])}~${formatDate(t.dates[0])}`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={S.emptyText}>처방 데이터 없음</div>
              )}
            </div>

            {/* SOAP 경과기록 */}
            {opinionData.progressNotes?.length > 0 && (
              <div style={{ ...S.dataCard, gridColumn: '1 / -1' }}>
                <div style={S.dataCardTitle}>경과기록 SOAP ({opinionData.progressNotes.length}건)</div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {opinionData.progressNotes.map((n, i) => (
                    <div key={i} style={S.noteItem}>
                      <div style={S.noteHeader}>
                        <span style={S.noteDate}>{formatDate(n.date)}</span>
                      </div>
                      {['S', 'O', 'A', 'P'].map(k => n[k] ? (
                        <div key={k} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                          <span style={S.soapLabel}>{k}</span>
                          <span style={S.noteContent}>{n[k]}</span>
                        </div>
                      ) : null)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 생성 버튼 */}
          <div style={S.generateArea}>
            <button
              style={{
                ...S.generateBtn,
                opacity: generating ? 0.7 : 1,
                cursor: generating ? 'wait' : 'pointer',
              }}
              onClick={generateDraft}
              disabled={generating}
            >
              {generating ? 'AI 소견서 내용 생성 중...' : 'AI 소견서 내용 생성'}
            </button>
          </div>

          {/* 생성 결과 */}
          {draft && (
            <div style={S.resultSection}>
              <div style={S.resultHeader}>
                <div style={S.resultTitle}>소견서 내용 (편집 가능)</div>
                <button
                  style={S.copyBtn}
                  onClick={copyToClipboard}
                >
                  {copied ? '복사됨!' : '클립보드 복사'}
                </button>
              </div>

              {/* 편집 필요 항목 하이라이트 */}
              {(() => {
                const edits = [...draft.matchAll(/【([^】]+)】/g)].map(m => m[1]);
                return edits.length > 0 ? (
                  <div style={S.editHints}>
                    <span style={S.editHintsLabel}>편집 필요 ({edits.length}개):</span>
                    {edits.map((e, i) => (
                      <span key={i} style={S.editHintTag}>{e}</span>
                    ))}
                  </div>
                ) : null;
              })()}

              <div style={{ position: 'relative' }}>
                {/* 하이라이트 오버레이 */}
                <div
                  style={S.highlightOverlay}
                  dangerouslySetInnerHTML={{
                    __html: draft
                      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/【([^】]+)】/g, '<mark style="background:#fef08a;border-radius:3px;padding:1px 2px;color:#92400e;font-weight:600">【$1】</mark>')
                      + '\n',
                  }}
                />
                <textarea
                  style={S.resultText}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={20}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const S = {
  container: { maxWidth: 960, margin: '0 auto', padding: '24px 16px' },
  header: { marginBottom: 24 },
  headerLeft: {},
  backLink: { color: '#6366f1', textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  title: { fontSize: 24, fontWeight: 800, margin: '8px 0 4px', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', margin: 0 },

  section: { marginBottom: 20, position: 'relative' },
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 8, color: '#334155' },

  searchBox: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchInput: {
    width: '100%', padding: '12px 40px 12px 14px', fontSize: 15, borderRadius: 8,
    border: '1.5px solid #cbd5e1', outline: 'none', background: '#fff',
    boxSizing: 'border-box',
  },
  clearBtn: {
    position: 'absolute', right: 8, background: 'none', border: 'none',
    fontSize: 20, color: '#94a3b8', cursor: 'pointer', padding: '4px 8px',
    lineHeight: 1,
  },

  resultsList: {
    marginTop: 6, background: '#fff', borderRadius: 10,
    border: '1.5px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    maxHeight: 320, overflowY: 'auto',
  },
  resultCount: {
    fontSize: 12, fontWeight: 700, color: '#64748b', padding: '10px 14px 4px',
  },
  resultItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
    cursor: 'pointer', transition: 'background 0.1s', borderBottom: '1px solid #f1f5f9',
  },
  resultName: { fontWeight: 700, fontSize: 15, color: '#0f172a' },
  resultMeta: { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  noResult: { textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 14 },

  selectedBar: {
    marginTop: 8, display: 'flex', alignItems: 'center', gap: 10,
    background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: 8,
    padding: '10px 14px',
  },
  selectedName: { fontWeight: 700, fontSize: 15, color: '#0f172a' },
  selectedChart: { fontSize: 13, color: '#64748b' },
  changeBtn: {
    marginLeft: 'auto', background: '#fff', border: '1px solid #cbd5e1',
    borderRadius: 6, padding: '4px 12px', fontSize: 13, fontWeight: 600,
    color: '#475569', cursor: 'pointer',
  },

  loadingBar: {
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
    padding: '12px 16px', color: '#1d4ed8', fontSize: 14, marginBottom: 16,
  },
  errorBar: {
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
    padding: '12px 16px', color: '#dc2626', fontSize: 14, marginBottom: 16,
  },

  dataGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: 16, marginBottom: 20,
  },
  dataCard: {
    background: '#fff', borderRadius: 10, padding: '16px 18px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0',
  },
  dataCardTitle: {
    fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 12,
    paddingBottom: 8, borderBottom: '1px solid #f1f5f9',
  },
  dataRow: {
    display: 'flex', gap: 10, padding: '4px 0', fontSize: 14, alignItems: 'baseline',
  },
  dataLabel: {
    fontWeight: 600, color: '#475569', minWidth: 70, flexShrink: 0,
  },
  diagCode: {
    fontFamily: 'monospace', fontSize: 13, color: '#7c3aed', fontWeight: 600,
    background: '#f5f3ff', padding: '1px 6px', borderRadius: 4, flexShrink: 0,
  },
  emptyText: { color: '#94a3b8', fontSize: 13, fontStyle: 'italic' },

  admissionList: {
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  admissionItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0',
    cursor: 'pointer', transition: 'all 0.15s',
  },
  admissionHint: {
    marginTop: 10, fontSize: 13, color: '#7c3aed', fontWeight: 600,
    background: '#f5f3ff', padding: '10px 14px', borderRadius: 8,
    textAlign: 'center',
  },
  currentBadge: {
    background: '#dcfce7', color: '#16a34a', fontSize: 11, fontWeight: 700,
    padding: '2px 8px', borderRadius: 10,
  },

  memoText: {
    fontSize: 14, lineHeight: 1.6, color: '#334155',
    background: '#f8fafc', padding: '10px 14px', borderRadius: 6,
    whiteSpace: 'pre-wrap',
  },
  noteItem: {
    padding: '8px 0', borderBottom: '1px solid #f1f5f9',
  },
  noteHeader: {
    display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4,
  },
  noteDate: {
    fontSize: 12, fontWeight: 700, color: '#7c3aed',
  },
  noteType: {
    fontSize: 11, background: '#f1f5f9', color: '#64748b',
    padding: '1px 6px', borderRadius: 4, fontWeight: 600,
  },
  noteContent: {
    fontSize: 13, lineHeight: 1.5, color: '#475569',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1,
  },
  soapLabel: {
    fontWeight: 700, fontSize: 13, color: '#7c3aed',
    minWidth: 16, flexShrink: 0,
  },

  treatGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8,
  },
  treatItem: {
    background: '#f8fafc', borderRadius: 6, padding: '8px 12px',
    border: '1px solid #e2e8f0',
  },
  treatName: { fontSize: 13, fontWeight: 600, color: '#1e293b', lineHeight: 1.4 },
  treatMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },

  generateArea: { textAlign: 'center', marginBottom: 24 },
  generateBtn: {
    background: 'linear-gradient(135deg, #7c3aed, #6366f1)', color: '#fff',
    border: 'none', borderRadius: 10, padding: '14px 40px', fontSize: 16,
    fontWeight: 700, boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
    transition: 'all 0.15s',
  },

  resultSection: { marginBottom: 32 },
  resultHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  resultTitle: { fontSize: 16, fontWeight: 700, color: '#1e293b' },
  copyBtn: {
    background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6,
    padding: '6px 14px', fontSize: 13, fontWeight: 600, color: '#475569',
    cursor: 'pointer',
  },
  resultText: {
    width: '100%', padding: '16px', fontSize: 14, lineHeight: 1.8,
    borderRadius: 10, border: '1.5px solid #cbd5e1', outline: 'none',
    fontFamily: 'inherit', resize: 'vertical', minHeight: 300,
    boxSizing: 'border-box', background: 'transparent', position: 'relative',
    zIndex: 1, color: 'transparent', caretColor: '#000',
  },
  highlightOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    padding: '16px', fontSize: 14, lineHeight: 1.8,
    fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordWrap: 'break-word',
    borderRadius: 10, border: '1.5px solid transparent',
    boxSizing: 'border-box', pointerEvents: 'none',
    color: '#000', background: '#fff', zIndex: 0,
    overflow: 'auto',
  },
  editHints: {
    display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
    marginBottom: 8, padding: '8px 12px',
    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
  },
  editHintsLabel: {
    fontSize: 13, fontWeight: 700, color: '#92400e',
  },
  editHintTag: {
    fontSize: 12, background: '#fef08a', color: '#78350f', fontWeight: 600,
    padding: '2px 8px', borderRadius: 10,
  },
};
