import type { Entity } from "@/types/api";

/**
 * 记忆页「按用户筛选」下拉的纯逻辑。
 *
 * Radix Select 不允许 value="" 的选项，所以用一个哨兵值代表「全部用户」，
 * 对外仍是空字符串（= 不加 user_id 参数），调用方无感。
 */

export const ALL_USERS = "__all__";

export interface UserOption {
  id: string;
  total: number;
}

/** 用户选项：只取 type="user" 的实体，按记忆条数降序（同条数按 id），顺序稳定 */
export function userOptions(entities: Entity[]): UserOption[] {
  return entities
    .filter((entity) => entity.type === "user" && entity.id)
    .map((entity) => ({ id: entity.id, total: entity.total_memories ?? 0 }))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

/**
 * 补上「当前值」：URL 直传的 user_id 或实体列表里没有的用户也要能显示，
 * 否则 Select 会显示成空白，看起来像筛选丢了。
 */
export function withCurrentUser(
  options: UserOption[],
  userId: string,
): UserOption[] {
  if (!userId || options.some((option) => option.id === userId)) return options;
  return [...options, { id: userId, total: -1 }];
}

/** 下拉选中的值 → 查询用的 user_id（哨兵 → 空串 = 不筛选） */
export function selectionToUserId(value: string): string {
  return value === ALL_USERS ? "" : value;
}

/** 查询用的 user_id → 下拉选中值 */
export function userIdToSelection(userId: string): string {
  return userId ? userId : ALL_USERS;
}
