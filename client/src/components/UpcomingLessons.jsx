import { useState } from 'react';
import useSchedule from '../hooks/useSchedule.js';
import ScheduleState from './ScheduleState.jsx';
import LessonCard from './LessonCard.jsx';
import LessonDetails from './LessonDetails.jsx';

export default function UpcomingLessons({ onSessionExpired }) {
  const state = useSchedule('/student/schedule/upcoming', onSessionExpired);
  const [selected, setSelected] = useState(null);
  return <>
    <p className="demo-note">Демонстрационные занятия · время по Москве</p>
    <ScheduleState state={state} emptyTitle="Ближайших занятий нет">
      <div className="lesson-list upcoming-lessons">{state.data?.lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} onSelect={(item) => setSelected(item.id)} />)}</div>
    </ScheduleState>
    {selected !== null && <LessonDetails lessonId={selected} onClose={() => setSelected(null)} onSessionExpired={onSessionExpired} />}
  </>;
}
