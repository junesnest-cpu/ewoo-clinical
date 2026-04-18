import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ref, onValue } from "firebase/database";
import { wardDb } from "../../lib/firebaseConfig";
import { useAuth } from "../_app";

const WARD_STRUCTURE = {
  2: { name: "2병동", rooms: [
    { id:"201",capacity:4 },{ id:"202",capacity:1 },{ id:"203",capacity:4 },
    { id:"204",capacity:2 },{ id:"205",capacity:6 },{ id:"206",capacity:6 },
  ]},
  3: { name: "3병동", rooms: [
    { id:"301",capacity:4 },{ id:"302",capacity:1 },{ id:"303",capacity:4 },
    { id:"304",capacity:2 },{ id:"305",capacity:2 },{ id:"306",capacity:6 },
  ]},
  5: { name: "5병동", rooms: [
    { id:"501",capacity:4 },{ id:"502",capacity:1 },{ id:"503",capacity:4 },
    { id:"504",capacity:2 },{ id:"505",capacity:6 },{ id:"506",capacity:6 },
  ]},
  6: { name: "6병동", rooms: [
    { id:"601",capacity:6 },{ id:"602",capacity:1 },{ id:"603",capacity:6 },
  ]},
};

const TREATMENT_GROUPS = [
  { group:"고주파 온열치료", color:"#dc2626", bg:"#fef2f2",
    items:[{ id:"hyperthermia", name:"고주파 온열치료" }, { id:"hyperbaric", name:"고압산소치료" }] },
  { group:"싸이모신알파1", color:"#7c3aed", bg:"#faf5ff",
    items:[{ id:"zadaxin",name:"자닥신" },{ id:"imualpha",name:"이뮤알파" },{ id:"scion",name:"싸이원주" }] },
  { group:"수액류", color:"#0ea5e9", bg:"#f0f9ff",
    items:[
      { id:"glutathione",name:"글루타치온" },{ id:"dramin",name:"닥터라민+지씨멀티주" },
      { id:"thioctic",name:"티옥트산" },{ id:"gt",name:"G+T" },
      { id:"myers1",name:"마이어스1" },{ id:"myers2",name:"마이어스2" },
      { id:"selenium_iv",name:"셀레늄" },{ id:"vitd",name:"비타민D" },
      { id:"vitc",name:"고용량 비타민C",custom:"vitc" },
    ] },
  { group:"물리치료", color:"#059669", bg:"#f0fdf4",
    items:[{ id:"pain",name:"페인스크렘블러" },{ id:"manip2",name:"도수치료2" },{ id:"manip1",name:"도수치료1" }] },
  { group:"경구제", color:"#d97706", bg:"#fffbeb",
    items:[
      { id:"meshima",name:"메시마F",custom:"qty" },{ id:"selenase_l",name:"셀레나제액상",custom:"qty" },
      { id:"selenase_t",name:"셀레나제정",custom:"qty" },{ id:"selenase_f",name:"셀레나제필름",custom:"qty" },
    ] },
];

const ALL_ITEMS = TREATMENT_GROUPS.flatMap(g => g.items);
const DAY_KO = ["일","월","화","수","목","금","토"];

const ATT_COLORS = {
  "강국형": { bg:"#dbeafe", fg:"#1d4ed8", border:"#60a5fa" },
  "이숙경": { bg:"#fce7f3", fg:"#be185d", border:"#f472b6" },
};

function pad(n) { return String(n).padStart(2, "0"); }
function toMK(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function toDK(d) { return String(d.getDate()); }
function toISOLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function parseAdmitDate(str) {
  if (!str || str === "미정") return null;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { const d = new Date(+iso[1], +iso[2]-1, +iso[3]); d.setHours(0,0,0,0); return d; }
  const m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const now = new Date();
    let y = now.getFullYear();
    const d = new Date(y, +m[1]-1, +m[2]);
    if (d.getTime() > now.getTime() + 7*24*3600*1000) { d.setFullYear(y-1); }
    d.setHours(0,0,0,0);
    return d;
  }
  return null;
}

// 주 시작(월요일)
function getMonday(d) {
  const x = new Date(d);
  const dw = x.getDay();
  x.setDate(x.getDate() + (dw === 0 ? -6 : 1 - dw));
  x.setHours(0,0,0,0);
  return x;
}

