import { createClient } from 'npm:@supabase/supabase-js@2.108.2';

type Result = {
  status: 'normal' | 'possible_fall' | 'fall' | 'uncertain';
  confidence: number;
  reason: string;
  peopleCount: number;
  subjectContinuity: 'single_continuous_person' | 'multiple_people' | 'uncertain';
  detections: PersonDetection[];
};

type PersonDetection = {
  label: 'person';
  state: 'normal' | 'possible_fall' | 'fall' | 'uncertain';
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const normalizedNumber = { type: 'number', minimum: 0, maximum: 1 };

const resultSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['normal', 'possible_fall', 'fall', 'uncertain'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    peopleCount: { type: 'integer', minimum: 0, maximum: 20 },
    subjectContinuity: { type: 'string', enum: ['single_continuous_person', 'multiple_people', 'uncertain'] },
    detections: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', enum: ['person'] },
          state: { type: 'string', enum: ['normal', 'possible_fall', 'fall', 'uncertain'] },
          confidence: normalizedNumber,
          x: normalizedNumber,
          y: normalizedNumber,
          width: normalizedNumber,
          height: normalizedNumber,
        },
        required: ['label', 'state', 'confidence', 'x', 'y', 'width', 'height'],
      },
    },
  },
  required: ['status', 'confidence', 'reason', 'peopleCount', 'subjectContinuity', 'detections'],
};

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && (
    value.startsWith('data:image/jpeg;base64,') ||
    value.startsWith('data:image/png;base64,')
  );
}

function isResult(value: unknown): value is Result {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    (data.status === 'normal' || data.status === 'possible_fall' ||
      data.status === 'fall' || data.status === 'uncertain') &&
    typeof data.confidence === 'number' && Number.isFinite(data.confidence) &&
    data.confidence >= 0 && data.confidence <= 1 && typeof data.reason === 'string' &&
    Number.isSafeInteger(data.peopleCount) && Number(data.peopleCount) >= 0 && Number(data.peopleCount) <= 20 &&
    (data.subjectContinuity === 'single_continuous_person' ||
      data.subjectContinuity === 'multiple_people' || data.subjectContinuity === 'uncertain') &&
    (data.peopleCount === 1 || data.subjectContinuity !== 'single_continuous_person') &&
    Array.isArray(data.detections) && data.detections.length <= 20 &&
    data.detections.every(isPersonDetection)
  );
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPersonDetection(value: unknown): value is PersonDetection {
  if (typeof value !== 'object' || value === null) return false;
  const detection = value as Record<string, unknown>;
  return detection.label === 'person' &&
    (detection.state === 'normal' || detection.state === 'possible_fall' ||
      detection.state === 'fall' || detection.state === 'uncertain') &&
    isNormalizedNumber(detection.confidence) && isNormalizedNumber(detection.x) &&
    isNormalizedNumber(detection.y) && isNormalizedNumber(detection.width) &&
    isNormalizedNumber(detection.height) &&
    Number(detection.width) > 0 && Number(detection.height) > 0 &&
    Number(detection.x) + Number(detection.width) <= 1 &&
    Number(detection.y) + Number(detection.height) <= 1;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const providerKey = Deno.env.get('VISION_API_KEY');
  const providerUrl = Deno.env.get('VISION_API_URL');
  const apiStyle = Deno.env.get('VISION_API_STYLE');
  const model = Deno.env.get('VISION_MODEL');
  const instructions = Deno.env.get('VISION_INSTRUCTIONS');
  const maxImageLength = Number(Deno.env.get('AI_MAX_IMAGE_DATA_LENGTH'));
  if (!supabaseUrl || !publishableKey || !providerKey || !providerUrl ||
      (apiStyle !== 'responses' && apiStyle !== 'chat_completions') || !model || !instructions ||
      !Number.isInteger(maxImageLength) || maxImageLength <= 0) {
    return json({ error: 'AI service is not configured' }, 503);
  }
  try {
    if (new URL(providerUrl).protocol !== 'https:') return json({ error: 'AI endpoint must use HTTPS' }, 503);
  } catch {
    return json({ error: 'AI endpoint is invalid' }, 503);
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid request body' }, 400);
  }
  const { cameraId, currentImage, previousImage } = body;
  if (typeof cameraId !== 'string' || !isImageDataUrl(currentImage) ||
      currentImage.length > maxImageLength ||
      (previousImage !== undefined && (!isImageDataUrl(previousImage) || previousImage.length > maxImageLength))) {
    return json({ error: 'Invalid camera image' }, 400);
  }

  const { data: camera, error: cameraError } = await supabase
    .from('cameras').select('id').eq('id', cameraId).maybeSingle();
  if (cameraError || !camera) return json({ error: 'Camera unavailable' }, 403);

  // A single still image cannot establish the motion of a fall.
  if (!previousImage) {
    return json({
      status: 'uncertain', confidence: 0, reason: 'ต้องมีภาพต่อเนื่องอย่างน้อยสองภาพ',
      peopleCount: 0, subjectContinuity: 'uncertain', detections: [],
    } satisfies Result);
  }

  try {
    const requestBody = apiStyle === 'responses' ? {
      model,
      store: false,
      instructions,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'ภาพก่อนหน้า' },
          { type: 'input_image', image_url: previousImage },
          { type: 'input_text', text: 'ภาพล่าสุด ตรวจคนทุกคนและส่งกรอบ detections ของภาพนี้ พิกัด x y width height ใช้ค่า 0 ถึง 1 วัดจากมุมซ้ายบน กรอบต้องคลุมร่างแต่ละคนให้พอดี' },
          { type: 'input_image', image_url: currentImage },
        ],
      }],
      text: {
        format: { type: 'json_schema', name: 'fall_analysis', strict: true, schema: resultSchema },
      },
    } : {
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: [
          { type: 'text', text: 'ภาพก่อนหน้า' },
          { type: 'image_url', image_url: { url: previousImage } },
          { type: 'text', text: 'ภาพล่าสุด ตรวจคนทุกคนและส่งกรอบ detections ของภาพนี้ พิกัด x y width height ใช้ค่า 0 ถึง 1 วัดจากมุมซ้ายบน กรอบต้องคลุมร่างแต่ละคนให้พอดี' },
          { type: 'image_url', image_url: { url: currentImage } },
        ] },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'fall_analysis', strict: true, schema: resultSchema },
      },
    };
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${providerKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) return json({ error: 'AI provider unavailable' }, 502);
    const providerData = await response.json();
    const outputText = apiStyle === 'responses'
      ? providerData.output?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content || [])
        .find((item: { type: string }) => item.type === 'output_text')?.text
      : providerData.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string') return json({ error: 'AI provider returned no result' }, 502);
    const result: unknown = JSON.parse(outputText);
    if (!isResult(result)) return json({ error: 'AI provider returned invalid data' }, 502);
    return json(result);
  } catch {
    return json({ error: 'AI analysis failed' }, 502);
  }
});
