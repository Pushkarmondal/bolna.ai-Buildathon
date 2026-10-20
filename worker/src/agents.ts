// Builds the two Bolna agents (POST /v2/agent bodies) and their custom functions. Used by
// scripts/setup-agents.ts; kept here so the shapes are type-checked and tested.

import { CALLER_PROMPT, CALLER_WELCOME, DESK_PROMPT, DESK_WELCOME } from './prompts';

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

/** The POST /v2/agent body for the Desk (talks to the buyer) or the Caller (phones suppliers). */
export function agentBody(kind: 'desk' | 'caller', setup: AgentSetup) {
  const desk = kind === 'desk';
  return {
    agent_config: {
      agent_name: desk ? 'Bhaav Desk' : 'Bhaav Caller',
      agent_welcome_message: desk ? DESK_WELCOME : CALLER_WELCOME,
      webhook_url: `${setup.workerUrl}/webhooks/bolna/${setup.webhookSecret}`,
      tasks: [
        {
          task_type: 'conversation',
          toolchain: { execution: 'parallel', pipelines: [['transcriber', 'llm', 'synthesizer']] },
          tools_config: {
            llm_agent: {
              agent_type: 'simple_llm_agent',
              agent_flow_type: 'streaming',
              llm_config: {
                provider: 'custom',
                model: setup.llmModel,
                base_url: `${setup.workerUrl}/v1`,
                family: 'openai',
                max_tokens: 200,
                temperature: 0.3,
              },
            },
            synthesizer: {
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
            },
            transcriber: {
              provider: 'sarvam',
              model: 'saaras:v4',
              language: 'hi',
              stream: true,
              encoding: 'linear16',
              sampling_rate: 16000,
              endpointing: 250,
            },
            input: { provider: 'plivo', format: 'wav' },
            output: { provider: 'plivo', format: 'wav' },
            api_tools: apiTools(desk ? DESK_TOOLS : CALLER_TOOLS, setup),
          },
          task_config: {
            // Four minutes a call (the Bhaav promise), and hang up on long silence.
            call_terminate: desk ? 300 : 240,
            hangup_after_silence: 15,
          },
        },
      ],
    },
    agent_prompts: { task_1: { system_prompt: desk ? DESK_PROMPT : CALLER_PROMPT } },
  };
}
