/**
 * TypeScript type definitions for Coolify API responses.
 * These represent the shapes returned by the Coolify REST API.
 */

// ── Projects & Environments ──────────────────────────────────────────

export interface CoolifyProject {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  environments?: CoolifyEnvironment[];
}

export interface CoolifyEnvironment {
  id: number;
  name: string;
  project_id: number;
  created_at?: string;
  updated_at?: string;
}

// ── Applications ─────────────────────────────────────────────────────

export interface CoolifyApplication {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  fqdn?: string;
  status?: string;
  repository_project_id?: number;
  git_repository?: string;
  git_branch?: string;
  build_pack?: string;
  docker_registry_image_name?: string;
  docker_registry_image_tag?: string;
  dockerfile_location?: string;
  ports_exposes?: string;
  environment_id?: number;
  destination_id?: number;
  health_check_enabled?: boolean;
  health_check_path?: string;
  health_check_port?: string;
  health_check_method?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Databases ────────────────────────────────────────────────────────

export interface CoolifyDatabase {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  type?: string;
  status?: string;
  public_port?: number;
  is_public?: boolean;
  environment_id?: number;
  destination_id?: number;
  created_at?: string;
  updated_at?: string;
}

// ── Services ─────────────────────────────────────────────────────────

export interface CoolifyService {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  type?: string;
  status?: string;
  fqdn?: string;
  environment_id?: number;
  server_id?: number;
  created_at?: string;
  updated_at?: string;
}

// ── Servers ──────────────────────────────────────────────────────────

export interface CoolifyServer {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  ip: string;
  user?: string;
  port?: number;
  is_reachable?: boolean;
  is_usable?: boolean;
  validation_logs?: string;
  settings?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

// ── Deployments ──────────────────────────────────────────────────────

export interface CoolifyDeployment {
  id: number;
  uuid?: string;
  application_id?: number;
  application_name?: string;
  deployment_uuid?: string;
  pull_request_id?: number;
  force_rebuild?: boolean;
  commit?: string;
  status?: string;
  is_webhook?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ── Environment Variables ────────────────────────────────────────────

export interface CoolifyEnvVar {
  id: number;
  uuid?: string;
  key: string;
  value: string;
  is_build_time?: boolean;
  is_preview?: boolean;
  application_id?: number;
  service_id?: number;
  created_at?: string;
  updated_at?: string;
}

// ── Private Keys ────────────────────────────────────────────────────

export interface CoolifyPrivateKey {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  private_key?: string;
  public_key?: string;
  fingerprint?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Database Backups ─────────────────────────────────────────────────

export interface CoolifyDatabaseBackup {
  id: number;
  uuid: string;
  database_id?: number;
  database_type?: string;
  status?: string;
  filename?: string;
  size?: number;
  frequency: string; // cron expression
  enabled: boolean;
  save_s3?: boolean;
  s3_storage_id?: number;
  databases_to_backup?: string;
  dump_all?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CoolifyBackupExecution {
  id: number;
  uuid: string;
  scheduled_database_backup_id?: number;
  status?: string;
  message?: string;
  size?: number;
  filename?: string;
  created_at?: string;
  updated_at?: string;
}

// ── GitHub Apps (Coolify resource) ───────────────────────────────────

export interface CoolifyGitHubApp {
  id: number;
  uuid: string;
  name: string;
  organization?: string | null;
  api_url?: string;
  html_url?: string;
  custom_user?: string;
  custom_port?: number;
  app_id?: number | null;
  installation_id?: number | null;
  client_id?: string | null;
  is_system_wide?: boolean;
  is_public?: boolean;
  private_key_id?: number | null;
  team_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CoolifyGitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

export interface CoolifyGitHubBranch {
  name: string;
}

// ── Pagination ───────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  total: number;
  count: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}
