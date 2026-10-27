// Builds the two Bolna agents (POST /v2/agent bodies) and their custom functions. Used by
// scripts/setup-agents.ts; kept here so the shapes are type-checked and tested.

import {
  CALLER_PROMPT,
  CALLER_RULES,
  CALLER_WELCOME,
  DESK_PROMPT,
  DESK_WELCOME,
  VOICE_RULES,
} from './prompts';

export interface AgentSetup {
  /** Public URL of the deployed Worker, without a trailing slash. */
  workerUrl: string;
  /** The custom LLM's name as registered in Bolna. */
  llmModel: string;
  toolSecret: string;
  webhookSecret: string;
  voice: { id: string; name: string };
}

interface ToolSpec {
  name: string;
  description: string;
  preCallMessage: string;
  params: Record<string, { type: 'string' | 'number'; description: string }>;
  required: string[];
}

const DESK_TOOLS: ToolSpec[] = [
  {
    name: 'update_order',
    description:
      'Save any order details the buyer has just said: item, quantity, unit, quality, delivery date or area. Call it every time you learn something new, with only the fields you heard.',
    preCallMessage: '',
    params: {
      request_ref: { type: 'string', description: 'The REQUEST_REF from your instructions.' },
      item: { type: 'string', description: 'What to buy, e.g. "red onions".' },
      quantity: { type: 'number', description: 'How much, as a number.' },
      unit: { type: 'string', description: 'kilo, litre, piece, dozen, quintal or pack.' },
      quality: { type: 'string', description: 'Grade or quality, if the buyer said one.' },
      deliver_by: { type: 'string', description: 'Delivery date as YYYY-MM-DD.' },
      area: { type: 'string', description: 'Delivery area, e.g. "Indiranagar".' },
    },
    required: ['request_ref'],
  },
  {
    name: 'start_calls',
    description:
      'Start calling the suppliers. Call it only after the buyer has clearly said yes to the order you read back.',
    preCallMessage: 'एक second जी।',
    params: {
      request_ref: { type: 'string', description: 'The REQUEST_REF from your instructions.' },
    },
    required: ['request_ref'],
  },
];

const CALLER_TOOLS: ToolSpec[] = [
  {
    name: 'save_quote',
    description:
      "Save the supplier's quote. Call it only after you read the quote back and the supplier confirmed it. Use their exact numbers.",
    preCallMessage: '',
    params: {
      call_ref: { type: 'string', description: 'The CALL_REF from your instructions.' },
      price: {
        type: 'number',
        description: 'The price in rupees, exactly as the supplier said it.',
      },
      unit: {
        type: 'string',
        description: 'What the price is for: kilo, litre, piece, dozen, quintal or pack.',
      },
      pack_size: {
        type: 'number',
        description: 'If priced per pack, tin or bag: how much one holds, e.g. 15.',
      },
      pack_unit: {
        type: 'string',
        description: 'If priced per pack: the unit inside it, e.g. litre.',
      },
      min_quantity: {
        type: 'number',
        description: 'Minimum order the supplier asked for, in the same unit as the price.',
      },
      delivery_date: { type: 'string', description: 'When they can deliver, as YYYY-MM-DD.' },
      delivery_charge: {
        type: 'number',
        description: 'Delivery charge in rupees for the whole order; 0 if free.',
      },
      payment_terms: {
        type: 'string',
        description: 'Payment terms, e.g. "cash on delivery" or "7 days credit".',
      },
      supplier_words: {
        type: 'string',
        description: "A short quote of the supplier's own words about the price.",
      },
    },
    required: ['call_ref', 'price', 'unit', 'supplier_words'],
  },
  {
    name: 'do_not_call',
    description:
      'The supplier asked never to be called again. Call it, apologise, and end the call.',
    preCallMessage: '',
    params: { call_ref: { type: 'string', description: 'The CALL_REF from your instructions.' } },
    required: ['call_ref'],
  },
];

const paramTemplate = (spec: ToolSpec) =>
  Object.fromEntries(Object.keys(spec.params).map((key) => [key, `%(${key})s`]));

function apiTools(specs: ToolSpec[], setup: AgentSetup) {
  return {
    tools: specs.map((spec) => ({
      name: spec.name,
      key: 'custom_task',
      description: spec.description,
      pre_call_message: spec.preCallMessage,
      parameters: { type: 'object', properties: spec.params, required: spec.required },
    })),
    tools_params: Object.fromEntries(
      specs.map((spec) => [
        spec.name,
        {
          method: 'POST',
          url: `${setup.workerUrl}/tools/${spec.name}`,
          api_token: `Bearer ${setup.toolSecret}`,
          param: JSON.stringify(paramTemplate(spec)),
        },
      ]),
    ),
  };
}

