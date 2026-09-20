import type { VoiceCloneMeta } from '../shared/types';
export declare class VoiceStore {
    private dir;
    private metaPath;
    /** 样本 base64 缓存：key = 音色 id，mtime 变化即失效 */
    private cache;
    constructor(dataDir: string);
    private loadMeta;
    private saveMeta;
    list(): Promise<VoiceCloneMeta[]>;
    /** 上传/导入参考音频：校验格式与大小后复制进音色库 */
    add(name: string, srcPath: string): Promise<VoiceCloneMeta>;
    /** 删除克隆音色（文件 + 元数据 + 缓存；样本缺失不报错） */
    remove(id: string): Promise<void>;
    /** 重命名克隆音色 */
    rename(id: string, name: string): Promise<VoiceCloneMeta[]>;
    private requireMeta;
    /** 读取样本 base64（带 mtime 缓存，供克隆请求与试听） */
    getSampleBase64(id: string): Promise<{
        base64: string;
        mime: string;
    }>;
    /** 样本 dataURL（audio.voice 克隆参数直接可用） */
    getSampleDataUrl(id: string): Promise<string>;
}
