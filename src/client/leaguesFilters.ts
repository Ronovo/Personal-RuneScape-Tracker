export const TASK_FILTER_ALL = 'All';

export type TaskFilterState = {
  region: string;
  difficulty: string;
  activityType: string;
};

export function matchesTaskFilters(
  task: TaskFilterState,
  active: TaskFilterState,
  all = TASK_FILTER_ALL,
): boolean {
  return (active.region === all || task.region === active.region)
    && (active.difficulty === all || task.difficulty === active.difficulty)
    && (active.activityType === all || task.activityType === active.activityType);
}
