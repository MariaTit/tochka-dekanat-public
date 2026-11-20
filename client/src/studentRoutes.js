export const STUDENT_NAVIGATION = [
  { path: '/student', label: 'Главная', icon: 'home' },
  { path: '/student/schedule', label: 'Расписание', icon: 'calendar' },
  { path: '/student/grades', label: 'Оценки', icon: 'grades' },
  { path: '/student/documents', label: 'Документы', icon: 'document' },
  { path: '/student/more', label: 'Ещё', icon: 'more' },
];

export function isStudentPath(path) {
  return path === '/student/profile' || STUDENT_NAVIGATION.some((item) => item.path === path);
}
