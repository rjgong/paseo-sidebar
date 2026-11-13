import { completeTask } from "./notion";

export interface CompletionResult {
  taskId: string;
  name: string;
  description: string;
  tag: string;
  source: string;
  completedAt: string;
  releasedNext: string;
}

/** Sidebar and notification cards share the same completion path. */
export async function completeTaskWithReceipt(id: string, name: string): Promise<CompletionResult> {
  const completed = await completeTask(id);
  return {
    taskId: id,
    name: completed.title || name,
    description: completed.description,
    tag: completed.tag,
    source: completed.source,
    completedAt: completed.completedAt,
    releasedNext: completed.releasedNext,
  };
}
