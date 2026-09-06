/** 预加载公式引擎；docx 工具入口 await 本函数（首次之后为 no-op） */
export declare function ensureMathEngines(): Promise<void>;
/** 文档块类型（由工具参数解析而来） */
export type DocBlock = {
    type: 'heading';
    text: string;
    level?: number;
} | {
    type: 'paragraph';
    text: string;
    bold?: boolean;
    italic?: boolean;
    size?: number;
    align?: Align;
} | {
    type: 'formula';
    latex: string;
    inline?: boolean;
    align?: Align;
} | {
    type: 'list';
    items: string[];
    ordered?: boolean;
} | {
    type: 'table';
    rows: string[][];
    header?: boolean;
} | {
    type: 'pagebreak';
};
export type Align = 'left' | 'center' | 'right' | 'both';
/** LaTeX → OMML（Word 原生可编辑公式） */
export declare function latexToOmml(latex: string, display?: boolean): string;
export interface BuildOptions {
    title?: string;
    author?: string;
    fontName?: string;
    fontSize?: number;
    landscape?: boolean;
}
/** 构建 .docx 二进制内容 */
export declare function buildDocx(blocks: DocBlock[], opts?: BuildOptions): Promise<Buffer>;
