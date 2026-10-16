import { compareStr } from './basics';
import { snapshotCatalog } from './catalog';
import { addInto, newNutrientTable, NutritionCache, servingMassG } from './nutrition';
import type { NutrientTable } from './nutrition';
import { resolveVitaminTargets } from './targets';
import type { TargetStatus } from './targets';
import { VITAMIN_IDS } from './types';
import type { Catalog, Member, Menu, VitaminId } from './types';

// Per-member nutrition of a menu. Each member's numbers come from their own portion (share of the
// batch), never from a family average. Vitamin coverage is reported per planning period; when part
// of the data is unknown only a lower bound is shown — never a confirmed 100 %.

export type EnergyStatus = 'ok' | 'below' | 'above' | 'no_target';

export interface MemberDayReport {
  date: string;
  totals: NutrientTable;
  portion_mass_g: number | null;
  energy_target: number | null;
  energy_deviation_pct: number | null;
  energy_status: EnergyStatus;
}

export interface VitaminRow {
  nutrient: VitaminId;
  status: TargetStatus | 'incomplete_data';
  daily_target: number | null;
  period_target: number | null;
  period_value: number;
  coverage_pct: number | null;
  lower_bound_pct: number | null;
  data_complete: boolean;
  missing_products: string[];
  message: string;
  set_status: string | null;
}

export interface MemberReport {
  member_id: string;
  name: string;
  days: MemberDayReport[];
  period: NutrientTable;
  vitamins: VitaminRow[];
}

export function menuReport(menu: Menu, baseCatalog: Catalog, members: Member[]): MemberReport[] {
  const catalog = snapshotCatalog(menu, baseCatalog);
  const cache = new NutritionCache(catalog);
  const batches = new Map(menu.batches.map((b) => [b.id, b]));
  const tolerance = menu.settings.tolerances.energy_pct;
  const reports: MemberReport[] = [];
  for (const member of members) {
    if (!menu.member_ids.includes(member.id)) continue;
    const days: MemberDayReport[] = [];
    const period = newNutrientTable();
    const dates = [...new Set(menu.meals.map((m) => m.date))].sort(compareStr);
    for (const date of dates) {
      const totals = newNutrientTable();
      let mass: number | null = 0;
      for (const meal of menu.meals) {
        if (meal.date !== date) continue;
        for (const item of meal.items) {
          const factor = item.portions[member.id];
          if (factor === undefined) continue;
          const batch = batches.get(item.batch_id);
          const recipe = batch ? catalog.recipes[batch.recipe_id] : undefined;
          if (!batch || !recipe) continue;
          addInto(totals, cache.perServing(recipe.id), factor);
          const serving = servingMassG(recipe);
          mass = mass === null || serving === null ? null : mass + serving * factor;
        }
      }
      addInto(period, totals, 1);
      const target = member.portion_mode === 'target' ? member.kcal_target : null;
      let deviation: number | null = null;
      let status: EnergyStatus = 'no_target';
      if (target) {
        deviation = ((totals.kcal.value - target) / target) * 100;
        status = Math.abs(deviation) <= tolerance ? 'ok' : deviation < 0 ? 'below' : 'above';
      }
      days.push({ date, totals, portion_mass_g: mass, energy_target: target, energy_deviation_pct: deviation, energy_status: status });
    }
    const vitamins: VitaminRow[] = [];
    const resolved = resolveVitaminTargets(catalog, member, menu.settings.vitamins.target_set, menu.settings.vitamins.demo);
    for (const vit of VITAMIN_IDS) {
      const t = resolved.find((r) => r.nutrient === vit);
      const amount = period[vit];
      const row: VitaminRow = {
        nutrient: vit,
        status: t?.status ?? 'no_target',
        daily_target: t?.daily ?? null,
        period_target: t?.daily != null ? t.daily * dates.length : null,
        period_value: amount.value,
        coverage_pct: null,
        lower_bound_pct: null,
        data_complete: amount.complete,
        missing_products: [...amount.missing].sort(compareStr),
        message: t?.message ?? '',
        set_status: t?.setStatus ?? null,
      };
      if (t?.status === 'ok' && row.period_target) {
        const pct = (amount.value / row.period_target) * 100;
        if (amount.complete) row.coverage_pct = pct;
        else {
          row.lower_bound_pct = pct;
          row.status = 'incomplete_data';
          row.message = 'Данные о витамине известны не для всех продуктов: показана нижняя граница.';
        }
      }
      vitamins.push(row);
    }
    reports.push({ member_id: member.id, name: member.name, days, period, vitamins });
  }
  return reports;
}
