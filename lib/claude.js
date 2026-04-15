/**
 * Claude API 클라이언트 — 의료 서식 요약용
 */
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 치료일정표 치료 → 소견서 설명 매핑 (EMR 처방명 키워드 → 설명)
const TREATMENT_DESCRIPTIONS = {
  '자닥신|이뮤알파|싸이원|thymosin|티모신': {
    title: 'thymosin α1: 자닥신주사 또는 이뮤알파주',
    desc: '이 주사제는 보건복지부 분류상 항종양면역치료제로 분류되며 면역조절 세포인자인 IL-2, 인터페론감마의 분비를 증가시키며 T cell과 B cell 의 활성화를 돕고, 대표적인 암 공격 세포인 cytotoxic T cell과 NK cell 을 활성화시켜 암세포를 파괴하는 작용을 함. 또한 암 세포 감수성을 증가(암세포 표면 단백질 MHC I 활성화)시켜 감염된 세포나 돌연변이 된 암 조직에 직접 작용하여 암세포 복제를 저해하고 성장을 억제하여 궁극적으로 생존기간의 연장 및 암에 대한 직접적 치료 효과가 있음.',
  },
  '고주파|온열|hyperthermia|oncothermia': {
    title: '고주파온열암요법',
    desc: '고주파온열암요법(oncothermia)은 열을 이용한 항암요법으로 치료 시 고주파의 열에너지는 종양을 42.5도까지 온도상승을 유발시킵니다. 고주파를 인체에 투여 시 대사와 세포분열이 활발한 암세포주변에 분포하는 전해질의 양이 정상세포보다 월등해 암세포주변에 고주파열에너지가 집중이 되면 치료기간인 60분동안 세포막 안과 밖에 온도차이가 발생하고 이 온도차에 의해 세포막의 불안정성과 변성이 유발되어 세포막이 파괴 되는 작용원리를 이용한 장비입니다. 또한, 종양조직의 신생혈관내 미세혈전을 유도하여 치료횟수가 반복될수록 종양으로 가는 신생혈관이 미세혈전에 의해 혈류흐름이 차단되고 종양의 에너지대사가 차단되게 됩니다.',
  },
  '메시마': {
    title: '메시마F(메시마에프액)',
    desc: '복지부 의약품 분류 항악성종양제(421)로 구분된 전문의약품으로서 주성분인 Phellinus Linteus가 암수술 및 항암치료로 저하된 T-Lymphocyte 수치를 상승시켜 면역상승작용과 Complement system, macrophage, T cell, B cell, NK cell 활성화 등 관련된 인체내 Immunity를 강화하며, Interleukin, interferon등의 cytokine 생산을 촉진함으로 항종양, 항암효과를 보여 미세, 잔존암 제거 및 종양세포 성장 정지작용을 합니다.',
  },
  '이스카도|미슬토|mistletoe': {
    title: '미슬토: 이스카도주사',
    desc: '1) 세포독성효과 : 종양세포의 성장을 억제시킵니다. 미슬토렉틴은 세포소멸과 면역조절에 관여하고 비스코톡신은 세포괴사의 기전을 이용하여 암세포를 파괴시킵니다.\n2) 면역조절효과 : 미슬토렉틴과 미슬토 추출물이 IL-1, IL-2, IL-6, TNF-α, IFN-γ의 활성을 향상시켜 helper T cell 의 증식을 유도합니다.\n3) β-endorphin 분비 : 미슬토 주사액 투여후 관찰되는 β-endorphin 의 증가는 암환자의 삶의 질 향상에 기여합니다.',
  },
  '도수치료|도수': {
    title: '도수치료',
    desc: '항암 치료 환자에서 도수치료는 치료 과정 중 발생하는 통증과 기능 저하를 완화하기 위한 보조적 재활 치료로 수술 및 방사선 치료 후 생기는 관절 가동성 감소와 근막 긴장을 개선해 통증을 감소시키며, 유방암 환자의 경우 림프절 절제 후 발생할 수 있는 림프부종의 예방과 관리에도 도움을 줍니다. 근력 감소와 관절 경직을 개선하여 일상생활 기능 회복을 도와주며 또한 피로와 스트레스를 완화해 전반적인 삶의 질 향상에 기여합니다.',
  },
  '페인스크|pain.*scrambler|스크램블러': {
    title: '페인스크럼블러 : 비침습적 무통증 신호요법',
    desc: '페인스크럼블러는 체외전극패드를 통해 우리의 뇌로 인공적인 무통증 신경정보를 생성하고 전달하여 통증을 완화시키는 치료로 한국식약처(2011) 및 미국 FDA(2009), 유럽CE(2008)등 국내외 전문기관으로부터 안전성을 인정받았으며 2013년 보건복지부로부터 신의료기술로 인정받은 치료로 암성통증, 수술후통증, 화학요법으로인한 말초신경병증, 난치성통증등에 적용하기위한 치료방법임.',
  },
  '셀레늄|셀레나제|세파셀렌|selenium': {
    title: '셀레늄:세파셀렌정',
    desc: '셀레늄은 25가지가넘는 효소의 구성요소로서 항산화, 항염증, 갑상선호르몬 안정화작용을 하는 필수미량원소로 유리 라디칼 제거, 면역자극, 항종양효과(p53 활성화를 통한 암세포 자연사 유도, 신생혈관 억제, CDB 활성화, NF-kappaB 활성화 억제, 암세포내 셀레노디글루타치온 합성 증가로 유리 라디칼 증가에 따른 세포 독성효과)를 가지고 있어 암치료에 효과적으로 사용되고 있음. 또한 이 약은 유방암 또는 기타 다른 종양의 임파선 전이로 인한 부종에 효능이 있음.',
  },
  '글루타티온|글루타치온|디톡시온|glutathione': {
    title: '디톡시온주(글루타티온)',
    desc: '항산화 및 해독 작용을 하는 주사제로 항암치료로 인한 간 기능 저하 및 산화 스트레스를 완화하는 목적으로 사용됩니다.',
  },
};

