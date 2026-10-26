import { useRef, useState } from 'react';
import { useApp } from '../state/app';
import { downloadJson, exportGuestData, importGuestData, migrateExport } from '../data/backup';
import type { GuestExport } from '../data/backup';
import { ApiError } from '../data/api';
import { NATIVE_BUILD } from '../lib/config';
import { deviceTimeZone, localDate } from '../lib/dates';
import { plural } from '../lib/format';
import { Icon } from './icons';
import { Banner, Sheet } from './kit';

/** Backup and restore of the guest's local data: shown in the profile and on the «Данные» page. */
export function GuestDataCard() {
  const { catalog, reportError, toast, refreshHousehold, bump, setCurrentMenuId } = useApp();
  const [restoring, setRestoring] = useState<GuestExport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const restore = async (mode: 'replace' | 'merge') => {
    if (!restoring) return;
    try {
      const r = await importGuestData(restoring, mode, catalog);
      setRestoring(null);
      if (mode === 'replace') setCurrentMenuId(null);
      await refreshHousehold();
      bump();
      toast(`Восстановлено: ${r.members} ${plural(r.members, 'участник', 'участника', 'участников')}, ${r.menus} меню`, { tone: 'success' });
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <section className="card stack">
      <h2>Мои данные на этом устройстве</h2>
      <Banner icon="info">
        {NATIVE_BUILD
          ? 'Данные хранятся только на этом телефоне и не синхронизируются. Удаление приложения удалит их — сохраняйте резервную копию.'
          : 'Без аккаунта данные хранятся только в этом браузере и не синхронизируются. Очистка данных браузера удалит их — сохраняйте резервную копию.'}
      </Banner>
      <div className="row wrap">
        <button
          className="btn"
          onClick={async () => {
            try {
              await downloadJson(`foodo-backup-${localDate(deviceTimeZone())}.json`, await exportGuestData());
            } catch (e) {
              reportError(e);
            }
          }}
        >
          <Icon name="download" size={18} /> Резервная копия (JSON)
        </button>
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> Восстановить из файла
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              let parsed: unknown;
              try {
                parsed = JSON.parse(await file.text());
              } catch {
                throw new ApiError('invalid_import', 'Файл не читается как резервная копия Foodo (JSON).', 400);
              }
              setRestoring(migrateExport(parsed));
            } catch (err) {
              reportError(err);
            }
          }}
        />
      </div>
      {restoring && (
        <Sheet
          open
          onClose={() => setRestoring(null)}
          title="Восстановить из файла"
          footer={
            <>
              <button className="btn primary" onClick={() => void restore('replace')}>
                Заменить
              </button>
              <button className="btn" onClick={() => void restore('merge')}>
                Добавить к текущим
              </button>
              <button className="btn ghost" onClick={() => setRestoring(null)}>
                Отмена
              </button>
            </>
          }
        >
          <div className="stack">
            <p>
              В файле от {new Date(restoring.exported_at).toLocaleDateString('ru-RU')}: {restoring.members.length} {plural(restoring.members.length, 'участник', 'участника', 'участников')}, {restoring.menus.length} меню, {restoring.pantry.length} {plural(restoring.pantry.length, 'продукт', 'продукта', 'продуктов')} в остатках.
            </p>
            <p className="small">
              <strong>Заменить</strong> — данные в этом {NATIVE_BUILD ? 'приложении' : 'браузере'} будут заменены содержимым файла, включая город, магазин и бюджет.
            </p>
            <p className="small">
              <strong>Добавить к текущим</strong> — ничего не перезаписывается: добавятся только записи, которых здесь ещё нет; настройки семьи останутся текущими.
            </p>
          </div>
        </Sheet>
      )}
    </section>
  );
}
