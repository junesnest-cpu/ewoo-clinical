/**
 * Claude API 클라이언트 — 의료 서식 요약용
 */
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    medical_opinion: '당신은 소견서 작성을 돕는 의료 AI입니다. 환자의 현재 상태, 진단명, 치료 경과를 근거로 의학적 소견을 한국어로 작성하세요.',
    doctor_rounding: '당신은 병동 라운딩 체크리스트 작성을 돕는 의료 AI입니다. 각 환자의 현재 상태, 바이탈, 주요 이슈를 간결하게 한국어로 요약하세요.',
    // 간호과
    nurse_rounding: '당신은 간호과 환자 라운딩 체크를 돕는 의료 AI입니다. 각 환자의 간호 관찰 사항, 호소 증상, 주의 사항을 한국어로 정리하세요.',
    vital_check: '당신은 바이탈 체크지 분석을 돕는 의료 AI입니다. 바이탈 사인 추이를 분석하고 이상치가 있으면 알려주세요.',
    nursing_record: '당신은 간호기록지 작성을 돕는 의료 AI입니다. SBAR(Situation, Background, Assessment, Recommendation) 형식으로 간호기록 초안을 한국어로 작성하세요.',
    handoff_summary: '당신은 병동 인계사항 요약을 돕는 의료 AI입니다. 인계가 필요한 핵심 사항을 우선순위별로 한국어로 정리하세요.',
  };

  const systemPrompt = systemPrompts[formType] || '당신은 의료 서식 작성을 돕는 AI입니다.';

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
