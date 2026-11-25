export declare function publishManifest(pkg: Readonly<Record<string, unknown>>): Record<string, unknown>;
export declare function packTarball(dest: string, env?: NodeJS.ProcessEnv): { filename: string; path: string; size: number; unpackedSize: number; entryCount: number; integrity: string };
