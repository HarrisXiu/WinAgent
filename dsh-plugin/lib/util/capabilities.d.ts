export interface Capabilities {
    /** pandoc 版本号（外部增强引擎）；null = 未安装 */
    pandoc: string | null;
    /** LibreOffice 版本号；null = 未安装 */
    soffice: string | null;
    /** 可用的 soffice 命令（含常见安装绝对路径探测）；null = 未安装 */
    sofficeCmd: string | null;
    /** Word COM 可用（装有 Office，注册表探测） */
    officeCom: boolean;
    /** pdfjs-dist + @napi-rs/canvas 页面渲染链可用（render_pdf_page / extract_pdf_images） */
    pdfjsRender: boolean;
    /** python + PyMuPDF 可用（可选增强） */
    pymupdf: boolean;
}
/** 探测本地能力（进程内缓存；force=true 强制重探） */
export declare function getCapabilities(force?: boolean): Capabilities;
