import { useRef, useState } from 'react';
import GradesResults from '../components/GradesResults.jsx';
import GradesState from '../components/GradesState.jsx';
import useApiResource from '../hooks/useApiResource.js';

const TABS = [{ id: 'current', title: 'Текущие результаты' }, { id: 'attestation', title: 'Аттестация' }];

export default function StudentGradesPage({ onSessionExpired }) {
  const [tab, setTab] = useState('current');
  const buttons = useRef([]);
  const state = useApiResource('/student/grades', onSessionExpired);
  function onTabKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    buttons.current[next].focus();
  }
  return <>
    <div className="page-heading"><p className="eyebrow">Кабинет студента</p><h1>Оценки и успеваемость</h1>
      <p>Текущий контроль, экзамены и зачёты по вашим дисциплинам.</p></div>
    <section className="student-card grades-section" aria-label="Учебные результаты">
      <div className="grades-tabs" role="tablist" aria-label="Вид учебных результатов">
        {TABS.map((item, index) => <button key={item.id} type="button" role="tab" id={`grades-tab-${item.id}`}
          aria-controls="grades-panel" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
          ref={(element) => { buttons.current[index] = element; }}
          onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKey(event, index)}>{item.title}</button>)}
      </div>
      <div id="grades-panel" role="tabpanel" aria-labelledby={`grades-tab-${tab}`} tabIndex={0}>
        <GradesState state={state}>
          {state.data && <>
            {state.data.disciplines.some((discipline) => discipline.isDemo) && <p className="grades-demo-note">
              Демонстрационные учебные результаты. Все сведения вымышлены и не являются данными университета.
            </p>}
            <GradesResults disciplines={state.data.disciplines} current={tab === 'current'} />
            <p className="grades-footnote">Если результат ещё не опубликован, это не означает академическую задолженность.</p>
          </>}
        </GradesState>
      </div>
    </section>
  </>;
}
