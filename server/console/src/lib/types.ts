export type Role = "admin" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role | string;
  created_at?: string;
  /** 普通用户被锁定的记忆 user_id 作用域；管理员为 null（可见全部）。 */
  memory_scope?: string | null;
  is_active?: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export interface SetupStatus {
  needsSetup: boolean;
}

export interface MessageResponse {
  message: string;
}

/** FastAPI 的两种错误体：HTTPException 的 detail 与上游错误的 code/request_id。 */
export interface ApiErrorBody {
  detail?: unknown;
  code?: string;
  request_id?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface CategoryEntry {
  name: string;
  description: string;
  enabled?: boolean;
}

export interface CategoryCatalog {
  custom_categories: CategoryEntry[];
  custom_category_rules: string[];
  names: string[];
  disabled: string[];
  enabled_count: number;
}
