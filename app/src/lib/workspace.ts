/**
 * The active workspace.
 *
 * SPEC §12.3 item 1: "The client must never assume there is one workspace."
 * P0a has exactly one and shows no switcher — but it reaches it through this
 * module rather than through a hardcoded constant at every call site, so
 * adding a second one later is a change here and nowhere else.
 *
 * The ids are fixed for P0a so that rows created before there is a server
 * still line up with the workspace P1 creates. They are deliberately not
 * derived from anything user-specific (SPEC §12 item 7).
 */

const LOCAL_WORKSPACE_ID = '01920000-0000-7000-8000-000000000001'
const LOCAL_PROJECT_ID = '01920000-0000-7000-8000-000000000002'
const LOCAL_SECTION_ID = '01920000-0000-7000-8000-000000000003'
const LOCAL_DONE_SECTION_ID = '01920000-0000-7000-8000-000000000004'

export interface WorkspaceContext {
  workspaceId: string
  /** P0a's one hardcoded list. P0b replaces this with real projects. */
  projectId: string
  sectionId: string
  /**
   * SPEC §4: where a completed task lands. Created in the v2 migration;
   * nothing moves tasks into it until the sections UI exists.
   */
  doneSectionId: string
}

export function activeWorkspace(): WorkspaceContext {
  return {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: LOCAL_PROJECT_ID,
    sectionId: LOCAL_SECTION_ID,
    doneSectionId: LOCAL_DONE_SECTION_ID,
  }
}
