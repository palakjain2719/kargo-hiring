import type { EmailDraft, WorkflowStatus } from "./types";

export const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  processing: "Processing",
  analysed: "Analysed",
  shortlisted: "Shortlisted",
  finalist: "Finalist",
  selected: "Selected",
  rejected: "Rejected",
};

/**
 * Transitions the founder can make directly. "selected" is reachable only through
 * the confirm-selections action (/api/selections/confirm), never a single click.
 */
export const MANUAL_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  processing: [],
  analysed: ["shortlisted", "rejected"],
  shortlisted: ["finalist", "rejected", "analysed"],
  finalist: ["rejected", "shortlisted"],
  selected: ["finalist"],
  rejected: ["analysed"],
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus) {
  return MANUAL_TRANSITIONS[from].includes(to);
}

export const ACTION_LABEL: Partial<Record<WorkflowStatus, string>> = {
  shortlisted: "Shortlist",
  finalist: "Move to finalist",
  rejected: "Reject",
  analysed: "Back to analysed",
};

/** Human-readable combined status, e.g. "Selected · Email Draft Ready". */
export function displayStatus(wf: WorkflowStatus, draft: EmailDraft | undefined) {
  const base = WORKFLOW_LABEL[wf];
  if (!draft) return base;
  const comm = { draft: "Email Draft Ready", approved: "Email Approved", sent: "Sent", failed: "Send Failed" }[draft.status];
  return `${base} · ${comm}`;
}
