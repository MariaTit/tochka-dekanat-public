import { useState } from 'react';

export default function MessageRecipientPicker({ recipients, role, busy, onOpen }) {
  const [department, setDepartment] = useState('');
  const [course, setCourse] = useState('');
  const [group, setGroup] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const inDepartment = recipients.filter((item) => JSON.stringify(item.department) === department);
  const inCourse = inDepartment.filter((item) => JSON.stringify(item.course) === course);
  const inGroup = inCourse.filter((item) => JSON.stringify(item.group) === group);
  const options = (items, field) => [...new Set(items.map((item) => JSON.stringify(item[field])))].map((value) =>
    <option key={value} value={value}>{JSON.parse(value) ?? 'Не указано в профиле'}</option>);
  return <form onSubmit={(event) => { event.preventDefault(); if (recipientId) onOpen(Number(recipientId)); }}>
    <fieldset className="message-recipient-fields" disabled={busy}>
      {role === 'staff' && <>
        <div><label htmlFor="message-department">Факультет / институт</label>
          <select id="message-department" value={department} onChange={(event) => {
            setDepartment(event.target.value); setCourse(''); setGroup(''); setRecipientId('');
          }}><option value="">Выберите факультет / институт</option>{options(recipients, 'department')}</select></div>
        <div><label htmlFor="message-course">Курс</label>
          <select id="message-course" value={course} disabled={!department} onChange={(event) => {
            setCourse(event.target.value); setGroup(''); setRecipientId('');
          }}><option value="">Выберите курс</option>{options(inDepartment, 'course')}</select></div>
        <div><label htmlFor="message-group">Учебная группа</label>
          <select id="message-group" value={group} disabled={!course} onChange={(event) => {
            setGroup(event.target.value); setRecipientId('');
          }}><option value="">Выберите группу</option>{options(inCourse, 'group')}</select></div>
      </>}
      <div><label htmlFor="message-recipient">{role === 'staff' ? 'ФИО студента' : 'Сотрудник учебного офиса'}</label>
        <select id="message-recipient" required value={recipientId} disabled={role === 'staff' && !group}
          onChange={(event) => setRecipientId(event.target.value)}>
          <option value="">Выберите получателя</option>{(role === 'staff' ? inGroup : recipients).map((item) =>
            <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></div>
      <button type="submit" disabled={!recipientId}>{busy ? 'Открываем…' : 'Открыть переписку'}</button>
    </fieldset>
  </form>;
}
