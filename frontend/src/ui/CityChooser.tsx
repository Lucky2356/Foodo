import { useEffect, useMemo, useState } from 'react';
import { chainsForCity, detectCity, loadChains, loadCities, searchCities } from '../data/geo';
import type { Chain, City } from '../data/geo';
import { useApp } from '../state/app';
import { Icon } from './icons';
import { Chip } from './kit';

/**
 * City and store choice, used by the questionnaire and the settings. The location is resolved on the
 * device against the bundled city list; only the chosen city and chain ids are stored.
 */
export function CityChooser({
  cityId,
  chainId,
  onCity,
  onChain,
}: {
  cityId: string | null;
  chainId: string | null;
  onCity: (city: City) => void | Promise<void>;
  onChain: (chain: Chain | null) => void | Promise<void>;
}) {
  const { reportError } = useApp();
  const [cities, setCities] = useState<City[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [query, setQuery] = useState('');
  const [detecting, setDetecting] = useState(false);
  useEffect(() => {
    void loadCities().then(setCities);
    void loadChains().then(setChains);
  }, []);
  const city = useMemo(() => cities.find((c) => c.id === cityId) ?? null, [cities, cityId]);
  const available = city ? chainsForCity(chains, city) : [];
  const detect = async () => {
    setDetecting(true);
    try {
      const found = await detectCity();
      await onCity(found.city);
    } catch (e) {
      reportError(e);
    } finally {
      setDetecting(false);
    }
  };
  return (
    <div className="stack" style={{ ['--gap' as string]: '12px' }}>
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={() => void detect()} disabled={detecting}>
          {detecting ? <span className="spinner" /> : <Icon name="location" size={18} />} Определить мой город
        </button>
        {city && (
          <span className="badge green">
            <Icon name="location" size={14} /> {city.name}, {city.region}
          </span>
        )}
      </div>
      <label className="search">
        <span className="visually-hidden">Найти город</span>
        <Icon name="search" size={18} />
        <input className="input" placeholder="Или найдите город вручную" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {query && (
        <div className="chips">
          {searchCities(cities, query, 12).map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip"
              onClick={() => {
                setQuery('');
                void onCity(c);
              }}
            >
              {c.name} <span className="faint small">{c.region}</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted tiny">Местоположение используется только на этом устройстве, чтобы найти ближайший город из встроенного списка; координаты никуда не отправляются.</p>
      {city && (
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Где обычно покупаете</span>
          <div className="chips">
            <Chip on={!chainId} onClick={() => void onChain(null)}>
              Любой магазин
            </Chip>
            {available.map((c) => (
              <Chip key={c.id} on={chainId === c.id} onClick={() => void onChain(c)}>
                {c.name}
              </Chip>
            ))}
          </div>
          <p className="muted tiny">Без выбора магазина считаем по средним ценам Росстата для вашего города или региона. Список сетей составлен по открытым данным и может быть неточным.</p>
        </div>
      )}
    </div>
  );
}
