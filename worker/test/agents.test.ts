import { describe, expect, it } from 'vitest';
import { agentBody, callerGraph, dashboardTools } from '../src/agents';
import { CALLER_PROMPT, DESK_PROMPT } from '../src/prompts';

const setup = {
  workerUrl: 'https://bhaav.example.workers.dev',
  llmModel: 'bhaav-llm',
  toolSecret: 'tool-secret',
  webhookSecret: 'hook-secret',
  voice: { id: 'aparna_hi_customer', name: 'Aparna (Customer)' },
};

describe('agentBody', () => {
  it('points the Caller at our LLM endpoint, tools and webhook', () => {
    const body = agentBody('caller', setup);
    const task = body.agent_config.tasks[0];
    expect(task?.tools_config.llm_agent.llm_config).toMatchObject({
      provider: 'custom',
      model: 'bhaav-llm',
      base_url: 'https://bhaav.example.workers.dev/v1',
    });
    expect(body.agent_config.webhook_url).toBe(
      'https://bhaav.example.workers.dev/webhooks/bolna/hook-secret',
    );
    expect(task?.task_config.call_terminate).toBe(240);
    const tools = task?.tools_config.api_tools;
    expect(tools?.tools.map((t) => t.name)).toEqual(['save_quote', 'do_not_call']);
    const params = tools?.tools_params.save_quote;
    expect(params).toMatchObject({
      url: 'https://bhaav.example.workers.dev/tools/save_quote',
      api_token: 'Bearer tool-secret',
    });
    expect(JSON.parse(params?.param ?? '{}')).toMatchObject({
      call_ref: '%(call_ref)s',
      price: '%(price)s',
    });
  });

  it('gives the Desk only the order tools', () => {
    const tools = agentBody('desk', setup).agent_config.tasks[0]?.tools_config.api_tools.tools;
    expect(tools?.map((t) => t.name)).toEqual(['update_order', 'start_calls']);
  });

  it('builds the dashboard copy of each tool', () => {
    const [saveQuote] = dashboardTools('caller', setup);
    expect(saveQuote).toMatchObject({
      key: 'custom_task',
      value: { method: 'POST', param: { price: '%(price)s' } },
    });
  });
});

describe('prompts', () => {
  it('carry the references the lie-catcher and tools need', () => {
    expect(CALLER_PROMPT).toContain('CALL_REF: {call_ref}');
    expect(DESK_PROMPT).toContain('REQUEST_REF: {request_ref}');
  });

  it('fill every variable the dialler sends', () => {
    const sent = [
      'call_ref',
      'buyer_name',
      'supplier_name',
      'item',
      'quantity',
      'quality',
      'area',
      'deliver_by',
      'round',
      'best_offer',
      'language',
    ];
    const used = new Set([...CALLER_PROMPT.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...sent].sort());
  });
});

describe('languages', () => {
  it('lets both agents switch between Hindi, English and Kannada', () => {
    for (const kind of ['desk', 'caller'] as const) {
      const config = agentBody(kind, setup).agent_config.tasks[0]?.tools_config.multilingual_config;
      expect(config?.enabled).toBe(true);
      expect(config?.active_language).toBe('hi');
      expect(Object.keys(config?.languages ?? {}).sort()).toEqual(['en', 'hi', 'kn']);
    }
  });
});

describe('callerGraph', () => {
  const graph = callerGraph(setup);
  const ids = new Set(graph.nodes.map((n) => n.id));

  it('starts at a node that exists, and every edge leads to one', () => {
    expect(ids.has(graph.current_node_id)).toBe(true);
    for (const node of graph.nodes)
      for (const edge of node.edges)
        expect(ids.has(edge.to_node_id), `${node.id} → ${edge.to_node_id}`).toBe(true);
  });

  it('keeps CALL_REF in the prompt every step sends, so the lie-catcher still works', () => {
    expect(graph.agent_information).toContain('CALL_REF: {{call_ref}}');
    expect(graph.provider).toBe('custom');
  });

  it('only references tools the Caller has', () => {
    const tools = new Set(['save_quote', 'do_not_call']);
    for (const node of graph.nodes) {
      for (const [, name] of (node.prompt ?? '').matchAll(/@([a-z_]+)/g))
        expect(tools.has(name ?? ''), name).toBe(true);
    }
  });

  it('sends round 3 straight to the confirmation step and ends every path at close', () => {
    const greet = graph.nodes.find((n) => n.id === 'greet');
    expect(greet?.edges[0]).toMatchObject({
      to_node_id: 'confirm_choice',
      condition_type: 'expression',
    });
    const close = graph.nodes.find((n) => n.id === 'close');
    expect(close).toMatchObject({ node_type: 'static', function_call: 'end_call' });
  });

  it('is what the caller-graph agent body carries', () => {
    const llm = agentBody('caller-graph', setup).agent_config.tasks[0]?.tools_config.llm_agent;
    expect(llm?.agent_type).toBe('graph_agent');
  });
});