/** The tools as an OpenAI chat-completions `tools` list, as Bolna passes them to the LLM. */
export function openAiTools(kind: 'desk' | 'caller') {
  return (kind === 'desk' ? DESK_TOOLS : CALLER_TOOLS).map((spec) => ({
    type: 'function' as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: { type: 'object', properties: spec.params, required: spec.required },
    },
  }));
}

/** The same tools in the dashboard's "Write manually" custom-function format, for pasting by hand. */
export function dashboardTools(kind: 'desk' | 'caller', setup: AgentSetup) {
  return (kind === 'desk' ? DESK_TOOLS : CALLER_TOOLS).map((spec) => ({
    name: spec.name,
    description: spec.description,
    pre_call_message: spec.preCallMessage,
    parameters: { type: 'object', properties: spec.params, required: spec.required },
    key: 'custom_task',
    value: {
      method: 'POST',
      param: paramTemplate(spec),
      url: `${setup.workerUrl}/tools/${spec.name}`,
      api_token: `Bearer ${setup.toolSecret}`,
      headers: {},
    },
  }));
}

// ---- Voices and languages -------------------------------------------------------------------

const transcriber = {
  provider: 'sarvam',
  model: 'saaras:v4',
  language: 'hi',
  stream: true,
  encoding: 'linear16',
  sampling_rate: 16000,
  endpointing: 250,
};

const synthesizer = (setup: AgentSetup) => ({
  provider: 'sarvam',
  provider_config: {
    voice: setup.voice.name,
    voice_id: setup.voice.id,
    model: 'bulbul:v4-flash',
    language: 'hi',
  },
  stream: true,
  buffer_size: 150,
  audio_format: 'wav',
});

// Bulbul v3 voices work in every Sarvam language, so English and Kannada share one.
const v3Voice = {
  provider: 'sarvam',
  provider_config: { voice: 'Priya', voice_id: 'priya', model: 'bulbul:v3' },
};

/** Hindi first; switches when the other person speaks English or Kannada (Bolna's multilingual_config). */
const multilingual = (setup: AgentSetup) => ({
  enabled: true,
  active_language: 'hi',
  language_switch_trigger: 'requested_or_auto_detected',
  languages: {
    hi: {
      synthesizer: {
        provider: 'sarvam',
        provider_config: {
          voice: setup.voice.name,
          voice_id: setup.voice.id,
          model: 'bulbul:v4-flash',
        },
      },
      handoff_message: 'ठीक है जी, हिंदी में बात करते हैं।',
    },
    en: {
      transcriber: { language: 'en' },
      synthesizer: v3Voice,
      handoff_message: 'Sure, let us continue in English.',
    },
    kn: {
      transcriber: { language: 'kn' },
      synthesizer: v3Voice,
      handoff_message: 'ಸರಿ ಸರ್, ಕನ್ನಡದಲ್ಲಿ ಮಾತಾಡೋಣ.',
    },
  },
});

const customLlm = (setup: AgentSetup) => ({
  provider: 'custom',
  model: setup.llmModel,
  base_url: `${setup.workerUrl}/v1`,
  family: 'openai',
  // Room for a reasoning model's short thinking as well as the reply; replies stay short anyway.
  max_tokens: 400,
  temperature: 0.3,
});

// ---- The Caller as a Graph Agent (optional: npm run agents:setup -- --graph) ----------------

/**
 * The same call as CALLER_PROMPT, split into steps. Every step's LLM call still goes to our
 * endpoint, and `agent_information` carries CALL_REF, so the lie-catcher works unchanged.
 * Routing between steps uses Bolna's routing LLM; add a Groq key in Bolna so it runs on Groq.
 */
