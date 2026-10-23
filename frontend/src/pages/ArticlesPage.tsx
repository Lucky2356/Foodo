import { Link, useParams } from 'react-router-dom';
import { seedArticles } from '../data/seed';
import { Icon } from '../ui/icons';
import { Empty, PageHead } from '../ui/kit';

export default function ArticlesPage() {
  const { articleId } = useParams();
  const article = articleId ? seedArticles.find((a) => a.id === articleId) : null;
  if (articleId && !article) return <Empty page icon="leaf" title="Статья не найдена" action={<Link className="btn" to="/articles">Все статьи</Link>} />;
  if (article) {
    return (
      <article className="stack fade-in" style={{ ['--gap' as string]: '16px' }}>
        <Link to="/articles" className="btn ghost small" style={{ alignSelf: 'flex-start' }}>
          <Icon name="back" size={16} /> Все статьи
        </Link>
        <span className="badge green" style={{ alignSelf: 'flex-start' }}>
          {article.category_name}
        </span>
        <h1>{article.title}</h1>
        <div className="prose">
          {article.body.split('\n\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </article>
    );
  }
  return (
    <div className="stack">
      <PageHead eyebrow="Журнал" title="Статьи" subtitle="Коротко о меню, КБЖУ, покупках и честных данных." />
      <div className="grid">
        {seedArticles.map((a) => (
          <Link key={a.id} to={`/articles/${a.id}`} className="card card-link stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="badge green" style={{ alignSelf: 'flex-start' }}>
              {a.category_name}
            </span>
            <h2 className="h3">{a.title}</h2>
            <p className="muted small">{a.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
