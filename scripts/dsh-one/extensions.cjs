'use strict';
const path = require('node:path');
const { loadSkills } = require('./skills/SkillLoader');
const { McpManager } = require('./mcp/McpManager');

exports.create = async function (config) {
  const mcp = new McpManager();
  try {
    const tools = await loadSkills(path.join(__dirname, '../assets/skills'));
    for (const directory of config.skillsDirs || []) tools.push(...await loadSkills(path.resolve(directory)));
    if (config.mcpConfigPath) tools.push(...await mcp.load(path.resolve(config.mcpConfigPath)));
    const names = new Set();
    for (const tool of tools) {
      if (names.has(tool.schema.name)) throw new Error(`重复扩展工具名：${tool.schema.name}`);
      names.add(tool.schema.name);
    }
    return { tools, dispose: () => mcp.dispose() };
  } catch (error) { mcp.dispose(); throw error; }
};
