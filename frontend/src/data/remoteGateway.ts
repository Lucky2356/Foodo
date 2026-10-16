import type { Member, MemberReport, PriceProfile, RankedCandidate, Recipe, ShoppingState } from '../engine';
import { api, ApiError, OfflineError } from './api';
import { cacheGet, cachePut } from './localDb';
import type {
  Gateway,
  GenerateParams,
  HabitView,
  HouseholdPatch,
  HouseholdView,
  MenuRecord,
  MenuSummary,
  NewPrice,
  OwnPrice,
  PantryRecord,
  ShoppingView,
  WaterView,
} from './types';

/**
 * Account mode: the server stores and computes. Reads are copied to a per-account IndexedDB so
 * previously loaded data stays readable offline; writes require the network and fail with a clear
 * message instead of being queued (no hidden sync that could lose changes).
 */
export class RemoteGateway implements Gateway {
  readonly mode = 'account' as const;
  private readonly base: string;

  constructor(
    readonly householdId: string,
    private readonly cacheScope: string,
  ) {
    this.base = `/households/${householdId}`;
  }

  private async read<T>(path: string): Promise<T> {
    try {
      const data = await api<T>(path);
      void cachePut(this.cacheScope, path, data);
      return data;
    } catch (e) {
      if (e instanceof OfflineError) {
        const cached = await cacheGet<T>(this.cacheScope, path);
        if (cached) return cached.data;
      }
      throw e;
    }
  }

  private write<T>(path: string, method: string, body?: unknown): Promise<T> {
    if (!navigator.onLine) return Promise.reject(new OfflineError());
    return api<T>(path, { method, body });
  }

  getHousehold(): Promise<HouseholdView> {
    return this.read(`${this.base}/`);
  }

  updateHousehold(patch: HouseholdPatch): Promise<HouseholdView> {
    return this.write(`${this.base}/`, 'PATCH', patch);
  }

  addMember(data: Partial<Member> & { name: string }): Promise<Member> {
    return this.write(`${this.base}/members/`, 'POST', data);
  }

  updateMember(id: string, patch: Partial<Member>): Promise<Member> {
    return this.write(`${this.base}/members/${id}/`, 'PATCH', patch);
  }

  deleteMember(id: string): Promise<void> {
    return this.write(`${this.base}/members/${id}/`, 'DELETE');
  }

  listMenus(): Promise<MenuSummary[]> {
    return this.read(`${this.base}/menus/`);
  }

  getMenu(id: string): Promise<MenuRecord> {
    return this.read(`${this.base}/menus/${id}/`);
  }

  generateMenu(params: GenerateParams): Promise<MenuRecord> {
    return this.write(`${this.base}/menus/`, 'POST', params);
  }

  applyOp(menuId: string, op: unknown, expectedRevision: number | null): Promise<MenuRecord> {
    return this.write(`${this.base}/menus/${menuId}/ops/`, 'POST', { op, expected_revision: expectedRevision });
  }

  async updateMenuMeta(id: string, patch: { title?: string; is_favorite?: boolean }): Promise<void> {
    await this.write(`${this.base}/menus/${id}/`, 'PATCH', patch);
  }

  deleteMenu(id: string): Promise<void> {
    return this.write(`${this.base}/menus/${id}/`, 'DELETE');
  }

  candidates(menuId: string, itemId: string): Promise<RankedCandidate[]> {
    return this.read(`${this.base}/menus/${menuId}/candidates/?item_id=${encodeURIComponent(itemId)}`);
  }

  getShopping(menuId: string): Promise<ShoppingView> {
    return this.read(`${this.base}/menus/${menuId}/shopping/`);
  }

  patchShopping(menuId: string, patch: Partial<ShoppingState>, expectedRevision: number | null): Promise<ShoppingView> {
    return this.write(`${this.base}/menus/${menuId}/shopping/`, 'PATCH', { ...patch, expected_revision: expectedRevision });
  }

  transferPurchases(menuId: string, lineIds: string[]): Promise<{ added: string[]; skipped: string[] }> {
    return this.write(`${this.base}/menus/${menuId}/shopping/transfer/`, 'POST', { line_ids: lineIds });
  }

  async cook(menuId: string, batchId: string): Promise<{ created: boolean }> {
    const r = await this.write<{ created: boolean }>(`${this.base}/menus/${menuId}/batches/${batchId}/cook/`, 'POST');
    return { created: r.created };
  }

  getReport(menuId: string): Promise<MemberReport[]> {
    return this.read(`${this.base}/menus/${menuId}/report/`);
  }

  listPantry(): Promise<PantryRecord[]> {
    return this.read(`${this.base}/pantry/`);
  }

