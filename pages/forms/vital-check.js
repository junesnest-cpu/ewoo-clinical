import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '../_app';

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

const VITAL_FIELDS = ['sys', 'dia', 'hr', 'bt'];
const DM_FIELDS = ['fbs', 'pp2'];

function getBadges(memo) { return BADGES.filter(b => b.match(memo)); }
function hasDM(memo) { return /당뇨|DM(?![A-Z])/i.test(memo); }

function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function currentSession() {
  return new Date().getHours() < 13 ? 'am' : 'pm';
}

// 한국어 숫자 → 아라비아 숫자 변환
function koreanToNum(str) {
  const units = { '백': 100, '십': 10 };
  const digits = { '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9, '영': 0, '공': 0 };
  // "삼십칠점오" → 37.5
  let s = str.replace(/점/g, '.');
  // 단순 아라비아 숫자면 그대로
  if (/^[\d.]+$/.test(s)) return parseFloat(s);
  // 한국어 숫자 변환
  let result = 0, cur = 0;
  for (const ch of s) {
    if (ch === '.') { result += cur; result = parseFloat(result + '.'); cur = 0; continue; }
    if (digits[ch] !== undefined) { cur = digits[ch]; }
    else if (units[ch]) { result += (cur || 1) * units[ch]; cur = 0; }
  }
  result += cur;
  return result || NaN;
}

// 바이탈 유효 범위
const VITAL_RANGES = {
  sys: [60, 260],   // 수축기
  dia: [30, 160],   // 이완기
  hr:  [30, 220],   // 심박수
  bt:  [34, 42],    // 체온
  fbs: [30, 600],   // 공복혈당
  pp2: [30, 600],   // 식후혈당
};

// 큰 숫자를 바이탈 범위에 맞게 분리 시도
function trySplitNumber(n) {
  const s = String(Math.round(n));
  if (s.length < 4) return [n]; // 3자리 이하는 분리 불필요

  // 모든 분리 위치 시도, 두 수가 가장 바이탈 범위에 가까운 조합 선택
  let bestPair = null, bestScore = Infinity;
  for (let i = 1; i < s.length; i++) {
    const a = parseInt(s.slice(0, i)), b = parseInt(s.slice(i));
    if (b === 0 && s[i] !== '0') continue; // 앞에 0 떨어지는 경우 스킵
    // sys/dia 쌍으로 점수 계산
    const inSys = a >= VITAL_RANGES.sys[0] && a <= VITAL_RANGES.sys[1];
    const inDia = b >= VITAL_RANGES.dia[0] && b <= VITAL_RANGES.dia[1];
    const score = (inSys ? 0 : Math.min(Math.abs(a - 120), Math.abs(a - 130)))
                + (inDia ? 0 : Math.min(Math.abs(b - 70), Math.abs(b - 80)));
    if (inSys && inDia) return [a, b]; // 둘 다 유효하면 즉시 반환
    if ((inSys || inDia) && score < bestScore) { bestScore = score; bestPair = [a, b]; }
  }
  // 하나라도 유효 범위면 분리
  if (bestPair) return bestPair;
  return [n];
}

// 음성 텍스트에서 숫자 추출 (큰 숫자 분리 포함)
function extractNumbers(text) {
  // 한국어 단일 글자 변환은 이름 오염 위험이 있으므로 제거
  // (예: "이난영" → "이난0" 방지)
  // 음성 API가 이미 숫자를 아라비아로 출력하므로 직접 추출
  const matches = text.match(/[\d]+\.?[\d]*/g);
  if (!matches) return [];

  const raw = matches.map(m => parseFloat(m)).filter(n => !isNaN(n));

  // 큰 숫자 분리 적용
  const result = [];
  for (const n of raw) {
    if (n > 300 && !String(n).includes('.')) {
      result.push(...trySplitNumber(n));
    } else {
      result.push(n);
    }
  }
  return result;
}

// 음성 텍스트에서 환자 이름 매칭 (공백 무시, 부분 매칭)
function matchPatient(text, patients) {
  const clean = text.replace(/\s/g, '');
  let best = null, bestLen = 0;
  for (const p of patients) {
    const name = p.name.replace(/\s/g, '');
    if (clean.includes(name) && name.length > bestLen) {
      best = p;
      bestLen = name.length;
    }
  }
  return best;
}

// 미니 SVG 라인 차트
function MiniChart({ data, field, color, height = 60, width = 220, label, unit }) {
  if (!data.length) return null;
  const values = data.map(d => d[field]).filter(v => v != null && !isNaN(v));
  if (!values.length) return null;
  const min = Math.min(...values) - 5;
  const max = Math.max(...values) + 5;
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 20) + 10;
    const y = height - 8 - ((v - min) / range) * (height - 20);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{label} ({unit})</div>
      <svg width={width} height={height} style={{ background: '#f8fafc', borderRadius: 6 }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
        {values.map((v, i) => {
          const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 20) + 10;
          const y = height - 8 - ((v - min) / range) * (height - 20);
          return <circle key={i} cx={x} cy={y} r={3} fill={color} />;
        })}
      </svg>
    </div>
  );
}


