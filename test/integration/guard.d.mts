export declare const ROOT: string;

export interface TestEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  ref: string;
}

export declare function parseEnvText(text: string): Record<string, string>;
export declare function projectRef(url: string): string | null;
export declare function checkTestEnv(
  test: Record<string, string> | null,
  real: Record<string, string> | null
): string[];
export declare function loadTestEnv(): TestEnv;
