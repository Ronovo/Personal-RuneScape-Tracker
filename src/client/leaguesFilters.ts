export const TASK_FILTER_ALL = 'All';

export type TaskFilterState = {
  region: string;
  difficulty: string;
  activityType: string;
};

export function matchesTaskFilters(task: TaskFilterState, active: TaskFilterState): boolean {
  return (active.region === TASK_FILTER_ALL || task.region === active.region)
    && (active.difficulty === TASK_FILTER_ALL || task.difficulty === active.difficulty)
    && (active.activityType === TASK_FILTER_ALL || task.activityType === active.activityType);
}