  addPantry(item: Omit<PantryRecord, 'id'>): Promise<PantryRecord> {
    return this.write(`${this.base}/pantry/`, 'POST', item);
  }

  updatePantry(id: string, patch: Partial<PantryRecord>): Promise<PantryRecord> {
    return this.write(`${this.base}/pantry/${id}/`, 'PATCH', patch);
  }

  deletePantry(id: string): Promise<void> {
    return this.write(`${this.base}/pantry/${id}/`, 'DELETE');
  }

  listPrices(): Promise<{ own: OwnPrice[]; profile: PriceProfile }> {
    return this.read(`${this.base}/prices/`);
  }

  async addPrices(entries: NewPrice[]): Promise<{ shared: number }> {
    const r = await this.write<{ shared: number }>(`${this.base}/prices/`, 'POST', { entries });
    return { shared: r.shared };
  }

  deletePrice(id: string): Promise<void> {
    return this.write(`${this.base}/prices/${id}/`, 'DELETE');
  }

  listFavorites(): Promise<string[]> {
    return this.read(`${this.base}/favorites/`);
  }

  setFavorite(recipeId: string, on: boolean): Promise<string[]> {
    return this.write(`${this.base}/favorites/`, on ? 'POST' : 'DELETE', { recipe_id: recipeId });
  }

  listCustomRecipes(): Promise<Recipe[]> {
    return this.read(`${this.base}/recipes/`);
  }

  saveCustomRecipe(recipe: Recipe): Promise<Recipe> {
    return this.write(`${this.base}/recipes/`, 'POST', recipe);
  }

  deleteCustomRecipe(id: string): Promise<void> {
    return this.write(`${this.base}/recipes/${id}/`, 'DELETE');
  }

  water(memberId: string, days = 14): Promise<WaterView> {
    return this.read(`${this.base}/water/?member_id=${encodeURIComponent(memberId)}&days=${days}`);
  }

  async addWater(memberId: string, amountMl: number): Promise<void> {
    await this.write(`${this.base}/water/`, 'POST', { member_id: memberId, amount_ml: amountMl });
  }

  deleteWater(id: string): Promise<void> {
    return this.write(`${this.base}/water/${id}/`, 'DELETE');
  }

  habits(): Promise<HabitView[]> {
    return this.read(`${this.base}/habits/`);
  }

  addHabit(memberId: string, name: string): Promise<HabitView> {
    return this.write(`${this.base}/habits/`, 'POST', { member_id: memberId, name });
  }

  deleteHabit(id: string): Promise<void> {
    return this.write(`${this.base}/habits/${id}/`, 'DELETE');
  }

  markHabit(id: string, localDate: string, done: boolean): Promise<HabitView> {
    return this.write(`${this.base}/habits/${id}/marks/`, done ? 'PUT' : 'DELETE', { local_date: localDate });
  }
}

export interface AccountUser {
  id: number;
  email: string;
  name: string;
  households: { id: string; name: string; role: string }[];
}

export const account = {
  me: () => api<AccountUser>('/auth/me/'),
  login: (email: string, password: string) => api<AccountUser>('/auth/login/', { method: 'POST', body: { email, password } }),
  register: (email: string, password: string, name: string) => api<AccountUser>('/auth/register/', { method: 'POST', body: { email, password, name } }),
  logout: () => api<{ ok: boolean }>('/auth/logout/', { method: 'POST' }),
  requestReset: (email: string) => api<{ message: string }>('/auth/password/reset/', { method: 'POST', body: { email } }),
  confirmReset: (uid: string, token: string, password: string) => api<{ ok: boolean }>('/auth/password/reset/confirm/', { method: 'POST', body: { uid, token, password } }),
  changePassword: (oldPassword: string, newPassword: string) =>
    api<{ ok: boolean }>('/auth/password/change/', { method: 'POST', body: { old_password: oldPassword, new_password: newPassword } }),
  exportData: () => api<unknown>('/account/export/'),
  deleteAccount: (password: string, confirm: string) => api<{ ok: boolean }>('/account/delete/', { method: 'POST', body: { password, confirm } }),
  importGuest: (householdId: string, data: unknown, mode: 'preview' | 'apply', resolution?: unknown) =>
    api<unknown>(`/households/${householdId}/import-guest/`, { method: 'POST', body: { data, mode, resolution } }),
  acceptInvitation: (token: string) => api<{ household_id: string }>('/invitations/accept/', { method: 'POST', body: { token } }),
  invite: (householdId: string, email: string, role: string) =>
    api<{ token: string }>(`/households/${householdId}/invitations/`, { method: 'POST', body: { email, role } }),
};

export function isNotAuthenticated(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403) && (e.code === 'not_authenticated' || e.code === 'permission_denied' || e.code === 'authentication_failed');
}
