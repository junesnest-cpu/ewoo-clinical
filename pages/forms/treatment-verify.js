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
      { id:"meshima",name:"메시마F",custom:"qty" },
      { id:"selenase_l",name:"셀레나제",custom:"qty" },
      { id:"selenase_t",name:"세파셀렌정",custom:"qty" },
      { id:"selenase_f",name:"셀레늄필름",custom:"qty" },
    ] },
  { group:"퇴원약", color:"#92400e", bg:"#fef3c7",
    items:[
      { id:"meshima_dm",name:"메시마F(퇴원약)",custom:"qty",dischargeMed:true },
      { id:"selenase_l_dm",name:"셀레나제(퇴원약)",custom:"qty",dischargeMed:true },
      { id:"selenase_t_dm",name:"세파셀렌정(퇴원약)",custom:"qty",dischargeMed:true },
      { id:"selenase_f_dm",name:"셀레늄필름(퇴원약)",custom:"qty",dischargeMed:true },
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
  const [roomSyncTime, setRoomSyncTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterAttending, setFilterAttending] = useState(null);
  const [filterGroup, setFilterGroup] = useState(null);
  const [viewMode, setViewMode] = useState("all"); // "all" | "patient"
  const [selectedSlotKey, setSelectedSlotKey] = useState(null);

  useEffect(() => {
    const unsubS = onValue(ref(wardDb, "slots"), snap => setSlots(snap.val() || {}));
    const unsubT = onValue(ref(wardDb, "treatmentPlans"), snap => { setTreatPlans(snap.val() || {}); setLoading(false); });
    const unsubE = onValue(ref(wardDb, "emrSyncLog/lastSync"), snap => setEmrSyncTime(snap.val()));
    const unsubR = onValue(ref(wardDb, "roomSyncLog/lastSync"), snap => setRoomSyncTime(snap.val()));
    return () => { unsubS(); unsubT(); unsubE(); unsubR(); };
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

  // 치료별·날짜별 불일치 집계 (매트릭스)
  const { mismatchMatrix, itemIds, emrSummary, attCounts, unassignedCount } = useMemo(() => {
    // matrix[itemId][dateISO] = { added:[], modified:[], missing:[], room:[] }
    //   added    = EMR 추가 (EMR에만 있음, 파랑)
    //   modified = 치료실 입력사항 EMR 미반영 (수량 다름, 갈색)
    //   missing  = EMR 미입력 (치료계획엔 있는데 EMR 없음, 빨강)  ← removed/missing 통합
    //   room     = 치료실 제거 (오늘/미래만)
    const matrix = {};
    const summary = { match:0, added:0, modified:0, missing:0, room:0 };

    for (const sk of Object.keys(slots)) {
      const current = slots[sk]?.current;
      if (!current?.name) continue;
      const attending = current?.attending || "";
      if (filterAttending && attending !== filterAttending) continue;

      const admit = parseAdmitDate(current.admitDate);

      for (const d of weekDates) {
        if (admit && d < admit) continue;
        const items = treatPlans[sk]?.[toMK(d)]?.[toDK(d)];
        if (!items) continue;
        const isPast = d < today;
        const dateISO = toISOLocal(d);
        for (const e of items) {
          if (e.room === "removed" && isPast) continue;
          const type = e.room === "removed" ? "room" :
            e.emr === "match" ? "match" :
            e.emr === "added" ? "added" :
            e.emr === "modified" ? "modified" :
            (e.emr === "removed" || e.emr === "missing") ? "missing" : null;
          if (!type) continue;
          summary[type]++;
          if (type === "match") continue;
          if (filterGroup) {
            const grp = TREATMENT_GROUPS.find(g => g.group === filterGroup);
            if (!grp || !grp.items.some(i => i.id === e.id)) continue;
          }
          if (!matrix[e.id]) matrix[e.id] = {};
          if (!matrix[e.id][dateISO]) matrix[e.id][dateISO] = { added:[], modified:[], missing:[], room:[] };
          const [rid, bed] = sk.split("-");
          matrix[e.id][dateISO][type].push({
            slotKey: sk, roomId: rid, bedNum: bed,
            patientName: current.name, attending,
            qty: e.qty,
          });
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
    // 셀 내부 환자 배열은 병실순으로 정렬
    for (const itemId of Object.keys(matrix)) {
      for (const dk of Object.keys(matrix[itemId])) {
        for (const kind of ["added","modified","missing","room"]) {
          matrix[itemId][dk][kind].sort((a,b) => a.roomId.localeCompare(b.roomId));
        }
      }
    }
    const sortedIds = Object.keys(matrix).sort((a, b) => (itemOrder[a] ?? 999) - (itemOrder[b] ?? 999));

    return {
      mismatchMatrix: matrix,
      itemIds: sortedIds,
      emrSummary: summary,
      attCounts: [
        { att:"강국형", count: fullAtt["강국형"].size },
        { att:"이숙경", count: fullAtt["이숙경"].size },
      ].filter(a => a.count > 0),
      unassignedCount: fullAtt[""].size,
    };
  }, [slots, treatPlans, weekDates, filterAttending, filterGroup, today]);

  const filterGroupCandidates = useMemo(() => {
    const set = new Set();
    for (const itemId of itemIds) {
      const grp = TREATMENT_GROUPS.find(g => g.items.some(i => i.id === itemId));
      if (grp) set.add(grp.group);
    }
    return TREATMENT_GROUPS.filter(g => set.has(g.group));
  }, [itemIds]);

  // 사이드바 환자 목록 (불일치 있는 환자만, 병실순)
  const patientList = useMemo(() => {
    const arr = [];
    for (const sk of Object.keys(slots)) {
      const current = slots[sk]?.current;
      if (!current?.name) continue;
      const attending = current?.attending || "";
      if (filterAttending && attending !== filterAttending) continue;
      const admit = parseAdmitDate(current.admitDate);
      let added = 0, modified = 0, missing = 0, room = 0;
      for (const d of weekDates) {
        if (admit && d < admit) continue;
        const items = treatPlans[sk]?.[toMK(d)]?.[toDK(d)];
        if (!items) continue;
        const isPast = d < today;
        for (const e of items) {
          if (e.room === "removed" && isPast) continue;
          const t = e.room === "removed" ? "room" :
            e.emr === "match" ? "match" :
            e.emr === "added" ? "added" :
            e.emr === "modified" ? "modified" :
            (e.emr === "removed" || e.emr === "missing") ? "missing" : null;
          if (filterGroup && t && t !== "match") {
            const grp = TREATMENT_GROUPS.find(g => g.group === filterGroup);
            if (!grp || !grp.items.some(i => i.id === e.id)) continue;
          }
          if (t === "added") added++;
          else if (t === "modified") modified++;
          else if (t === "missing") missing++;
          else if (t === "room") room++;
        }
      }
      if (added + modified + missing + room === 0) continue;
      const [rid, bed] = sk.split("-");
      arr.push({ slotKey: sk, roomId: rid, bedNum: bed, name: current.name, attending, added, modified, missing, room });
    }
    return arr.sort((a,b) => a.slotKey.localeCompare(b.slotKey));
  }, [slots, treatPlans, weekDates, filterAttending, filterGroup, today]);

  // 선택 환자의 매트릭스
  const selectedMatrix = useMemo(() => {
    if (viewMode !== "patient" || !selectedSlotKey) return null;
    const sk = selectedSlotKey;
    const current = slots[sk]?.current;
    if (!current?.name) return { matrix:{}, itemIds:[], current:null };
    const admit = parseAdmitDate(current.admitDate);
    const matrix = {};
    for (const d of weekDates) {
      if (admit && d < admit) continue;
      const items = treatPlans[sk]?.[toMK(d)]?.[toDK(d)];
      if (!items) continue;
      const isPast = d < today;
      const dateISO = toISOLocal(d);
      for (const e of items) {
        if (e.room === "removed" && isPast) continue;
        const type = e.room === "removed" ? "room" :
          e.emr === "match" ? "match" :
          e.emr === "added" ? "added" :
          e.emr === "modified" ? "modified" :
          (e.emr === "removed" || e.emr === "missing") ? "missing" : null;
        if (!type || type === "match") continue;
        if (filterGroup) {
          const grp = TREATMENT_GROUPS.find(g => g.group === filterGroup);
          if (!grp || !grp.items.some(i => i.id === e.id)) continue;
        }
        if (!matrix[e.id]) matrix[e.id] = {};
        if (!matrix[e.id][dateISO]) matrix[e.id][dateISO] = { added:[], modified:[], missing:[], room:[] };
        const [rid, bed] = sk.split("-");
        matrix[e.id][dateISO][type].push({
          slotKey: sk, roomId: rid, bedNum: bed,
          patientName: current.name, attending: current.attending || "",
          qty: e.qty,
        });
      }
    }
    const itemOrder = Object.fromEntries(ALL_ITEMS.map((it, i) => [it.id, i]));
    const sortedIds = Object.keys(matrix).sort((a, b) => (itemOrder[a] ?? 999) - (itemOrder[b] ?? 999));
    return { matrix, itemIds: sortedIds, current };
  }, [viewMode, selectedSlotKey, slots, treatPlans, weekDates, filterGroup, today]);

  // 환자별 모드에서 현재 선택 환자가 목록에 없으면 자동 해제, 첫 환자 자동 선택
  useEffect(() => {
    if (viewMode !== "patient") return;
    if (!patientList.length) { if (selectedSlotKey) setSelectedSlotKey(null); return; }
    if (!selectedSlotKey || !patientList.some(p => p.slotKey === selectedSlotKey)) {
      setSelectedSlotKey(patientList[0].slotKey);
    }
  }, [viewMode, patientList, selectedSlotKey]);

  const activeMatrix = viewMode === "patient" ? (selectedMatrix?.matrix || {}) : mismatchMatrix;
  const activeItemIds = viewMode === "patient" ? (selectedMatrix?.itemIds || []) : itemIds;

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };
  const thisWeek = () => setWeekStart(getMonday(today));

  const isThisWeek = weekStart.getTime() === getMonday(today).getTime();
  const weekLabel = `${weekStart.getMonth()+1}/${weekStart.getDate()}(${DAY_KO[weekStart.getDay()]}) ~ ${weekEnd.getMonth()+1}/${weekEnd.getDate()}(${DAY_KO[weekEnd.getDay()]})`;

  const isSameDay = (a, b) => a.getTime() === b.getTime();

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
            <strong style={{color:"#0ea5e9", fontSize:20}}>{itemIds.length}</strong>개 치료 불일치
          </div>
          <div style={S.totalSub}>
            <span style={{color:"#16a34a"}}>일치 {emrSummary.match}</span>
            <span style={{color:"#2563eb"}}>EMR 추가 {emrSummary.added}</span>
            <span style={{color:"#b45309"}}>EMR 미반영 {emrSummary.modified}</span>
            <span style={{color:"#dc2626"}}>EMR 미입력 {emrSummary.missing}</span>
            {emrSummary.room > 0 && <span style={{color:"#78350f"}}>치료실 제거 {emrSummary.room}</span>}
          </div>
        </div>
        <div style={S.syncBox}>
          <div>EMR 동기화 <strong>{formatSyncAgo(emrSyncTime)}</strong></div>
          <div>치료실 동기화 <strong>{formatSyncAgo(roomSyncTime)}</strong></div>
        </div>
      </div>

      <div style={S.filterBar}>
        <div style={S.filterLine}>
          <span style={S.filterLabel}>뷰</span>
          <button style={{...S.filterBtn, ...(viewMode==="all" ? S.filterBtnActive : {})}}
            onClick={() => setViewMode("all")}>전체</button>
          <button style={{...S.filterBtn, ...(viewMode==="patient" ? S.filterBtnActive : {})}}
            onClick={() => setViewMode("patient")}>환자별 ({patientList.length})</button>
        </div>
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
        ) : (
          <div style={S.layout}>
            {viewMode === "patient" && (
              <aside style={S.sidebar}>
                <div style={S.sidebarHeader}>
                  환자 {patientList.length}명
                </div>
                <div style={S.sidebarList}>
                  {patientList.length === 0 && (
                    <div style={{fontSize:12, color:"#94a3b8", padding:"10px 12px"}}>불일치 환자 없음</div>
                  )}
                  {patientList.map(p => {
                    const active = selectedSlotKey === p.slotKey;
                    const attC = ATT_COLORS[p.attending];
                    return (
                      <button key={p.slotKey}
                        onClick={() => setSelectedSlotKey(p.slotKey)}
                        style={{...S.sidebarItem, ...(active ? S.sidebarItemActive : {})}}>
                        <div style={S.sidebarRow1}>
                          <span style={S.sidebarRoom}>{p.roomId}-{p.bedNum}</span>
                          <span style={S.sidebarName}>{p.name}</span>
                          {attC && (
                            <span style={{...S.sidebarAtt, background:attC.bg, color:attC.fg, borderColor:attC.border}}>
                              {p.attending[0]}
                            </span>
                          )}
                        </div>
                        <div style={S.sidebarRow2}>
                          {p.added > 0 && <span style={{color:"#1e40af"}}>추+{p.added}</span>}
                          {p.modified > 0 && <span style={{color:"#92400e"}}>반+{p.modified}</span>}
                          {p.missing > 0 && <span style={{color:"#991b1b"}}>미+{p.missing}</span>}
                          {p.room > 0 && <span style={{color:"#78350f"}}>실{p.room}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>
            )}

            <div style={S.tableArea}>
        {activeItemIds.length === 0 ? (
          <div style={S.empty}>
            {viewMode === "patient"
              ? (patientList.length === 0 ? "이 주는 불일치 환자가 없습니다. ✓" : "선택한 환자는 이 주 불일치 항목이 없습니다. ✓")
              : "이 주는 불일치 항목이 없습니다. ✓"}
          </div>
        ) : (
          <div style={S.tableWrap}>
            {viewMode === "patient" && selectedMatrix?.current && (
              <div style={S.patientHeader}>
                <span style={S.patientHeaderRoom}>{selectedMatrix.current && selectedSlotKey && `${selectedSlotKey.split("-")[0]}-${selectedSlotKey.split("-")[1]}`}</span>
                <span style={S.patientHeaderName}>{selectedMatrix.current.name}</span>
                {selectedMatrix.current.attending && ATT_COLORS[selectedMatrix.current.attending] && (
                  <span style={{...S.patientHeaderAtt,
                    background: ATT_COLORS[selectedMatrix.current.attending].bg,
                    color: ATT_COLORS[selectedMatrix.current.attending].fg,
                    borderColor: ATT_COLORS[selectedMatrix.current.attending].border}}>
                    {selectedMatrix.current.attending}
                  </span>
                )}
                {selectedMatrix.current.admitDate && (
                  <span style={S.patientHeaderAdmit}>입원 {selectedMatrix.current.admitDate}</span>
                )}
              </div>
            )}
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thCorner}>치료</th>
                  {weekDates.map((d, i) => {
                    const isToday = isSameDay(d, today);
                    const isPast = d < today;
                    const dow = d.getDay();
                    return (
                      <th key={i} style={{
                        ...S.thDate,
                        ...(isToday ? S.thToday : {}),
                        ...(isPast && !isToday ? S.thPast : {}),
                        ...(dow === 0 ? { color:"#dc2626" } : dow === 6 ? { color:"#2563eb" } : {}),
                      }}>
                        <div style={S.thDateNum}>{d.getMonth()+1}/{d.getDate()}</div>
                        <div style={S.thDay}>({DAY_KO[dow]})</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeItemIds.map(itemId => {
                  const item = ALL_ITEMS.find(i => i.id === itemId);
                  const grp = TREATMENT_GROUPS.find(g => g.items.some(i => i.id === itemId));
                  return (
                    <tr key={itemId}>
                      <td style={{...S.tdItem, color: grp?.color, background: grp?.bg, borderLeftColor: grp?.color}}>
                        {item?.name || itemId}
                      </td>
                      {weekDates.map((d, i) => {
                        const dateISO = toISOLocal(d);
                        const cell = activeMatrix[itemId]?.[dateISO];
                        const isToday = isSameDay(d, today);
                        const isPast = d < today;
                        return (
                          <td key={i} style={{
                            ...S.tdCell,
                            ...(isToday ? S.tdCellToday : {}),
                            ...(isPast && !isToday ? S.tdCellPast : {}),
                          }}>
                            {cell && (cell.added.length || cell.modified.length || cell.missing.length || cell.room.length) ? (
                              <div style={S.cellStack}>
                                {cell.added.length > 0 && (
                                  <div style={S.cellSection}>
                                    {cell.added.map((p, idx) => (
                                      <PatChip key={`a${idx}`} p={p} type="added" />
                                    ))}
                                  </div>
                                )}
                                {cell.modified.length > 0 && (
                                  <div style={S.cellSection}>
                                    {cell.modified.map((p, idx) => (
                                      <PatChip key={`mo${idx}`} p={p} type="modified" />
                                    ))}
                                  </div>
                                )}
                                {cell.missing.length > 0 && (
                                  <div style={S.cellSection}>
                                    {cell.missing.map((p, idx) => (
                                      <PatChip key={`mi${idx}`} p={p} type="missing" />
                                    ))}
                                  </div>
                                )}
                                {cell.room.length > 0 && (
                                  <div style={S.cellSection}>
                                    {cell.room.map((p, idx) => (
                                      <PatChip key={`r${idx}`} p={p} type="room" />
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={S.legend}>
              <span style={{...S.legendItem, background:"#dcfce7", color:"#166534", borderColor:"#86efac"}}>
                EMR 일치
              </span>
              <span style={{...S.legendItem, background:"#dbeafe", color:"#1e40af", borderColor:"#60a5fa"}}>
                EMR 추가 (EMR에만 있음)
              </span>
              <span style={{...S.legendItem, background:"#fef3c7", color:"#92400e", borderColor:"#d97706"}}>
                치료실 입력 EMR 미반영 (수량 불일치)
              </span>
              <span style={{...S.legendItem, background:"#fee2e2", color:"#991b1b", borderColor:"#fca5a5"}}>
                EMR 미입력 (EMR에 없음)
              </span>
              {emrSummary.room > 0 && (
                <span style={{...S.legendItem, background:"#fef9c3", color:"#78350f", borderColor:"#fde047"}}>
                  치료실 제거
                </span>
              )}
            </div>
          </div>
        )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const CHIP_COLORS = {
  added:    { bg:"#dbeafe", fg:"#1e40af", bd:"#60a5fa" }, // 파랑 · EMR 추가
  modified: { bg:"#fef3c7", fg:"#92400e", bd:"#d97706" }, // 갈색 · 치료실 입력 EMR 미반영
  missing:  { bg:"#fee2e2", fg:"#991b1b", bd:"#fca5a5" }, // 빨강 · EMR 미입력
  room:     { bg:"#fef9c3", fg:"#78350f", bd:"#fde047" }, // 연노랑 · 치료실 제거
};

function PatChip({ p, type }) {
  const c = CHIP_COLORS[type] || CHIP_COLORS.missing;
  const { bg, fg, bd } = c;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:bg, color:fg,
      border:`1px solid ${bd}`, borderRadius:5, padding:"1px 4px", fontSize:10, fontWeight:700, lineHeight:1.3 }}>
      <span style={{ background:fg, color:"#fff", borderRadius:3, padding:"0 3px", fontSize:9 }}>
        {p.roomId}-{p.bedNum}
      </span>
      <span>{p.patientName}</span>
      {p.qty != null && p.qty !== "" && (
        <span style={{ background:"#fff", color:fg, border:`1px solid ${bd}`,
          borderRadius:3, padding:"0 4px", fontSize:9, fontWeight:800 }}>
          {p.qty}개
        </span>
      )}
      {p.attending && ATT_COLORS[p.attending] && (
        <span style={{
          background: ATT_COLORS[p.attending].fg, color:"#fff",
          borderRadius:3, padding:"0 3px", fontSize:8, fontWeight:800
        }}>
          {p.attending[0]}
        </span>
      )}
    </span>
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

  layout: { display:"flex", gap:14, alignItems:"flex-start" },
  sidebar: { width:200, flexShrink:0, background:"#fff", border:"1px solid #e2e8f0", borderRadius:10,
    boxShadow:"0 1px 3px rgba(0,0,0,0.04)", overflow:"hidden", maxHeight:"calc(100vh - 220px)", display:"flex", flexDirection:"column" },
  sidebarHeader: { background:"#0f2744", color:"#fff", fontSize:12, fontWeight:800,
    padding:"10px 12px", textAlign:"center" },
  sidebarList: { overflowY:"auto", flex:1, padding:6, display:"flex", flexDirection:"column", gap:3 },
  sidebarItem: { textAlign:"left", background:"#f8fafc", border:"1.5px solid transparent",
    borderRadius:7, padding:"6px 8px", cursor:"pointer", display:"flex", flexDirection:"column", gap:2, fontFamily:"inherit" },
  sidebarItemActive: { background:"#e0f2fe", borderColor:"#0284c7" },
  sidebarRow1: { display:"flex", alignItems:"center", gap:5, fontSize:12 },
  sidebarRow2: { display:"flex", gap:6, fontSize:11, fontWeight:800, marginLeft:2 },
  sidebarRoom: { background:"#0f2744", color:"#fff", borderRadius:3, padding:"1px 5px", fontSize:10, fontWeight:700 },
  sidebarName: { fontWeight:800, color:"#0f172a" },
  sidebarAtt: { fontSize:9, fontWeight:800, borderRadius:3, padding:"0 4px", border:"1px solid", marginLeft:"auto" },

  tableArea: { flex:1, minWidth:0 },
  patientHeader: { display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
    borderBottom:"1px solid #e2e8f0", background:"#f8fafc", flexWrap:"wrap" },
  patientHeaderRoom: { background:"#0f2744", color:"#fff", borderRadius:5, padding:"2px 8px", fontSize:12, fontWeight:800 },
  patientHeaderName: { fontSize:15, fontWeight:800, color:"#0f172a" },
  patientHeaderAtt: { fontSize:11, fontWeight:800, borderRadius:5, padding:"2px 7px", border:"1px solid" },
  patientHeaderAdmit: { fontSize:11, color:"#64748b", fontWeight:700, marginLeft:"auto" },

  tableWrap: { overflowX:"auto", background:"#fff", borderRadius:10, border:"1px solid #e2e8f0", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" },
  table: { width:"100%", borderCollapse:"separate", borderSpacing:0, minWidth:720 },
  thCorner: { position:"sticky", left:0, top:0, zIndex:3, background:"#0f2744", color:"#fff",
    fontSize:12, fontWeight:800, padding:"10px 12px", textAlign:"center", borderBottom:"2px solid #0f2744",
    minWidth:130, width:130 },
  thDate: { position:"sticky", top:0, zIndex:2, background:"#0f2744", color:"#e2e8f0",
    fontSize:12, fontWeight:700, padding:"8px 4px", textAlign:"center",
    borderLeft:"1px solid rgba(255,255,255,0.15)", borderBottom:"2px solid #0f2744", minWidth:110 },
  thToday: { background:"#0369a1", color:"#fff" },
  thPast: { background:"#334155", color:"#cbd5e1" },
  thDateNum: { fontSize:13, fontWeight:800 },
  thDay: { fontSize:10, fontWeight:700, opacity:0.85, marginTop:1 },

  tdItem: { position:"sticky", left:0, zIndex:1, fontSize:12, fontWeight:800, textAlign:"center",
    padding:"8px 10px", borderBottom:"1px solid #e2e8f0", borderLeft:"3px solid transparent",
    minWidth:130, width:130, background:"#fff" },
  tdCell: { verticalAlign:"top", padding:4, borderBottom:"1px solid #e2e8f0",
    borderLeft:"1px solid #e2e8f0", minWidth:110, background:"#fff" },
  tdCellToday: { background:"#f0f9ff" },
  tdCellPast: { background:"#f8fafc" },

  cellStack: { display:"flex", flexDirection:"column", gap:3 },
  cellSection: { display:"flex", flexWrap:"wrap", gap:2 },

  legend: { display:"flex", gap:8, flexWrap:"wrap", padding:"10px 14px", borderTop:"1px solid #e2e8f0", background:"#f8fafc" },
  legendItem: { fontSize:11, fontWeight:700, border:"1px solid", borderRadius:6, padding:"3px 8px" },
};