/** 환자 치료 데이터에서 매칭되는 치료 설명만 추출 */
function matchTreatmentDescriptions(treatments) {
  const names = treatments.map(t => t.name).join('|');
  const matched = [];
  for (const [keywords, info] of Object.entries(TREATMENT_DESCRIPTIONS)) {
    const re = new RegExp(keywords, 'i');
    if (re.test(names)) {
      matched.push(`<${info.title}>\n${info.desc}`);
    }
  }
  return matched;
}

function buildMedicalOpinionPrompt(patientData) {
  const matchedDescs = matchTreatmentDescriptions(patientData?.treatments || []);

  const treatmentSection = matchedDescs.length > 0
    ? `### 2. 치료 설명 섹션
각 치료마다 <치료명> 소제목 아래 해당 치료의 의학적 설명을 기재합니다.
아래는 이 환자에게 해당하는 치료별 표준 설명입니다. 그대로 사용하세요.

${matchedDescs.join('\n\n')}`
    : '### 2. 치료 설명 섹션\n환자 데이터에 치료 항목이 없으므로 이 섹션은 생략합니다.';

  return `당신은 이우요양병원 소견서의 "내용" 부분을 작성하는 의료 AI입니다.
아래 형식에 맞춰 한국어로 작성하세요. "내용" 영역의 텍스트만 생성합니다.

## 작성 형식

### 1. 도입부 (1~3문장)
- 첫 문장: "상환 [진단명] 진단으로 【이전 치료 병원】에서 【이전 치료 내역(항암화학치료, 수술, 방사선치료 등)】 후 [현재 상태]입니다."
  또는: "[암종]으로 수술하신후 【후속치료(항호르몬치료, 방사선치료 등)】 중인 환자분으로 general weakness를 주소로 입원함."
- 이어서: "본원 입원하여 암에 대한 직접 치료 및 재발 방지 목적으로 [본원 치료 목록을 나열]. 추후 지속적인 경과관찰이 필요합니다."

${treatmentSection}

### 3. 경과기록(SOAP) 및 처방메모 활용
- 환자 데이터에 progressNotes(경과기록/SOAP)가 있으면 환자 상태, 주소증, 치료 경과를 파악하는 데 참고하세요.
- prescriptionMemos(처방메모)가 있으면 약제 변경, 치료 세부사항 등을 파악하는 데 참고하세요.
- 경과기록이나 처방메모에서 이전 치료 병원, 수술 이력, 항암 치료 이력 등이 확인되면 【】 없이 직접 기재하세요.

## 주의사항
- "내용" 영역의 텍스트만 생성하세요.
- 사용자가 편집해야 하는 부분(이전 병원명, 이전 치료 내역 등 EMR에서 확인 불가한 정보)은 반드시 【】로 감싸세요. 예: 【○○병원】, 【항암화학치료 6차】
- 경과기록이나 메모에서 확인된 정보는 【】없이 그대로 작성하세요.
- 문장은 간결하고 의학적으로 정확하게 작성하세요.`;
}

