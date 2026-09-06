declare class LoggerImpl {
    private stream;
    private dir;
    private day;
    constructor();
    private ensure;
    private ts;
    write(level: string, msg: string): Promise<void>;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    section(title: string, body: string): void;
}
export declare const Logger: LoggerImpl;
export {};