export default function VitalCheck() {
  const { userName } = useAuth() || {};
  const userId = userName || '';
  const [patients, setPatients] = useState([]);
  const [vitals, setVitals] = useState({});
  const [yesterdayVitals, setYesterdayVitals] = useState({});
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(currentSession);
  const [activeBadges, setActiveBadges] = useState(new Set());
  const [listening, setListening] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('');
  const [historyPatient, setHistoryPatient] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const saveTimers = useRef({});
  const recognitionRef = useRef(null);
  const voiceBuffer = useRef('');
  const parseTimer = useRef(null);

  const dateKey = todayStr();
  const now = new Date();
  const dateDisplay = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()} (${DAY_NAMES[now.getDay()]})`;
  const sessionLabel = session === 'am' ? '오전 (09:00)' : '오후 (16:00)';

  // 전날 날짜 계산
  const yesterday = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);

  // 직전 바이탈 조회: PM→오늘AM→어제PM→어제AM, AM→어제PM→어제AM
  const getPrev = useCallback((chartNo) => {
    const today = vitals[chartNo];
    const yday = yesterdayVitals[chartNo];
    if (session === 'pm') {
      return today?.am || yday?.pm || yday?.am || null;
    }
    // AM: 어제 PM → 어제 AM
    return yday?.pm || yday?.am || null;
  }, [vitals, yesterdayVitals, session]);

  // 환자 목록 + 오늘/어제 바이탈 조회
  useEffect(() => {
    (async () => {
      try {
        const [patRes, vitRes, ydayRes] = await Promise.all([
          fetch(`/api/rounding?date=${dateKey}`),
          fetch(`/api/vitals?date=${dateKey}`),
          fetch(`/api/vitals?date=${yesterday}`),
        ]);
        if (patRes.ok) {
          const d = await patRes.json();
          setPatients(d.patients || []);
        }
        if (vitRes.ok) {
          const d = await vitRes.json();
          setVitals(d.vitals || {});
        }
        if (ydayRes.ok) {
          const d = await ydayRes.json();
          setYesterdayVitals(d.vitals || {});
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [dateKey, yesterday]);

  // 바이탈 저장 (디바운스 1초)
  const saveVital = useCallback((chartNo, field, value) => {
    const key = `${chartNo}_${field}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const current = vitals[chartNo]?.[session] || {};
      const updated = { ...current, [field]: value === '' ? null : Number(value) };
      try {
        await fetch('/api/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateKey, session, chartNo, vitals: updated, userId }),
        });
      } catch (e) { console.error(e); }
    }, 1000);
  }, [dateKey, session, vitals, userId]);

  const updateVital = (chartNo, field, value) => {
    // 입력 중간 상태("36.", "36.5")를 문자열로 유지
    setVitals(prev => ({
      ...prev,
      [chartNo]: {
        ...prev[chartNo],
        [session]: { ...(prev[chartNo]?.[session] || {}), [field]: value },
      },
    }));
    saveVital(chartNo, field, value);
  };

  // 한 환자의 전체 바이탈 한번에 세팅 (음성입력용)
  const setPatientVitals = useCallback((chartNo, vals) => {
    const fields = ['sys', 'dia', 'hr', 'bt', 'fbs', 'pp2'];
    const updated = {};
    fields.forEach((f, i) => {
      if (i < vals.length && vals[i] != null) updated[f] = vals[i];
    });
    setVitals(prev => ({
      ...prev,
      [chartNo]: {
        ...prev[chartNo],
        [session]: { ...(prev[chartNo]?.[session] || {}), ...updated },
      },
    }));
    // 즉시 저장
    (async () => {
      const current = vitals[chartNo]?.[session] || {};
      try {
        await fetch('/api/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateKey, session, chartNo, vitals: { ...current, ...updated }, userId }),
        });
      } catch (e) { console.error(e); }
    })();
  }, [dateKey, session, vitals, userId]);

  // 이미 바이탈이 입력된 환자인지 확인
  const hasVitals = useCallback((chartNo) => {
    const v = vitals[chartNo]?.[session];
    return v && (v.sys != null || v.dia != null || v.hr != null || v.bt != null);
  }, [vitals, session]);

  // 음성 버퍼 파싱 시도
  const tryParse = useCallback((text) => {
    const patient = matchPatient(text, patients);
    const nums = extractNumbers(text);
    if (patient && nums.length >= 4) {
      if (hasVitals(patient.chartNo)) {
        setVoiceStatus(`${patient.name}: 이미 입력됨 — 수정은 직접 입력해주세요`);
        voiceBuffer.current = '';
        setVoiceText('');
        return true; // 버퍼는 비우되 덮어쓰지 않음
      }
      setPatientVitals(patient.chartNo, nums);
      setVoiceStatus(`${patient.name}: BP ${nums[0]}/${nums[1]}, HR ${nums[2]}, BT ${nums[3]}${nums[4] != null ? `, FBS ${nums[4]}` : ''}${nums[5] != null ? `, PP2 ${nums[5]}` : ''}`);
      voiceBuffer.current = '';
      setVoiceText('');
      return true;
    }
    if (!patient) {
      setVoiceStatus(`인식: "${text}" — 환자를 찾지 못했습니다`);
    } else {
      setVoiceStatus(`인식: "${text}" — 숫자 ${nums.length}개 (${nums.join(', ')}) / 최소 4개 필요`);
    }
    return false;
  }, [patients, setPatientVitals, hasVitals]);

  // 음성 인식 (연속 모드 + 자동 재시작)
  const toggleVoice = useCallback(() => {
    if (listening) {
      if (recognitionRef.current) { recognitionRef.current._stopped = true; recognitionRef.current.stop(); }
      if (parseTimer.current) clearTimeout(parseTimer.current);
      // 남은 버퍼 최종 파싱
      if (voiceBuffer.current.trim()) tryParse(voiceBuffer.current);
      voiceBuffer.current = '';
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceStatus('이 브라우저는 음성인식을 지원하지 않습니다'); return; }

    function startRecognition() {
      const recognition = new SR();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition._stopped = false;
      recognitionRef.current = recognition;

      recognition.onstart = () => { setListening(true); if (!voiceBuffer.current) setVoiceStatus('듣는 중... 천천히 말씀하세요'); };
      recognition.onresult = (e) => {
        // 현재 인식 중인 전체 텍스트 조합
        let interim = '', final = '';
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) { final += t + ' '; } else { interim += t; }
        }
        const accumulated = voiceBuffer.current + final;
        setVoiceText((accumulated + interim).trim());

        if (final) {
          voiceBuffer.current = accumulated;
          // 파싱 디바운스: final 결과가 올 때마다 2.5초 타이머 리셋
          if (parseTimer.current) clearTimeout(parseTimer.current);
          parseTimer.current = setTimeout(() => {
            const buf = voiceBuffer.current.trim();
            if (buf) {
              const ok = tryParse(buf);
              if (ok) voiceBuffer.current = '';
            }
          }, 2500);
        }
      };
      recognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return; // 무시, 재시작됨
        setVoiceStatus(`오류: ${e.error}`);
      };
      recognition.onend = () => {
        // 자동 재시작 (사용자가 직접 중지하지 않은 경우)
        if (!recognition._stopped) {
          try { startRecognition(); } catch (ex) { setListening(false); }
        } else {
          setListening(false);
        }
      };
      recognition.start();
    }

    voiceBuffer.current = '';
    startRecognition();
  }, [listening, tryParse]);

  // 환자 바이탈 이력 팝업
  const openHistory = async (patient) => {
    setHistoryPatient(patient);
    setHistoryLoading(true);
    setHistoryData([]);
    try {
      const r = await fetch(`/api/vitals?chartNo=${patient.chartNo}&days=14`);
      if (r.ok) {
        const d = await r.json();
        setHistoryData(d.history || []);
      }
    } catch (e) { console.error(e); }
    setHistoryLoading(false);
  };

  // 그룹핑
  const grouped = {};
  patients.forEach(p => {
    const floor = String(p.dong);
    if (!grouped[floor]) grouped[floor] = {};
    if (!grouped[floor][p.roomLabel]) grouped[floor][p.roomLabel] = [];
    grouped[floor][p.roomLabel].push(p);
  });
  const floorCount = floor => Object.values(grouped[floor] || {}).reduce((s, arr) => s + arr.length, 0);

  const isDM = (p) => hasDM(p.memo);

  const getVal = (chartNo, sess, field) => {
    const v = vitals[chartNo]?.[sess]?.[field];
    return v != null ? v : '';
  };

  const S = {
    container: { maxWidth: 1100, margin: '0 auto', padding: '0 12px 60px' },
    header: { background: '#0f172a', color: '#fff', padding: '18px 24px', borderRadius: '12px 12px 0 0', position: 'sticky', top: 0, zIndex: 100 },
    date: { fontSize: 22, fontWeight: 800, letterSpacing: 1 },
    title: { fontSize: 14, color: '#94a3b8', marginTop: 3 },
    back: { position: 'absolute', top: 18, right: 24, color: '#94a3b8', fontSize: 14, cursor: 'pointer' },
    toolbar: { background: '#1e293b', padding: '10px 24px', position: 'sticky', top: 82, zIndex: 99, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
    badgeBar: { background: '#1e293b', padding: '8px 24px 10px', borderRadius: '0 0 12px 12px', marginBottom: 16, position: 'sticky', top: 126, zIndex: 98, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    sessionBtn: (active) => ({ padding: '5px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: active ? '#3b82f6' : '#334155', color: active ? '#fff' : '#94a3b8', transition: 'all 0.15s' }),
    voiceBtn: (on) => ({ padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: on ? '2px solid #ef4444' : '2px solid #475569', background: on ? '#ef4444' : '#334155', color: '#fff', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4 }),
    voiceText: { fontSize: 12, color: '#94a3b8', marginLeft: 8, flex: 1, minWidth: 100 },
    badgeFilter: (b, active) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: active ? `2px solid ${b.color}` : '2px solid transparent', color: active ? '#fff' : b.color, background: active ? b.color : b.bg, transition: 'all 0.15s', userSelect: 'none' }),
    badgeBarLabel: { fontSize: 12, color: '#94a3b8', fontWeight: 600, marginRight: 4 },
    floorHeader: { background: '#1e3a5f', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontSize: 16, fontWeight: 700, marginTop: 20 },
    count: { fontSize: 13, color: '#94a3b8', marginLeft: 8, fontWeight: 400 },
    table: { width: '100%', borderCollapse: 'collapse', marginBottom: 2, fontSize: 13, tableLayout: 'fixed' },
    th: { background: '#f1f5f9', padding: '7px 6px', fontWeight: 600, textAlign: 'center', borderBottom: '2px solid #cbd5e1', fontSize: 12, color: '#475569', position: 'sticky', top: 170, zIndex: 50 },
    td: { padding: '5px 4px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'middle', textAlign: 'center' },
    roomGap: { height: 15, background: '#f8fafc' },
    name: { fontWeight: 700, fontSize: 14, color: '#0f172a', cursor: 'pointer', whiteSpace: 'nowrap' },
    badge: { display: 'inline-block', padding: '1px 5px', borderRadius: 8, fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: '16px' },
    vInput: { width: '100%', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 2px', fontSize: 14, textAlign: 'center', outline: 'none', fontFamily: 'inherit', fontWeight: 600 },
    prevSummary: { fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', lineHeight: '16px' },
    prevTime: { fontSize: 10, color: '#94a3b8', lineHeight: '14px' },
    dmCell: { display: 'flex', alignItems: 'center', gap: 3 },
    dmPrev: { fontSize: 11, color: '#94a3b8', flexShrink: 0, minWidth: 20, textAlign: 'center' },
    // 팝업 스타일
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    popup: { background: '#fff', borderRadius: 16, padding: '24px 20px', maxWidth: 540, width: '95vw', maxHeight: '85vh', overflowY: 'auto', position: 'relative' },
    popupClose: { position: 'absolute', top: 12, right: 16, fontSize: 20, cursor: 'pointer', color: '#64748b', background: 'none', border: 'none' },
    popupTitle: { fontSize: 18, fontWeight: 800, marginBottom: 16 },
    historyTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 },
    histTh: { background: '#f1f5f9', padding: '6px 8px', fontWeight: 600, textAlign: 'center', borderBottom: '2px solid #cbd5e1', fontSize: 11, position: 'sticky', top: 0 },
    histTd: { padding: '5px 8px', borderBottom: '1px solid #e2e8f0', textAlign: 'center', fontSize: 12 },
    loading: { textAlign: 'center', padding: 40, color: '#64748b' },
  };

  if (loading) return <div style={S.loading}>환자 목록 조회 중...</div>;

  return (
    <div style={S.container}>
      {/* 헤더 */}
      <div style={S.header}>
        <div style={S.date}>{dateDisplay}</div>
        <div style={S.title}>바이탈 체크지 — {sessionLabel}</div>
        <Link href="/" style={S.back}>← 메인</Link>
      </div>

      {/* 툴바: 세션 선택 + 음성입력 */}
      <div style={S.toolbar}>
        <button style={S.sessionBtn(session === 'am')} onClick={() => setSession('am')}>오전 09:00</button>
        <button style={S.sessionBtn(session === 'pm')} onClick={() => setSession('pm')}>오후 16:00</button>
        <div style={{ width: 1, height: 24, background: '#475569', margin: '0 4px' }} />
        <button style={S.voiceBtn(listening)} onClick={toggleVoice}>
          {listening ? '● 중지' : '🎤 음성입력'}
        </button>
        <span style={S.voiceText}>
          {voiceText || voiceStatus || '이름 — 수축기 — 이완기 — 심박수 — 체온 (띄어서 천천히)'}
        </span>
      </div>

      {/* 뱃지 필터 바 */}
      <div style={S.badgeBar}>
        <span style={S.badgeBarLabel}>주석:</span>
        {BADGES.map(b => (
          <span key={b.id} style={S.badgeFilter(b, activeBadges.has(b.id))}
            onClick={() => setActiveBadges(prev => {
              const next = new Set(prev);
              next.has(b.id) ? next.delete(b.id) : next.add(b.id);
              return next;
            })}>
            {b.label}
          </span>
        ))}
        {activeBadges.size > 0 && (
          <span style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', marginLeft: 4 }}
            onClick={() => setActiveBadges(new Set())}>✕ 전체해제</span>
        )}
      </div>

      {/* 병동별 테이블 */}
      {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map(floor => (
        <div key={floor}>
          <div style={S.floorHeader}>
            {FLOOR_LABELS[floor] || `${floor}층`}
            <span style={S.count}>{floorCount(floor)}명</span>
          </div>
          <table style={S.table}>
            <colgroup>
              <col style={{ width: '5%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={S.th}>병실</th>
                <th style={{ ...S.th, textAlign: 'left', paddingLeft: 6 }}>이름</th>
                <th style={{ ...S.th, textAlign: 'left', paddingLeft: 4 }}>뱃지</th>
                <th style={S.th}>수축기</th>
                <th style={S.th}>이완기</th>
                <th style={S.th}>심박</th>
                <th style={S.th}>체온</th>
                <th style={{ ...S.th, textAlign: 'left', paddingLeft: 8, color: '#94a3b8' }}>직전</th>
                <th style={{ ...S.th, background: '#fef9c3', color: '#92400e' }}>FBS</th>
                <th style={{ ...S.th, background: '#fef9c3', color: '#92400e' }}>PP2</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(grouped[floor]).sort().map((roomLabel, ri) => {
                const roomPts = grouped[floor][roomLabel];
                return (
                  <React.Fragment key={roomLabel}>
                    {ri > 0 && <tr><td colSpan={10} style={S.roomGap}></td></tr>}
                    {roomPts.map(p => {
                      const badges = getBadges(p.memo);
                      const matched = activeBadges.size > 0
                        ? badges.filter(b => activeBadges.has(b.id))
                        : [];
                      const rowStyle = matched.length > 0
                        ? {
                            background: matched[0].bg,
                            boxShadow: matched.map((b, i) => `inset ${(i + 1) * 3}px 0 0 ${b.color}`).join(', '),
                          }
                        : undefined;
                      const dm = isDM(p);
                      const prev = getPrev(p.chartNo);
                      const prevParts = prev ? [prev.sys, prev.dia, prev.hr, prev.bt].filter(v => v != null) : [];
                      const prevText = prevParts.length > 0 ? prevParts.join('-') : '';
                      const prevTime = prev?.at
                        ? new Date(prev.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                        : '';
                      return (
                        <tr key={p.chartNo} style={rowStyle}>
                          <td style={{ ...S.td, fontSize: 12, color: '#475569', fontWeight: 600 }}>{p.roomLabel}-{p.bed}</td>
                          <td style={{ ...S.td, textAlign: 'left', paddingLeft: 6 }}>
                            <span style={S.name} onClick={() => openHistory(p)}>{p.name}</span>
                          </td>
                          <td style={{ ...S.td, textAlign: 'left', paddingLeft: 4 }}>
                            <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap', minHeight: 18 }}>
                              {badges.map(b => (
                                <span key={b.id} style={{ ...S.badge, color: b.color, background: b.bg }}>{b.label}</span>
                              ))}
                            </div>
                          </td>
                          {['sys', 'dia', 'hr', 'bt'].map(field => (
                            <td key={field} style={S.td}>
                              <input type="text" inputMode="decimal" style={S.vInput}
                                value={getVal(p.chartNo, session, field)}
                                onChange={e => updateVital(p.chartNo, field, e.target.value)}
                                placeholder="-" />
                            </td>
                          ))}
                          <td style={{ ...S.td, textAlign: 'left', paddingLeft: 8 }}>
                            {prevText ? (
                              <>
                                <div style={S.prevSummary}>{prevText}</div>
                                {prevTime && <div style={S.prevTime}>{prevTime}</div>}
                              </>
                            ) : (
                              <div style={S.prevSummary}>{'\u00A0'}</div>
                            )}
                          </td>
                          {['fbs', 'pp2'].map(field => (
                            <td key={field} style={S.td}>
                              {dm ? (
                                <div style={S.dmCell}>
                                  <input type="text" inputMode="decimal" style={{ ...S.vInput, background: '#fffbeb' }}
                                    value={getVal(p.chartNo, session, field)}
                                    onChange={e => updateVital(p.chartNo, field, e.target.value)}
                                    placeholder="-" />
                                  <span style={S.dmPrev}>{prev?.[field] != null ? prev[field] : ''}</span>
                                </div>
                              ) : (
                                <span style={{ color: '#e2e8f0' }}>-</span>
                              )}
                            </td>
                          ))}
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
        총 {patients.length}명 · {sessionLabel}
      </div>

      {/* 바이탈 이력 팝업 */}
      {historyPatient && (
        <div style={S.overlay} onClick={() => setHistoryPatient(null)}>
          <div style={S.popup} onClick={e => e.stopPropagation()}>
            <button style={S.popupClose} onClick={() => setHistoryPatient(null)}>✕</button>
            <div style={S.popupTitle}>
              {historyPatient.name} — 바이탈 추이 (최근 14일)
            </div>
            {historyLoading ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>조회 중...</div>
            ) : historyData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>기록된 바이탈이 없습니다</div>
            ) : (
              <>
                {/* 차트 */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <MiniChart data={historyData} field="sys" color="#dc2626" label="수축기" unit="mmHg" />
                  <MiniChart data={historyData} field="dia" color="#2563eb" label="이완기" unit="mmHg" />
                  <MiniChart data={historyData} field="hr" color="#059669" label="심박수" unit="bpm" />
                  <MiniChart data={historyData} field="bt" color="#d97706" label="체온" unit="°C" />
                  {isDM(historyPatient) && <MiniChart data={historyData} field="fbs" color="#7c3aed" label="FBS" unit="mg/dL" />}
                  {isDM(historyPatient) && <MiniChart data={historyData} field="pp2" color="#0891b2" label="PP2" unit="mg/dL" />}
                </div>
                {/* 테이블 */}
                <table style={S.historyTable}>
                  <thead>
                    <tr>
                      <th style={S.histTh}>날짜</th>
                      <th style={S.histTh}>시간</th>
                      <th style={S.histTh}>BP</th>
                      <th style={S.histTh}>HR</th>
                      <th style={S.histTh}>BT</th>
                      {isDM(historyPatient) && <th style={S.histTh}>FBS</th>}
                      {isDM(historyPatient) && <th style={S.histTh}>PP2</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.map((h, i) => (
                      <tr key={i}>
                        <td style={S.histTd}>{h.date?.slice(5)}</td>
                        <td style={S.histTd}>{h.session === 'am' ? '오전' : '오후'}</td>
                        <td style={S.histTd}>{h.sys || '-'}/{h.dia || '-'}</td>
                        <td style={S.histTd}>{h.hr || '-'}</td>
                        <td style={S.histTd}>{h.bt || '-'}</td>
                        {isDM(historyPatient) && <td style={S.histTd}>{h.fbs || '-'}</td>}
                        {isDM(historyPatient) && <td style={S.histTd}>{h.pp2 || '-'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
