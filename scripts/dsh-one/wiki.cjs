'use strict';
const { ConfigStore } = require('./config/ConfigStore');
const { EventBus } = require('./event-bus');
const { WikiHost } = require('./wiki/wiki-host');
const { createWikiTools } = require('./tools/wikiTools');

exports.create = async function (config) {
  const store = new ConfigStore();
  await store.load();
  // Override only in memory: no API keys or existing config are rewritten.
  if (config.vaultPath) store.get().vaultPath = config.vaultPath;
  const host = new WikiHost(store, new EventBus());
  try { await host.init(); } catch (error) { host.dispose(); throw error; }
  const tools = createWikiTools(host.vault, host.search, store);
  tools.push({
    schema: {
      name: 'import_knowledge_files', description: '导入本地文档并执行知识库详细分析。需在 WinAgent 数据目录 config.json 中配置模型 Provider。',
      parameters: { type: 'object', properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '文件绝对路径列表' },
        requirement: { type: 'string', description: '分析要求' },
      }, required: ['paths', 'requirement'] },
    }, dangerous: true,
    run: async a => JSON.stringify(await host.importAnalyze(a.paths, a.requirement)),
  });
  tools.push({
    schema: {
      name: 'import_knowledge_url', description: '将 URL 原文导入知识库 raw 层，返回来源路径。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '网页 URL' } }, required: ['url'] },
    }, dangerous: true, run: async a => JSON.stringify(await host.importUrl(a.url)),
  });
  return { tools, dispose: () => host.dispose() };
};
