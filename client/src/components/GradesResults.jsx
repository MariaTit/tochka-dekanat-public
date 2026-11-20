const TYPES = { exam: 'Экзамен', credit: 'Зачёт' };

function ResultValue({ result, current }) {
  if (!result || (current ? result.points === null : result.result === null)) {
    return <span className="muted">Нет результата</span>;
  }
  return <strong className="grade-value">{current ? `${result.points} из ${result.maxPoints} баллов` : result.result}</strong>;
}

function ResultStatus({ result, current }) {
  const published = result?.status === 'published';
  return <span className={`grade-status${published ? ' grade-status--published' : ''}`}>
    {current ? (published ? 'Опубликован' : 'Не опубликован') : (published ? 'Выставлен' : 'Не выставлен')}
  </span>;
}

export default function GradesResults({ disciplines, current }) {
  const field = current ? 'currentResults' : 'attestations';
  const rows = disciplines.flatMap((discipline) => (discipline[field].length ? discipline[field] : [null])
    .map((result) => ({ discipline, result, key: `${discipline.id}-${result?.id ?? 'empty'}` })));
  const rules = [...new Set(rows.map(({ result }) => current ? result?.scaleRules : result?.gradingRules).filter(Boolean))];
  const typeLabel = current ? 'Вид контроля' : 'Вид аттестации';
  const type = (result) => (current ? result?.controlType : TYPES[result?.type]) || 'Не указан';
  return <>
    <table className="grades-table">
      <caption className="visually-hidden">{current ? 'Текущие результаты по дисциплинам' : 'Результаты экзаменов и зачётов'}</caption>
      <thead><tr><th scope="col">Дисциплина</th><th scope="col">{typeLabel}</th><th scope="col">Результат</th><th scope="col">Статус</th></tr></thead>
      <tbody>{rows.map(({ discipline, result, key }) => <tr key={key}>
        <th scope="row">{discipline.name}<span className="grade-period">{discipline.period}</span></th>
        <td>{type(result)}</td><td><ResultValue result={result} current={current} /></td>
        <td><ResultStatus result={result} current={current} /></td>
      </tr>)}</tbody>
    </table>
    <div className="grades-cards">{rows.map(({ discipline, result, key }) => <article className="grade-card" key={key}>
      <h3>{discipline.name}</h3><p className="grade-period">{discipline.period}</p>
      <dl><div><dt>{typeLabel}</dt><dd>{type(result)}</dd></div>
        <div><dt>Результат</dt><dd><ResultValue result={result} current={current} /></dd></div>
        <div><dt>Статус</dt><dd><ResultStatus result={result} current={current} /></dd></div></dl>
    </article>)}</div>
    {rules.length > 0 && <details className="grades-rules"><summary>Как читать результаты</summary>
      {rules.map((rule) => <p key={rule}>{rule}</p>)}
    </details>}
  </>;
}
