"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PACKAGE_ROOT = void 0;
exports.pluginNodePath = pluginNodePath;
exports.skillEnv = skillEnv;
/**
 * 平台适配：DSH 插件运行时的包根目录定位与子进程模块解析。
 * @module dsh-winagent/platform
 */
const module_1 = require("module");
const path_1 = __importDefault(require("path"));
/** 包根目录（lib/ 的上一级）；本包保持可迁移，不依赖绝对路径。 */
exports.PACKAGE_ROOT = path_1.default.resolve(__dirname, '..');
/** 包内 CJS require（锚定 package.json，解析路径与本包安装位置一致）。 */
const packageRequire = (0, module_1.createRequire)(path_1.default.join(exports.PACKAGE_ROOT, 'package.json'));
/**
 * 子进程 NODE_PATH：skills 脚本（read_pdf.js 等）require pdf-parse/xlsx 等依赖时，
 * 从「本包所在安装树」解析（link 安装=仓库 node_modules，npm/git 安装=profile 安装树）。
 */
function pluginNodePath() {
    try {
        return (packageRequire.resolve.paths('gray-matter') ?? []).join(path_1.default.delimiter);
    }
    catch {
        return '';
    }
}
/** 子进程 env：在进程环境基础上附带 NODE_PATH。 */
function skillEnv(extra = {}) {
    const nodePath = pluginNodePath();
    return {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...(nodePath ? { NODE_PATH: nodePath } : {}),
        ...extra,
    };
}
