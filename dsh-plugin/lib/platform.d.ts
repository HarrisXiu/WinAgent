/** 包根目录（lib/ 的上一级）；本包保持可迁移，不依赖绝对路径。 */
export declare const PACKAGE_ROOT: string;
/**
 * 子进程 NODE_PATH：skills 脚本（read_pdf.js 等）require pdf-parse/xlsx 等依赖时，
 * 从「本包所在安装树」解析（link 安装=仓库 node_modules，npm/git 安装=profile 安装树）。
 */
export declare function pluginNodePath(): string;
/** 子进程 env：在进程环境基础上附带 NODE_PATH。 */
export declare function skillEnv(extra?: Record<string, string>): Record<string, string>;
