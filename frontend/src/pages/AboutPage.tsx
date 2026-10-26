import type { ReactNode } from 'react';
import { APP_NAME, APP_VERSION, CONTACT_EMAIL, NATIVE_BUILD, OPERATOR, STATIC_BUILD } from '../lib/config';
import { useApp } from '../state/app';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { Banner } from '../ui/kit';

const FACTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'sparkle', title: 'Бесплатно', text: 'Все основные функции — без подписок, пробных периодов и рекламы.' },
  { icon: 'user', title: 'Без регистрации', text: 'Меню, рецепты и покупки работают сразу, аккаунт — по желанию.' },
  { icon: 'shield', title: 'Данные у вас', text: 'В гостевом режиме профили и меню не уходят на сервер.' },
];

function Point({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="about-point">
      <span className="about-point-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <h3>{title}</h3>
        <p className="muted">{children}</p>
      </div>
    </div>
  );
}

export default function AboutPage() {
  const { catalogSource } = useApp();
  const edition = NATIVE_BUILD ? 'Приложение для Android' : STATIC_BUILD ? 'Гостевая версия сайта' : 'Полная версия';
  return (
    <div className="stack narrow" style={{ ['--gap' as string]: '18px' }}>
      <header className="about-hero fade-in">
        <span className="brand-mark about-mark" aria-hidden="true">
          <Icon name="chef" size={30} />
        </span>
        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          <div className="eyebrow">О сервисе</div>
          <h1>{APP_NAME}</h1>
          <p className="lead">Планировщик питания для семьи: меню на 1–35 дней, порции и КБЖУ, рецепты, остатки дома и список покупок.</p>
          <div className="row wrap" style={{ ['--gap' as string]: '6px' }}>
            <span className="badge">Версия {APP_VERSION}</span>
            <span className="badge">{edition}</span>
            <span className="badge">Каталог: {catalogSource === 'bundled' ? 'встроенный' : 'с сервера'}</span>
          </div>
        </div>
      </header>

      <section className="about-facts" aria-label="Коротко">
        {FACTS.map((f) => (
          <div key={f.title} className="card about-fact">
            <span className="about-point-icon" aria-hidden="true">
              <Icon name={f.icon} size={18} />
            </span>
            <h2 className="h3">{f.title}</h2>
            <p className="muted small">{f.text}</p>
          </div>
        ))}
      </section>

      <Banner icon="info">
        {APP_NAME} не является медицинским сервисом и не даёт медицинских рекомендаций. Расчёты — ориентир. Решения о диете при заболеваниях, беременности и для детей принимайте со специалистом.
      </Banner>

      <section className="card stack about-section" id="privacy" style={{ ['--gap' as string]: '18px' }}>
        <h2>Обработка данных</h2>
        {OPERATOR && <p className="muted">Оператор: {OPERATOR}.</p>}
        <Point icon="user" title="Гостевой режим">
          Профили семьи, ограничения, меню, остатки и привычки хранятся только {NATIVE_BUILD ? 'на этом телефоне, в памяти приложения' : 'в вашем браузере'} (IndexedDB) и не передаются на сервер. С сервера загружаются только общедоступные каталог и цены — по идентификатору города и сети. Местоположение используется только на устройстве для выбора ближайшего города.
        </Point>
        {NATIVE_BUILD && (
          <Point icon="download" title="Приложение для Android">
            Данные не попадают в резервные копии Android и удаляются вместе с приложением. В сеть приложение обращается только за обновлениями: анонимный запрос к GitHub (IP-адрес и версия приложения) и загрузка файла новой версии.
          </Point>
        )}
        <Point icon="shield" title="Аккаунт">
          Для синхронизации на сервере хранятся адрес почты, пароль в виде хеша и данные вашей семьи. Доступ к ним есть только у вас и приглашённых вами участников. Все свои данные можно выгрузить, а аккаунт — удалить в разделе «Аккаунт».
        </Point>
        <Point icon="store" title="Цены">
          Если вы включите «Делиться ценами анонимно», в общую статистику попадают только цена, продукт, сеть, город и дата — без связи с вашим аккаунтом.
        </Point>
        <Point icon="info" title="Cookies">
          Только служебные: сессия входа и защита от подделки запросов. Рекламы и сторонней аналитики нет.
        </Point>
      </section>

      {CONTACT_EMAIL && (
        <section className="card stack about-section" id="contacts">
          <h2>Контакты</h2>
          <p>
            Вопросы, предложения и ошибки в рецептах: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>
      )}

      <section className="card stack about-section">
        <h2>Источники и лицензии</h2>
        <ul className="about-list">
          <li>Рецепты и тексты — собственные материалы {APP_NAME}.</li>
          <li>Пищевая ценность стартовой базы — оценочные значения, не верифицированы; помечены в карточках.</li>
          <li>Нормы витаминов МР 2.3.1.0253-21 внесены со статусом «не сверено с первоисточником».</li>
          <li>Справочник городов — hflabs/city, лицензия CC BY-SA 4.0 (HFLabs).</li>
          <li>Шрифт интерфейса Onest — SIL Open Font License 1.1; шрифт PDF DejaVu Sans — лицензия Bitstream Vera / public domain.</li>
          <li>Фотографии блюд — только с указанием автора и свободной лицензии (Wikimedia Commons и Openverse); без фото показывается иллюстрация.</li>
        </ul>
      </section>
    </div>
  );
}
