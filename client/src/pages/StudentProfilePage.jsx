import Icon from '../components/Icon.jsx';

export default function StudentProfilePage({ user }) {
  const fields = [
    ['ФИО', user.fullName],
    ['Факультет / институт', user.department],
    ['Направление подготовки', user.studyProgram],
    ['Курс', user.course],
    ['Учебная группа', user.studentGroup],
    ['Email', user.email],
  ];
  return <>
    <div className="page-heading"><p className="eyebrow">Личные сведения</p><h1>Мой профиль</h1><p>Данные вашего аккаунта в «Точке».</p></div>
    <section className="student-card student-profile" aria-labelledby="profile-title">
      <div className="profile-summary"><span className="avatar avatar-large"><Icon name="user" /></span><div><h2 id="profile-title">{user.fullName || 'Не указано'}</h2><p>Студент</p></div></div>
      <dl className="student-profile-data">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null || String(value).trim() === '' ? 'Не указано' : value}</dd></div>)}</dl>
      <p className="profile-footnote">Показаны сведения из текущего аккаунта. Редактирование профиля пока недоступно.</p>
    </section>
  </>;
}
