import EmptyState from '../components/EmptyState.jsx';
import StudentLink from '../components/StudentLink.jsx';

const SECTIONS = {
  '/student/schedule': { title: 'Расписание', icon: 'calendar', description: 'Занятия и учебная неделя в одном месте.', detail: 'Расписание занятий пока не реализовано. Предметы, преподаватели, аудитории и даты появятся после подключения учебных данных.' },
  '/student/grades': { title: 'Оценки', icon: 'grades', description: 'Информация о вашей успеваемости.', detail: 'Раздел оценок пока не реализован. Учебные результаты и сведения об успеваемости ещё не подключены.' },
  '/student/documents': { title: 'Документы', icon: 'document', description: 'Будущий раздел документов и заявок.', detail: 'Заказ справок, отправка заявок и отслеживание их статусов пока недоступны. Этот раздел будет реализован в отдельном блоке.' },
};

export default function StudentSectionPage({ path, onNavigate }) {
  const section = SECTIONS[path];
  return <>
    <div className="page-heading"><p className="eyebrow">Кабинет студента</p><h1>{section.title}</h1><p>{section.description}</p></div>
    <section className="student-card section-placeholder" aria-label={`Раздел «${section.title}»`}>
      <span className="section-status">В разработке</span>
      <EmptyState icon={section.icon} title="Раздел появится позже">{section.detail}</EmptyState>
      <StudentLink className="text-link" to="/student" onNavigate={onNavigate}>На главную</StudentLink>
    </section>
  </>;
}
