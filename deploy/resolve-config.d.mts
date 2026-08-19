export interface ResolvedDeployConfig {
  platform: "cloudflare" | "vercel" | "edgeone";
  database: "d1" | "supabase" | "postgres";
  projectName: string;
  cloudflareAccountId: string;
  vercelScope: string;
  edgeoneArea: "overseas" | "global";
}

export function resolveDeployConfig(raw: string): ResolvedDeployConfig;
