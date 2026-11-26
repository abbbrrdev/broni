// ═══════════════════════════════════════════════════════════
//  C A L L S   S T O R E  —  история телефонных разговоров
// ═══════════════════════════════════════════════════════════

export interface DialogEntry {
  role: 'admin' | 'ai_response' | 'system_instruction';
  content: string;
}

export const callHistory = new Map<string, DialogEntry[]>();

export function getHistory(taskId: string): DialogEntry[] {
  if (!callHistory.has(taskId)) callHistory.set(taskId, []);
  return callHistory.get(taskId)!;
}

export function pushEntry(taskId: string, role: DialogEntry['role'], content: string) {
  getHistory(taskId).push({ role, content });
}