export function callerGraph(setup: AgentSetup) {
  const agentInformation = `You are Bhaav, an AI assistant calling {{supplier_name}} on behalf of {{buyer_name}}.
CALL_REF: {{call_ref}}
ROUND: {{round}}
The order: {{quantity}} of {{item}} ({{quality}}), delivered to {{area}} by {{deliver_by}}.
Offer for this call: {{best_offer}}
Start in {{language}}. If the supplier switches language, switch with them.

${CALLER_RULES}

${VOICE_RULES}`;

  return {
    ...customLlm(setup),
    agent_information: agentInformation,
    routing_instructions:
      'This is round {{round}} of a supplier call; round 2 includes a counter-offer of {{best_offer}}, round 3 confirms the buyer chose this supplier. Move on only when the step is complete.',
    current_node_id: 'greet',
    variable_types: { round: 'string' },
    nodes: [
      {
        id: 'greet',
        prompt:
          'Ask if they have two minutes for a quick rate enquiry. Say the call is recorded so the buyer can hear their exact rate.',
        edges: [
          {
            to_node_id: 'confirm_choice',
            condition: 'Round 3: the buyer has chosen this supplier',
            condition_type: 'expression',
            expression: {
              logic: 'and',
              conditions: [{ variable: 'round', operator: 'eq', value: '3' }],
            },
          },
          { to_node_id: 'ask_price', condition: 'The supplier agrees to talk' },
          { to_node_id: 'stop_calls', condition: 'The supplier asks never to be called again' },
          { to_node_id: 'close', condition: 'The supplier is busy or refuses to talk' },
        ],
      },
      {
        id: 'ask_price',
        prompt:
          'Ask their price for {{quantity}} of {{item}}: the price and the unit it is for, any delivery charge, when they can deliver, and payment terms.',
        edges: [
          { to_node_id: 'read_back', condition: 'The supplier has given a price' },
          { to_node_id: 'stop_calls', condition: 'The supplier asks never to be called again' },
          { to_node_id: 'close', condition: 'The supplier will not give a price' },
        ],
      },
      {
        id: 'read_back',
        prompt:
          'Read the quote back in one sentence using their exact numbers. When they confirm, call @save_quote once with their numbers and a short quote of their own words. If they correct you, read back the corrected quote.',
        edges: [
          {
            to_node_id: 'bargain',
            condition: 'The supplier confirmed the quote and this is round 2 with an offer',
          },
          {
            to_node_id: 'close',
            condition: 'The supplier confirmed the quote and this is round 1',
          },
        ],
      },
      {
        id: 'bargain',
        prompt:
          'Say: "मेरे पास {{best_offer}} का असली offer है। क्या आप match या beat कर सकते हैं?" Ask once. If they give a new price, read it back and call @save_quote again. If they say no, accept it politely.',
        edges: [{ to_node_id: 'close', condition: 'The supplier has answered the counter-offer' }],
      },
      {
        id: 'confirm_choice',
        prompt:
          'Say {{buyer_name}} has chosen their quote of {{best_offer}} for {{quantity}} of {{item}}, delivered by {{deliver_by}}. Ask them to confirm it still holds; if they change it, read the new terms back and call @save_quote. Say {{buyer_name}} will call to place the order.',
        edges: [
          { to_node_id: 'close', condition: 'The supplier has confirmed or changed the quote' },
        ],
      },
      {
        id: 'stop_calls',
        prompt: 'Call @do_not_call, apologise, and say Bhaav will not call again.',
        edges: [{ to_node_id: 'close', condition: 'Done', condition_type: 'unconditional' }],
      },
      {
        id: 'close',
        node_type: 'static',
        static_message: 'धन्यवाद जी, buyer आपको call करेंगे।',
        function_call: 'end_call',
        edges: [],
      },
    ],
  };
}

// ---- Agent bodies ------------------------------------------------------------------------------

export type AgentKind = 'desk' | 'caller' | 'caller-graph' | 'practice';

const AGENT_NAMES: Record<AgentKind, string> = {
  desk: 'Bhaav Desk',
  caller: 'Bhaav Caller',
  'caller-graph': 'Bhaav Caller (graph)',
  practice: 'Bhaav Practice Caller',
};

/** Seconds before Bolna hangs up: four minutes a supplier call, two for a judge's practice call. */
const CALL_SECONDS: Record<AgentKind, number> = {
  desk: 300,
  caller: 240,
  'caller-graph': 240,
  practice: 120,
};

/**
 * The POST /v2/agent body for the Desk (talks to the buyer), the Caller (phones suppliers), or
 * the practice Caller (the same Caller, cut off at two minutes, for "Be the supplier").
 */
export function agentBody(kind: AgentKind, setup: AgentSetup) {
  const desk = kind === 'desk';
  const graph = kind === 'caller-graph';
  return {
    agent_config: {
      agent_name: AGENT_NAMES[kind],
      agent_welcome_message: desk ? DESK_WELCOME : CALLER_WELCOME,
      webhook_url: `${setup.workerUrl}/webhooks/bolna/${setup.webhookSecret}`,
      tasks: [
        {
          task_type: 'conversation',
          toolchain: { execution: 'parallel', pipelines: [['transcriber', 'llm', 'synthesizer']] },
          tools_config: {
            llm_agent: graph
              ? {
                  agent_type: 'graph_agent',
                  agent_flow_type: 'streaming',
                  llm_config: callerGraph(setup),
                }
              : {
                  agent_type: 'simple_llm_agent',
                  agent_flow_type: 'streaming',
                  llm_config: customLlm(setup),
                },
            synthesizer: synthesizer(setup),
            transcriber,
            multilingual_config: multilingual(setup),
            input: { provider: 'plivo', format: 'wav' },
            output: { provider: 'plivo', format: 'wav' },
            api_tools: apiTools(desk ? DESK_TOOLS : CALLER_TOOLS, setup),
          },
          task_config: {
            // Four minutes a call (the Bhaav promise), two for practice, and hang up on long silence.
            call_terminate: CALL_SECONDS[kind],
            hangup_after_silence: 15,
          },
        },
      ],
    },
    agent_prompts: { task_1: { system_prompt: desk ? DESK_PROMPT : CALLER_PROMPT } },
  };
}