function formatSyncAgo(iso) {
  if (!iso) return "아직 없음";
  const diff = Date.now() - new Date(iso).getTime();
  if (!isFinite(diff) || diff < 0) return "—";
  const min = Math.round(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(iso).toLocaleString("ko-KR");
}

export default function TreatmentVerify() {
  useAuth(); // 로그인 체크 트리거
  const today = new Date(); today.setHours(0,0,0,0);
  const [weekStart, setWeekStart] = useState(() => getMonday(today));
  const [slots, setSlots] = useState({});
  const [treatPlans, setTreatPlans] = useState({});
  const [emrSyncTime, setEmrSyncTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterAttending, setFilterAttending] = useState(null);
  const [filterGroup, setFilterGroup] = useState(null);

  useEffect(() => {
    const unsubS = onValue(ref(wardDb, "slots"), snap => setSlots(snap.val() || {}));
    const unsubT = onValue(ref(wardDb, "treatmentPlans"), snap => { setTreatPlans(snap.val() || {}); setLoading(false); });
    const unsubE = onValue(ref(wardDb, "emrSyncLog/lastSync"), snap => setEmrSyncTime(snap.val()));
    return () => { unsubS(); unsubT(); unsubE(); };
  }, []);

  // 주 7일 날짜 목록
  const weekDates = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [weekStart]);

  const weekEnd = weekDates[6];

  // 치료별·환자별 불일치 집계
  const { mismatchEntries, emrSummary, attCounts, unassignedCount } = useMemo(() => {
    // itemId → Map<slotKey::emrType, {..., dates:[]}>
    const byItem = {};
    const summary = { match:0, plus:0, minus:0 };
    const attendingSet = { "강국형":0, "이숙경":0, "": 0 };

    for (const sk of Object.keys(slots)) {
      const current = slots[sk]?.current;
      if (!current?.name) continue;
      const attending = current?.attending || "";
      if (filterAttending && attending !== filterAttending) continue;
      attendingSet[attending] = (attendingSet[attending] || 0) + 0;

      const admit = parseAdmitDate(current.admitDate);

      for (const d of weekDates) {
        if (admit && d < admit) continue;
        const items = treatPlans[sk]?.[toMK(d)]?.[toDK(d)];
        if (!items) continue;
        for (const e of items) {
          const type =
            e.emr === "match" ? "match" :
            (e.emr === "added" || e.emr === "modified") ? "plus" :
            (e.emr === "removed" || e.emr === "missing") ? "minus" : null;
          if (!type) continue;
          summary[type]++;
          if (type === "match") continue;
          if (filterGroup) {
            const grp = TREATMENT_GROUPS.find(g => g.group === filterGroup);
            if (!grp || !grp.items.some(i => i.id === e.id)) continue;
          }
          if (!byItem[e.id]) byItem[e.id] = {};
          const key = `${sk}::${type}`;
          if (!byItem[e.id][key]) {
            const [rid, bed] = sk.split("-");
            byItem[e.id][key] = {
              slotKey: sk, roomId: rid, bedNum: bed,
              patientName: current.name, attending,
              emrType: type, dates: [],
            };
          }
          byItem[e.id][key].dates.push(toISOLocal(d));
        }
      }
    }

    // 주치의별 집계 (주 전체 기준, 필터 무관)
    const fullAtt = { "강국형":new Set(), "이숙경":new Set(), "":new Set() };
    for (const sk of Object.keys(slots)) {
      const current = slots[sk]?.current;
      if (!current?.name) continue;
      const admit = parseAdmitDate(current.admitDate);
      let hasWeekPlan = false;
      for (const d of weekDates) {
        if (admit && d < admit) continue;
        if (treatPlans[sk]?.[toMK(d)]?.[toDK(d)]?.length) { hasWeekPlan = true; break; }
      }
      if (!hasWeekPlan) continue;
      const att = current.attending || "";
      if (fullAtt[att]) fullAtt[att].add(sk);
    }

    const itemOrder = Object.fromEntries(ALL_ITEMS.map((it, i) => [it.id, i]));
    const entries = Object.entries(byItem).map(([itemId, pmap]) => {
      const pats = Object.values(pmap).sort((a,b) => a.roomId.localeCompare(b.roomId));
      return [itemId, pats];
    }).sort((a, b) => (itemOrder[a[0]] ?? 999) - (itemOrder[b[0]] ?? 999));

    return {
      mismatchEntries: entries,
      emrSummary: summary,
      attCounts: [
        { att:"강국형", count: fullAtt["강국형"].size },
        { att:"이숙경", count: fullAtt["이숙경"].size },
      ].filter(a => a.count > 0),
      unassignedCount: fullAtt[""].size,
    };
  }, [slots, treatPlans, weekDates, filterAttending, filterGroup]);

  const filterGroupCandidates = useMemo(() => {
    const set = new Set();
    for (const [itemId] of mismatchEntries) {
      const grp = TREATMENT_GROUPS.find(g => g.items.some(i => i.id === itemId));
      if (grp) set.add(grp.group);
    }
    return TREATMENT_GROUPS.filter(g => set.has(g.group));
  }, [mismatchEntries]);

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };
  const thisWeek = () => setWeekStart(getMonday(today));

  const isThisWeek = weekStart.getTime() === getMonday(today).getTime();
  const weekLabel = `${weekStart.getMonth()+1}/${weekStart.getDate()}(${DAY_KO[weekStart.getDay()]}) ~ ${weekEnd.getMonth()+1}/${weekEnd.getDate()}(${DAY_KO[weekEnd.getDay()]})`;

  const formatDateBadge = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return `${d.getMonth()+1}/${d.getDate()}`;
  };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 돌아가기</Link>
        <div style={S.titleWrap}>
          <div style={S.title}>치료계획 / EMR 검증</div>
          <div style={S.sub}>주간 불일치 현황</div>
        </div>
        <div style={S.nav}>
          <button style={S.navBtn} onClick={prevWeek}>‹ 이전</button>
          <div style={S.weekLabel}>{weekLabel}</div>
          <button style={S.navBtn} onClick={nextWeek}>다음 ›</button>
          {!isThisWeek && <button style={{...S.navBtn, background:"#065f46", color:"#6ee7b7"}} onClick={thisWeek}>이번 주</button>}
        </div>
      </header>

      <div style={S.topBar}>
        <div style={S.totalBox}>
          <div style={S.totalMain}>
            <strong style={{color:"#0ea5e9", fontSize:20}}>{mismatchEntries.length}</strong>개 치료 불일치
          </div>
          <div style={S.totalSub}>
            <span style={{color:"#10b981"}}>EMR {emrSummary.match}</span>
            <span style={{color:"#3b82f6"}}>EMR+ {emrSummary.plus}</span>
            <span style={{color:"#ef4444"}}>EMR- {emrSummary.minus}</span>
          </div>
        </div>
        <div style={S.syncBox}>
          EMR 동기화 <strong>{formatSyncAgo(emrSyncTime)}</strong>
        </div>
      </div>

      <div style={S.filterBar}>
        <div style={S.filterLine}>
          <span style={S.filterLabel}>주치의</span>
          <button style={{...S.filterBtn, ...(filterAttending===null ? S.filterBtnActive : {})}}
            onClick={() => setFilterAttending(null)}>전체</button>
          {attCounts.map(a => {
            const c = ATT_COLORS[a.att] || {bg:"#f1f5f9", fg:"#334155", border:"#cbd5e1"};
            const active = filterAttending === a.att;
            return (
              <button key={a.att}
                style={{...S.filterBtn, background: active ? c.fg : c.bg, color: active ? "#fff" : c.fg, borderColor: c.border}}
                onClick={() => setFilterAttending(active ? null : a.att)}>
                {a.att} ({a.count})
              </button>
            );
          })}
          {unassignedCount > 0 && <span style={{fontSize:11, color:"#94a3b8", marginLeft:4}}>미지정 {unassignedCount}명</span>}
        </div>
        {filterGroupCandidates.length > 0 && (
          <div style={S.filterLine}>
            <span style={S.filterLabel}>치료군</span>
            <button style={{...S.filterBtn, ...(filterGroup===null ? S.filterBtnActive : {})}}
              onClick={() => setFilterGroup(null)}>전체</button>
            {filterGroupCandidates.map(g => {
              const active = filterGroup === g.group;
              return (
                <button key={g.group}
                  style={{...S.filterBtn, background: active ? g.color : g.bg, color: active ? "#fff" : g.color, borderColor: g.color}}
                  onClick={() => setFilterGroup(active ? null : g.group)}>
                  {g.group}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <main style={S.main}>
        {loading ? (
          <div style={S.empty}>불러오는 중...</div>
        ) : mismatchEntries.length === 0 ? (
          <div style={S.empty}>이 주는 불일치 항목이 없습니다. ✓</div>
        ) : (
          <div style={S.list}>
            {mismatchEntries.map(([itemId, patients]) => {
              const item = ALL_ITEMS.find(i => i.id === itemId);
              const grp = TREATMENT_GROUPS.find(g => g.items.some(i => i.id === itemId));
              return (
                <div key={itemId} style={S.row}>
                  <span style={{...S.itemName, color: grp?.color, background: grp?.bg, borderColor: grp?.color}}>
                    {item?.name || itemId}
                  </span>
                  <div style={S.patWrap}>
                    {patients.map((p, idx) => (
                      <span key={`${p.slotKey}-${p.emrType}-${idx}`} style={S.chip}>
                        <span style={S.room}>{p.roomId}-{p.bedNum}</span>
                        <span style={S.name}>{p.patientName}</span>
                        {p.attending && ATT_COLORS[p.attending] && (
                          <span style={{...S.att, background: ATT_COLORS[p.attending].bg, color: ATT_COLORS[p.attending].fg, borderColor: ATT_COLORS[p.attending].border}}>
                            {p.attending}
                          </span>
                        )}
                        <span style={S.dates}>
                          {p.dates.map(formatDateBadge).join(", ")}
                        </span>
                        <span style={{...S.badge, background: p.emrType === "plus" ? "#3b82f6" : "#ef4444"}}>
                          {p.emrType === "plus" ? "EMR+" : "EMR-"}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const S = {
  page: { fontFamily:"'Noto Sans KR','Pretendard',sans-serif", background:"#f0f4f8", minHeight:"100vh", color:"#0f172a" },
  header: { background:"#0f2744", color:"#fff", padding:"14px 20px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", boxShadow:"0 2px 12px rgba(0,0,0,0.15)" },
  back: { background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:7, padding:"6px 14px", fontSize:13, fontWeight:600, textDecoration:"none" },
  titleWrap: { flex:1, textAlign:"center" },
  title: { fontSize:18, fontWeight:800 },
  sub: { fontSize:12, color:"#7dd3fc", marginTop:2 },
  nav: { display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" },
  navBtn: { background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#e2e8f0", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:600 },
  weekLabel: { fontSize:13, fontWeight:700, minWidth:180, textAlign:"center" },

  topBar: { background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 },
  totalBox: { display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" },
  totalMain: { fontSize:14, fontWeight:700 },
  totalSub: { display:"flex", gap:10, fontSize:12, fontWeight:700 },
  syncBox: { fontSize:12, color:"#64748b", fontWeight:600 },

  filterBar: { background:"#f8fafc", borderBottom:"1px solid #e2e8f0", padding:"10px 20px", display:"flex", flexDirection:"column", gap:6 },
  filterLine: { display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" },
  filterLabel: { fontSize:12, fontWeight:700, color:"#475569", marginRight:4 },
  filterBtn: { border:"1.5px solid #e2e8f0", borderRadius:7, padding:"3px 10px", cursor:"pointer", fontSize:12, fontWeight:700, background:"#f1f5f9", color:"#64748b" },
  filterBtnActive: { background:"#0f2744", color:"#fff", borderColor:"#0f2744" },

  main: { padding:"20px" },
  empty: { textAlign:"center", color:"#94a3b8", fontSize:15, marginTop:60 },
  list: { display:"flex", flexDirection:"column", gap:8, background:"#fffbeb", border:"1.5px solid #fbbf24", borderRadius:10, padding:"14px 16px" },
  row: { display:"flex", alignItems:"flex-start", gap:10, flexWrap:"wrap" },
  itemName: { flexShrink:0, minWidth:140, fontSize:12, fontWeight:800, borderRadius:6, padding:"6px 12px", border:"1.5px solid", textAlign:"center" },
  patWrap: { display:"flex", flexWrap:"wrap", gap:6, flex:1 },
  chip: { display:"inline-flex", alignItems:"center", gap:5, background:"#fff", border:"1px solid #fde68a", borderRadius:8, padding:"4px 9px", fontSize:12, fontWeight:700, color:"#0f172a" },
  room: { background:"#0f2744", color:"#fff", borderRadius:4, padding:"1px 6px", fontSize:10, fontWeight:700 },
  name: { fontSize:12, fontWeight:800 },
  att: { fontSize:10, fontWeight:800, borderRadius:4, padding:"1px 5px", border:"1px solid" },
  dates: { fontSize:10, color:"#78716c", fontWeight:700 },
  badge: { color:"#fff", fontSize:10, fontWeight:800, borderRadius:4, padding:"1px 6px", letterSpacing:0.2 },
};
