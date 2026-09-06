/**
 * 统一 slug 规则（契约 §0：文件名 slug 一律英文小写连字符，禁止中文、空格与下划线）。
 * 全部落盘命名（source/concept 页、query 输出、save_knowledge_output、URL 导入）必须经此函数。
 */
/** 通用 slug 归一：小写、剔除非法字符、压缩连字符；空结果回退 `${fallbackPrefix}-<base36 时间戳>` */
export declare function slugifyKebab(name: string, fallbackPrefix?: string): string;