/**
 * 환자 데이터를 기반으로 서식 초안 생성
 * @param {string} formType - 서식 종류 (admission_summary, discharge_summary, rounding, opinion 등)
 * @param {object} patientData - EMR에서 가져온 환자 데이터
 * @param {string} additionalContext - 외부 검사결과 등 추가 컨텍스트
 * @returns {string} AI가 생성한 서식 초안
 */
export async function generateFormDraft(formType, patientData, additionalContext = '') {
  const systemPrompts = {
    // 의과
    admission_summary: '당신은 병원 의과 전문의의 입원 요약지 작성을 돕는 의료 AI입니다. EMR 데이터를 바탕으로 입원 요약지 초안을 한국어로 작성하세요. 주소(Chief Complaint), 현병력(Present Illness), 과거력(Past History), 신체검사(Physical Examination), 검사결과(Lab Findings), 치료계획(Treatment Plan)을 포함하세요.',
    discharge_summary: '당신은 퇴원 요약지 작성을 돕는 의료 AI입니다. 입원 기간 중 시행한 치료, 검사결과 변화, 퇴원 시 상태, 퇴원 후 계획을 한국어로 정리하세요.',
    medical_opinion: null, // 동적 생성 — buildMedicalOpinionPrompt() 사용
    doctor_rounding: '당신은 병동 라운딩 체크리스트 작성을 돕는 의료 AI입니다. 각 환자의 현재 상태, 바이탈, 주요 이슈를 간결하게 한국어로 요약하세요.',
    // 간호과
    nurse_rounding: '당신은 간호과 환자 라운딩 체크를 돕는 의료 AI입니다. 각 환자의 간호 관찰 사항, 호소 증상, 주의 사항을 한국어로 정리하세요.',
    vital_check: '당신은 바이탈 체크지 분석을 돕는 의료 AI입니다. 바이탈 사인 추이를 분석하고 이상치가 있으면 알려주세요.',
    nursing_record: '당신은 간호기록지 작성을 돕는 의료 AI입니다. SBAR(Situation, Background, Assessment, Recommendation) 형식으로 간호기록 초안을 한국어로 작성하세요.',
    handoff_summary: '당신은 병동 인계사항 요약을 돕는 의료 AI입니다. 인계가 필요한 핵심 사항을 우선순위별로 한국어로 정리하세요.',
  };

  const systemPrompt = formType === 'medical_opinion'
    ? buildMedicalOpinionPrompt(patientData)
    : (systemPrompts[formType] || '당신은 의료 서식 작성을 돕는 AI입니다.');

  const userMessage = [
    '아래 환자 데이터를 바탕으로 서식 초안을 작성해주세요.',
    '',
    '## 환자 데이터 (EMR)',
    JSON.stringify(patientData, null, 2),
    additionalContext ? `\n## 외부 검사결과\n${additionalContext}` : '',
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].text;
}
