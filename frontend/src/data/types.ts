import type {
  Member,
  Menu,
  MemberReport,
  PlanSettings,
  PriceEntry,
  PriceProfile,
  RankedCandidate,
  Recipe,
  ShoppingLine,
  ShoppingList,
  ShoppingState,
} from '../engine';

export interface HouseholdSettings {
  slots: string[];
  days: number;
  plan: PlanSettings;
  slot_members: Record<string, string[]> | null;
  onboarded: boolean;
}

export interface CityRef {
  id: string;
  name: string;
  region: string;
  timezone: string;
}

export interface HouseholdView {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  settings: HouseholdSettings;
  city: CityRef | null;
  store_chain_id: string | null;
  share_prices: boolean;
  members: Member[];
}

export interface HouseholdPatch {
  name?: string;
  settings?: HouseholdSettings;
  city_id?: string | null;
  store_chain_id?: string | null;
  share_prices?: boolean;
}

export interface MenuSummary {
  id: string;
  title: string;
  start_date: string;
  days: number;
  revision: number;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuRecord extends MenuSummary {
  menu: Menu;
  shopping_revision: number;
  cooked_batches: string[];
}

export type ShoppingView = Omit<ShoppingList, 'lines'> & {
  lines: (ShoppingLine & { transferred: boolean })[];
  state: ShoppingState;
  shopping_revision: number;
};

export interface PantryRecord {
  id: string;
  product_id: string;
  qty: number;
  unit: 'g' | 'ml' | 'pcs';
  location: string | null;
  expires: string | null;
}

export interface OwnPrice extends PriceEntry {
  id: string;
  chain_id: string | null;
}

export interface NewPrice {
  product_id: string;
  price_kop: number;
  package_size: number;
  package_unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs';
  loose?: boolean;
  date?: string;
  kind?: 'manual' | 'receipt';
  chain_id?: string | null;
  source?: string;
}

export interface WaterView {
  member_id: string;
  today: string;
  goal_ml: number | null;
  totals: Record<string, number>;
  entries: { id: string; amount_ml: number; local_date: string; created_at: string }[];
}

export interface HabitView {
  id: string;
  member_id: string;
  name: string;
  archived: boolean;
  marks: string[];
}

export interface GenerateParams {
  start_date: string;
  days?: number;
  seed?: number;
  title?: string;
}

/**
 * The UI talks to one interface; the guest implementation runs the engine in the browser and
 * stores data in IndexedDB, the account implementation calls the server API.
 */
export interface Gateway {
  readonly mode: 'guest' | 'account';
  getHousehold(): Promise<HouseholdView>;
  updateHousehold(patch: HouseholdPatch): Promise<HouseholdView>;
  addMember(data: Partial<Member> & { name: string }): Promise<Member>;
  updateMember(id: string, patch: Partial<Member>): Promise<Member>;
  deleteMember(id: string): Promise<void>;
  listMenus(): Promise<MenuSummary[]>;
  getMenu(id: string): Promise<MenuRecord>;
  generateMenu(params: GenerateParams): Promise<MenuRecord>;
  applyOp(menuId: string, op: unknown, expectedRevision: number | null): Promise<MenuRecord>;
  updateMenuMeta(id: string, patch: { title?: string; is_favorite?: boolean }): Promise<void>;
  deleteMenu(id: string): Promise<void>;
  candidates(menuId: string, itemId: string): Promise<RankedCandidate[]>;
  getShopping(menuId: string): Promise<ShoppingView>;
  patchShopping(menuId: string, patch: Partial<ShoppingState>, expectedRevision: number | null): Promise<ShoppingView>;
  transferPurchases(menuId: string, lineIds: string[]): Promise<{ added: string[]; skipped: string[] }>;
  cook(menuId: string, batchId: string): Promise<{ created: boolean }>;
  getReport(menuId: string): Promise<MemberReport[]>;
  listPantry(): Promise<PantryRecord[]>;
  addPantry(item: Omit<PantryRecord, 'id'>): Promise<PantryRecord>;
  updatePantry(id: string, patch: Partial<PantryRecord>): Promise<PantryRecord>;
  deletePantry(id: string): Promise<void>;
  listPrices(): Promise<{ own: OwnPrice[]; profile: PriceProfile }>;
  addPrices(entries: NewPrice[]): Promise<{ shared: number }>;
  deletePrice(id: string): Promise<void>;
  listFavorites(): Promise<string[]>;
  setFavorite(recipeId: string, on: boolean): Promise<string[]>;
  listCustomRecipes(): Promise<Recipe[]>;
  saveCustomRecipe(recipe: Recipe): Promise<Recipe>;
  deleteCustomRecipe(id: string): Promise<void>;
  water(memberId: string, days?: number): Promise<WaterView>;
  addWater(memberId: string, amountMl: number): Promise<void>;
  deleteWater(id: string): Promise<void>;
  habits(): Promise<HabitView[]>;
  addHabit(memberId: string, name: string): Promise<HabitView>;
  deleteHabit(id: string): Promise<void>;
  markHabit(id: string, localDate: string, done: boolean): Promise<HabitView>;
}
