import type { SkinMeta, SkinSlot } from '../shared/types';
export declare const SKIN_SLOTS: SkinSlot[];
export declare class SkinStore {
    private dir;
    private metaPath;
    constructor(dataDir: string);
    private loadMeta;
    private saveMeta;
    list(): Promise<SkinMeta[]>;
    /** 新建空主题包（素材随后逐槽位上传） */
    create(name: string): Promise<SkinMeta>;
    private requireMeta;
    /** 写回单个主题包的元数据 */
    private patchMeta;
    /** 上传槽位素材：校验格式与大小后复制进 <id>/<slot>.<ext>（替换旧扩展名文件） */
    setSlot(id: string, slot: SkinSlot, srcPath: string): Promise<SkinMeta>;
    /** 清空槽位（素材缺失不报错） */
    clearSlot(id: string, slot: SkinSlot): Promise<SkinMeta>;
    /** 删除主题包（整个目录 + 元数据） */
    remove(id: string): Promise<void>;
    /** 重命名主题包 */
    rename(id: string, name: string): Promise<SkinMeta[]>;
    /** 解析槽位文件的绝对路径（协议处理器用；不存在返回 null） */
    resolveSlotFile(id: string, slot: SkinSlot, file: string): string | null;
}
